// =============================================================================
// NotificationsScreen — the notifications ePurse decides to send itself.
//
// Split out of RemindersScreen (Sep-14-26): Reminders is what the USER asked to
// be reminded about; this is what the APP does on its own. Every switch is a
// `notificationPrefs` key = a `NotificationKind` in constants/notificationPolicy,
// read through `pushEnabled` (Review Reminder is the one that starts off).
//
// Rows sit directly on the page background, like the rest of the Settings
// tree; each section heading is a full-width white band (Oct-11-26, user's
// call) so the five groups read as separate.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, ScrollView, AppState, Linking } from 'react-native';
import { Text } from '../components/AppText';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { pushEnabled } from '../constants/notificationPolicy';
import { useSyncEnabled } from '../sync/config';
import { getNotificationPermission, requestNotificationPermissions } from '../utils/notifications';
import { radius, spacing, typography as typographyBase, DIVIDER_W } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import SectionHeader from '../components/SectionHeader';
import PlainScreenHeader from '../components/PlainScreenHeader';
import AppSwitch from '../components/AppSwitch';
import NavListRow from '../components/NavListRow';
import PrimaryButton from '../components/PrimaryButton';
import TimeField from '../components/TimeField';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/**
 * `key` is the `notificationPrefs` key = the NotificationKind its sender passes
 * to `notify()` / `notificationPlan`. Adding one means a row here AND a sender;
 * profileNav.test checks every row has one.
 */
const GROUPS = [
  {
    title: 'Cards & Bills',
    icon: 'card-outline',
    rows: [
      { key: 'ccBillDue',        icon: 'card-outline',           label: 'Card Bill Due',          hint: 'The day before, so no late fee' },
      { key: 'ccCycleHeadsUp',   icon: 'calendar-outline',       label: 'Statement Closed',       hint: 'On statement day, so no surprises' },
      { key: 'ccPayment',        icon: 'checkmark-done-outline', label: 'Card Payment Received',  hint: 'Confirms it reached the card' },
    ],
  },
  {
    title: 'Budget',
    icon: 'pie-chart-outline',
    rows: [
      { key: 'budgetBreach',     icon: 'alert-circle-outline',   label: 'Budget Limit Crossed',   hint: 'When a category or total goes over' },
      { key: 'budgetPlan',       icon: 'clipboard-outline',      label: 'Plan New Month',         hint: "On the 3rd, if there's no budget yet" },
      { key: 'midmonthNudge',    icon: 'speedometer-outline',    label: 'Mid-Month Check-In',     hint: 'On the 15th, while you can adjust' },
    ],
  },
  {
    title: 'Goals',
    icon: 'flag-outline',
    rows: [
      { key: 'goalBehind',       icon: 'flag-outline',           label: 'Goal Behind Plan',       hint: 'When a goal falls short this month' },
    ],
  },
  {
    title: 'Spending',
    icon: 'receipt-outline',
    rows: [
      { key: 'subscriptionHike', icon: 'repeat-outline',         label: 'Subscription Price Rise', hint: 'When a recurring charge goes up' },
      { key: 'reviewReminder',   icon: 'layers-outline',         label: 'Review Reminder',        hint: 'When 5+ spends wait to be sorted' },
    ],
  },
  {
    title: 'Reports',
    icon: 'bar-chart-outline',
    rows: [
      { key: 'monthlyRecap',     icon: 'bar-chart-outline',      label: 'Monthly Recap',          hint: 'On the 1st, where your money went' },
      { key: 'weeklyRecap',      icon: 'calendar-number-outline', label: 'Weekly Recap',          hint: 'Mondays, last week at a glance' },
    ],
  },
  {
    // Shown only while sharing is available (useSyncEnabled).
    title: 'Shared Groups',
    icon: 'people-outline',
    rows: [
      { key: 'sharedGroupActivity', icon: 'people-outline',      label: 'Shared Group Activity',  hint: 'When someone changes a group you share' },
    ],
  },
] as const;

interface Props {
  navigation: { goBack: () => void };
}

const NotificationsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const notificationPrefs = useEPurseStore((s: any) => s.notificationPrefs) as Record<string, boolean>;
  const setNotificationPref = useEPurseStore((s: any) => s.setNotificationPref);
  const reviewAtMin = useEPurseStore((s: any) => s.reviewReminderAtMin) as number;
  const setReviewReminderTime = useEPurseStore((s: any) => s.setReviewReminderTime);
  const syncOn = useSyncEnabled();

  const [permission, setPermission] = useState<{ granted: boolean; canAskAgain: boolean } | null>(null);
  const checkPermission = useCallback(() => {
    getNotificationPermission().then(setPermission).catch(() => {});
  }, []);
  // Re-checked on return from system settings.
  useEffect(() => {
    checkPermission();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') checkPermission(); });
    return () => sub.remove();
  }, [checkPermission]);

  const turnOn = async () => {
    if (permission?.canAskAgain) await requestNotificationPermissions();
    else await Linking.openSettings();
    checkPermission();
  };

  const reviewTime = new Date();
  reviewTime.setHours(Math.floor((reviewAtMin ?? 1140) / 60), (reviewAtMin ?? 1140) % 60, 0, 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Notifications"
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
        {permission && !permission.granted ? (
          <View style={[styles.banner, { backgroundColor: theme.card, borderColor: theme.danger + '55' }]}>
            <View style={styles.bannerRow}>
              <Ionicons name="notifications-off-outline" size={20} color={theme.danger} />
              <View style={styles.rowMid}>
                <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Notifications are off for ePurse</Text>
                <Text style={[styles.rowHint, { color: theme.textSecondary }]}>
                  Bill reminders and recaps can't reach you until they're on.
                </Text>
              </View>
            </View>
            <PrimaryButton title="Turn On" onPress={turnOn} />
          </View>
        ) : null}

        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          Quiet between 9:30 PM and 8:30 AM, and never more than 2 a day — card bills and shared groups excepted.
        </Text>

        {GROUPS.filter((group) => syncOn || group.title !== 'Shared Groups').map((group) => (
          <View key={group.title} style={styles.group}>
            <SectionHeader
              icon={group.icon}
              title={group.title}
              accentColor={theme.primary}
              style={[styles.sectionBand, { backgroundColor: theme.card, borderColor: theme.divider }]}
            />
            {group.rows.map(({ key, icon, label, hint }, i) => {
              const on = pushEnabled(notificationPrefs, key);
              return (
                <View key={key}>
                  {/* Same row as Settings' list; tapping anywhere on it flips the switch. */}
                  <NavListRow
                    icon={icon}
                    label={label}
                    hint={hint}
                    divided={i > 0}
                    chevron={false}
                    onPress={() => setNotificationPref(key, !on)}
                    right={(
                      <AppSwitch
                        value={on}
                        onValueChange={(v: boolean) => setNotificationPref(key, v)}
                        trackColor={{ true: theme.primary, false: theme.divider }}
                        thumbColor="#fff"
                        ios_backgroundColor={theme.divider}
                      />
                    )}
                  />
                  {key === 'reviewReminder' && on ? (
                    <View style={styles.subRow}>
                      <TimeField
                        value={reviewTime}
                        onChange={(d) => setReviewReminderTime(d.getHours() * 60 + d.getMinutes())}
                        accentColor={theme.primary}
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
  hint: { ...typography.small, lineHeight: 18 },
  group: { gap: spacing.xs },
  // Bleeds past the scroll padding to the screen edges.
  sectionBand: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: DIVIDER_W,
    borderBottomWidth: DIVIDER_W,
  },

  banner: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  // Lines the time field up with the row's label, past NavListRow's 22pt glyph slot.
  subRow: { paddingLeft: 22 + spacing.md, paddingBottom: spacing.sm },
  rowMid: { flex: 1 },
  rowLabel: { ...typography.body, fontWeight: '600' },
  rowHint: { ...typography.tiny, marginTop: 1 },
});

export default NotificationsScreen;
