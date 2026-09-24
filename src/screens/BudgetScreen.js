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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme, useGradient } from '../hooks/useTheme';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import { formatCompact, monthKey } from '../utils/format';
import { computeBudgetStatus } from '../utils/budgetStatus';
import { BUDGETABLE_PARENT_IDS as BUDGETABLE_IDS } from '../constants/twoTierCategories';
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
import { tabBarClearance } from '../context/TabBarVisibilityContext';
import SectionHeader from '../components/SectionHeader';

// (A local `ringColor` used to live here. It moved into CustomWidgetContainer as
//  `budgetRingColor`, next to the two rings it has to agree with — the classic ring keeps
//  the old pace thresholds, the paid gauge reads its gradient. `computeBudgetStatus` still
//  owns the PACE verdict; that's a separate question from the ring's colour.)

// Budget operates on FIRST-LEVEL (parent) categories only. Children (e.g.
// Groceries) roll up into their parent (Food & Dining) in the store, so there's
// no separate "groceries" budget line. BUDGETABLE_IDS is imported (aliased) from
// twoTierCategories.ts — single source, derived from the tree.

// Copy for the "how budgeting works" info popover.
const BUDGET_INFO = {
  title: 'How this budget works',
  message:
    'Your budget only tracks the categories you add to the plan. Spending in any other category is shown separately as "Unbudgeted expenses" and is not counted against your caps.\n\nSelf transfers and lent/borrowed amounts are never counted — they aren\'t expenses.',
  primaryText: 'Got it',
};

/**
 * Reshapes a closed month's `budgetHistory` snapshot ({ totalCap, perCategory:
 * { catId: { cap, actual } }, totalActual }) into the SAME shape
 * `getBudgetUsage()` returns, so `renderProgress` below can render a live
 * month and a historical one through one code path. `daysElapsedPct: 100` /
 * `daysLeftInMonth: 0` isn't a hack — the month IS fully elapsed, and feeding
 * that through the existing pace thresholds collapses them to a plain
 * over/under read, which is exactly right for a month that already closed.
 * `unbudgeted` isn't captured in the snapshot, so it's 0 — never a real 0/0
 * card, since that section is already gated on `unbudgeted > 0`.
 */
const usageFromHistory = (entry, date) => {
  const perCategory = {};
  let totalActual = 0;
  Object.entries(entry?.perCategory || {}).forEach(([catId, v]) => {
    const cap    = Number(v?.cap) || 0;
    const actual = Number(v?.actual) || 0;
    totalActual += actual;
    perCategory[catId] = {
      cap, actual,
      pct:       cap > 0 ? (actual / cap) * 100 : 0,
      remaining: Math.max(0, cap - actual),
      over:      actual > cap,
      overshoot: Math.max(0, actual - cap),
    };
  });
  const totalCap = entry?.totalCap ?? null;
  return {
    monthKey: monthKey(date),
    total: {
      cap: totalCap,
      actual: totalActual,
      pct: totalCap ? (totalActual / totalCap) * 100 : 0,
      remaining: totalCap != null ? Math.max(0, totalCap - totalActual) : null,
      over: totalCap != null && totalActual > totalCap,
      overshoot: (totalCap != null && totalActual > totalCap) ? (totalActual - totalCap) : 0,
    },
    perCategory,
    allExpense: totalActual,
    unbudgeted: 0,
    daysLeftInMonth: 0,
    daysElapsedPct: 100,
    dayOfMonth: 0,
    lastDayOfMonth: 0,
  };
};

// ── Screen ────────────────────────────────────────────────────────────────────
const BudgetScreen = ({ navigation, headerless = false, openPlan = false, monthOffset = 0 }) => {
  const theme    = useTheme();
  const insets   = useSafeAreaInsets();
  const gradient = useGradient();
  const tabBarScroll = useTabBarScroll();
  const toast    = useToast();

  const budget                  = useEPurseStore((s) => s.budget);
  const budgetHistory           = useEPurseStore((s) => s.budgetHistory);
  const transactions            = useEPurseStore((s) => s.transactions);
  const budgetStreak            = useEPurseStore((s) => s.budgetStreak);
  const categories              = useEPurseStore((s) => s.categories);
  const clearBudget             = useEPurseStore((s) => s.clearBudget);
  const getBudgetUsage          = useEPurseStore((s) => s.getBudgetUsage);
  const getUnbudgetedBreakdown  = useEPurseStore((s) => s.getUnbudgetedBreakdown);
  const getCategoryMastery      = useEPurseStore((s) => s.getCategoryMastery);

  const [confirm, setConfirm] = useState(null);

  // Unbudgeted-expenses drill-down sheet. Budgeted categories no longer use a
  // sheet — tapping one pushes BudgetCategoryDetailScreen instead.
  const [unbudgetedOpen, setUnbudgetedOpen] = useState(false);

  // A past month is a VIEW only — Edit/Remove Plan and the category drill-down
  // stay scoped to the live (current) plan; you can't edit history.
  const isHistorical = monthOffset !== 0;
  const date = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  // Live month reads the same reactive selector as always; a past month reads
  // its `budgetHistory` snapshot instead (null if that month was never tracked).
  const usage = useMemo(
    () => (isHistorical ? usageFromHistory(budgetHistory?.[monthKey(date)], date) : getBudgetUsage()),
    [isHistorical, budgetHistory, date, budget, transactions, getBudgetUsage],
  );
  const hasHistoryEntry = !isHistorical || !!budgetHistory?.[monthKey(date)];

  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Same keys either way — `usage.perCategory` mirrors `budget.perCategory`'s
  // ids for the live month, and the history snapshot's for a past one.
  const budgetedIds = useMemo(() => Object.keys(usage?.perCategory || {}), [usage]);

  const monthName = monthOffset === 0
    ? date.toLocaleDateString('en-IN', { month: 'long' })
    : date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

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
      title: 'Remove Plan?',
      message: 'Removes your total cap and all category caps. Your monthly history stays.',
      primaryText: 'Remove',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        clearBudget();
        setConfirm(null);
        toast.success('Plan removed');
      },
    });
  }, [clearBudget, toast]);

  // Unbudgeted-expenses breakdown, current month.
  const drillRows = useMemo(
    () => (unbudgetedOpen ? getUnbudgetedBreakdown() : []),
    [unbudgetedOpen, getUnbudgetedBreakdown, transactions],
  );
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
    const status   = computeBudgetStatus(pctVal, daysElapsedPct, hasCap);
    // Tinted for whichever ring is actually rendering — the gauge's own gradient when
    // the paid widget is on, the classic pace thresholds otherwise.
    const rColor   = budgetRingColor(pctVal, daysElapsedPct, hasCap, isGaugeWidget);

    const dailyRate = hasCap && total.remaining != null && daysLeftInMonth > 0
      ? Math.max(0, total.remaining / daysLeftInMonth)
      : null;

    // Bottom stats row — built as a list so a missing piece (no cap yet, no
    // unbudgeted spend) just drops its column instead of leaving a gap.
    const statsCols = [];
    if (hasCap && total.remaining != null) {
      statsCols.push({
        key: 'remaining',
        value: formatCompact(Math.abs(total.remaining)),
        label: total.remaining < 0 ? 'Over Budget' : 'Remaining',
        color: total.remaining < 0 ? colors.budgetOver : colors.budgetRemaining,
      });
    }
    if (dailyRate != null) {
      statsCols.push({ key: 'perDay', value: `${formatCompact(dailyRate)}/day`, label: 'Per Day', color: colors.textPrimary });
    }
    // if (usage.unbudgeted > 0) {
      statsCols.push({ key: 'unbudgeted', value: formatCompact(usage.unbudgeted), label: 'Unbudgeted', color: colors.textPrimary });
    // }

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
                {isHistorical
                  ? 'Closed'
                  : daysLeftInMonth === 0 ? 'Last day' : `${daysLeftInMonth} day${daysLeftInMonth === 1 ? '' : 's'} left`}
              </Text>
            </View>
            {/* Editing (and the streak, which is about an ongoing run) only makes
                sense for the live month — a past month is a view, not a form. */}
            {!isHistorical ? (
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
            ) : null}
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
                {hasCap ? `of ${formatCompact(total.cap)}` : (isHistorical ? 'spent' : 'spent this month')}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: status.color + '18' }]}>
                <Text style={styles.statusEmoji}>{status.emoji}</Text>
                <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>
          </View>

          {/* Remaining / per-day pace / unbudgeted — value on top, label below */}
          {statsCols.length > 0 ? (
            <View style={styles.heroStatsRow}>
              {statsCols.map((c, i) => (
                <React.Fragment key={c.key}>
                  {i > 0 ? <View style={styles.heroStatsDivider} /> : null}
                  <View style={styles.heroStatsCol}>
                    <Text style={[styles.heroStatsValue, { color: c.color }]}>{c.value}</Text>
                    <Text style={styles.heroStatsLabel}>{c.label}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          ) : null}
        </View>

        {/* ── Per-category rows ── */}
        {rows.length > 0 ? (
          <View style={styles.catSection}>
            <SectionHeader icon="grid-outline" title="By category" accentColor={theme.primary} />
            {rows.map((r) => {
              const cat = categoryById.get(r.catId);
              if (!cat) return null;
              const barColor =
                r.pct >= 100 ? colors.budgetOver :
                r.pct >= 85  ? colors.budgetNearLimit :
                               cat.color ?? colors.budgetNormal;
              // Mastery is a CURRENT streak, not "as of that month" — showing it
              // on a historical row would misleadingly imply it still applies.
              const mastery = isHistorical ? 0 : getCategoryMastery(r.catId);
              const masteryEmoji = mastery >= 6 ? '🥇' : mastery >= 3 ? '⭐' : null;
              return (
                <TouchableOpacity
                  key={r.catId}
                  style={styles.catCard}
                  activeOpacity={isHistorical ? 1 : 0.75}
                  disabled={isHistorical}
                  onPress={isHistorical ? undefined : () => navigation.navigate('BudgetCategoryDetail', { catId: r.catId })}
                >
                  <View style={styles.catCardTop}>
                    <Text style={styles.catEmoji}>{cat.emoji}</Text>
                    <Text style={styles.catName} numberOfLines={1}>{cat.name}</Text>
                    {masteryEmoji ? <Text style={styles.masteryBadge}>{masteryEmoji}</Text> : null}
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.catPct, { color: barColor }]}>{Math.round(r.pct)}%</Text>
                    {!isHistorical ? <Text style={styles.catChevron}>›</Text> : null}
                  </View>
                  <ProgressBar progress={r.pct / 100} color={barColor} height={7} />
                  <View style={styles.catCardBot}>
                    <Text style={styles.catActual} numberOfLines={1}>{formatCompact(r.actual)}</Text>
                    <Text style={styles.catCapLabel} numberOfLines={1}>{`/ ${formatCompact(r.cap)}`}</Text>
                    <View style={{ flex: 1, minWidth: spacing.sm }} />
                    <Text
                      style={[styles.catRemain, { color: r.over ? colors.budgetOver : colors.textSecondary }]}
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
              onPress={() => setUnbudgetedOpen(true)}
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

        {/* Remove link — the live plan only; there's nothing to remove from a
            past month's view. */}
        {!isHistorical ? (
          <TouchableOpacity onPress={handleResetPlan} style={styles.resetLink} activeOpacity={0.7}>
            <Text style={[styles.resetLinkText, { color: colors.danger }]}>Remove Plan</Text>
          </TouchableOpacity>
        ) : null}
      </>
    );
  };

  // ── Empty states ─────────────────────────────────────────────────────────
  const renderEmpty = () => (
    <EmptyState
      icon="clipboard-outline"
      title="No plan yet"
      subtitle="Set a monthly budget and track your spending in real time."
      actionLabel={`Create ${monthName} Plan`}
      onAction={() => navigation.navigate('BudgetPlan')}
    />
  );

  // A past month with no snapshot — no CTA, since you can't retroactively
  // track a plan for a month that's already closed.
  const renderHistoricalEmpty = () => (
    <EmptyState
      icon="calendar-outline"
      title={`No budget data for ${monthName}`}
      subtitle="A plan wasn't tracked for this month."
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
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: tabBarClearance(insets.bottom) },
            headerless && { paddingTop: spacing.lg },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Hide-on-scroll for the tab bar — Analytics + Budget are the Insights tab's
          // scenes, so the hook belongs here, not on InsightsScreen (which doesn't scroll).
          {...tabBarScroll}
        >
          {isHistorical
            ? (hasHistoryEntry ? renderProgress() : renderHistoricalEmpty())
            : (budget ? renderProgress() : renderEmpty())}
        </ScrollView>
      </SafeAreaView>

      {/* Unbudgeted-expenses drill-down — breakdown of spend outside the plan */}
      <Modal
        visible={unbudgetedOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setUnbudgetedOpen(false)}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setUnbudgetedOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerSheet}>
            <SheetCloseButton onPress={() => setUnbudgetedOpen(false)} variant="absolute" />
            <View style={styles.pickerHandle} />
            <View style={styles.drillHeader}>
              <Ionicons name="file-tray-outline" size={20} color={colors.textSecondary} />
              <Text style={[styles.drillTitle, { flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">
                Unbudgeted expenses
              </Text>
              <View style={{ flex: 1, minWidth: spacing.sm }} />
              <Text style={styles.drillTotal} numberOfLines={1}>{formatCompact(drillTotal)}</Text>
            </View>
            <Text style={styles.drillSub}>This month, by category</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {drillRows.length === 0 ? (
                <Text style={styles.pickerEmpty}>No spending outside your plan yet this month.</Text>
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
                      <ProgressBar progress={pct / 100} color={colors.budgetNormal} height={7} />
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
    // In-flow card above `card`-rung catCards — same rung as them, it stands
    // out by size and fill rather than by out-shadowing its own list.
    ...shadows.card,
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

  // Remaining / per-day — sized to the same ~2-line height the old stacked
  // pace + remaining text took, just laid out as two columns instead.
  heroStatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  heroStatsCol: { flex: 1 },
  // `colors.divider` is tuned for full-width row separators and reads as
  // near-invisible at hairline width next to bold column text — textMuted at
  // low alpha keeps it a quiet separator that's still actually visible here.
  heroStatsDivider: { width: 1, height: 24, backgroundColor: colors.textMuted + '40', marginHorizontal: spacing.md },
  heroStatsValue: { ...typography.small, fontWeight: '800', color: colors.textPrimary },
  heroStatsLabel: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },

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

  unbudgetedCard: { borderWidth: 1, borderColor: colors.divider },
  unbudgetedAmount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '800' },
  unbudgetedNote: { ...typography.tiny, color: colors.textSecondary, marginTop: 6, lineHeight: 15 },

  resetLink:     { alignSelf: 'center', paddingVertical: spacing.md },
  resetLinkText: { ...typography.small, fontWeight: '700' },

  // ── Category drill-down sheet (also shares pickerBackdrop/Sheet/Handle/Empty
  //     below — the "Add Category" picker moved to BudgetPlanScreen) ──
  pickerBackdrop: {
    ...StyleSheet.absoluteFill,
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

  // ── Unbudgeted drill-down sheet ──
  drillHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  drillTitle:  { ...typography.h3, color: colors.textPrimary },
  drillTotal:  { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  drillSub:    { ...typography.small, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md },
  drillRow:    { paddingVertical: spacing.sm },
  drillRowTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: spacing.sm },
  drillRowLabel:  { flex: 1, ...typography.body, color: colors.textPrimary },
  drillRowAmount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  drillRowPct:    { ...typography.small, color: colors.textSecondary, width: 40, textAlign: 'right' },
});
