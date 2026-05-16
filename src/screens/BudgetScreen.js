// =============================================================================
// BudgetScreen
// -----------------------------------------------------------------------------
// One screen, two stacked sections:
//   1. Progress view (visible only when a plan exists) — big ring + category bars
//   2. Edit form (always visible) — total cap + budgeted rows + suggestions
// Auto-saves on every change. No "Save" button.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';
import CenterModal from '../components/CenterModal';

// ── Progress ring SVG ─────────────────────────────────────────────────────────
const ProgressRing = ({ pct, size = 180, strokeWidth = 14, color, trackColor, children }) => {
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
// On-track vs slow vs over status, based on actual % vs days-elapsed %.
const computeStatus = (pct, daysElapsedPct, hasCap) => {
  if (!hasCap)              return { key: 'neutral', label: 'No total cap',  color: colors.textMuted, emoji: '·' };
  if (pct >= 100)           return { key: 'over',    label: 'Over budget',  color: colors.danger,  emoji: '🚨' };
  if (pct > daysElapsedPct + 10) return { key: 'slow', label: 'Over pace',  color: colors.danger,  emoji: '⚠' };
  if (pct > daysElapsedPct + 5)  return { key: 'slow', label: 'Slow down',  color: colors.warning, emoji: '⚠' };
  return { key: 'on',       label: 'On track',     color: colors.success, emoji: '✅' };
};

const ringColor = (pct, daysElapsedPct) => {
  if (pct >= 100) return colors.danger;
  if (pct > daysElapsedPct + 10) return colors.danger;
  if (pct > daysElapsedPct + 5)  return colors.warning;
  return colors.success;
};

// ── Screen ────────────────────────────────────────────────────────────────────
const BudgetScreen = ({ navigation, headerless = false }) => {
  const theme = useTheme();

  const budget                = useEPurseStore((s) => s.budget);
  const transactions          = useEPurseStore((s) => s.transactions);
  const budgetStreak          = useEPurseStore((s) => s.budgetStreak);
  const categories            = useEPurseStore((s) => s.categories);
  const setBudgetTotalCap     = useEPurseStore((s) => s.setBudgetTotalCap);
  const updateBudgetCategory  = useEPurseStore((s) => s.updateBudgetCategory);
  const removeBudgetCategory  = useEPurseStore((s) => s.removeBudgetCategory);
  const clearBudget           = useEPurseStore((s) => s.clearBudget);
  const getBudgetUsage        = useEPurseStore((s) => s.getBudgetUsage);
  const getCategoryAverage    = useEPurseStore((s) => s.getCategoryAverage);
  const getTopCategoriesByAverage = useEPurseStore((s) => s.getTopCategoriesByAverage);
  const getCategoryMastery    = useEPurseStore((s) => s.getCategoryMastery);
  const budgetHistory         = useEPurseStore((s) => s.budgetHistory);

  const [confirm,    setConfirm]    = useState(null); // { title, message, primaryText, onConfirm }
  const [pickerOpen, setPickerOpen] = useState(false);

  // Recomputes when budget OR transactions change so actuals stay live
  const usage = useMemo(() => getBudgetUsage(), [budget, transactions, getBudgetUsage]);

  // Category lookup for emoji / name / color
  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Budgeted categories (rows in the edit list)
  const budgetedIds = useMemo(() => Object.keys(budget?.perCategory || {}), [budget]);

  // Suggestions = top categories by 3-mo avg that aren't already budgeted,
  // excluding LB / non-expense categories
  const EXCLUDE_CATS = useMemo(() => new Set([
    'lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'salary', 'transfer',
  ]), []);
  const suggestions = useMemo(() => {
    const tops = getTopCategoriesByAverage(8);
    return tops
      .filter((s) => !budgetedIds.includes(s.categoryId) && !EXCLUDE_CATS.has(s.categoryId))
      .slice(0, 6);
  }, [getTopCategoriesByAverage, budgetedIds, EXCLUDE_CATS, budget]);

  // 3-month total avg (sum of category averages) — used as a quick "use suggested" total
  const totalAvg = useMemo(() => {
    return getTopCategoriesByAverage(50)
      .filter((s) => !EXCLUDE_CATS.has(s.categoryId))
      .reduce((acc, s) => acc + s.average, 0);
  }, [getTopCategoriesByAverage, EXCLUDE_CATS]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleTotalCapChange = useCallback((text) => {
    const num = parseInt(text.replace(/\D/g, ''), 10);
    setBudgetTotalCap(Number.isFinite(num) ? num : null);
  }, [setBudgetTotalCap]);

  const handleCategoryCapChange = useCallback((catId, text) => {
    const num = parseInt(text.replace(/\D/g, ''), 10);
    updateBudgetCategory(catId, Number.isFinite(num) ? num : 0);
  }, [updateBudgetCategory]);

  const handleRemoveCategory = useCallback((catId) => {
    const cat = categoryById.get(catId);
    setConfirm({
      title: `Remove ${cat?.name || 'category'} from plan?`,
      message: 'You can add it back anytime.',
      primaryText: 'Remove',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => { removeBudgetCategory(catId); setConfirm(null); },
    });
  }, [categoryById, removeBudgetCategory]);

  const handleAddSuggestion = useCallback((s) => {
    updateBudgetCategory(s.categoryId, s.average);
  }, [updateBudgetCategory]);

  const handleAddCategory = useCallback((catId) => {
    const avg = getCategoryAverage(catId, 3);
    updateBudgetCategory(catId, avg > 0 ? avg : 1000);
    setPickerOpen(false);
  }, [getCategoryAverage, updateBudgetCategory]);

  const handleUseSuggestedTotal = useCallback(() => {
    if (totalAvg > 0) setBudgetTotalCap(Math.round(totalAvg * 1.05));
  }, [totalAvg, setBudgetTotalCap]);

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

  // ── Progress section ─────────────────────────────────────────────────────
  const renderProgress = () => {
    if (!usage) return null;
    const { total, perCategory, daysElapsedPct, daysLeftInMonth } = usage;
    const hasCap  = total.cap != null && total.cap > 0;
    const pctVal  = hasCap ? total.pct : 0;
    const status  = computeStatus(pctVal, daysElapsedPct, hasCap);
    const rColor  = hasCap ? ringColor(pctVal, daysElapsedPct) : colors.divider;

    // Sort: breaches first (descending by pct), then everything else
    const rows = budgetedIds
      .map((catId) => ({ catId, ...(perCategory[catId] || { cap: 0, actual: 0, pct: 0, remaining: 0, over: false }) }))
      .sort((a, b) => b.pct - a.pct);

    // Pace microcopy — "₹X/day for N days"
    let paceText = '';
    if (hasCap && total.remaining != null && daysLeftInMonth > 0) {
      const perDay = Math.max(0, Math.round(total.remaining / Math.max(1, daysLeftInMonth)));
      paceText = `₹${perDay.toLocaleString('en-IN')}/day for ${daysLeftInMonth} day${daysLeftInMonth === 1 ? '' : 's'}`;
    }

    return (
      <>
        {/* Hero ring card */}
        <View style={styles.ringCard}>
          <ProgressRing
            pct={pctVal}
            size={180}
            strokeWidth={14}
            color={rColor}
            trackColor={colors.divider}
          >
            <Text style={[styles.ringPct, { color: rColor }]}>
              {hasCap ? `${Math.round(pctVal)}%` : '—'}
            </Text>
            <Text style={styles.ringActual}>{formatCompact(total.actual)}</Text>
            {hasCap ? (
              <Text style={styles.ringOfCap}>of {formatCompact(total.cap)}</Text>
            ) : (
              <Text style={styles.ringOfCap}>spent</Text>
            )}
          </ProgressRing>

          <View style={styles.ringMeta}>
            <View style={styles.statusPill}>
              <Text style={styles.statusEmoji}>{status.emoji}</Text>
              <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
            </View>
            <Text style={styles.daysLeft}>
              {daysLeftInMonth === 0 ? 'Last day of month' : `${daysLeftInMonth} day${daysLeftInMonth === 1 ? '' : 's'} left`}
            </Text>
            {paceText ? <Text style={styles.paceText}>⚡ {paceText}</Text> : null}
          </View>

          {/* Streak badge — only if there's actually a streak */}
          {budgetStreak?.current >= 1 ? (
            <View style={styles.streakBadge}>
              <Text style={styles.streakEmoji}>🏆</Text>
              <Text style={styles.streakText}>
                {budgetStreak.current} month{budgetStreak.current === 1 ? '' : 's'} under budget
              </Text>
            </View>
          ) : null}
        </View>

        {/* Per-category progress */}
        {rows.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>By category</Text>
            <View style={styles.progressList}>
              {rows.map((r) => {
                const cat = categoryById.get(r.catId);
                if (!cat) return null;
                const barColor =
                  r.pct >= 100 ? colors.danger :
                  r.pct >= 90  ? colors.warning :
                                 cat.color;
                const mastery = getCategoryMastery(r.catId);
                const masteryEmoji = mastery >= 6 ? '🥇' : mastery >= 3 ? '⭐' : null;
                return (
                  <View key={r.catId} style={styles.progressRow}>
                    <View style={styles.progressHeader}>
                      <Text style={styles.progressEmoji}>{cat.emoji}</Text>
                      <Text style={styles.progressName} numberOfLines={1}>{cat.name}</Text>
                      {masteryEmoji ? (
                        <Text style={styles.masteryBadge}>{masteryEmoji}</Text>
                      ) : null}
                      <Text style={styles.progressAmt}>
                        {formatCompact(r.actual)}
                        <Text style={styles.progressAmtMuted}> / {formatCompact(r.cap)}</Text>
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.min(100, r.pct)}%`, backgroundColor: barColor }]} />
                    </View>
                    <View style={styles.progressFooter}>
                      <Text style={[styles.progressPct, { color: barColor }]}>
                        {Math.round(r.pct)}%
                      </Text>
                      <Text style={styles.progressSub}>
                        {r.over
                          ? `₹${r.overshoot.toLocaleString('en-IN')} over`
                          : `₹${r.remaining.toLocaleString('en-IN')} left`}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        ) : null}

        <View style={styles.sectionDivider} />
      </>
    );
  };

  // ── Edit form section ────────────────────────────────────────────────────
  const renderEditForm = () => (
    <>
      <Text style={styles.sectionTitle}>{budget ? 'Edit plan' : 'Create plan'}</Text>

      {/* Total cap */}
      <Text style={styles.fieldLabel}>Total monthly cap</Text>
      <View style={styles.amountInputWrap}>
        <Text style={styles.amountPrefix}>₹</Text>
        <TextInput
          value={budget?.totalCap ? String(budget.totalCap) : ''}
          onChangeText={handleTotalCapChange}
          placeholder="50,000"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          style={styles.amountInput}
        />
      </View>
      {totalAvg > 0 ? (
        <TouchableOpacity onPress={handleUseSuggestedTotal} style={styles.suggestionLink}>
          <Text style={styles.suggestionLinkText}>
            3-mo avg total: ₹{Math.round(totalAvg).toLocaleString('en-IN')}
          </Text>
          <Text style={[styles.suggestionUseBtn, { color: theme.primary }]}>Use +5%</Text>
        </TouchableOpacity>
      ) : null}

      {/* Budgeted rows */}
      <View style={styles.editSection}>
        <Text style={styles.subSectionTitle}>
          Budgeted {budgetedIds.length > 0 ? `(${budgetedIds.length})` : ''}
        </Text>
        {budgetedIds.length === 0 ? (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>
              Pick categories below to start budgeting. You can change amounts anytime.
            </Text>
          </View>
        ) : (
          <View style={styles.editList}>
            {budgetedIds.map((catId) => {
              const cat = categoryById.get(catId);
              if (!cat) return null;
              const cap = budget?.perCategory?.[catId] || 0;
              return (
                <View key={catId} style={styles.editRow}>
                  <Text style={styles.editEmoji}>{cat.emoji}</Text>
                  <Text style={styles.editName} numberOfLines={1}>{cat.name}</Text>
                  <View style={styles.editAmountWrap}>
                    <Text style={styles.editAmountPrefix}>₹</Text>
                    <TextInput
                      value={String(cap)}
                      onChangeText={(t) => handleCategoryCapChange(catId, t)}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                      style={styles.editAmountInput}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={() => handleRemoveCategory(catId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.editRemove}
                  >
                    <Text style={styles.editRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Suggestions */}
      {suggestions.length > 0 ? (
        <View style={styles.editSection}>
          <Text style={styles.subSectionTitle}>Suggested · based on last 3 months</Text>
          <View style={styles.editList}>
            {suggestions.map((s) => {
              const cat = categoryById.get(s.categoryId);
              if (!cat) return null;
              return (
                <TouchableOpacity
                  key={s.categoryId}
                  style={styles.suggestionRow}
                  onPress={() => handleAddSuggestion(s)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.editEmoji}>{cat.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.editName} numberOfLines={1}>{cat.name}</Text>
                    <Text style={styles.suggestionAvg}>avg ₹{s.average.toLocaleString('en-IN')}/mo</Text>
                  </View>
                  <View style={[styles.addBadge, { backgroundColor: theme.primary + '18', borderColor: theme.primary }]}>
                    <Text style={[styles.addBadgeText, { color: theme.primary }]}>+ Add</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Add any other category */}
      <TouchableOpacity
        style={styles.addOtherBtn}
        onPress={() => setPickerOpen(true)}
        activeOpacity={0.75}
      >
        <Text style={[styles.addOtherPlus, { color: theme.primary }]}>+</Text>
        <Text style={styles.addOtherText}>Add other category</Text>
      </TouchableOpacity>
    </>
  );

  // ── Category picker modal ────────────────────────────────────────────────
  const pickerCategories = useMemo(() => {
    return categories.filter(
      (c) => !budgetedIds.includes(c.id) && !EXCLUDE_CATS.has(c.id)
    );
  }, [categories, budgetedIds, EXCLUDE_CATS]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={headerless ? [] : ['top']}>
        {/* Header — hidden when embedded inside InsightsScreen */}
        {!headerless && (
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backText}>←</Text>
            </TouchableOpacity>
            <Text style={styles.title}>
              {new Date().toLocaleDateString('en-IN', { month: 'long' })} Budget
            </Text>
            {budget ? (
              <TouchableOpacity onPress={handleResetPlan} style={styles.resetBtn}>
                <Text style={[styles.resetText, { color: colors.danger }]}>Reset</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 60 }} />
            )}
          </View>
        )}

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {budget ? renderProgress() : null}
          {renderEditForm()}
          <View style={{ height: 80 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Category picker bottom sheet */}
      {pickerOpen ? (
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Add category to plan</Text>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {pickerCategories.length === 0 ? (
                <Text style={styles.pickerEmpty}>All available categories are already budgeted.</Text>
              ) : (
                pickerCategories.map((c) => {
                  const avg = getCategoryAverage(c.id, 3);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.pickerRow}
                      onPress={() => handleAddCategory(c.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.editEmoji}>{c.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.editName}>{c.name}</Text>
                        {avg > 0 ? (
                          <Text style={styles.suggestionAvg}>avg ₹{avg.toLocaleString('en-IN')}/mo</Text>
                        ) : (
                          <Text style={styles.suggestionAvg}>no history yet</Text>
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
      ) : null}

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

const styles = StyleSheet.create({
  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  backText: { fontSize: 22, color: colors.textPrimary },
  title: { ...typography.h2, color: colors.textPrimary },
  resetBtn: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  resetText: { ...typography.bodyBold, fontWeight: '700' },

  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  // Ring card
  ringCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  ringCenter: { position: 'absolute', alignItems: 'center' },
  ringPct: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  ringActual: { ...typography.bodyBold, color: colors.textPrimary, marginTop: 4 },
  ringOfCap: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },

  ringMeta: { alignItems: 'center', marginTop: spacing.md, gap: 6 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    backgroundColor: colors.background,
    borderRadius: radius.pill,
  },
  statusEmoji: { fontSize: 13 },
  statusLabel: { ...typography.small, fontWeight: '700' },
  daysLeft: { ...typography.small, color: colors.textSecondary },
  paceText: { ...typography.tiny, color: colors.textPrimary, fontWeight: '600', marginTop: 2 },

  streakBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 6,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  streakEmoji: { fontSize: 14 },
  streakText: { ...typography.small, color: '#92400E', fontWeight: '700' },

  // Per-category progress
  sectionTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  progressList: { gap: spacing.md },
  progressRow: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.card,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 8,
  },
  progressEmoji: { fontSize: 18 },
  progressName: { flex: 1, ...typography.bodyBold, color: colors.textPrimary },
  masteryBadge: { fontSize: 14, marginRight: 6 },
  progressAmt: { ...typography.small, color: colors.textPrimary, fontWeight: '700' },
  progressAmtMuted: { color: colors.textSecondary, fontWeight: '400' },

  barTrack: {
    height: 8,
    backgroundColor: colors.divider,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressPct: { ...typography.tiny, fontWeight: '700' },
  progressSub: { ...typography.tiny, color: colors.textSecondary },

  sectionDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.xl,
  },

  // Edit form
  fieldLabel: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  amountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  amountPrefix: { fontSize: 22, color: colors.textSecondary, fontWeight: '600', marginRight: spacing.sm },
  amountInput: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  suggestionLink: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  suggestionLinkText: { ...typography.tiny, color: colors.textSecondary },
  suggestionUseBtn: { ...typography.small, fontWeight: '700' },

  editSection: { marginTop: spacing.lg },
  subSectionTitle: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },

  emptyHint: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
  },
  emptyHintText: { ...typography.small, color: colors.textSecondary, lineHeight: 19 },

  editList: { gap: spacing.sm },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...shadows.card,
  },
  editEmoji: { fontSize: 18 },
  editName: { flex: 1, ...typography.bodyBold, color: colors.textPrimary },
  editAmountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 110,
  },
  editAmountPrefix: { fontSize: 14, color: colors.textSecondary, marginRight: 4 },
  editAmountInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    paddingVertical: 2,
  },
  editRemove: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  editRemoveText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },

  // Suggestions
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  suggestionAvg: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  addBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  addBadgeText: { ...typography.tiny, fontWeight: '700' },

  addOtherBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  addOtherPlus: { fontSize: 20, fontWeight: '700' },
  addOtherText: { ...typography.bodyBold, color: colors.textPrimary },

  // Picker
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl + 8,
    ...shadows.elevated,
  },
  pickerHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  pickerTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  pickerEmpty: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  pickerArrow: { fontSize: 22, fontWeight: '300' },
});

export default BudgetScreen;
