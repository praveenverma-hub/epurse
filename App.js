import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Sentry from '@sentry/react-native';

import * as Notifications from 'expo-notifications';
import { initSentry } from './src/config/sentry';

// Runs once at module load, before anything else in this file — catches
// crashes as early in boot as possible. See src/config/sentry.ts for why
// it's a no-op under __DEV__.
initSentry();

import AppNavigator from './src/navigation/AppNavigator';
import { useSmsSync } from './src/hooks/useSmsSync';
import { useEPurseStore } from './src/store/ePurseStore';
import { configureNotificationHandler, setupAndroidChannel, setupBudgetAlertChannel } from './src/utils/notifications';
import { ToastProvider } from './src/components/Toast';
import AppLockGate from './src/components/AppLockGate';
import LoginGate from './src/components/LoginGate';
import UpdateRequiredGate from './src/components/UpdateRequiredGate';
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
  const openMonthlyRecap = useEPurseStore((s) => s.openMonthlyRecap);
  useEffect(() => {
    const handle = (response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.type === 'monthly_recap' && data.monthKey) {
        openMonthlyRecap(data.monthKey);
      }
    };
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, [openMonthlyRecap]);
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
  const compact = useEPurseStore((s) => s.compactTransactions);
  useEffect(() => {
    compact();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') compact();
    });
    return () => sub.remove();
  }, [compact]);
  return null;
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

  useEffect(() => {
    (async () => {
      const signedIn = await googleAuth.isSignedIn();
      setGoogleAccount(signedIn ? await googleAuth.getSignedInProfile() : null);
    })();

    return googleAuth.onSessionChange((signedIn) => {
      if (signedIn) return; // the sign-in path already updates the store itself
      const wasLoggedIn = useEPurseStore.getState().isLoggedIn;
      setGoogleAccount(null);
      if (wasLoggedIn) setSessionExpired(true);
    });
  }, [setGoogleAccount, setSessionExpired]);

  return null;
}

function BudgetRolloverBoot() {
  const rollover   = useEPurseStore((s) => s.rolloverBudgetIfNeeded);
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
  useEffect(() => {
    rollover();
    nudge();
    subAlerts();
    ccCycle();
    recap();
    weeklyRecap();
    reconcileReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        rollover();
        nudge();
        subAlerts();
        ccCycle();
        recap();
        weeklyRecap();
        reconcileReminders();
      }
    });
    return () => sub.remove();
  }, [rollover, nudge, subAlerts, ccCycle, recap, weeklyRecap, reconcileReminders]);
  return null;
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ToastProvider>
          <StatusBar style="light" />
          <NotificationBoot />
          <NotificationTapBoot />
          <RemoteConfigBoot />
          <AppUpdateNudgeBoot />
          <SmsSyncBoot />
          <CompactionBoot />
          <BudgetRolloverBoot />
          <AuthSessionBoot />
          <AppNavigator />
          <AppLockGate />
          <LoginGate />
          <UpdateRequiredGate />
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap adds a root-level error boundary (reports uncaught render
// errors) and touch-event breadcrumbs — a no-op if Sentry was never
// initialized (dev, or the DSN placeholder still in place).
export default Sentry.wrap(App);
