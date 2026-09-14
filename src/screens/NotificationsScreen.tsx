// =============================================================================
// NotificationsScreen — the automatic nudges ePurse decides to send itself.
//
// Split out of RemindersScreen (Sep-14-26). The two lists look similar (icon +
// label + a control) but answer different questions: Reminders is what the
// USER asked to be reminded about; this is what the APP already does on its
// own from what your messages say — bill due, price hikes, budget, recap.
// Pulled here so it lives beside the app's other settings, and so a fresh
// Reminders screen can go back to being blank by default.
//
// Every switch writes to the shared `notificationPrefs`, gated at its fire
// site in ePurseStore via `nudgeAllowed` — see project_reminders_sep2026 memory.
// The switch silences the OS push only, never the in-app bell entry.
//
// Rendered PLAIN (Sep-14-26), like the rest of the Settings tree — no card
// fill/shadow, the heading + rows sit directly on the page background.
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import SectionHeader from '../components/SectionHeader';
import PlainScreenHeader from '../components/PlainScreenHeader';
import AppSwitch from '../components/AppSwitch';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/**
 * In the order they matter to someone deciding what to silence. `key` is the
 * `notificationPrefs` key the store gates on — see `nudgeAllowed` in
 * ePurseStore. Adding a nudge means adding a row here AND a gate at its fire
 * site; nothing is inferred.
 */
const NUDGE_ROWS = [
  { key: 'ccBillDue',        icon: 'card-outline',        label: 'Credit-card bill due',  hint: 'The day before a bill is due' },
  { key: 'ccCycleHeadsUp',   icon: 'calendar-outline',    label: 'Statement cycle closed', hint: 'When a new statement is due to arrive' },
  { key: 'ccPayment',        icon: 'checkmark-done-outline', label: 'Card payment received', hint: 'Confirms a bill payment landed' },
  { key: 'subscriptionHike', icon: 'repeat-outline',      label: 'Subscription price rises', hint: 'When a recurring charge goes up' },
  { key: 'budgetBreach',     icon: 'pie-chart-outline',   label: 'Budget limits',          hint: 'When a category or the total goes over' },
  { key: 'midmonthNudge',    icon: 'speedometer-outline', label: 'Mid-month check-in',     hint: 'How your pace looks halfway through' },
  { key: 'monthlyRecap',     icon: 'bar-chart-outline',   label: 'Monthly recap ready',    hint: "When last month's summary is available" },
] as const;

interface Props {
  navigation: { goBack: () => void };
}

const NotificationsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const notificationPrefs = useEPurseStore((s: any) => s.notificationPrefs) as Record<string, boolean>;
  const setNotificationPref = useEPurseStore((s: any) => s.setNotificationPref);

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
        <SectionHeader icon="notifications-outline" title="Automatic Nudges" accentColor={theme.primary} />
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          Sent by ePurse on its own, from what your messages already say. Turning one off
          stops the notification — you'll still find it in the bell.
        </Text>
        {NUDGE_ROWS.map(({ key, icon, label, hint }, i) => (
          <View key={key} style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}>
            <Ionicons name={icon as any} size={18} color={theme.primary} style={styles.rowIcon} />
            <View style={styles.rowMid}>
              <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>{label}</Text>
              <Text style={[styles.rowHint, { color: theme.textSecondary }]}>{hint}</Text>
            </View>
            <AppSwitch
              // Absent means ON — matches the store's `nudgeAllowed`, so an
              // upgrading user sees every nudge as enabled, which it is.
              value={notificationPrefs?.[key] ?? true}
              onValueChange={(v: boolean) => setNotificationPref(key, v)}
              trackColor={{ true: theme.primary, false: theme.divider }}
              thumbColor="#fff"
              ios_backgroundColor={theme.divider}
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  hint: { ...typography.small, marginBottom: spacing.sm, lineHeight: 18 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowIcon: { width: 22, textAlign: 'center' },
  rowMid: { flex: 1 },
  rowLabel: { ...typography.body, fontWeight: '600' },
  rowHint: { ...typography.tiny, marginTop: 1 },
});

export default NotificationsScreen;
