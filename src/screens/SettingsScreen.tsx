// =============================================================================
// SettingsScreen — one consistent list. Every row navigates.
//
// Was a bottom sheet inside RewardShop (Region D, Jul-28), then a screen with
// THREE different interaction shapes on one page: Appearance rendered its
// theme grid inline, Monthly recap rendered its toggle (+ conditional
// sub-toggles) inline, and only "Manage" was actual nav rows. Flagged directly
// (Sep-14-26) as inconsistent — some settings lived on the page itself, others
// were a tap away, for no reason a user could predict.
//
// Now every row behaves the same way: tap it, and it opens whatever the
// content actually needs — a SHEET for a short, non-growing decision
// (Appearance: 5 swatches, nothing conditional, nowhere further to go —
// `ThemePickerSheet`, ui-consistency §2b), or a SCREEN for anything with
// conditional/growing rows (Monthly recap's "Report includes" sub-toggles only
// exist while the recap itself is on — `MonthlyRecapSettingsScreen`). The
// Manage rows already worked this way; nothing about them changes here.
//
// Backup used to be a section here. It MOVED to the Profile hub (Aug-31): it is
// its own screen, so a nav row inside a settings section put it three taps from
// home for no reason. It is not duplicated — one entry point, on the hub.
//
// Theme-reactive (`useTheme()`), not the static palette — this is the screen
// that PICKS the theme, so it above all shouldn't be frozen off it.
//
// Rendered PLAIN (Sep-14-26) — no card fill/shadow around the row list, just
// the rows on the page background with hairlines between them, matching the
// same flat treatment given to every screen this one leads to (Notifications,
// Monthly Recap, Expense Inclusions, Categories, Backup). A scoped exception
// to the app's general card-per-section convention (ui-consistency §1b) —
// see the "Settings — rendered plain" note there before extending it further.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, ScrollView, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useEPurseStore } from '../store/ePurseStore';
import { CHANNELS, pushEnabled } from '../constants/notificationPolicy';
import type { NotificationKind } from '../constants/notificationPolicy';
import { getNotificationPermission } from '../utils/notifications';
import { Storage } from '../utils/storage';
import { flushAppStorage } from '../storage/appStorage';
import { spacing } from '../constants/theme';
import { THEMES } from '../constants/themes';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { APP_VERSION } from '../constants/appMeta';
import { useTheme } from '../hooks/useTheme';
import { useGoogleSession } from '../hooks/useGoogleSession';
import { deleteSyncAccount } from '../sync/session';
import NavListRow from '../components/NavListRow';
import PlainScreenHeader from '../components/PlainScreenHeader';
import ThemePickerSheet from '../components/ThemePickerSheet';
import CenterModal from '../components/CenterModal';
import { FormChipRow, FormChip } from '../components/FormField';
import { CLEANUP_CHOICES_YEARS } from '../constants/retention';

type CleanupRemoved = { transactions: number; lentBorrowed: number; people: number; groups: number };

/** Start of this month, N years back — clean-ups take whole months only. */
const cleanupCutoff = (years: number) => {
  const d = new Date();
  return new Date(d.getFullYear() - years, d.getMonth(), 1).getTime();
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;


interface Props {
  navigation: { goBack: () => void; navigate: (route: string) => void };
}

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const SMS_DIAGNOSTIC_ENABLED = useFeatureFlag('smsDiagnostic');
  const RATING_ENABLED = useFeatureFlag('rating');
  const THEME_PICKER_ENABLED = useFeatureFlag('themePicker');

  const themeId = useEPurseStore((s: any) => s.themeId);
  const setThemeId = useEPurseStore((s: any) => s.setThemeId);
  const showMonthlyRecap = useEPurseStore((s: any) => s.showMonthlyRecap);
  const excludedExpenseParents = useEPurseStore((s: any) => s.excludedExpenseParents) as string[];
  const appLockEnabled = useEPurseStore((s: any) => s.appLockEnabled) as boolean;
  const notificationPrefs = useEPurseStore((s: any) => s.notificationPrefs) as Record<string, boolean>;
  const deleteAllUserData = useEPurseStore((s: any) => s.deleteAllUserData);
  const previewHistoryCleanup = useEPurseStore((s: any) => s.previewHistoryCleanup);
  const cleanUpHistory = useEPurseStore((s: any) => s.cleanUpHistory);
  const { signOut, deleteAccount } = useGoogleSession();

  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasSyncAccount = useEPurseStore((s: any) => !!s.syncAccount);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupYears, setCleanupYears] = useState(CLEANUP_CHOICES_YEARS[CLEANUP_CHOICES_YEARS.length - 1]);

  // Re-checked on return from system settings, so the hint can't go stale.
  const [notifBlocked, setNotifBlocked] = useState(false);
  const checkPermission = useCallback(() => {
    getNotificationPermission().then((p) => setNotifBlocked(!p.granted)).catch(() => {});
  }, []);
  useEffect(() => {
    checkPermission();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') checkPermission(); });
    return () => sub.remove();
  }, [checkPermission]);
  const kinds = Object.keys(CHANNELS) as NotificationKind[];
  const notifOn = kinds.filter((k) => pushEnabled(notificationPrefs, k)).length;

  const handleLogout = async () => {
    setConfirmLogout(false);
    await signOut();
  };

  /**
   * "Delete Account & Data" — docs/ANDROID_RELEASE.md §0.3/§7 item 10. Order:
   * revoke Google FIRST (network, can fail — see revokeAndSignOut's own
   * best-effort contract), then the two LOCAL wipes, which cannot fail in a
   * way that should block anything. `Storage.wipeEverything()` runs even
   * though `deleteAllUserData()` just wiped the same key, because zustand's
   * persist middleware writes on every `set()` — this is the belt-and-
   * suspenders pass that also catches `useRewardStore`/`useNotificationStore`
   * /the remote-config cache, none of which `deleteAllUserData` (ePurseStore-
   * only) touches.
   */
  const handleDeleteAccount = async () => {
    setConfirmDelete(false);
    // Server first and NOT best-effort: once this phone is wiped, nothing can retry it.
    try {
      await deleteSyncAccount();
    } catch (e) {
      setDeleteError((e as Error).message);
      return;
    }
    await deleteAccount();
    deleteAllUserData();
    // The emptied store must reach SQLite now, not after the coalescing window.
    await flushAppStorage();
    await Storage.wipeEverything();
  };

  const cutoff = cleanupCutoff(cleanupYears);
  const cutoffLabel = new Date(cutoff).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  const cleanupPreview = useMemo<CleanupRemoved | null>(
    () => (cleanupOpen ? previewHistoryCleanup(cutoff) : null),
    [cleanupOpen, cutoff, previewHistoryCleanup],
  );
  const cleanupParts = cleanupPreview ? [
    cleanupPreview.transactions ? plural(cleanupPreview.transactions, 'transaction', 'transactions') : null,
    cleanupPreview.lentBorrowed ? plural(cleanupPreview.lentBorrowed, 'lent & borrowed entry', 'lent & borrowed entries') : null,
    cleanupPreview.groups ? plural(cleanupPreview.groups, 'settled group', 'settled groups') : null,
  ].filter(Boolean) : [];
  const cleanupMessage = cleanupParts.length
    ? `Removes ${cleanupParts.join(', ')} from before ${cutoffLabel}. Monthly totals stay, so charts and recaps still cover those months. This cannot be undone.`
    : `Nothing to remove from before ${cutoffLabel}.`;

  const handleCleanup = () => {
    setCleanupOpen(false);
    if (cleanupParts.length) cleanUpHistory(cutoff);
  };

  const excludedCount = (excludedExpenseParents || []).length;
  const activeThemeLabel = (THEMES as any)[themeId]?.label || 'Ocean';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Settings"
        onBack={() => navigation.goBack()}
        tint={theme.textPrimary}
        titleColor={theme.textPrimary}
        bordered
        surfaceColor={theme.card}
        dividerColor={theme.divider}
      />

      <ScrollView
        style={[styles.scrollBody, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <>
          <NavListRow
            icon="finger-print-outline"
            label="Security"
            hint={appLockEnabled ? 'App Lock on' : 'App Lock off'}
            onPress={() => navigation.navigate('Security')}
          />
          {THEME_PICKER_ENABLED ? (
            <NavListRow
              icon="color-palette-outline"
              label="Appearance"
              hint={activeThemeLabel}
              onPress={() => setThemeSheetOpen(true)}
            />
          ) : null}
          {/* Notifications sits beside Monthly Recap: both decide what ePurse sends you. */}
          <NavListRow
            icon="notifications-outline"
            label="Notifications"
            hint={notifBlocked ? 'Off in phone settings' : `${notifOn} of ${kinds.length} on`}
            hintTone={notifBlocked ? 'warn' : 'default'}
            onPress={() => navigation.navigate('Notifications')}
          />
          <NavListRow
            icon="document-text-outline"
            label="Monthly Recap"
            hint={showMonthlyRecap ? 'On' : 'Off'}
            onPress={() => navigation.navigate('MonthlyRecapSettings')}
          />
          <NavListRow
            icon="calculator-outline"
            label="Expense Inclusions"
            onPress={() => navigation.navigate('SpendRules')}
            /* An exclusion has to be visible from OUTSIDE the screen that set it —
               otherwise "why is Spent low?" has no discoverable answer. */
            hint={
              excludedCount > 0
                ? `${excludedCount} categor${excludedCount === 1 ? 'y' : 'ies'} excluded`
                : 'All categories included'
            }
            hintTone={excludedCount > 0 ? 'warn' : 'default'}
          />
          <NavListRow
            icon="pricetags-outline"
            label="Categories"
            hint="Add or remove your own"
            onPress={() => navigation.navigate('Categories')}
          />
          <NavListRow
            icon="archive-outline"
            label="Clean Up History"
            hint="Everything is kept until you choose"
            onPress={() => setCleanupOpen(true)}
          />
          {SMS_DIAGNOSTIC_ENABLED ? (
            <NavListRow
              icon="flask-outline"
              label="SMS Diagnostic"
              hint="See how messages are parsed"
              onPress={() => navigation.navigate('SmsDiagnostic')}
            />
          ) : null}
          <NavListRow
            icon="help-circle-outline"
            label="Help & Support"
            hint="FAQs and how to reach us"
            onPress={() => navigation.navigate('HelpSupport')}
          />
          <NavListRow
            icon="star-outline"
            label="Rate & Feedback"
            hint={RATING_ENABLED ? 'Rate us and tell us what you think' : 'Send feedback'}
            onPress={() => navigation.navigate('RateFeedback')}
          />
          <NavListRow
            icon="information-circle-outline"
            label="About"
            hint={`Version ${APP_VERSION}`}
            onPress={() => navigation.navigate('About')}
          />
          <NavListRow
            icon="log-out-outline"
            label="Logout"
            chevron={false}
            onPress={() => setConfirmLogout(true)}
          />
          <NavListRow
            icon="trash-outline"
            label="Delete Account"
            tint={theme.danger}
            chevron={false}
            onPress={() => setConfirmDelete(true)}
          />
        </>
      </ScrollView>

      <ThemePickerSheet
        visible={THEME_PICKER_ENABLED && themeSheetOpen}
        currentThemeId={themeId}
        onSelect={(id) => setThemeId(id)}
        onClose={() => setThemeSheetOpen(false)}
      />

      <CenterModal
        visible={confirmLogout}
        title="Logout?"
        message="You'll need to sign in with Google again to use ePurse. Nothing on this device is deleted."
        primaryText="Logout"
        secondaryText="Cancel"
        destructive
        onPrimary={handleLogout}
        onSecondary={() => setConfirmLogout(false)}
        onClose={() => setConfirmLogout(false)}
      />

      <CenterModal
        visible={cleanupOpen}
        title="Clean Up History?"
        message={cleanupMessage}
        primaryText={cleanupParts.length ? 'Clean Up' : 'OK'}
        secondaryText={cleanupParts.length ? 'Cancel' : undefined}
        destructive={cleanupParts.length > 0}
        onPrimary={handleCleanup}
        onSecondary={() => setCleanupOpen(false)}
        onClose={() => setCleanupOpen(false)}
      >
        <FormChipRow>
          {CLEANUP_CHOICES_YEARS.map((y) => (
            <FormChip
              key={y}
              label={`${y}+ ${y === 1 ? 'Year' : 'Years'}`}
              active={cleanupYears === y}
              onPress={() => setCleanupYears(y)}
              accentColor={theme.primary}
            />
          ))}
        </FormChipRow>
      </CenterModal>

      <CenterModal
        visible={confirmDelete}
        title="Delete Account?"
        message={'This permanently erases every transaction, account, budget, goal, and reminder on this device, and disconnects your Google account. '
          // A shared-group account exists only for people who shared or joined a group (sync/session.ts).
          + (hasSyncAccount ? 'You also leave every shared group; what you added stays in their history for the other members. ' : '')
          + 'This does not delete a Drive backup — see epurse.co.in/delete-account for that. This cannot be undone.'}
        primaryText="Delete"
        secondaryText="Cancel"
        destructive
        onPrimary={handleDeleteAccount}
        onSecondary={() => setConfirmDelete(false)}
        onClose={() => setConfirmDelete(false)}
      />

      <CenterModal
        visible={!!deleteError}
        title="Couldn't Delete Account"
        message={deleteError ?? ''}
        primaryText="OK"
        secondaryText={undefined}
        onSecondary={undefined}
        onPrimary={() => setDeleteError(null)}
        onClose={() => setDeleteError(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
});

export default SettingsScreen;
