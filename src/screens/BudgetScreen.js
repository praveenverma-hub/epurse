// =============================================================================
// BudgetScreen — Monthly budget tracker.
//
// Layout (when a plan exists):
//   • Hero card — horizontal ring + amounts + status (attractive, no clutter)
//   • Per-category progress rows
//   • "Edit Plan" button opens the plan modal
//
// Layout (no plan):
//   • Illustrated empty state with "Create Plan" CTA
//
// "Edit Plan" (and the empty-state "Create Plan" CTA) push BudgetPlanScreen —
// a full stack screen, not a modal — for create AND edit alike.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme, useGradient } from '../hooks/useTheme';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import { formatCompact } from '../utils/format';
import { PARENT_CATEGORIES, BUDGETABLE_PARENT_IDS as BUDGETABLE_IDS } from '../constants/twoTierCategories';
import CenterModal from '../components/CenterModal';
import {
  BudgetRingWidget,
  budgetRingColor,
  useGaugeWidgetActive,
} from '../components/CustomWidgetContainer';
import SheetCloseButton from '../components/SheetCloseButton';
import EmptyState from '../components/EmptyState';
import InfoIcon from '../components/InfoIcon';
import ProgressBar from '../components/ProgressBar';
import { useToast } from '../components/Toast';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
import SectionHeader from '../components/SectionHeader';

// ── Helpers ───────────────────────────────────────────────────────────────────
const computeStatus = (pct, daysElapsedPct, hasCap) => {
  if (!hasCap)                    return { key: 'neutral', label: 'No total cap',  color: colors.textMuted,  emoji: '·' };
  if (pct >= 100)                 return { key: 'over',    label: 'Over budget',   color: colors.danger,     emoji: '🚨' };
  if (pct > daysElapsedPct + 10)  return { key: 'slow',    label: 'Over pace',     color: colors.danger,     emoji: '⚠' };
  if (pct > daysElapsedPct + 5)   return { key: 'slow',    label: 'Slow down',     color: colors.warning,    emoji: '⚠' };
  return                                 { key: 'on',      label: 'On track',      color: colors.success,    emoji: '✅' };
};

// (A local `ringColor` used to live here. It moved into CustomWidgetContainer as
//  `budgetRingColor`, next to the two rings it has to agree with — the classic ring keeps
//  the old pace thresholds, the paid gauge reads its gradient. `computeStatus` above still
//  owns the PACE verdict; that's a separate question from the ring's colour.)

// Budget operates on FIRST-LEVEL (parent) categories only. Children (e.g.
// Groceries) roll up into their parent (Food & Dining) in the store, so there's
// no separate "groceries" budget line. BUDGETABLE_IDS is imported (aliased) from
// twoTierCategories.ts — single source, derived from the tree.

// How many sub-categories are DEFINED under each parent (from the taxonomy, not
// from spending). A parent is drillable when it has >1 defined sub-category —
// regardless of whether every sub has spending this month.
const DEFINED_SUBCOUNT = Object.fromEntries(
  PARENT_CATEGORIES.map((p) => [p.id, (p.children || []).length]),
);
// Sentinel id for the "Unbudgeted expenses" drill-down.
const UNBUDGETED_ID = '__unbudgeted__';

// Copy for the "how budgeting works" info popover.
const BUDGET_INFO = {
  title: 'How this budget works',
  message:
    'Your budget only tracks the categories you add to the plan. Spending in any other category is shown separately as "Unbudgeted expenses" and is not counted against your caps.\n\nSelf transfers and lent/borrowed amounts are never counted — they aren\'t expenses.',
  primaryText: 'Got it',
};

// ── Screen ────────────────────────────────────────────────────────────────────
const BudgetScreen = ({ navigation, headerless = false, openPlan = false }) => {
  const theme    = useTheme();
  const gradient = useGradient();
  const tabBarScroll = useTabBarScroll();
  const toast    = useToast();

  const budget                  = useEPurseStore((s) => s.budget);
  const transactions            = useEPurseStore((s) => s.transactions);
  const budgetStreak            = useEPurseStore((s) => s.budgetStreak);
  const categories              = useEPurseStore((s) => s.categories);
  const clearBudget             = useEPurseStore((s) => s.clearBudget);
  const getBudgetUsage          = useEPurseStore((s) => s.getBudgetUsage);
  const getBudgetChildBreakdown = useEPurseStore((s) => s.getBudgetChildBreakdown);
  const getUnbudgetedBreakdown  = useEPurseStore((s) => s.getUnbudgetedBreakdown);
  const getCategoryMastery      = useEPurseStore((s) => s.getCategoryMastery);

  const [confirm, setConfirm] = useState(null);

  // Drill-down sheet: which budget category's sub-categories to show.
  const [drillCatId,       setDrillCatId]         = useState(null);

  // Recomputes when budget OR transactions change so actuals stay live
  const usage = useMemo(() => getBudgetUsage(), [budget, transactions, getBudgetUsage]);

  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  const budgetedIds = useMemo(() => Object.keys(budget?.perCategory || {}), [budget]);

  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });

  const BUDGETABLE = useMemo(() => new Set(BUDGETABLE_IDS), []);

  // Sum of the category caps the user is editing — the total is derived, never typed.
  // Auto-open the plan SCREEN when arriving from the dashboard with no plan yet.
  // Ref guard ensures it fires only once per mount even if deps change.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (openPlan && !budget && !didAutoOpen.current) {
      didAutoOpen.current = true;
      const t = setTimeout(() => navigation.navigate('BudgetPlan'), 120);
      return () => clearTimeout(t);
    }
  }, [openPlan, budget, navigation]);

  const handleResetPlan = useCallback(() => {
    setConfirm({
      title: 'Reset entire plan?',
      message: 'Removes your total cap and all category caps. Your monthly history stays.',
      primaryText: 'Reset',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        clearBudget();
        setConfirm(null);
        toast.success('Plan reset');
      },
    });
  }, [clearBudget, toast]);

  // Drill-down: sub-category stats for the tapped budget category (current
  // month). The special '__unbudgeted__' id drills the unbudgeted slice instead.
  const isUnbudgetedDrill = drillCatId === UNBUDGETED_ID;
  const drillCat = isUnbudgetedDrill
    ? { name: 'Unbudgeted expenses', emoji: null, color: colors.textMuted }
    : (drillCatId ? categoryById.get(drillCatId) : null);
  const drillRows = useMemo(() => {
    if (!drillCatId) return [];
    if (isUnbudgetedDrill) return getUnbudgetedBreakdown();
    const rows = getBudgetChildBreakdown(drillCatId);
    // Exclude rows whose label is the parent category name — those come from
    // transactions tagged directly to the parent with no child sub-category set.
    const parentName = categoryById.get(drillCatId)?.name;
    return parentName ? rows.filter((r) => r.label !== parentName) : rows;
  }, [drillCatId, isUnbudgetedDrill, getBudgetChildBreakdown, getUnbudgetedBreakdown, transactions, categoryById]);
  const drillTotal = useMemo(() => drillRows.reduce((s, r) => s + r.total, 0), [drillRows]);

  // The tab keeps this screen mounted, so the gauge would only ever sweep up once —
  // on the very first visit. Bumping a token on each focus replays the 0 → used fill
  // every time the user actually opens Budget.
  const isFocused = useIsFocused();
  const [gaugeReplay, setGaugeReplay] = useState(0);
  useEffect(() => {
    if (isFocused) setGaugeReplay((n) => n + 1);
  }, [isFocused]);

  // Which hero ring is rendering. Read HERE, at the top level — `renderProgress`
  // below returns early when there's no usage, so a hook called inside it would
  // change hook order between renders.
  const isGaugeWidget = useGaugeWidgetActive();

  // ── Progress section ─────────────────────────────────────────────────────
  const renderProgress = () => {
    if (!usage) return null;
    const { total, perCategory, daysElapsedPct, daysLeftInMonth } = usage;
    const hasCap   = total.cap != null && total.cap > 0;
    const pctVal   = hasCap ? total.pct : 0;
    const status   = computeStatus(pctVal, daysElapsedPct, hasCap);
    // Tinted for whichever ring is actually rendering — the gauge's own gradient when
    // the paid widget is on, the classic pace thresholds otherwise.
    const rColor   = budgetRingColor(pctVal, daysElapsedPct, hasCap, isGaugeWidget);

    const paceText = hasCap && total.remaining != null && daysLeftInMonth > 0
      ? `₹${Math.max(0, Math.round(total.remaining / Math.max(1, daysLeftInMonth))).toLocaleString('en-IN')}/day`
      : '';

    const rows = budgetedIds
      .map((catId) => ({ catId, ...(perCategory[catId] || { cap: 0, actual: 0, pct: 0, remaining: 0, over: false }) }))
      .sort((a, b) => b.pct - a.pct);

    return (
      <>
        {/* ── Hero card ── */}
        <View style={styles.heroCard}>
          {/* Top bar */}
          <View style={styles.heroTop}>
            <View>
              <View style={styles.heroMonthRow}>
                <Text style={styles.heroMonth}>{monthName}</Text>
                <TouchableOpacity
                  onPress={() => setConfirm(BUDGET_INFO)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="How this budget works"
                >
                  <InfoIcon size={16} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.heroDays}>
                {daysLeftInMonth === 0 ? 'Last day' : `${daysLeftInMonth} day${daysLeftInMonth === 1 ? '' : 's'} left`}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {budgetStreak?.current >= 1 ? (
                <View style={styles.streakBadge}>
                  <Text style={styles.streakEmoji}>🏆</Text>
                  <Text style={styles.streakText}>{budgetStreak.current}mo</Text>
                </View>
              ) : null}
              <TouchableOpacity style={[styles.editPlanBtn, { borderColor: theme.primary }]} onPress={() => navigation.navigate('BudgetPlan')} activeOpacity={0.75}>
                <Text style={[styles.editPlanText, { color: theme.primary }]}>Edit Plan</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Ring + info */}
          <View style={styles.heroBody}>
            {/* Classic ring by default; the Gradient Budget Gauge swaps in when bought
                and switched on in the Reward Shop. Fed the percentage USED — the same
                number printed in the middle — so the gauge's pointer can never
                contradict the label. With no cap set there's nothing to be a fraction
                of, so the pointer is hidden rather than parked at a misleading 0%. */}
            <BudgetRingWidget
              pct={pctVal}
              daysElapsedPct={daysElapsedPct}
              hasCap={hasCap}
              discColor={colors.card}
              replayKey={gaugeReplay}
            >
              <Text style={[styles.ringPct, { color: rColor }]}>
                {hasCap ? `${Math.round(pctVal)}%` : '—'}
              </Text>
              {hasCap && (
                <Text style={styles.ringLabel}>used</Text>
              )}
            </BudgetRingWidget>

            <View style={styles.heroInfo}>
              <Text style={styles.heroActual}>{formatCompact(total.actual)}</Text>
              <Text style={styles.heroCap}>
                {hasCap ? `of ${formatCompact(total.cap)}` : 'spent this month'}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: status.color + '18' }]}>
                <Text style={styles.statusEmoji}>{status.emoji}</Text>
                <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
              </View>
              {paceText ? (
                <Text style={styles.paceText}>⚡ {paceText} · {daysLeftInMonth}d left</Text>
              ) : null}
              {hasCap && total.remaining != null ? (
                <Text style={[styles.remainText, { color: total.remaining < 0 ? colors.danger : colors.success }]}>
                  {total.remaining < 0
                    ? `₹${Math.abs(Math.round(total.remaining)).toLocaleString('en-IN')} over`
                    : `₹${Math.round(total.remaining).toLocaleString('en-IN')} remaining`}
                </Text>
              ) : null}
              {usage.unbudgeted > 0 ? (
                <View style={styles.unbudgetedHintRow}>
                  <Ionicons name="file-tray-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.unbudgetedHint}>{formatCompact(usage.unbudgeted)} unbudgeted</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Per-category rows ── */}
        {rows.length > 0 ? (
          <View style={styles.catSection}>
            <SectionHeader icon="grid-outline" title="By category" accentColor={theme.primary} />
            {rows.map((r) => {
              const cat = categoryById.get(r.catId);
              if (!cat) return null;
              const barColor =
                r.pct >= 100 ? colors.danger :
                r.pct >= 85  ? colors.warning :
                               cat.color ?? colors.info;
              const mastery = getCategoryMastery(r.catId);
              const masteryEmoji = mastery >= 6 ? '🥇' : mastery >= 3 ? '⭐' : null;
              return (
                <TouchableOpacity
                  key={r.catId}
                  style={styles.catCard}
                  activeOpacity={0.75}
                  onPress={() => {
                    // Open the breakdown when this category has SOME spend AND the
                    // parent defines more than one sub-category — even if not every
                    // sub has spending (the sheet shows whatever's there). Only block
                    // when there's nothing to break down (no spend, or a single-sub
                    // parent like Fuel/Entertainment where a drill is meaningless).
                    const definedSubs = DEFINED_SUBCOUNT[r.catId] || 0;
                    if (r.actual > 0 && definedSubs > 1) {
                      setDrillCatId(r.catId);
                    } else {
                      toast.info(
                        'No sub-category breakdown',
                        r.actual > 0
                          ? `${cat.name} has only one sub-category — nothing to break down.`
                          : `${cat.name} has no spending to drill into this month.`,
                      );
                    }
                  }}
                >
                  <View style={styles.catCardTop}>
                    <Text style={styles.catEmoji}>{cat.emoji}</Text>
                    <Text style={styles.catName} numberOfLines={1}>{cat.name}</Text>
                    {masteryEmoji ? <Text style={styles.masteryBadge}>{masteryEmoji}</Text> : null}
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.catPct, { color: barColor }]}>{Math.round(r.pct)}%</Text>
                    <Text style={styles.catChevron}>›</Text>
                  </View>
                  <ProgressBar progress={r.pct / 100} color={barColor} height={7} />
                  <View style={styles.catCardBot}>
                    <Text style={styles.catActual} numberOfLines={1}>{formatCompact(r.actual)}</Text>
                    <Text style={styles.catCapLabel} numberOfLines={1}>{`/ ${formatCompact(r.cap)}`}</Text>
                    <View style={{ flex: 1, minWidth: spacing.sm }} />
                    <Text
                      style={[styles.catRemain, { color: r.over ? colors.danger : colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {r.over
                        ? `${formatCompact(r.overshoot ?? 0)} over`
                        : `${formatCompact(r.remaining ?? 0)} left`}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {/* ── Unbudgeted expenses ── */}
        {usage.unbudgeted > 0 ? (
          <View style={styles.catSection}>
            <TouchableOpacity
              style={[styles.catCard, styles.unbudgetedCard]}
              activeOpacity={0.75}
              onPress={() => setDrillCatId(UNBUDGETED_ID)}
            >
              <View style={styles.catCardTop}>
                <Ionicons name="file-tray-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.catName} numberOfLines={1}>Unbudgeted expenses</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.unbudgetedAmount}>{formatCompact(usage.unbudgeted)}</Text>
                <Text style={styles.catChevron}>›</Text>
              </View>
              <Text style={styles.unbudgetedNote}>
                Spent outside your budgeted categories — not counted against caps. Tap to see where.
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Reset link */}
        <TouchableOpacity onPress={handleResetPlan} style={styles.resetLink} activeOpacity={0.7}>
          <Text style={[styles.resetLinkText, { color: colors.danger }]}>Reset plan</Text>
        </TouchableOpacity>
      </>
    );
  };

  // ── Empty state ──────────────────────────────────────────────────────────
  const renderEmpty = () => (
    <EmptyState
      icon="clipboard-outline"
      title="No plan yet"
      subtitle="Set a monthly budget and track your spending in real time."
      actionLabel={`Create ${monthName} Plan`}
      onAction={() => navigation.navigate('BudgetPlan')}
    />
  );


  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={headerless ? [] : ['top']}>
        {/* Header — hidden when embedded inside InsightsScreen */}
        {!headerless && (
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.title}>{monthName} Budget</Text>
            <View style={{ width: 40 }} />
          </View>
        )}

        <ScrollView
          contentContainerStyle={[styles.scroll, headerless && { paddingBottom: TAB_BAR_HEIGHT + 24, paddingTop: spacing.lg }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Hide-on-scroll for the tab bar — Analytics + Budget are the Insights tab's
          // scenes, so the hook belongs here, not on InsightsScreen (which doesn't scroll).
          {...tabBarScroll}
        >
          {budget ? renderProgress() : renderEmpty()}
        </ScrollView>
      </SafeAreaView>

      {/* Category drill-down — sub-category stats for the tapped budget card */}
      <Modal
        visible={!!drillCatId}
        animationType="slide"
        transparent
        onRequestClose={() => setDrillCatId(null)}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setDrillCatId(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerSheet}>
            <SheetCloseButton onPress={() => setDrillCatId(null)} variant="absolute" />
            <View style={styles.pickerHandle} />
            <View style={styles.drillHeader}>
              {isUnbudgetedDrill ? (
                <Ionicons name="file-tray-outline" size={20} color={colors.textSecondary} />
              ) : (
                <Text style={styles.drillEmoji}>{drillCat?.emoji}</Text>
              )}
              <Text style={[styles.drillTitle, { flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">
                {drillCat?.name}
              </Text>
              <View style={{ flex: 1, minWidth: spacing.sm }} />
              <Text style={styles.drillTotal} numberOfLines={1}>{formatCompact(drillTotal)}</Text>
            </View>
            <Text style={styles.drillSub}>This month, by sub-category</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {drillRows.length === 0 ? (
                <Text style={styles.pickerEmpty}>No spending in this category yet this month.</Text>
              ) : (
                drillRows.map((row) => {
                  const pct = drillTotal > 0 ? (row.total / drillTotal) * 100 : 0;
                  return (
                    <View key={row.label} style={styles.drillRow}>
                      <View style={styles.drillRowTop}>
                        <Text style={styles.drillRowLabel} numberOfLines={1}>{row.label}</Text>
                        <Text style={styles.drillRowAmount}>{formatCompact(row.total)}</Text>
                        <Text style={styles.drillRowPct}>{Math.round(pct)}%</Text>
                      </View>
                      <ProgressBar progress={pct / 100} color={drillCat?.color ?? colors.info} height={7} />
                    </View>
                  );
                })
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />
    </KeyboardAvoidingView>
  );
};

export default BudgetScreen;

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Screen header ──
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title:    { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.textPrimary },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl + 24, flexGrow: 1 },

  // ── Hero card ──
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.elevated,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heroMonthRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMonth: { ...typography.h2, color: colors.textPrimary },
  heroDays:  { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  streakBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  streakEmoji: { fontSize: 11 },
  streakText:  { fontSize: 11, color: '#92400E', fontWeight: '700' },
  editPlanBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, borderWidth: 1.5,
  },
  editPlanText: { fontSize: 13, fontWeight: '700' },

  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  ringPct:    { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  ringLabel:  { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },

  heroInfo: { flex: 1, gap: 4 },
  heroActual: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  heroCap:    { ...typography.small, color: colors.textSecondary },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill, alignSelf: 'flex-start',
    marginTop: 4,
  },
  statusEmoji: { fontSize: 12 },
  statusLabel: { ...typography.small, fontWeight: '700' },
  paceText:    { ...typography.tiny, color: colors.textSecondary, marginTop: 4 },
  remainText:  { ...typography.small, fontWeight: '700', marginTop: 2 },
  unbudgetedHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  unbudgetedHint: { ...typography.tiny, color: colors.textMuted, fontWeight: '600' },

  // ── Category section ──
  catSection: { gap: spacing.sm, marginBottom: spacing.lg },
  catCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.card,
  },
  catCardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 8 },
  catEmoji:     { fontSize: 18 },
  catName:      { ...typography.bodyBold, color: colors.textPrimary, flexShrink: 1 },
  masteryBadge: { fontSize: 13 },
  catPct:       { fontSize: 13, fontWeight: '800' },
  catChevron:   { fontSize: 18, color: colors.textMuted, marginLeft: 6, marginTop: -2 },
  catCardBot: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  catActual:    { ...typography.small, color: colors.textPrimary, fontWeight: '700' },
  catCapLabel:  { ...typography.small, color: colors.textSecondary },
  catRemain:    { ...typography.tiny, fontWeight: '600' },

  unbudgetedCard: { borderWidth: 1, borderColor: colors.divider, borderStyle: 'dashed' },
  unbudgetedAmount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '800' },
  unbudgetedNote: { ...typography.tiny, color: colors.textSecondary, marginTop: 6, lineHeight: 15 },

  resetLink:     { alignSelf: 'center', paddingVertical: spacing.md },
  resetLinkText: { ...typography.small, fontWeight: '700' },

  // ── Category drill-down sheet (also shares pickerBackdrop/Sheet/Handle/Empty
  //     below — the "Add Category" picker moved to BudgetPlanScreen) ──
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000060',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  pickerHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider, alignSelf: 'center', marginBottom: spacing.md,
  },
  pickerEmpty: { ...typography.small, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xl },

  // ── Category drill-down sheet ──
  drillHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  drillEmoji:  { fontSize: 22 },
  drillTitle:  { ...typography.h3, color: colors.textPrimary },
  drillTotal:  { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  drillSub:    { ...typography.small, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  drillRow:    { paddingVertical: spacing.sm },
  drillRowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: spacing.sm },
  drillRowLabel:  { flex: 1, ...typography.body, color: colors.textPrimary },
  drillRowAmount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  drillRowPct:    { ...typography.small, color: colors.textSecondary, width: 40, textAlign: 'right' },
});
