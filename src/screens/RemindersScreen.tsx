// =============================================================================
// RemindersScreen — the user's OWN reminders, and only those.
//
// This used to be two halves: Upcoming (this list) plus an "Automatic nudges"
// section of switches for notifications the app decides to send on its own
// (bill due, price hikes, budget, recap). That second half moved to its own
// screen — Settings → Notifications — because the two are different kinds of
// thing: an entry here is something the USER asked to be reminded about
// (custom, or a repayment/bill nudge scheduled on their behalf); a nudge is
// something the APP already does automatically, and configuring whether it
// fires belongs beside the app's other settings, not mixed into a list the
// user is meant to be able to leave empty by default.
//
// So this screen shows a blank, unboxed EmptyState by default (Sep-14-26 —
// the same shape every other empty screen in the app uses), same as before
// the nudges section existed — a fresh install has nothing here until the
// user actually sets a reminder. Once there's something to show, each
// reminder is its OWN card under an "Upcoming" heading (was one shared card
// with a hairline between rows) — a heading over a stack of cards, matching
// how Goals/Groups list their own entries.
//
// Every row here reads its "when" through `utils/reminderSchedule`, so the listed
// time is derived from the same anchor + repeat rule that was actually armed
// with the OS — a label can't drift from the schedule.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
import { REPEAT, describeRepeat, nextOccurrence } from '../utils/reminderSchedule';
import EmptyState from '../components/EmptyState';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import CenterModal from '../components/CenterModal';
import { formatTimeLabel } from '../components/TimeField';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

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
  const cancelReminder = useEPurseStore((s: any) => s.cancelReminder);

  // Deleting from the list is just as destructive as the form's own "Delete
  // reminder" — a lone target (not a per-row boolean) since only one confirm
  // is ever open at a time, and one shared CenterModal below serves all rows.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

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
      <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
        <PlainScreenHeader
          title="Reminders"
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          bordered
          surfaceColor={theme.card}
          dividerColor={theme.divider}
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

        <ScrollView
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={[styles.body, upcoming.length === 0 && styles.bodyEmpty]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Upcoming ─────────────────────────────────────────────────── */}
          {upcoming.length === 0 ? (
            // Blank, not boxed — a fresh install (or a fully-cleared list) reads
            // as "nothing here", the same shape every other empty screen in the
            // app uses, not a card with nothing to separate it from.
            <EmptyState
              icon="alarm-outline"
              title="No reminders yet"
              subtitle="Set one for a bill, a repayment, or anything you'd rather not keep in your head."
              actionLabel="Add a reminder"
              onAction={() => openForm()}
            />
          ) : (
            <>
              <SectionHeader icon="alarm-outline" title="Upcoming" accentColor={theme.primary} />
              {upcoming.map((r) => {
                const meta = KIND_META[r.kind] || KIND_META.custom;
                const repeats = (r.repeat || REPEAT.ONCE) !== REPEAT.ONCE;
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.card, styles.row, { backgroundColor: theme.card }]}
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
                      ) : r.person ? (
                        // A custom reminder tagged to a person but with no amount has
                        // no composed body (that wording needs both) — say who it's
                        // about anyway, or the tag picked in the form is invisible here.
                        <Text style={[styles.rowBody, { color: theme.textSecondary }]} numberOfLines={1}>
                          {`For ${r.person}`}
                        </Text>
                      ) : null}
                      <Text style={[styles.rowWhen, { color: theme.textSecondary }]} numberOfLines={1}>
                        {dayLabel(r.nextAt)} · {formatTimeLabel(new Date(r.nextAt))}
                        {repeats ? ` · ${describeRepeat(r.anchorAt, r.repeat)}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => { hapticLight(); setDeleteTarget({ id: r.id, title: r.title }); }}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete reminder: ${r.title}`}
                    >
                      <Ionicons name="close" size={18} color={theme.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>

        {/* Same destructive action as the form's own "Delete reminder" — same
            confirm, same verb (ui-consistency §8c), just reachable from the
            list's ✕ too. */}
        <CenterModal
          visible={!!deleteTarget}
          title="Delete this reminder?"
          message={`"${deleteTarget?.title}" won't notify you any more. This cannot be undone.`}
          primaryText="Delete"
          secondaryText="Cancel"
          destructive
          onPrimary={() => {
            if (deleteTarget) cancelReminder(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onSecondary={() => setDeleteTarget(null)}
          onClose={() => setDeleteTarget(null)}
        />
      </SafeAreaView>
    </View>
  );
};

export default RemindersScreen;

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1 },
  body:      { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  // Only the empty state needs the scroll content to fill the viewport, so
  // EmptyState's own `full` mode (flex:1, centred both axes) actually has
  // room to centre in rather than collapsing to its content height.
  bodyEmpty: { flexGrow: 1 },

  // Each reminder is its OWN card now (was one shared card with a hairline
  // between rows) — a heading above a stack of cards, not a list inside one.
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
});
