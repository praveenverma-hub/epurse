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

import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useEPurseStore } from '../store/ePurseStore';
import { Storage } from '../utils/storage';
import { spacing } from '../constants/theme';
import { THEMES } from '../constants/themes';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { APP_VERSION } from '../constants/appMeta';
import { useTheme } from '../hooks/useTheme';
import { useGoogleSession } from '../hooks/useGoogleSession';
import NavListRow from '../components/NavListRow';
import PlainScreenHeader from '../components/PlainScreenHeader';
import ThemePickerSheet from '../components/ThemePickerSheet';
import CenterModal from '../components/CenterModal';


interface Props {
  navigation: { goBack: () => void; navigate: (route: string) => void };
}

const SettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const SMS_DIAGNOSTIC_ENABLED = useFeatureFlag('smsDiagnostic');
  const RATING_ENABLED = useFeatureFlag('rating');

  const themeId = useEPurseStore((s: any) => s.themeId);
  const setThemeId = useEPurseStore((s: any) => s.setThemeId);
  const showMonthlyRecap = useEPurseStore((s: any) => s.showMonthlyRecap);
  const excludedExpenseParents = useEPurseStore((s: any) => s.excludedExpenseParents) as string[];
  const appLockEnabled = useEPurseStore((s: any) => s.appLockEnabled) as boolean;
  const deleteAllUserData = useEPurseStore((s: any) => s.deleteAllUserData);
  const { googleAccount, signOut, deleteAccount } = useGoogleSession();

  const [themeSheetOpen, setThemeSheetOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    await deleteAccount();
    deleteAllUserData();
    await Storage.wipeEverything();
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
          <NavListRow
            icon="color-palette-outline"
            label="Appearance"
            hint={activeThemeLabel}
            divided
            onPress={() => setThemeSheetOpen(true)}
          />
          <NavListRow
            icon="document-text-outline"
            label="Monthly Recap"
            hint={showMonthlyRecap ? 'On' : 'Off'}
            divided
            onPress={() => navigation.navigate('MonthlyRecapSettings')}
          />
          <NavListRow
            icon="calculator-outline"
            label="Expense Inclusions"
            divided
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
            divided
            onPress={() => navigation.navigate('Categories')}
          />
          <NavListRow
            icon="notifications-outline"
            label="Notifications"
            hint="Automatic nudges from ePurse"
            divided
            onPress={() => navigation.navigate('Notifications')}
          />
          {SMS_DIAGNOSTIC_ENABLED ? (
            <NavListRow
              icon="flask-outline"
              label="SMS Diagnostic"
              hint="See how messages are parsed"
              divided
              onPress={() => navigation.navigate('SmsDiagnostic')}
            />
          ) : null}
          <NavListRow
            icon="help-circle-outline"
            label="Help & Support"
            hint="FAQs and how to reach us"
            divided
            onPress={() => navigation.navigate('HelpSupport')}
          />
          <NavListRow
            icon="star-outline"
            label="Rate & Feedback"
            hint={RATING_ENABLED ? 'Rate us and tell us what you think' : 'Send feedback'}
            divided
            onPress={() => navigation.navigate('RateFeedback')}
          />
          <NavListRow
            icon="information-circle-outline"
            label="About"
            hint={`Version ${APP_VERSION}`}
            divided
            onPress={() => navigation.navigate('About')}
          />
          <NavListRow
            icon="log-out-outline"
            label="Logout"
            hint={googleAccount?.email}
            hintTone="warn"
            chevron={false}
            divided
            onPress={() => setConfirmLogout(true)}
          />
          <NavListRow
            icon="trash-outline"
            label="Delete Account"
            hint="Erases everything on this device"
            hintTone="warn"
            chevron={false}
            divided
            onPress={() => setConfirmDelete(true)}
          />
        </>
      </ScrollView>

      <ThemePickerSheet
        visible={themeSheetOpen}
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
        visible={confirmDelete}
        title="Delete Account?"
        message="This permanently erases every transaction, account, budget, goal, and reminder on this device, and disconnects your Google account. This does not delete a Drive backup — see epurse.co.in/delete-account for that. This cannot be undone."
        primaryText="Delete"
        secondaryText="Cancel"
        destructive
        onPrimary={handleDeleteAccount}
        onSecondary={() => setConfirmDelete(false)}
        onClose={() => setConfirmDelete(false)}
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
