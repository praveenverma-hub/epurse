// =============================================================================
// GoalDetailScreen — a goal's own stats page, opened by tapping its tile
// (Sep-12-26). Used to be a bottom sheet (`GoalTransactionsSheet`) that only
// showed this month's matching transactions; asked for "a new screen with
// stats", so this replaces it — same transaction drill-down (now including a
// manually-linked top-up too, not just auto-matched spend), plus the numbers
// that never had a home: lifetime saved, target/pace, and a month-by-month
// history pulled from `goalHistory` (closed months only — this screen's own
// stat row already covers the live one).
//
// Nothing here is stored — every number is read live from the store, the same
// selectors `GoalsScreen`/`GoalCard` already use, so this screen can never
// disagree with the tile that opened it.
// =============================================================================

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, withAlpha, mix, readableOn } from '../constants/theme';
import { formatCurrency, formatCompact, monthKey } from '../utils/format';
import { monthsToTarget, goalAutoRule } from '../utils/goalPlan';
import { GOAL_KIND_META, GOAL_DURATION_META, GOAL_DURATIONS } from '../constants/goals';
import { DEFAULT_CATEGORIES } from '../constants/categories';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import EditIcon from '../components/EditIcon';
import ProgressRing from '../components/ProgressRing';
import EmptyState from '../components/EmptyState';
import GoalFundModal from '../components/GoalFundModal';
import TransactionItemRaw from '../components/TransactionItem';
import TxnDetailSheet from '../components/TxnDetailSheet';
import FAB from '../components/FAB';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// TransactionItem is plain JS; alias so tsc only requires the props this
// screen passes (same cast GoalTransactionsSheet used).
const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any; onPress?: () => void;
}>;

const MONTH_LABEL = (mk: string) => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

/** Same words `GoalCard`'s ribbon uses for this month's pace. */
const PACE_LABEL: Record<string, string> = {
  funded: 'Fully funded', ahead: 'Ahead of pace', on_track: 'On track', behind: 'Behind pace',
};

interface Props {
  navigation: { goBack: () => void; navigate: (screen: string, params?: any) => void };
  route: { params?: { goalId?: string } };
}

const GoalDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const goalId = route?.params?.goalId;

  const goals = useEPurseStore((s: any) => s.goals);
  const goalHistory = useEPurseStore((s: any) => s.goalHistory);
  const getGoalPlanUsage = useEPurseStore((s: any) => s.getGoalPlanUsage);
  const getGoalLifetimeSaved = useEPurseStore((s: any) => s.getGoalLifetimeSaved);
  const getGoalTransactions = useEPurseStore((s: any) => s.getGoalTransactions);

  const [fundGoal, setFundGoal] = useState<any | null>(null);
  const [detailTxn, setDetailTxn] = useState<any | null>(null);

  const goal = useMemo(() => goals.find((g: any) => g.id === goalId), [goals, goalId]);

  const usage = getGoalPlanUsage();
  const row = usage?.perGoal.find((r: any) => r.goalId === goalId);
  const planned = row?.planned ?? 0;
  const funded = row?.funded ?? 0;
  const lifetimeSaved = goal ? getGoalLifetimeSaved(goal.id) : 0;
  const isOneTime = !!(goal?.lifetimeTarget && goal.lifetimeTarget > 0);
  const achieved = !!goal?.achievedAt;

  const monthsLeft = isOneTime && goal?.lifetimeTarget
    ? monthsToTarget(goal.lifetimeTarget, lifetimeSaved, planned)
    : null;

  const pct = isOneTime
    ? Math.max(0, Math.min(100, Math.round((lifetimeSaved / goal.lifetimeTarget) * 100)))
    : planned > 0
      ? Math.max(0, Math.min(100, Math.round((funded / planned) * 100)))
      : 0;

  const heroCaption = achieved
    ? 'Goal complete'
    : isOneTime
      ? (monthsLeft && monthsLeft > 0
          ? `${monthsLeft} month${monthsLeft === 1 ? '' : 's'} to go at this rate`
          : planned > 0 ? 'No pace yet — nothing saved this month' : 'No monthly amount set')
      : (row?.status ? PACE_LABEL[row.status] : 'Nothing planned this month');

  // This goal's own auto-fund rule, as one chip per category/merchant — a
  // category's OWN emoji is data (the icons rule's stated exception), so it
  // rides along; a merchant keyword isn't an entity with its own emoji, so it
  // gets a plain Ionicons glyph instead. Same for BOTH durations — a One-Time
  // goal funded automatically toward its target is exactly as common as a
  // Recurring one (see the Duration section of the ui-consistency skill).
  const categoryChips = useMemo(() => {
    if (!goal) return [];
    const rule = goalAutoRule(goal);
    const cats = rule.parentIds
      .map((id: string) => DEFAULT_CATEGORIES.find((c: any) => c.id === id))
      .filter(Boolean)
      .map((c: any) => ({ key: `cat:${c.id}`, label: c.name, emoji: c.emoji, color: c.color }));
    const merchants = rule.merchants.map((m: string) => ({ key: `merchant:${m}`, label: m, emoji: null, color: theme.textMuted }));
    return [...cats, ...merchants];
  }, [goal, theme.textMuted]);

  // Closed months only — the live month is already the stat row above.
  const history = useMemo(() => {
    if (!goal) return [];
    const thisMonth = monthKey(new Date());
    return Object.entries(goalHistory || {})
      .filter(([mk, snap]: [string, any]) => mk !== thisMonth && snap?.perGoal?.[goal.id])
      .map(([mk, snap]: [string, any]) => ({ monthKey: mk, ...snap.perGoal[goal.id] }))
      .sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
  }, [goalHistory, goal]);

  const txns = useMemo(
    () => (goal ? getGoalTransactions(goal.id) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [goal?.id, getGoalTransactions],
  );

  if (!goal) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.card }]} edges={['top']}>
        <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
        <PlainScreenHeader
          title="Goal"
          onBack={() => navigation.goBack()}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          bordered
          surfaceColor={theme.card}
          dividerColor={theme.divider}
        />
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <EmptyState icon="flag-outline" title="Goal not found" subtitle="This goal may have been removed." />
        </View>
      </SafeAreaView>
    );
  }

  const washedCard = mix(goal.color, theme.darkMode ? 0.22 : 0.16, theme.card);
  const ringInk = readableOn(theme.divider, goal.color, 3);
  const kindMeta = GOAL_KIND_META[goal.kind as keyof typeof GOAL_KIND_META];
  const durationMeta = GOAL_DURATION_META[
    (goal.duration || GOAL_DURATIONS.RECURRING) as keyof typeof GOAL_DURATION_META
  ];

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.root, { backgroundColor: theme.card }]} edges={['top']}>
      <PlainScreenHeader
        title={goal.name}
        onBack={() => { hapticLight(); navigation.goBack(); }}
        tint={theme.textPrimary}
        titleColor={theme.textPrimary}
        bordered
        surfaceColor={theme.card}
        dividerColor={theme.divider}
      />

      <ScrollView
        style={{ backgroundColor: theme.background }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── hero: ring + headline sit SIDE BY SIDE (Sep-12-26) ──────────
            First shipped as one centred column — ring, then value, then sub,
            then caption, then badges, then chips, each on its own row — which
            read as tall with a lot of dead space either side of the (narrow)
            ring. The ring and the numbers now share one row, and badges +
            auto-fund chips share a SECOND row instead of two stacked ones. */}
        <View style={[styles.hero, { backgroundColor: washedCard, borderColor: withAlpha(goal.color, 0.25) }]}>
          {/* Edit pencil — same placement/style as GoalCard's own: an outlined
              circle in the corner, so it reads as a button rather than
              decoration. Top-right here (the hero has no ribbon claiming that
              edge the way the tile does). */}
          <TouchableOpacity
            onPress={() => { hapticLight(); navigation.navigate('GoalForm', { goalId: goal.id }); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${goal.name}`}
            style={[styles.heroPencil, { borderColor: theme.inputBorder, backgroundColor: theme.card }]}
            activeOpacity={0.55}
          >
            <EditIcon size={12} color={theme.textSecondary} />
          </TouchableOpacity>

          <View style={styles.heroTop}>
            <View style={styles.ringWrap}>
              <ProgressRing progress={pct / 100} size={84} strokeWidth={6} color={ringInk} trackColor={theme.divider} />
              <View style={styles.ringGlyphWrap}>
                <Text style={styles.ringGlyph} allowFontScaling={false}>{goal.emoji}</Text>
              </View>
            </View>
            <View style={styles.heroTextCol}>
              <Text style={[styles.heroValue, { color: theme.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatCurrency(isOneTime ? lifetimeSaved : funded)}
              </Text>
              <Text style={[styles.heroSub, { color: theme.textSecondary }]} numberOfLines={1}>
                of {formatCurrency(isOneTime ? goal.lifetimeTarget : planned)}
                {isOneTime ? ' target' : ' planned this month'}
              </Text>
              <View style={[styles.heroCaptionPill, { backgroundColor: withAlpha(goal.color, 0.16) }]}>
                <Text style={[styles.heroCaption, { color: theme.textPrimary }]} numberOfLines={1}>{heroCaption}</Text>
              </View>
            </View>
          </View>

          {/* Kind/duration badges (plain outline) and what this goal is MADE
              of (tinted chips) share ONE wrapping row — same for either
              duration, and the tint is what tells the two kinds of pill apart
              without a second label taking its own line. */}
          <View style={styles.chipRow}>
            {kindMeta ? (
              <View style={[styles.badge, { borderColor: theme.inputBorder }]}>
                <Ionicons name={kindMeta.icon} size={12} color={theme.textSecondary} />
                <Text style={[styles.badgeTxt, { color: theme.textSecondary }]}>{kindMeta.label}</Text>
              </View>
            ) : null}
            {durationMeta ? (
              <View style={[styles.badge, { borderColor: theme.inputBorder }]}>
                <Text style={[styles.badgeTxt, { color: theme.textSecondary }]}>{durationMeta.label}</Text>
              </View>
            ) : null}
            {categoryChips.map((c: any) => (
              <View
                key={c.key}
                style={[
                  styles.categoryChip,
                  { backgroundColor: withAlpha(c.color, 0.14), borderColor: withAlpha(c.color, 0.32) },
                ]}
              >
                {c.emoji ? (
                  <Text style={styles.categoryChipEmoji} allowFontScaling={false}>{c.emoji}</Text>
                ) : (
                  <Ionicons name="pricetag-outline" size={11} color={theme.textSecondary} />
                )}
                <Text style={[styles.categoryChipTxt, { color: theme.textPrimary }]} numberOfLines={1}>
                  {c.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── stat grid ──────────────────────────────────────────────────── */}
        <View style={styles.statGrid}>
          <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Text style={[styles.statV, { color: theme.textPrimary }]}>{formatCompact(lifetimeSaved)}</Text>
            <Text style={[styles.statK, { color: theme.textMuted }]}>Saved so far</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Text style={[styles.statV, { color: theme.textPrimary }]}>
              {isOneTime ? formatCompact(goal.lifetimeTarget) : '—'}
            </Text>
            <Text style={[styles.statK, { color: theme.textMuted }]}>
              {isOneTime ? 'Target' : 'No target · recurring'}
            </Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Text style={[styles.statV, { color: theme.textPrimary }]}>{formatCompact(planned)}</Text>
            <Text style={[styles.statK, { color: theme.textMuted }]}>This month planned</Text>
          </View>
          <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Text style={[styles.statV, { color: theme.textPrimary }]}>{formatCompact(funded)}</Text>
            <Text style={[styles.statK, { color: theme.textMuted }]}>This month funded</Text>
          </View>
        </View>

        {/* ── history: closed months only ────────────────────────────────── */}
        {history.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader icon="time-outline" title="History" subtitle="What this goal saved, month by month" accentColor={theme.primary} />
            {history.map((h: any) => (
              <View key={h.monthKey} style={[styles.historyRow, { borderColor: theme.divider }]}>
                <Text style={[styles.historyMonth, { color: theme.textPrimary }]}>{MONTH_LABEL(h.monthKey)}</Text>
                <Text style={[styles.historyAmt, { color: theme.textSecondary }]}>
                  {formatCurrency(h.funded)} <Text style={{ color: theme.textMuted }}>of {formatCurrency(h.planned)}</Text>
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── this month's transactions — the auto-fund link, surfaced ──── */}
        <View style={styles.section}>
          <SectionHeader
            icon="receipt-outline"
            title="This Month's Transactions"
            subtitle="What this month's total is made of"
            accentColor={theme.primary}
          />
          {txns.length > 0 ? (
            <FlatList
              data={txns}
              keyExtractor={(t: any) => t.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TransactionItem txn={item} onPress={() => setDetailTxn(item)} />
              )}
            />
          ) : (
            <EmptyState
              compact
              icon="link-outline"
              title="Nothing yet this month"
              subtitle="Auto-matched spend and anything you add by hand will show up here."
            />
          )}
        </View>
      </ScrollView>
      </SafeAreaView>

      {/* Same trigger `GoalsScreen` uses for "add a goal" — a floating "+",
          bottom-right, not a pinned full-width bar (asked to match it
          directly; a full-width button pairing an icon with text isn't this
          app's shape for one anyway — icon-only FABs and text-only wide
          buttons, never both on one control). */}
      <FAB
        onPress={() => { hapticLight(); setFundGoal(goal); }}
        accessibilityLabel={`Add fund to ${goal.name}`}
        bottomInset={insets.bottom}
      />

      <GoalFundModal goal={fundGoal} onClose={() => setFundGoal(null)} />
      <TxnDetailSheet txn={detailTxn} onClose={() => setDetailTxn(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },

  hero: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // Same 26/13/1 shape as GoalCard's own pencil — top-right, inset from the
  // hero's corner rather than tucked under a ribbon (this card has none).
  heroPencil: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  // Ring + the numbers side by side — the ring alone is far narrower than the
  // card, so stacking them (the original shape) spent a whole extra row of
  // height on nothing either side of it.
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  ringWrap: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center' },
  ringGlyphWrap: { position: 'absolute' },
  ringGlyph: { fontSize: 32 },
  heroTextCol: { flex: 1, marginLeft: spacing.md },
  heroValue: { ...typography.h2, fontWeight: '800' },
  heroSub: { ...typography.small, marginTop: 1 },
  heroCaptionPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.pill,
  },
  heroCaption: { ...typography.tiny, fontWeight: '700' },

  // Kind/duration badges AND auto-fund chips share this one wrapping row —
  // two stacked rows collapsed into one, told apart by tint alone (plain
  // outline vs. a colour wash) rather than a second row and its own label.
  chipRow: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: spacing.xs, marginTop: spacing.sm,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  badgeTxt: { ...typography.tiny, fontWeight: '600' },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    maxWidth: 160,
  },
  categoryChipEmoji: { fontSize: 12 },
  categoryChipTxt: { ...typography.tiny, fontWeight: '600' },

  statGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md,
  },
  statTile: {
    flexBasis: '48%', flexGrow: 1,
    borderWidth: 1, borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  statV: { ...typography.bodyBold, fontWeight: '800' },
  statK: { ...typography.tiny, marginTop: 2, textAlign: 'center' },

  section: { marginTop: spacing.lg },
  historyRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  historyMonth: { ...typography.body, fontWeight: '600' },
  historyAmt: { ...typography.small },
});

export default GoalDetailScreen;
