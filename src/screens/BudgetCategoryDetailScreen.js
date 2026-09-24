// =============================================================================
// BudgetCategoryDetailScreen — full-screen drill-down for one budgeted
// category, pushed when a category card on BudgetScreen is tapped (replaces
// the old bottom-sheet modal, which only showed the sub-category breakdown).
//
//   • Hero card — same ring language as the Budget screen's own hero, plus a
//     full-width explained status band (heading + what-to-do suggestion)
//   • "By sub-category" card — this month's spend inside the category
//     (the old modal's content), hidden when the category has only one
//     defined sub-category (nothing to break down)
//   • "This month vs last month" comparison card
//   • "View Transactions" — hands off to the Activity tab pre-filtered to
//     this category + this month, rather than duplicating a (non-editable)
//     transaction list here; Activity already does view/edit.
// =============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';
import { computeBudgetStatus, budgetStatusAdvice } from '../utils/budgetStatus';
import { PARENT_CATEGORIES } from '../constants/twoTierCategories';
import {
  BudgetRingWidget,
  budgetRingColor,
  useGaugeWidgetActive,
} from '../components/CustomWidgetContainer';
import ProgressBar from '../components/ProgressBar';
import SectionHeader from '../components/SectionHeader';
import NavListRow from '../components/NavListRow';

// How many sub-categories are DEFINED under each parent (from the taxonomy,
// not from spending) — a parent is drillable when it has >1, regardless of
// whether every sub has spending this month.
const DEFINED_SUBCOUNT = Object.fromEntries(
  PARENT_CATEGORIES.map((p) => [p.id, (p.children || []).length]),
);

const BudgetCategoryDetailScreen = ({ navigation, route }) => {
  const theme = useTheme();
  const catId = route?.params?.catId;

  const categories              = useEPurseStore((s) => s.categories);
  const getBudgetUsage          = useEPurseStore((s) => s.getBudgetUsage);
  const getBudgetChildBreakdown = useEPurseStore((s) => s.getBudgetChildBreakdown);
  const getParentCategoryMonthTotal = useEPurseStore((s) => s.getParentCategoryMonthTotal);
  const getCategoryMastery      = useEPurseStore((s) => s.getCategoryMastery);
  const transactions            = useEPurseStore((s) => s.transactions);
  const isGaugeWidget = useGaugeWidgetActive();

  const cat = useMemo(() => categories.find((c) => c.id === catId), [categories, catId]);

  // Recomputes when transactions change so the category card and this screen
  // can never show different numbers for the same month.
  const usage = useMemo(() => getBudgetUsage(), [getBudgetUsage, transactions]);
  const r = usage?.perCategory?.[catId];

  const subRows = useMemo(() => {
    if (!catId) return [];
    const rows = getBudgetChildBreakdown(catId);
    // Exclude rows whose label is the parent category name — those come from
    // transactions tagged directly to the parent with no child sub-category set.
    return cat?.name ? rows.filter((row) => row.label !== cat.name) : rows;
  }, [catId, cat, getBudgetChildBreakdown, transactions]);
  const subTotal = useMemo(() => subRows.reduce((s, row) => s + row.total, 0), [subRows]);
  const showSubCard = (DEFINED_SUBCOUNT[catId] || 0) > 1;

  const lastMonthDate = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() - 1, 1);
  }, []);
  const lastMonthTotal = useMemo(
    () => (catId ? getParentCategoryMonthTotal(catId, lastMonthDate).total : 0),
    [catId, lastMonthDate, getParentCategoryMonthTotal, transactions],
  );

  const mastery = catId ? getCategoryMastery(catId) : 0;
  const masteryEmoji = mastery >= 6 ? '🥇' : mastery >= 3 ? '⭐' : null;

  if (!catId || !cat || !usage || !r) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Category</Text>
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>
    );
  }

  const hasCap  = r.cap > 0;
  const pctVal  = hasCap ? r.pct : 0;
  const status  = computeBudgetStatus(pctVal, usage.daysElapsedPct, hasCap);
  const advice  = budgetStatusAdvice(status, {
    remaining: r.remaining, overshoot: r.overshoot, daysLeftInMonth: usage.daysLeftInMonth,
  });
  const rColor  = budgetRingColor(pctVal, usage.daysElapsedPct, hasCap, isGaugeWidget);

  const delta = r.actual - lastMonthTotal;
  const deltaPct = lastMonthTotal > 0 ? (delta / lastMonthTotal) * 100 : (r.actual > 0 ? 100 : 0);
  const hasComparison = r.actual > 0 || lastMonthTotal > 0;
  const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const trendColor = trend === 'up' ? colors.danger : trend === 'down' ? colors.success : colors.textMuted;
  const trendIcon  = trend === 'up' ? 'trending-up' : trend === 'down' ? 'trending-down' : 'remove';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{cat.name}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero card ── */}
        <View style={styles.heroCard}>
          {/* Decorative category icon — large, absolutely positioned so it
              fills the card's empty top-right corner without pushing the
              heading row's layout (no gap/padding reserved for it). */}
          <View pointerEvents="none" style={styles.heroIconTile}>
            <Text style={styles.heroEmoji}>{cat.emoji}</Text>
          </View>

          <View style={styles.heroTop}>
            <View style={styles.heroTitleWrap}>
              <Text style={styles.heroName} numberOfLines={1}>{cat.name}</Text>
              {masteryEmoji ? <Text style={styles.masteryBadge}>{masteryEmoji}</Text> : null}
            </View>
          </View>

          <View style={styles.heroBody}>
            <BudgetRingWidget pct={pctVal} daysElapsedPct={usage.daysElapsedPct} hasCap={hasCap} discColor={colors.card}>
              <Text style={[styles.ringPct, { color: rColor }]}>{hasCap ? `${Math.round(pctVal)}%` : '—'}</Text>
              {hasCap ? <Text style={styles.ringLabel}>used</Text> : null}
            </BudgetRingWidget>

            <View style={styles.heroInfo}>
              <Text style={styles.heroActual}>{formatCompact(r.actual)}</Text>
              <Text style={styles.heroCap}>{hasCap ? `of ${formatCompact(r.cap)}` : 'spent this month'}</Text>
              {hasCap ? (
                <Text style={[styles.remainText, { color: r.over ? colors.budgetOver : colors.budgetRemaining }]}>
                  {r.over
                    ? `${formatCompact(r.overshoot ?? 0)} over`
                    : `${formatCompact(r.remaining ?? 0)} remaining`}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Explained status band — heading + what-you-can-do suggestion */}
          <View style={[styles.statusBand, { backgroundColor: status.color + '14' }]}>
            <View style={styles.statusBandTop}>
              <Text style={styles.statusEmoji}>{status.emoji}</Text>
              <Text style={[styles.statusHeading, { color: status.color }]}>{advice.heading}</Text>
            </View>
            <Text style={styles.statusDetail}>{advice.detail}</Text>
          </View>
        </View>

        {/* ── By sub-category ── */}
        {showSubCard ? (
          <View style={styles.card}>
            <SectionHeader icon="grid-outline" title="By Sub-Category" accentColor={theme.primary} size="sm" />
            {subRows.length === 0 ? (
              <Text style={styles.emptyText}>No spending in this category yet this month.</Text>
            ) : (
              subRows.map((row) => {
                const pct = subTotal > 0 ? (row.total / subTotal) * 100 : 0;
                return (
                  <View key={row.label} style={styles.subRow}>
                    <View style={styles.subRowTop}>
                      <Text style={styles.subRowLabel} numberOfLines={1}>{row.label}</Text>
                      <Text style={styles.subRowAmount}>{formatCompact(row.total)}</Text>
                      <Text style={styles.subRowPct}>{Math.round(pct)}%</Text>
                    </View>
                    <ProgressBar progress={pct / 100} color={cat.color ?? colors.budgetNormal} height={7} />
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* ── This month vs last month ── */}
        <View style={styles.card}>
          <SectionHeader
            icon="bar-chart-outline"
            size="sm"
            title={
              hasComparison
                ? trend === 'flat'
                  ? 'You spent the same'
                  : `You spent ${Math.round(Math.abs(deltaPct))}% ${trend === 'up' ? 'more' : 'less'}`
                : 'No spending yet'
            }
            subtitle={hasComparison ? (trend === 'flat' ? 'as last month' : 'than last month') : 'in this category, this month'}
            accentColor={theme.primary}
            right={hasComparison ? (
              <View style={[styles.trendChip, { backgroundColor: trendColor + '18' }]}>
                <Ionicons name={trendIcon} size={14} color={trendColor} />
                <Text style={[styles.trendChipText, { color: trendColor }]}>
                  {Math.round(Math.abs(deltaPct))}%
                </Text>
              </View>
            ) : null}
          />
          <View style={styles.compareRow}>
            <View style={styles.compareCol}>
              <Text style={styles.compareLabel}>This Month</Text>
              <Text style={styles.compareValue}>{formatCompact(r.actual)}</Text>
            </View>
            <View style={styles.compareDivider} />
            <View style={styles.compareCol}>
              <Text style={styles.compareLabel}>Last Month</Text>
              <Text style={styles.compareValue}>{formatCompact(lastMonthTotal)}</Text>
            </View>
          </View>
        </View>

        {/* ── View transactions — hands off to Activity, pre-filtered. Pushed
            directly (not via the tab) so back returns here, and disabled
            when there's nothing to show for this category this month. ── */}
        <View style={[styles.card, styles.navCard]}>
          <NavListRow
            icon="receipt-outline"
            label="View Transactions"
            hint={r.actual > 0 ? "This month's activity, filtered to this category" : 'No transactions yet this month'}
            tint={r.actual > 0 ? undefined : colors.textMuted}
            onPress={r.actual > 0 ? () => navigation.navigate('CategoryTransactions', { categoryId: catId, dateRangeId: 'mThis' }) : undefined}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default BudgetCategoryDetailScreen;

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.card },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.card,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title:   { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: 'center' },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xl, backgroundColor: colors.background, flexGrow: 1 },

  // ── Hero card ──
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    overflow: 'visible',
    ...shadows.card,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  // Absolutely positioned — out of flow, so its size never adds row gap or
  // pushes card padding. `overflow: visible` on heroCard lets it sit flush in
  // (or bleed past) the corner without being clipped.
  heroIconTile: {
    position: 'absolute',
    top: spacing.lg, right: spacing.lg,
    width: 96, height: 96,
    alignItems: 'center', justifyContent: 'center',
  },
  heroEmoji: { fontSize: 50 },
  // Bounded so a long category name truncates before it runs under the
  // absolutely-positioned icon, rather than reserving flex space for it.
  heroTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '58%' },
  heroName:  { ...typography.h3, color: colors.textPrimary, flexShrink: 1 },
  masteryBadge: { fontSize: 15 },

  heroBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  ringPct:   { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  ringLabel: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },

  heroInfo:   { flex: 1, gap: 4 },
  heroActual: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  heroCap:    { ...typography.small, color: colors.textSecondary },
  remainText: { ...typography.small, fontWeight: '700', marginTop: 2 },

  // Full-width explained status band at the bottom of the hero card.
  statusBand: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statusBandTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  statusEmoji:   { fontSize: 14 },
  statusHeading: { ...typography.bodyBold, fontWeight: '800' },
  statusDetail:  { ...typography.small, color: colors.textSecondary, lineHeight: 18 },

  // ── Shared card shell (sub-category / comparison / nav) ──
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  navCard: { paddingVertical: spacing.sm },

  emptyText: { ...typography.small, color: colors.textSecondary, marginTop: spacing.xs },

  subRow:    { paddingVertical: spacing.sm },
  subRowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: spacing.sm },
  subRowLabel:  { flex: 1, ...typography.body, color: colors.textPrimary },
  subRowAmount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  subRowPct:    { ...typography.small, color: colors.textSecondary, width: 40, textAlign: 'right' },

  compareRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  compareCol: { flex: 1, alignItems: 'center' },
  compareDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: colors.divider },
  compareLabel: { ...typography.tiny, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  compareValue: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 4, letterSpacing: -0.3 },

  // Trailing slot on SectionHeader's row — icon + the same % the heading states.
  trendChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 5,
    borderRadius: radius.pill,
  },
  trendChipText: { ...typography.tiny, fontWeight: '800' },
});
