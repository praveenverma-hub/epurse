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
// Plan Modal (create or edit):
//   • Total budget input
//   • Category rows (defaults: Food, Travel, Bills, Shopping on first create)
//   • "+ Add Category" via bottom sheet picker
//   • "Save Plan" button — persists to store on tap
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme, useGradient } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';
import { INPUT_LIMITS } from '../utils/validation';
import { PARENT_CATEGORIES } from '../constants/twoTierCategories';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';

// ── Progress ring SVG ─────────────────────────────────────────────────────────
const ProgressRing = ({ pct, size = 140, strokeWidth = 12, color, trackColor, children }) => {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c - (Math.min(pct, 100) / 100) * c;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <Circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>{children}</View>
    </View>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const computeStatus = (pct, daysElapsedPct, hasCap) => {
  if (!hasCap)                    return { key: 'neutral', label: 'No total cap',  color: colors.textMuted,  emoji: '·' };
  if (pct >= 100)                 return { key: 'over',    label: 'Over budget',   color: colors.danger,     emoji: '🚨' };
  if (pct > daysElapsedPct + 10)  return { key: 'slow',    label: 'Over pace',     color: colors.danger,     emoji: '⚠' };
  if (pct > daysElapsedPct + 5)   return { key: 'slow',    label: 'Slow down',     color: colors.warning,    emoji: '⚠' };
  return                                 { key: 'on',      label: 'On track',      color: colors.success,    emoji: '✅' };
};

const ringColor = (pct, daysElapsedPct) => {
  if (pct >= 100)                return colors.danger;
  if (pct > daysElapsedPct + 10) return colors.danger;
  if (pct > daysElapsedPct + 5)  return colors.warning;
  return colors.success;
};

// Budget operates on FIRST-LEVEL (parent) categories only. Children (e.g.
// Groceries) roll up into their parent (Food & Dining) in the store, so there's
// no separate "groceries" budget line.
const BUDGETABLE_IDS = ['food', 'travel', 'bills', 'shopping', 'entertainment', 'health', 'fuel', 'investments', 'education'];

// How many sub-categories are DEFINED under each parent (from the taxonomy, not
// from spending). A parent is drillable when it has >1 defined sub-category —
// regardless of whether every sub has spending this month.
const DEFINED_SUBCOUNT = Object.fromEntries(
  PARENT_CATEGORIES.map((p) => [p.id, (p.children || []).length]),
);
// Categories pre-added when creating the very first plan (no history to seed from).
const DEFAULT_BUDGET_IDS = ['food', 'travel', 'bills', 'shopping'];

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
  const toast    = useToast();

  const budget                  = useEPurseStore((s) => s.budget);
  const lastBudgetPlan          = useEPurseStore((s) => s.lastBudgetPlan);
  const transactions            = useEPurseStore((s) => s.transactions);
  const budgetStreak            = useEPurseStore((s) => s.budgetStreak);
  const categories              = useEPurseStore((s) => s.categories);
  const setBudget               = useEPurseStore((s) => s.setBudget);
  const clearBudget             = useEPurseStore((s) => s.clearBudget);
  const getBudgetUsage          = useEPurseStore((s) => s.getBudgetUsage);
  const getParentCategoryAverage = useEPurseStore((s) => s.getParentCategoryAverage);
  const getBudgetChildBreakdown = useEPurseStore((s) => s.getBudgetChildBreakdown);
  const getUnbudgetedBreakdown  = useEPurseStore((s) => s.getUnbudgetedBreakdown);
  const getCategoryMastery      = useEPurseStore((s) => s.getCategoryMastery);

  const [confirm,         setConfirm]         = useState(null);
  const [planModalVisible, setPlanModalVisible] = useState(false);

  // Local state for the plan modal
  const [localCats,        setLocalCats]         = useState([]); // [{ catId, cap: string }]
  const [localPickerOpen,  setLocalPickerOpen]   = useState(false);

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
  const localTotal = useMemo(
    () => localCats.reduce((sum, { cap }) => sum + (parseInt(cap, 10) || 0), 0),
    [localCats]
  );

  // Seed the plan form from the previous month's plan (so the user just nudges
  // each category up/down). Falls back to a few common categories on first ever
  // use. Returns [{ catId, cap }].
  const seedFromHistory = useCallback(() => {
    const prev = lastBudgetPlan?.perCategory;
    if (prev && Object.keys(prev).length > 0) {
      return Object.entries(prev)
        .filter(([catId]) => BUDGETABLE.has(catId))
        .map(([catId, cap]) => ({ catId, cap: cap ? String(cap) : '' }));
    }
    return DEFAULT_BUDGET_IDS
      .filter((catId) => categories.some((c) => c.id === catId))
      .map((catId) => ({ catId, cap: '' }));
  }, [lastBudgetPlan, categories, BUDGETABLE]);

  // ── Modal handlers ────────────────────────────────────────────────────────
  const openCreateModal = useCallback(() => {
    setLocalCats(seedFromHistory());
    setPlanModalVisible(true);
  }, [seedFromHistory]);

  // Auto-open the create modal when arriving from the dashboard with no plan.
  // Ref guard ensures it fires only once per mount even if deps change.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (openPlan && !budget && !didAutoOpen.current) {
      didAutoOpen.current = true;
      const t = setTimeout(openCreateModal, 120);
      return () => clearTimeout(t);
    }
  }, [openPlan, budget, openCreateModal]);

  const openEditModal = useCallback(() => {
    setLocalCats(
      Object.entries(budget?.perCategory || {})
        .filter(([catId]) => BUDGETABLE.has(catId))
        .map(([catId, cap]) => ({ catId, cap: String(cap) }))
    );
    setPlanModalVisible(true);
  }, [budget, BUDGETABLE]);

  const handleLocalCatCapChange = useCallback((catId, text) => {
    setLocalCats((prev) =>
      prev.map((c) => c.catId === catId ? { ...c, cap: text.replace(/\D/g, '').slice(0, INPUT_LIMITS.AMOUNT_INT_DIGITS) } : c)
    );
  }, []);

  const handleLocalAddCat = useCallback((catId) => {
    const avg = getParentCategoryAverage(catId, 3);
    setLocalCats((prev) => [
      ...prev,
      { catId, cap: avg > 0 ? String(Math.round(avg)) : '' },
    ]);
    setLocalPickerOpen(false);
  }, [getParentCategoryAverage]);

  const handleLocalRemoveCat = useCallback((catId) => {
    setLocalCats((prev) => prev.filter((c) => c.catId !== catId));
  }, []);

  const resetLocalState = useCallback(() => {
    if (budget) {
      // Edit mode — revert to saved plan
      setLocalCats(
        Object.entries(budget.perCategory || {})
          .filter(([catId]) => BUDGETABLE.has(catId))
          .map(([catId, cap]) => ({ catId, cap: String(cap) }))
      );
    } else {
      // Create mode — go back to the seeded defaults
      setLocalCats(seedFromHistory());
    }
  }, [budget, BUDGETABLE, seedFromHistory]);

  const savePlan = useCallback(() => {
    // Every listed category must have a cap > 0.
    if (localCats.length > 0) {
      const hasEmpty = localCats.some(({ cap }) => {
        const num = parseInt(cap, 10);
        return !Number.isFinite(num) || num <= 0;
      });
      if (hasEmpty) {
        setConfirm({
          title: 'Empty category budgets',
          message: 'Give every category a budget greater than 0, or remove it from the plan.',
          primaryText: 'OK',
        });
        return;
      }
    }

    // Build the plan; the store derives the (non-editable) total from the sum.
    const perCategory = {};
    localCats.forEach(({ catId, cap }) => {
      const num = parseInt(cap, 10);
      if (Number.isFinite(num) && num > 0) perCategory[catId] = num;
    });
    setBudget({ perCategory });
    setPlanModalVisible(false);
  }, [localCats, setBudget, setConfirm]);

  const handleResetPlan = useCallback(() => {
    setConfirm({
      title: 'Reset entire plan?',
      message: 'Removes your total cap and all category caps. Your monthly history stays.',
      primaryText: 'Reset',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => { clearBudget(); setConfirm(null); },
    });
  }, [clearBudget]);

  // First-level categories available to add in the modal (not yet in local list)
  const localPickerCategories = useMemo(() => {
    const addedIds = new Set(localCats.map((c) => c.catId));
    return BUDGETABLE_IDS
      .map((id) => categories.find((c) => c.id === id))
      .filter((c) => c && !addedIds.has(c.id));
  }, [categories, localCats]);

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

  // ── Progress section ─────────────────────────────────────────────────────
  const renderProgress = () => {
    if (!usage) return null;
    const { total, perCategory, daysElapsedPct, daysLeftInMonth } = usage;
    const hasCap   = total.cap != null && total.cap > 0;
    const pctVal   = hasCap ? total.pct : 0;
    const status   = computeStatus(pctVal, daysElapsedPct, hasCap);
    const rColor   = hasCap ? ringColor(pctVal, daysElapsedPct) : colors.divider;

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
                  <Text style={styles.heroInfoIcon}>ⓘ</Text>
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
              <TouchableOpacity style={[styles.editPlanBtn, { borderColor: theme.primary }]} onPress={openEditModal} activeOpacity={0.75}>
                <Text style={[styles.editPlanText, { color: theme.primary }]}>Edit Plan</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Ring + info */}
          <View style={styles.heroBody}>
            <ProgressRing pct={pctVal} size={140} strokeWidth={12} color={rColor} trackColor={colors.divider}>
              <Text style={[styles.ringPct, { color: rColor }]}>
                {hasCap ? `${Math.round(pctVal)}%` : '—'}
              </Text>
              {hasCap && (
                <Text style={styles.ringLabel}>used</Text>
              )}
            </ProgressRing>

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
            <Text style={styles.sectionTitle}>By category</Text>
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
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.min(100, r.pct)}%`, backgroundColor: barColor }]} />
                  </View>
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
    <View style={styles.emptyState}>
      <Text style={styles.emptyEmoji}>📋</Text>
      <Text style={styles.emptyTitle}>No plan yet</Text>
      <Text style={styles.emptySub}>
        Set a monthly budget and track your spending in real time.
      </Text>
      <TouchableOpacity
        style={[styles.createBtn, { backgroundColor: theme.primary }]}
        onPress={openCreateModal}
        activeOpacity={0.85}
      >
        <Text style={styles.createBtnText}>Create {monthName} Plan</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Plan Modal ───────────────────────────────────────────────────────────
  const renderPlanModal = () => (
    <Modal
      visible={planModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setPlanModalVisible(false)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setPlanModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {budget ? 'Edit Plan' : `${monthName} Plan`}
            </Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView
            contentContainerStyle={styles.modalScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Total budget — derived, non-editable (sum of the categories below) */}
            <View style={styles.modalSection}>
              <Text style={styles.modalFieldLabel}>Total monthly budget</Text>
              <View style={styles.totalReadonlyWrap}>
                <Text style={styles.totalReadonlyValue}>
                  ₹{localTotal.toLocaleString('en-IN')}
                </Text>
                <Text style={styles.totalReadonlyTag}>auto</Text>
              </View>
              <Text style={styles.totalInputHint}>
                Adds up automatically from your category budgets below.
              </Text>
            </View>

            {/* Category rows */}
            <View style={styles.modalSection}>
              <Text style={styles.modalFieldLabel}>
                Categories {localCats.length > 0 ? `(${localCats.length})` : ''}
              </Text>

              {localCats.length === 0 ? (
                <View style={styles.modalEmptyHint}>
                  <Text style={styles.modalEmptyText}>
                    Add first-level categories below to build your budget.
                  </Text>
                </View>
              ) : (
                <View style={styles.catList}>
                  {localCats.map(({ catId, cap }) => {
                    const cat = categoryById.get(catId);
                    if (!cat) return null;
                    return (
                      <View key={catId} style={styles.catInputRow}>
                        <Text style={styles.catInputEmoji}>{cat.emoji}</Text>
                        <Text style={styles.catInputName} numberOfLines={1}>{cat.name}</Text>
                        <View style={styles.catAmountWrap}>
                          <Text style={styles.catAmountPrefix}>₹</Text>
                          <TextInput
                            value={cap}
                            onChangeText={(t) => handleLocalCatCapChange(catId, t)}
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                            style={styles.catAmountInput}
                            maxLength={INPUT_LIMITS.AMOUNT_INT_DIGITS}
                          />
                        </View>
                        <TouchableOpacity
                          onPress={() => handleLocalRemoveCat(catId)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.catRemoveBtn}
                        >
                          <Text style={styles.catRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Add category button */}
              <TouchableOpacity
                style={[styles.addCatBtn, { borderColor: theme.primary + '66' }]}
                onPress={() => setLocalPickerOpen(true)}
                activeOpacity={0.75}
              >
                <Text style={[styles.addCatBtnText, { color: theme.primary }]}>+ Add Category</Text>
              </TouchableOpacity>
            </View>

            {/* Action row — Reset (narrow) + Save Plan (wide) */}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.resetModalBtn}
                onPress={resetLocalState}
                activeOpacity={0.8}
              >
                <Text style={[styles.resetModalBtnText, { color: colors.danger }]}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.savePlanBtn, { backgroundColor: theme.primary }]}
                onPress={savePlan}
                activeOpacity={0.85}
              >
                <Text style={styles.savePlanBtnText}>Save Plan</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>

        {/* Category picker bottom sheet (inside modal) */}
        {localPickerOpen && (
          <TouchableOpacity
            style={styles.pickerBackdrop}
            activeOpacity={1}
            onPress={() => setLocalPickerOpen(false)}
          >
            <TouchableOpacity activeOpacity={1} style={styles.pickerSheet}>
              <View style={styles.pickerHandle} />
              <Text style={styles.pickerTitle}>Add category</Text>
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {localPickerCategories.length === 0 ? (
                  <Text style={styles.pickerEmpty}>All categories are already added.</Text>
                ) : (
                  localPickerCategories.map((c) => {
                    const avg = getParentCategoryAverage(c.id, 3);
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.pickerRow}
                        onPress={() => handleLocalAddCat(c.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.pickerEmoji}>{c.emoji}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pickerName} numberOfLines={1} ellipsizeMode="tail">{c.name}</Text>
                          {avg > 0 ? (
                            <Text style={styles.pickerAvg}>avg ₹{avg.toLocaleString('en-IN')}/mo</Text>
                          ) : (
                            <Text style={styles.pickerAvg}>no history yet</Text>
                          )}
                        </View>
                        <Text style={[styles.pickerArrow, { color: theme.primary }]}>›</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
      </KeyboardAvoidingView>
    </Modal>
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
        >
          {budget ? renderProgress() : renderEmpty()}
        </ScrollView>
      </SafeAreaView>

      {renderPlanModal()}

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
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: drillCat?.color ?? colors.info }]} />
                      </View>
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

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl + 24 },

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
  heroInfoIcon: { fontSize: 15, color: colors.textMuted, marginTop: 1 },
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
  ringCenter: { position: 'absolute', alignItems: 'center' },
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
  sectionTitle: {
    ...typography.h3, color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
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
  barTrack: {
    height: 7, backgroundColor: colors.divider,
    borderRadius: 4, overflow: 'hidden',
  },
  barFill:  { height: '100%', borderRadius: 4 },
  catCardBot: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  catActual:    { ...typography.small, color: colors.textPrimary, fontWeight: '700' },
  catCapLabel:  { ...typography.small, color: colors.textSecondary },
  catRemain:    { ...typography.tiny, fontWeight: '600' },

  unbudgetedCard: { borderWidth: 1, borderColor: colors.divider, borderStyle: 'dashed' },
  unbudgetedAmount: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '800' },
  unbudgetedNote: { ...typography.tiny, color: colors.textSecondary, marginTop: 6, lineHeight: 15 },

  resetLink:     { alignSelf: 'center', paddingVertical: spacing.md },
  resetLinkText: { ...typography.small, fontWeight: '700' },

  // ── Empty state ──
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyEmoji: { fontSize: 52 },
  emptyTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  emptySub:   { ...typography.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  createBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.lg,
  },
  createBtnText: { ...typography.bodyBold, color: '#fff', fontWeight: '800', fontSize: 16 },

  // ── Plan modal ──
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.card,
  },
  modalClose:     { padding: spacing.sm },
  modalCloseText: { fontSize: 18, color: colors.textSecondary },
  modalTitle:     { ...typography.h3, color: colors.textPrimary },

  modalScroll:    { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  modalSection:   { marginBottom: spacing.xl },
  modalFieldLabel: {
    ...typography.small, color: colors.textSecondary, fontWeight: '700',
    marginBottom: spacing.sm,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  totalInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  totalInputPrefix: { fontSize: 24, color: colors.textSecondary, fontWeight: '600', marginRight: spacing.sm },
  totalInput: {
    flex: 1, paddingVertical: spacing.md,
    fontSize: 28, fontWeight: '800', color: colors.textPrimary,
  },
  totalInputHint: { ...typography.tiny, color: colors.textMuted, marginTop: spacing.xs },

  totalReadonlyWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  totalReadonlyValue: { flex: 1, fontSize: 28, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.5 },
  totalReadonlyTag: {
    ...typography.tiny, fontWeight: '700', color: colors.textSecondary,
    backgroundColor: colors.divider, paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.pill, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  catList:      { gap: spacing.sm, marginBottom: spacing.md },
  catInputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md, padding: spacing.md, gap: spacing.sm,
    ...shadows.card,
  },
  catInputEmoji: { fontSize: 20 },
  catInputName:  { flex: 1, ...typography.bodyBold, color: colors.textPrimary },
  catAmountWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  catAmountPrefix: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  catAmountInput: {
    minWidth: 60, fontSize: 15, fontWeight: '700',
    color: colors.textPrimary, textAlign: 'right',
    paddingVertical: 0,
  },
  catRemoveBtn:  { padding: 4 },
  catRemoveText: { fontSize: 14, color: colors.textSecondary },

  addCatBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderStyle: 'dashed',
    borderRadius: radius.md, paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  addCatBtnText: { ...typography.bodyBold, fontWeight: '700' },

  modalActionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  resetModalBtn: {
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.danger + '66',
    backgroundColor: colors.danger + '0D',
  },
  resetModalBtnText: { ...typography.bodyBold, fontWeight: '700', fontSize: 15 },
  savePlanBtn: {
    flex: 1,
    paddingVertical: spacing.md + 4,
    borderRadius: radius.lg, alignItems: 'center',
    ...shadows.elevated,
  },
  savePlanBtnText: { ...typography.bodyBold, color: '#fff', fontWeight: '800', fontSize: 17 },

  // ── Category picker (in modal) ──
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
  pickerTitle:  { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  pickerEmoji: { fontSize: 22 },
  pickerName:  { ...typography.bodyBold, color: colors.textPrimary },
  pickerAvg:   { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  pickerArrow: { fontSize: 22, fontWeight: '300' },
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
