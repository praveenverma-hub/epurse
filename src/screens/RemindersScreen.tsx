// =============================================================================
// RemindersScreen — everything the app will nudge you about, in one list.
//
// Two halves, and the split is the point:
//   • UPCOMING — real scheduled reminders from the store's `reminders` registry:
//     the user's own, plus repayment nudges and credit-card bill dates, which
//     used to be invisible once set. Each row can be edited or cancelled.
//   • AUTOMATIC NUDGES — the notifications the app decides to send by itself
//     (bill due, price hikes, budget, recap). These are now real switches backed
//     by `notificationPrefs`. This screen previously LISTED them with no
//     controls, and said so in its own header comment: a screen of switches that
//     don't move anything is worse than an empty one. They move things now.
//
// Every row here reads its "when" through `utils/reminderSchedule`, so the listed
// time is derived from the same anchor + repeat rule that was actually armed
// with the OS — a label can't drift from the schedule.
// =============================================================================

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { colors, radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
import { REPEAT, describeRepeat, nextOccurrence } from '../utils/reminderSchedule';
import EmptyState from '../components/EmptyState';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import { formatTimeLabel } from '../components/TimeField';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/**
 * The automatic nudges, in the order they matter to someone deciding what to
 * silence. `key` is the `notificationPrefs` key the store gates on — see
 * `nudgeAllowed` in ePurseStore. Adding a nudge means adding a row here AND a
 * gate at its fire site; nothing is inferred.
 */
const NUDGE_ROWS = [
  { key: 'ccBillDue',        icon: 'card-outline',        label: 'Credit-card bill due',  hint: 'The day before a bill is due' },
  { key: 'ccCycleHeadsUp',   icon: 'calendar-outline',    label: 'Statement cycle closed', hint: 'When a new statement is due to arrive' },
  { key: 'ccPayment',        icon: 'checkmark-done-outline', label: 'Card payment received', hint: 'Confirms a bill payment landed' },
  { key: 'subscriptionHike', icon: 'repeat-outline',      label: 'Subscription price rises', hint: 'When a recurring charge goes up' },
  { key: 'budgetBreach',     icon: 'pie-chart-outline',   label: 'Budget limits',          hint: 'When a category or the total goes over' },
  { key: 'midmonthNudge',    icon: 'speedometer-outline', label: 'Mid-month check-in',     hint: 'How your pace looks halfway through' },
  { key: 'monthlyRecap',     icon: 'bar-chart-outline',   label: 'Monthly recap ready',    hint: 'When last month\'s summary is available' },
] as const;

/** Per-kind chrome. `custom` is the user's own; the rest are app-created. */
const KIND_META: Record<string, { icon: string; tag: string }> = {
  custom:    { icon: 'alarm-outline',            tag: '' },
  // No lent kind: money owed TO you is chased by messaging the person
  // (WhatsAppReminderScreen), never by scheduling an alarm for yourself.
  lb_borrow: { icon: 'arrow-down-circle-outline', tag: 'YOU OWE' },
  cc_bill:   { icon: 'card-outline',              tag: 'CARD BILL' },
};

const dayLabel = (ms: number): string => {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-IN', { weekday: 'long' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

interface Props {
  navigation: { goBack: () => void; navigate: (route: string, params?: object) => void };
}

const RemindersScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const reminders = useEPurseStore((s: any) => s.reminders) as any[];
  const notificationPrefs = useEPurseStore((s: any) => s.notificationPrefs) as Record<string, boolean>;
  const setNotificationPref = useEPurseStore((s: any) => s.setNotificationPref);
  const cancelReminder = useEPurseStore((s: any) => s.cancelReminder);

  // Sorted by when they actually fire NEXT, which for a repeat is not its anchor
  // — an old monthly anchored in March still belongs between tomorrow and next
  // week if that's when it comes round again.
  const upcoming = useMemo(() => {
    const now = Date.now();
    return (reminders || [])
      .map((r) => ({ ...r, nextAt: nextOccurrence(r.anchorAt, r.repeat, now) }))
      .filter((r) => !!r.nextAt)
      .sort((a, b) => (a.nextAt as number) - (b.nextAt as number));
  }, [reminders]);

  const openForm = useCallback((params?: object) => {
    hapticLight();
    navigation.navigate('ReminderForm', params);
  }, [navigation]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <PlainScreenHeader
          title="Reminders"
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          right={
            <TouchableOpacity
              onPress={() => openForm()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Add a reminder"
            >
              <Ionicons name="add" size={26} color={theme.primary} />
            </TouchableOpacity>
          }
        />

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* ── Upcoming ─────────────────────────────────────────────────── */}
          {upcoming.length === 0 ? (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <EmptyState
                compact
                icon="alarm-outline"
                title="No reminders yet"
                subtitle="Set one for a bill, a repayment, or anything you'd rather not keep in your head."
                actionLabel="Add a reminder"
                onAction={() => openForm()}
              />
            </View>
          ) : (
            <View style={[styles.card, { backgroundColor: theme.card }]}>
              <SectionHeader icon="alarm-outline" title="Upcoming" accentColor={theme.primary} />
              {upcoming.map((r, i) => {
                const meta = KIND_META[r.kind] || KIND_META.custom;
                const repeats = (r.repeat || REPEAT.ONCE) !== REPEAT.ONCE;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }]}
                    // A card bill isn't editable here — its date comes from the
                    // bank's message, not from us, so the only sensible action is
                    // to silence it (the ✕).
                    onPress={r.kind === 'cc_bill' ? undefined : () => openForm({ reminderId: r.id })}
                    activeOpacity={r.kind === 'cc_bill' ? 1 : 0.7}
                  >
                    <View style={[styles.rowIconWrap, { backgroundColor: theme.primary + '14' }]}>
                      <Ionicons name={meta.icon as any} size={18} color={theme.primary} />
                    </View>
                    <View style={styles.rowMid}>
                      <View style={styles.rowTitleLine}>
                        <Text style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                          {r.title}
                        </Text>
                        {meta.tag ? (
                          <Text style={[styles.tag, { color: theme.textSecondary, borderColor: theme.divider }]}>
                            {meta.tag}
                          </Text>
                        ) : null}
                      </View>
                      {r.body ? (
                        <Text style={[styles.rowBody, { color: theme.textSecondary }]} numberOfLines={1}>
                          {r.body}
                        </Text>
                      ) : null}
                      <Text style={[styles.rowWhen, { color: theme.textSecondary }]} numberOfLines={1}>
                        {dayLabel(r.nextAt)} · {formatTimeLabel(new Date(r.nextAt))}
                        {repeats ? ` · ${describeRepeat(r.anchorAt, r.repeat)}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => { hapticLight(); cancelReminder(r.id); }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel reminder: ${r.title}`}
                    >
                      <Ionicons name="close" size={18} color={theme.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* ── Automatic nudges ─────────────────────────────────────────── */}
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <SectionHeader icon="notifications-outline" title="Automatic nudges" accentColor={theme.primary} />
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              Sent by ePurse on its own, from what your messages already say. Turning one off
              stops the notification — you'll still find it in the bell.
            </Text>
            {NUDGE_ROWS.map(({ key, icon, label, hint }) => (
              <View key={key} style={styles.nudgeRow}>
                <Ionicons name={icon as any} size={18} color={theme.primary} style={styles.nudgeIcon} />
                <View style={styles.rowMid}>
                  <Text style={[styles.rowTitle, { color: theme.textPrimary }]}>{label}</Text>
                  <Text style={[styles.rowBody, { color: theme.textSecondary }]}>{hint}</Text>
                </View>
                <Switch
                  // Absent means ON — matches the store's `nudgeAllowed`, so an
                  // upgrading user sees every nudge as enabled, which it is.
                  value={notificationPrefs?.[key] ?? true}
                  onValueChange={(v) => setNotificationPref(key, v)}
                  trackColor={{ true: theme.primary, false: colors.divider }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.divider}
                />
              </View>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

export default RemindersScreen;

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1 },
  body:      { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  hint: { ...typography.small, marginBottom: spacing.sm, lineHeight: 18 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowIconWrap: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  // flex:1 + numberOfLines on the children: a 40-char reminder title must
  // truncate rather than push the ✕ off the row (input-validation skill).
  rowMid: { flex: 1 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rowTitle: { ...typography.body, fontWeight: '600', flexShrink: 1 },
  rowBody:  { ...typography.tiny, marginTop: 1 },
  rowWhen:  { ...typography.tiny, marginTop: 2, fontWeight: '600' },
  tag: {
    ...typography.tiny,
    fontWeight: '800',
    letterSpacing: 0.6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    flexShrink: 0,
  },

  nudgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Fixed slot so every label starts at the same x, whatever the glyph.
  nudgeIcon: { width: 22, textAlign: 'center' },
});
