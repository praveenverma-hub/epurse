// =============================================================================
// BudgetPlanScreen — create or edit the monthly budget plan.
//
// Pushed full-screen from BudgetScreen (Edit Plan button, empty-state CTA, and
// the auto-open-on-first-visit flow) — was a `pageSheet` Modal until Jul-31,
// converted to a real stack screen for the same reason AddTransactionScreen
// isn't a sheet: enough fields (total, N category rows, add-category picker,
// reset/save) that a modal sheet felt cramped and inconsistent with every
// other multi-field flow in the app.
//
//   • Total budget — derived, non-editable (sum of the categories below)
//   • Category rows (seeded from last month's plan, or a few defaults on
//     first-ever creation)
//   • "+ Add Category" via a bottom sheet picker
//   • Reset (revert unsaved edits) + Save Plan
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { INPUT_LIMITS } from '../utils/validation';
import { BUDGETABLE_PARENT_IDS as BUDGETABLE_IDS } from '../constants/twoTierCategories';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import SheetCloseButton from '../components/SheetCloseButton';
import GradientButton from '../components/GradientButton';

// Categories pre-added when creating the very first plan (no history to seed from).
const DEFAULT_BUDGET_IDS = ['food', 'travel', 'bills', 'shopping'];

const BudgetPlanScreen = ({ navigation }) => {
  const theme = useTheme();
  const toast = useToast();

  const budget                  = useEPurseStore((s) => s.budget);
  const lastBudgetPlan          = useEPurseStore((s) => s.lastBudgetPlan);
  const categories              = useEPurseStore((s) => s.categories);
  const setBudget                = useEPurseStore((s) => s.setBudget);
  const getParentCategoryAverage = useEPurseStore((s) => s.getParentCategoryAverage);

  const isEdit = !!budget;
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });

  const BUDGETABLE = useMemo(() => new Set(BUDGETABLE_IDS), []);

  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Seed from the previous month's plan (nudge up/down), or a few common
  // categories on first-ever use.
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

  const seedFromSavedPlan = useCallback(
    () =>
      Object.entries(budget?.perCategory || {})
        .filter(([catId]) => BUDGETABLE.has(catId))
        .map(([catId, cap]) => ({ catId, cap: String(cap) })),
    [budget, BUDGETABLE]
  );

  const [localCats, setLocalCats] = useState(() => (isEdit ? seedFromSavedPlan() : seedFromHistory()));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

  // Sum of the category caps being edited — the total is derived, never typed.
  const localTotal = useMemo(
    () => localCats.reduce((sum, { cap }) => sum + (parseInt(cap, 10) || 0), 0),
    [localCats]
  );

  const handleCapChange = useCallback((catId, text) => {
    setLocalCats((prev) =>
      prev.map((c) => (c.catId === catId ? { ...c, cap: text.replace(/\D/g, '').slice(0, INPUT_LIMITS.AMOUNT_INT_DIGITS) } : c))
    );
  }, []);

  const handleAddCat = useCallback((catId) => {
    const avg = getParentCategoryAverage(catId, 3);
    setLocalCats((prev) => [...prev, { catId, cap: avg > 0 ? String(Math.round(avg)) : '' }]);
    setPickerOpen(false);
  }, [getParentCategoryAverage]);

  const handleRemoveCat = useCallback((catId) => {
    setLocalCats((prev) => prev.filter((c) => c.catId !== catId));
  }, []);

  const resetLocalState = useCallback(() => {
    setLocalCats(isEdit ? seedFromSavedPlan() : seedFromHistory());
  }, [isEdit, seedFromSavedPlan, seedFromHistory]);

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
    toast.success(isEdit ? 'Plan updated' : 'Plan created');
    navigation.goBack();
  }, [localCats, setBudget, navigation, isEdit, toast]);

  // First-level categories available to add (not yet in the local list)
  const pickerCategories = useMemo(() => {
    const addedIds = new Set(localCats.map((c) => c.catId));
    return BUDGETABLE_IDS
      .map((id) => categories.find((c) => c.id === id))
      .filter((c) => c && !addedIds.has(c.id));
  }, [categories, localCats]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {/* SafeAreaView is WHITE so the status-bar inset matches the white header bar
          below it; the page gray comes from the KeyboardAvoidingView + `scroll`. */}
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Light header → dark glyphs (static palette, so not theme-driven). */}
        <StatusBar style="dark" />
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{isEdit ? 'Edit Plan' : `${monthName} Plan`}</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Total budget — derived, non-editable (sum of the categories below) */}
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>Total monthly budget</Text>
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
          <View style={styles.section}>
            <Text style={styles.fieldLabel}>
              Categories {localCats.length > 0 ? `(${localCats.length})` : ''}
            </Text>

            {localCats.length === 0 ? (
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>
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
                          onChangeText={(t) => handleCapChange(catId, t)}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="numeric"
                          style={styles.catAmountInput}
                          maxLength={INPUT_LIMITS.AMOUNT_INT_DIGITS}
                        />
                      </View>
                      <TouchableOpacity
                        onPress={() => handleRemoveCat(catId)}
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
              onPress={() => setPickerOpen(true)}
              activeOpacity={0.75}
            >
              <Text style={[styles.addCatBtnText, { color: theme.primary }]}>+ Add Category</Text>
            </TouchableOpacity>
          </View>

          {/* Action row — Reset (narrow) + Save Plan (wide) */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.resetBtn}
              onPress={resetLocalState}
              activeOpacity={0.8}
            >
              <Text style={[styles.resetBtnText, { color: colors.danger }]}>Reset</Text>
            </TouchableOpacity>
            <GradientButton title="Save Plan" onPress={savePlan} style={styles.saveBtn} />
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Category picker bottom sheet */}
      {pickerOpen && (
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.pickerSheet}>
            <SheetCloseButton onPress={() => setPickerOpen(false)} variant="absolute" />
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Add category</Text>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {pickerCategories.length === 0 ? (
                <Text style={styles.pickerEmpty}>All categories are already added.</Text>
              ) : (
                pickerCategories.map((c) => {
                  const avg = getParentCategoryAverage(c.id, 3);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={styles.pickerRow}
                      onPress={() => handleAddCat(c.id)}
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

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        onClose={() => setConfirm(null)}
        onPrimary={() => setConfirm(null)}
      />
    </KeyboardAvoidingView>
  );
};

export default BudgetPlanScreen;

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Pushed screen → centred title (ui-consistency §2): 40×40 back box + an
  // equal-size empty spacer opposite it, title flex:1 + textAlign:'center'.
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

  safe:    { flex: 1, backgroundColor: colors.card },
  body:    { flex: 1, backgroundColor: colors.background },
  scroll:  { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  section: { marginBottom: spacing.xl },
  fieldLabel: {
    ...typography.small, color: colors.textSecondary, fontWeight: '700',
    marginBottom: spacing.sm,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

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
  totalInputHint: { ...typography.tiny, color: colors.textMuted, marginTop: spacing.xs },

  emptyHint: { paddingVertical: spacing.md },
  emptyHintText: { ...typography.small, color: colors.textSecondary },

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

  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Reset/Save share `radius.lg` (ui-consistency §3d) — a footer pair must
  // agree on radius, and this is the shared full-width-button tier.
  resetBtn: {
    paddingVertical: spacing.md + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.danger + '66',
    backgroundColor: colors.danger + '0D',
  },
  resetBtnText: { ...typography.bodyBold, fontWeight: '700', fontSize: 15 },
  saveBtn: { flex: 1 },

  // ── Category picker (bottom sheet) ──
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
});
