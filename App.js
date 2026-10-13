import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Sentry from '@sentry/react-native';

import * as Notifications from 'expo-notifications';
import { initSentry } from './src/config/sentry';
import { flushAppStorage } from './src/storage/appStorage';
import { expirePreRestoreSnapshot } from './src/backup/backupService';

// Runs once at module load, before anything else in this file — catches
// crashes as early in boot as possible. See src/config/sentry.ts for why
// it's a no-op under __DEV__.
initSentry();

import AppNavigator from './src/navigation/AppNavigator';
import AppKeyboardAvoidingView from './src/components/AppKeyboardAvoidingView';
import AwareRunBoot from './src/components/AwareRunBoot';
import { installSharedSync } from './src/sync/engine';
import { INVITE_BASE, parseInviteLink } from './src/sync/invite';
import { usePresentationSession } from './src/store/usePresentationSession';
import { useStoreHydrated } from './src/hooks/useStoreHydrated';
import AndroidSafeViewport from './src/components/AndroidSafeViewport';
import { useSmsSync } from './src/hooks/useSmsSync';
import { useEPurseStore } from './src/store/ePurseStore';
import { configureNotificationHandler, setupAndroidChannel, setupBudgetAlertChannel, setupSharedGroupChannel } from './src/utils/notifications';
import { ToastProvider } from './src/components/Toast';
import AppLockGate from './src/components/AppLockGate';
import LoginGate from './src/components/LoginGate';
import UpdateRequiredGate from './src/components/UpdateRequiredGate';
// `src/components/SplashOverlay.tsx` (branded gradient/bubbles/wordmark on
// Android) is DELIBERATELY not wired in here — Sep-22-2026: on-device video +
// logcat proved it, but a separate render artifact between the native splash
// and onboarding (a plain gradient with no mark/text) survived both a
// resizeMode change and a full uninstall/reinstall, meaning it isn't
// SplashOverlay's own image at all — most likely an OS-level window
// transition effect outside app control. Kept as a file, unused, in case a
// future attempt wants it back — see the component's own doc + the
// splash-screen memory before touching this again.
import { useRemoteConfigStore } from './src/store/useRemoteConfigStore';
import { useNotificationStore } from './src/store/useNotificationStore';
import { useAppUpdate } from './src/hooks/useAppUpdate';
import * as googleAuth from './src/backup/googleAuth';

// =============================================================================
// Background workers — mounted once at the root, render nothing.
// =============================================================================

/** Sets up push notification handler + Android channel once at startup. */
function NotificationBoot() {
  useEffect(() => {
    configureNotificationHandler();
    setupAndroidChannel();
    setupBudgetAlertChannel();
    setupSharedGroupChannel();
  }, []);
  return null;
}

/**
 * Routes taps on OS notifications to the right in-app view. Currently only
 * `monthly_recap` carries a payload (`data.monthKey`); other kinds just open
 * the app with no extra action, same as before. Handles both a tap while the
 * app is running/backgrounded (the listener) and a tap that COLD-STARTS the
 * app (getLastNotificationResponseAsync, checked once on mount).
 */
function NotificationTapBoot() {
  useEffect(() => {
    let lastId;
    const handle = (response) => {
      const data = response?.notification?.request?.content?.data;
      const id = response?.notification?.request?.identifier;
      if (!id || id === lastId) return;
      lastId = id;
      const modalByType = {
        cc_payment_review: 'ccPayment',
        monthly_recap: 'monthlyRecap',
        weekly_recap: 'weeklyRecap',
        aware_savings_ready: 'epcClaim',
      };
      const modal = modalByType[data?.type];
      if (modal) {
        usePresentationSession.getState().requestModal(
          modal,
          modal === 'monthlyRecap' && typeof data.monthKey === 'string' ? data.monthKey : undefined,
        );
        void Notifications.clearLastNotificationResponseAsync();
        return;
      }
      // Scheduled pushes that open a screen rather than a modal (notificationPlan).
      const budgetTab = { screen: 'Insights', params: { defaultTab: 'budget' } };
      const routeByType = {
        budget_plan: ['Main', { screen: 'Insights', params: { defaultTab: 'budget', openPlan: true } }],
        budget_midmonth: ['Main', budgetTab],
        goal_behind: typeof data?.goalId === 'string' ? ['GoalDetail', { goalId: data.goalId }] : ['Goals'],
        review_reminder: ['Main', { screen: 'Dashboard' }],
      };
      // Server push for a shared group (sync/push.ts): its server id → this phone's group.
      if (data?.type === 'shared_group') {
        const group = useEPurseStore.getState().groups.find((g) => g.shared?.remoteId === data.groupId);
        routeByType.shared_group = group ? ['GroupDetail', { groupId: group.id }] : ['Main', { screen: 'Groups' }];
      }
      const route = routeByType[data?.type];
      if (route) {
        usePresentationSession.getState().requestRoute(route[0], route[1]);
        void Notifications.clearLastNotificationResponseAsync();
      }
    };
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
  return null;
}

/**
 * A shared-group invite link tapped anywhere (WhatsApp, the /join web page) opens
 * Join Group with it filled in — the user still taps Join, so a link can't add them
 * to a group by itself. Either form (https or epurse://) arrives as the https one.
 */
function InviteLinkBoot() {
  useEffect(() => {
    let last;
    const open = (url) => {
      if (!url || url === last || !parseInviteLink(url)) return;
      last = url;
      usePresentationSession.getState().requestRoute('JoinGroup', { link: INVITE_BASE + url.slice(url.indexOf('#')) });
    };
    Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => open(url));
    return () => sub.remove();
  }, []);
  return null;
}

/**
 * Reads the cached remote config, then goes looking for a newer one. Cache
 * first and network second is the order that matters: a section switched off
 * last week must stay off on a launch with no signal, and the blocking gate
 * must not flash while a request is in flight.
 *
 * `refresh()` throttles itself to once every 30 minutes, so calling it on every
 * foreground is cheap — the config file changes a few times a year, and the app
 * only needs to notice within a session or two.
 */
function RemoteConfigBoot() {
  const hydrate = useRemoteConfigStore((s) => s.hydrate);
  const refresh = useRemoteConfigStore((s) => s.refresh);
  useEffect(() => {
    hydrate().then(() => refresh());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [hydrate, refresh]);
  return null;
}

/**
 * The SOFT half of update handling: a newer version exists, the app works fine,
 * and the user gets one bell entry about it. The hard half is UpdateRequiredGate.
 *
 * Checks for an existing entry before adding rather than relying on `add`'s
 * dedupe: `add` REPLACES a matching key, which would reset `isRead` and stamp a
 * fresh `createdAt` on every launch — a notification that keeps coming back
 * unread until you install. Deduping on the VERSION means the next release
 * gets its own entry, and the 15-day prune means a long-ignored one eventually
 * asks again.
 */
function AppUpdateNudgeBoot() {
  const { nudge, latestVersion } = useAppUpdate();
  const add = useNotificationStore((s) => s.add);
  useEffect(() => {
    if (!nudge || !latestVersion) return;
    const dedupeKey = `app_update:${latestVersion}`;
    if (useNotificationStore.getState().entries.some((e) => e.dedupeKey === dedupeKey)) return;
    add({
      kind: 'app_update',
      title: 'Update Available',
      body: `ePurse ${latestVersion} is ready on the store.`,
      dedupeKey,
    });
  }, [nudge, latestVersion, add]);
  return null;
}

/** Boots the Android SMS listener while a real permission is held. */
function SmsSyncBoot() {
  useSmsSync();
  return null;
}

/**
 * Enforces the data retention policy:
 *   • Runs once on launch
 *   • Re-runs whenever the app returns to foreground
 * The store action itself is throttled (max once every 6 hrs), so calling
 * this often is cheap.
 */
function CompactionBoot() {
  const hydrated = useStoreHydrated();
  const compact = useEPurseStore((s) => s.compactTransactions);
  useEffect(() => {
    if (!hydrated) return undefined; // before load there's nothing real to compact
    compact();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') compact();
    });
    return () => sub.remove();
  }, [hydrated, compact]);
  return null;
}

/** Shared-group sync: starts once the store has loaded, and only does work for live groups. */
function SharedSyncBoot() {
  const hydrated = useStoreHydrated();
  useEffect(() => {
    if (hydrated) installSharedSync();
  }, [hydrated]);
  return null;
}

// AppNavigator reads hasOnboarded ONCE, at mount, to pick its first screen. Mounted
// before the store loads it saw the default (false) and opened Onboarding for an
// onboarded user — visible once SQLite made loading slower. ROOT_BG shows meanwhile.
function HydratedNavigator() {
  const hydrated = useStoreHydrated();
  return hydrated ? <AppNavigator /> : null;
}

/**
 * Snapshots the previous month's budget into history when the calendar month
 * rolls over. Also fires the mid-cycle nudge once we're past day 15 (deduped
 * per cycle in the store). Both run at launch and on every return to foreground
 * so they're robust to users who leave the app open across midnight.
 */
/**
 * Keeps the store's googleAccount in sync with what googleAuth.ts actually
 * holds — at boot (SecureStore, not the persisted store, is ground truth for
 * "is there a live Google grant") and for the app's lifetime, so a mid-session
 * token revocation (googleAuth's own auto-sign-out on a failed refresh)
 * surfaces as LoginGate reappearing rather than a silently broken backup.
 */
function AuthSessionBoot() {
  const setGoogleAccount = useEPurseStore((s) => s.setGoogleAccount);
  const setSessionExpired = useEPurseStore((s) => s.setSessionExpired);
  const setAuthChecked = useEPurseStore((s) => s.setAuthChecked);

  useEffect(() => {
    // Never leave LoginGate's blank cover up if SecureStore stalls — after 3s it
    // decides on what it has (isLoggedIn still false ⇒ the gate, as before).
    const fallback = setTimeout(setAuthChecked, 3000);
    (async () => {
      try {
        const signedIn = await googleAuth.isSignedIn();
        const profile = signedIn ? await googleAuth.getSignedInProfile() : null;
        // Hydration REPLACES googleAccount with its stored copy (isLoggedIn isn't stored).
        // Applied before it, a signed-out answer was overwritten by a stale account:
        // "Signed in as …" with isLoggedIn false, and no way past LoginGate.
        if (!useEPurseStore.persist.hasHydrated()) {
          await new Promise((resolve) => {
            const unsub = useEPurseStore.persist.onFinishHydration(() => { unsub(); resolve(); });
          });
        }
        setGoogleAccount(profile);
      } finally {
        clearTimeout(fallback);
        setAuthChecked();
      }
    })();

    const unsubscribe = googleAuth.onSessionChange((signedIn) => {
      if (signedIn) return; // the sign-in path already updates the store itself
      const wasLoggedIn = useEPurseStore.getState().isLoggedIn;
      setGoogleAccount(null);
      if (wasLoggedIn) setSessionExpired(true);
    });
    return () => { clearTimeout(fallback); unsubscribe(); };
  }, [setGoogleAccount, setSessionExpired, setAuthChecked]);

  return null;
}

function BudgetRolloverBoot() {
  const hydrated = useStoreHydrated();
  const rollover   = useEPurseStore((s) => s.rolloverBudgetIfNeeded);
  const goalRollover = useEPurseStore((s) => s.rolloverGoalPlanIfNeeded);
  const markOpened = useEPurseStore((s) => s.markAppOpened);
  const nudge      = useEPurseStore((s) => s.maybeFireMidmonthNudge);
  const subAlerts  = useEPurseStore((s) => s.maybeFireSubscriptionAlerts);
  const ccCycle    = useEPurseStore((s) => s.maybeFireCcCycleHeadsUp);
  const recap      = useEPurseStore((s) => s.maybeQueueMonthlyRecap);
  const weeklyRecap = useEPurseStore((s) => s.maybeQueueWeeklyRecap);
  // Reminders: drop spent one-offs and top the OS queue back up for repeating
  // ones. This pass is what makes a repeat repeat — occurrences are scheduled as
  // absolute dates a few at a time (SDK 50 has no cross-platform monthly
  // trigger), so a repeating reminder is only armed as far ahead as the last time
  // the app was opened. It also re-arms everything after a restore, where the
  // records come back from the backup but the notification ids deliberately
  // don't. See utils/reminderSchedule.
  const reconcileReminders = useEPurseStore((s) => s.reconcileReminders);
  // Last: it plans from what the checks above just decided (recap shown, etc.).
  const replanPushes = useEPurseStore((s) => s.replanPushes);
  useEffect(() => {
    if (!hydrated) return;
    markOpened();
    rollover();
    goalRollover();
    nudge();
    subAlerts();
    ccCycle();
    recap();
    weeklyRecap();
    reconcileReminders();
    replanPushes();
    expirePreRestoreSnapshot();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        markOpened();
        rollover();
        goalRollover();
        nudge();
        subAlerts();
        ccCycle();
        recap();
        weeklyRecap();
        reconcileReminders();
        replanPushes();
      } else if (state === 'background') {
        replanPushes();
        // Don't leave the last few changes in the coalescing window if the OS kills us.
        flushAppStorage();
      }
    });
    return () => sub.remove();
  }, [hydrated, markOpened, rollover, goalRollover, nudge, subAlerts, ccCycle, recap, weeklyRecap, reconcileReminders, replanPushes]);
  return null;
}

// Whatever's behind the native splash's own exit fade is this root view, so it
// must never be the platform default (black on Android) — same brand violet
// the splash ends on, so a slow first frame still reads as "still the splash".
const ROOT_BG = '#5B3CC4';

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: ROOT_BG }}>
      <SafeAreaProvider>
        <AndroidSafeViewport fillBackground>
          <AppKeyboardAvoidingView style={{ flex: 1 }}>
          <ToastProvider>
            <StatusBar style="light" />
            <NotificationBoot />
            <NotificationTapBoot />
            <InviteLinkBoot />
            <RemoteConfigBoot />
            <AppUpdateNudgeBoot />
            <SmsSyncBoot />
            <CompactionBoot />
            <SharedSyncBoot />
            <BudgetRolloverBoot />
            <AwareRunBoot />
            <AuthSessionBoot />
            <HydratedNavigator />
            <AppLockGate />
            <LoginGate />
            <UpdateRequiredGate />
          </ToastProvider>
          </AppKeyboardAvoidingView>
        </AndroidSafeViewport>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap adds a root-level error boundary (reports uncaught render
// errors) and touch-event breadcrumbs — a no-op if Sentry was never
// initialized (dev, or the DSN placeholder still in place).
export default Sentry.wrap(App);
