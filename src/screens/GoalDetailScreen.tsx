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
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, Dimensions } from 'react-native';
import type { TextStyle, LayoutChangeEvent } from 'react-native';
import { TabView } from 'react-native-tab-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useRewardStore } from '../store/useRewardStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, withAlpha, mix, readableOn } from '../constants/theme';
import { REWARD_CONFIG, goalRewardDisplay } from '../config/rewardConfig';
import { formatCurrency, formatCompact, monthKey } from '../utils/format';
import { monthsToTarget, projectedMonthLabel, goalAutoRule } from '../utils/goalPlan';
import { GOAL_KIND_META, GOAL_DURATION_META, GOAL_DURATIONS } from '../constants/goals';
import { DEFAULT_CATEGORIES } from '../constants/categories';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import EditIcon from '../components/EditIcon';
import ProgressRing from '../components/ProgressRing';
import EmptyState from '../components/EmptyState';
import GoalFundModal from '../components/GoalFundModal';
import GoalAchievedModal from '../components/GoalAchievedModal';
import { useGoalAchievement } from '../hooks/useGoalAchievement';
import TransactionItemRaw from '../components/TransactionItem';
import UnderlineTabBar from '../components/UnderlineTabBar';
import { goalMonths, summarizeGoalMonths, isMet } from '../utils/goalHistory';
import TxnDetailSheet from '../components/TxnDetailSheet';
import FAB from '../components/FAB';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// TransactionItem is plain JS; alias so tsc only requires the props this
// screen passes (same cast GoalTransactionsSheet used).
const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any; onPress?: () => void;
}>;

const GOAL_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'history', label: 'History' },
];

const monthName = (mk: string, style: 'long' | 'short') => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });
};

const CHART_MONTHS = 6;
const BAR_AREA_H = 84;

/** Closed months: summary numbers, planned-vs-funded bars for the latest months, then every month as a row. */
const GoalHistoryTab: React.FC<{ months: any[]; summary: any; color: string; theme: any }> = ({ months, summary, color, theme }) => {
  // Always CHART_MONTHS calendar slots ending at the newest closed month — months before the
  // goal existed (or with no activity) show as empty slots, so a short history still fills the chart.
  const byKey = new Map<string, any>(months.map((m) => [m.monthKey, m]));
  const [ny, nm] = months[0].monthKey.split('-').map(Number);
  const shown = Array.from({ length: CHART_MONTHS }, (_, i) => {
    const d = new Date(ny, nm - 1 - (CHART_MONTHS - 1 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return byKey.get(key) || { monthKey: key, planned: 0, funded: 0 };
  });
  const peak = Math.max(1, ...shown.map((m) => Math.max(m.planned, m.funded)));
  const barH = (v: number) => Math.max(v > 0 ? 3 : 0, Math.round((v / peak) * BAR_AREA_H));
  const tiles: [string, string][] = [
    ...(summary.planMonths > 0 ? [
      ['Plan Met', `${summary.metMonths} of ${summary.planMonths} ${summary.planMonths === 1 ? 'month' : 'months'}`] as [string, string],
      ['Current Streak', `${summary.streak} ${summary.streak === 1 ? 'month' : 'months'}`] as [string, string],
    ] : []),
    ['Average Funded / Month', formatCompact(summary.avgFunded)],
    ...(summary.best ? [['Best Month', `${formatCompact(summary.best.funded)} · ${monthName(summary.best.monthKey, 'short')}`] as [string, string]] : []),
  ];
  return (
    <>
      <View style={styles.statGrid}>
        {tiles.map(([k, v]) => (
          <View key={k} style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Text style={[styles.statV, { color: theme.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
            <Text style={[styles.statK, { color: theme.textMuted }]}>{k}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <SectionHeader icon="stats-chart-outline" title="Planned vs Funded" accentColor={theme.primary} style={styles.secHead} />
        <View style={[styles.chartCard, { backgroundColor: theme.card, borderColor: theme.divider }]}>
          <View style={styles.chartBars}>
            {shown.map((m) => (
              <View key={m.monthKey} style={styles.chartCol}>
                <View style={[styles.chartPair, { height: BAR_AREA_H }]}>
                  <View style={[styles.bar, { height: barH(m.planned), backgroundColor: theme.divider }]} />
                  <View style={[styles.bar, { height: barH(m.funded), backgroundColor: color }]} />
                </View>
                <Text style={[styles.chartLabel, { color: theme.textMuted }]}>{monthName(m.monthKey, 'short')}</Text>
              </View>
            ))}
          </View>
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: theme.divider }]} /><Text style={[styles.legendTxt, { color: theme.textMuted }]}>Planned</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: color }]} /><Text style={[styles.legendTxt, { color: theme.textMuted }]}>Funded</Text></View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <SectionHeader icon="time-outline" title="Monthly Breakdown" accentColor={theme.primary} style={styles.secHead} />
        <View style={[styles.monthCard, { backgroundColor: theme.card, borderColor: theme.divider }]}>
          {months.map((m, i) => {
            const met = isMet(m);
            return (
              <View key={m.monthKey} style={[styles.monthRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.divider }]}>
                <Text style={[styles.monthName, { color: theme.textPrimary }]}>{monthName(m.monthKey, 'long')}</Text>
                <Text style={[styles.monthAmt, { color: theme.textSecondary }]}>
                  {m.planned > 0 ? `${formatCurrency(m.funded)} of ${formatCurrency(m.planned)}` : `${formatCurrency(m.funded)} funded`}
                </Text>
                {m.planned > 0 ? (
                  <Ionicons
                    name={met ? 'checkmark-circle' : 'ellipse-outline'}
                    size={18}
                    color={met ? theme.success : theme.textMuted}
                    accessibilityLabel={met ? 'Plan met' : 'Plan not met'}
                  />
                ) : <View style={styles.monthIconSpace} />}
              </View>
            );
          })}
        </View>
      </View>
    </>
  );
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
  // Held until every other modal on this screen is gone — two native <Modal>s
  // changing over in one commit is the §8b stack, and the arriving one loses.
  const { achievement, reward, clear: clearAchievement } = useGoalAchievement({
    blocked: !!fundGoal || !!detailTxn,
  });

  const goal = useMemo(() => goals.find((g: any) => g.id === goalId), [goals, goalId]);

  const usage = getGoalPlanUsage();
  const row = usage?.perGoal.find((r: any) => r.goalId === goalId);
  const planned = row?.planned ?? 0;
  const funded = row?.funded ?? 0;
  const lifetimeSaved = goal ? getGoalLifetimeSaved(goal.id) : 0;
  const isOneTime = !!(goal?.lifetimeTarget && goal.lifetimeTarget > 0);
  const achieved = !!goal?.achievedAt;
  const discontinued = !!goal?.discontinuedAt;
  const awareStreak = useRewardStore((s: any) => s.awareStreak);
  // Same `goalRewardDisplay` GoalCard reads, so the two can't disagree.
  const rewardDisplay = goal && REWARD_CONFIG.GOAL_REWARD_ENABLED
    ? goalRewardDisplay({
        isOneTime, lifetimeTarget: goal.lifetimeTarget || 0, planned,
        inactive: achieved || discontinued,
        rpEarned: goal.rpEarned || 0, epcEarned: goal.epcEarned || 0,
        streakDay: awareStreak,
      })
    : null;

  const monthsLeft = isOneTime && goal?.lifetimeTarget
    ? monthsToTarget(goal.lifetimeTarget, lifetimeSaved, planned)
    : null;

  const pct = isOneTime
    ? Math.max(0, Math.min(100, Math.round((lifetimeSaved / goal.lifetimeTarget) * 100)))
    : planned > 0
      ? Math.max(0, Math.min(100, Math.round((funded / planned) * 100)))
      : 0;

  // A bare month COUNT ("6 months to go") makes the reader do the arithmetic
  // themselves to find out what month that actually is — the same gap
  // `GoalCard`'s ribbon had ("does not provide much clarity", Sep-14-26).
  // This screen has the room to say the calendar month outright.
  const heroCaption = achieved
    ? 'Goal complete'
    : isOneTime
      ? (monthsLeft && monthsLeft > 0
          ? `Done by ${projectedMonthLabel(monthsLeft)} at this rate`
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
  const history = useMemo(
    () => (goal ? goalMonths(goalHistory, goal.id, monthKey(new Date())) : []),
    [goalHistory, goal],
  );
  const historySummary = useMemo(() => summarizeGoalMonths(history), [history]);
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  // The pager's height follows the active page's measured content (the page scrolls, not the pages).
  const [sceneH, setSceneH] = useState<Record<string, number>>({});
  const measureScene = (key: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setSceneH((prev) => (Math.abs((prev[key] || 0) - h) < 1 ? prev : { ...prev, [key]: h }));
  };
  // No History tab (and no tab bar) until a month has closed.
  const activeTab = history.length > 0 ? tab : 'overview';

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

  // This month's transactions — the auto-fund link, surfaced.
  const overviewScene = (
    <>
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

      <View style={styles.section}>
        <SectionHeader icon="receipt-outline" title="Transactions" accentColor={theme.primary} style={styles.secHead} />
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
    </>
  );

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
            </View>
          </View>

          {/* Status pill + reward info — "how is this goal doing". */}
          <View style={styles.statusRow}>
            <View style={[styles.heroCaptionPill, { backgroundColor: withAlpha(goal.color, 0.16) }]}>
              <Text style={[styles.heroCaption, { color: theme.textPrimary }]} numberOfLines={1}>{heroCaption}</Text>
            </View>
            {rewardDisplay ? (
              <>
                <View
                  style={[
                    styles.rewardChip,
                    { backgroundColor: withAlpha(rewardDisplay.mode === 'earned' ? theme.textMuted : theme.primary, 0.12) },
                  ]}
                >
                  <Text style={[styles.rewardChipTxt, { color: rewardDisplay.mode === 'earned' ? theme.textMuted : theme.primary }]}>
                    {rewardDisplay.mode === 'earned' && rewardDisplay.rp === 0 ? '— RP' : `+${rewardDisplay.rp} RP`}
                  </Text>
                </View>
                <View
                  style={[
                    styles.rewardChip,
                    { backgroundColor: withAlpha(rewardDisplay.mode === 'earned' ? theme.textMuted : theme.success, 0.12) },
                  ]}
                >
                  <Text style={[styles.rewardChipTxt, { color: rewardDisplay.mode === 'earned' ? theme.textMuted : theme.success }]}>
                    {rewardDisplay.mode === 'earned' && rewardDisplay.epc === 0 ? '— EPC' : `+${rewardDisplay.epc} EPC`}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {/* Kind/duration badges + category chips, one wrapping row. */}
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

        {history.length > 0 ? (
          <>
            {/* Edge-to-edge bar (cancels the page padding) + a real swipe pager, like Group Detail. */}
            <View style={styles.bleed}>
              <UnderlineTabBar
                tabs={GOAL_TABS}
                activeKey={activeTab}
                onChange={(k) => setTab(k as 'overview' | 'history')}
                accentColor={theme.primary}
                style={styles.tabs}
              />
            </View>
            <TabView
              navigationState={{ index: activeTab === 'history' ? 1 : 0, routes: GOAL_TABS }}
              renderScene={({ route }) => (
                <View style={styles.page} onLayout={measureScene(route.key)}>
                  {route.key === 'history'
                    ? <GoalHistoryTab months={history} summary={historySummary} color={goal.color} theme={theme} />
                    : overviewScene}
                </View>
              )}
              renderTabBar={() => null}
              onIndexChange={(i) => setTab(GOAL_TABS[i].key as 'overview' | 'history')}
              initialLayout={{ width: Dimensions.get('window').width }}
              swipeEnabled
              style={[styles.bleed, { height: sceneH[activeTab] || 240 }]}
            />
          </>
        ) : overviewScene}
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

      {/* The congratulation belongs HERE as much as on the list: the "Add money"
          FAB above is what usually tips a goal over its target, and claiming is
          one-shot, so a celebration shown only on GoalsScreen was spent against
          a screen the user wasn't looking at. The hook is focus-gated, so the
          two screens can't both claim the same goal. */}
      <GoalAchievedModal
        visible={!!achievement}
        achievement={achievement}
        reward={reward}
        onClose={clearAchievement}
      />
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
    paddingHorizontal: spacing.sm, paddingVertical: 3,
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

  // Row 3: the pace/status pill (moved out of heroTextCol) + the goal's
  // reward chips — grouped since both answer "how is this goal doing".
  statusRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.xs + 1, marginTop: spacing.sm,
  },
  rewardChip: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  rewardChipTxt: { ...typography.tiny, fontWeight: '800' },

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

  tabs: { marginTop: spacing.md },
  // Cancels scrollContent's side padding; pages put it back so content lines up.
  bleed: { marginHorizontal: -spacing.md },
  page: { paddingHorizontal: spacing.md },
  chartCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  chartBars: { flexDirection: 'row', justifyContent: 'space-around' },
  chartCol: { alignItems: 'center', gap: spacing.xs },
  chartPair: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 10, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  chartLabel: { ...typography.tiny },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { ...typography.tiny },
  monthCard: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  monthName: { ...typography.body, fontWeight: '600', flex: 1 },
  monthAmt: { ...typography.small },
  monthIconSpace: { width: 18 },

  section: { marginTop: spacing.lg },
  // `SectionHeader` carries no bottom margin of its own (that's layout, the
  // caller's job) — without this, "Transactions" sat flush against the list
  // right under it, no gap at all.
  secHead: { marginBottom: spacing.sm },
});

export default GoalDetailScreen;
