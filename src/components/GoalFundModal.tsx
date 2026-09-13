// =============================================================================
// GoalFundModal — "Add money" to a goal by hand.
//
// Extracted out of GoalsScreen (Sep-12-26) so GoalDetailScreen can offer the
// exact same top-up, not a second hand-rolled copy of it (shared-components
// rule: needed in >1 place → one component).
//
// A top-up is a REAL transaction, not a bare number — see the store's own
// `addTransaction`/`addGoalContribution(sourceTxnId)` comments. Category is
// picked automatically, never asked: an AUTO goal reuses the first id from its
// OWN rule, so the new transaction satisfies that rule on its own and the
// ordinary auto-match counts it — no separate contribution is written at all,
// which is what actually rules out double-counting (the modal only NAMES that
// for an auto goal; the code doesn't let it happen for one). A goal with no
// rule falls back to a generic bucket for its `kind`.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import type { TextStyle } from 'react-native';
import { GOAL_KINDS } from '../constants/goals';
import { DEFAULT_CATEGORIES } from '../constants/categories';
import { PARENT_CATEGORIES, findParentById, parentCatIdForTxn } from '../constants/twoTierCategories';
import { useCategoryMaps } from '../hooks/useCategoryTree';
import { hasAutoRule, goalAutoRule, ruleMatchesTxn } from '../utils/goalPlan';
import { INPUT_LIMITS, sanitizeAmount, parseAmount } from '../utils/validation';
import { formatCurrency } from '../utils/format';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { hapticLight } from '../utils/haptics';
import { useToast } from './Toast';
import CenterModal from './CenterModal';
import { FormField, FormChipRow, FormChip } from './FormField';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Which spend category a hand-logged top-up lands in. */
/**
 * Where this top-up should be filed, as a REAL two-tier category.
 *
 * Resolved through the tree rather than by handing a rule entry straight to the
 * transaction. `autoRule.categoryIds` holds tree CHILD ids now (`mf`,
 * `restaurants`, …), and those are not flat categories — writing one into
 * `categoryId` put a value in the row that nothing else in the app understands:
 * it showed as "Other" in this modal's own hint, and budgets, analytics and the
 * monthly aggregates would all bucket it as unknown.
 *
 * Returns the flat `categoryId` the rest of the app reads PLUS the two-tier
 * labels, so the row is filed exactly as if it had been categorised by hand —
 * which is also what makes it match the goal's own rule through `childCategory`.
 */
const inferGoalTxnCategory = (
  goal: any,
): { categoryId: string; parentCategory?: string; childCategory?: string } => {
  const rule = goalAutoRule(goal);

  const parentId = rule.parentIds[0];
  if (parentId) {
    const p = findParentById(parentId);
    if (p) return { categoryId: p.legacyId, parentCategory: p.label };
  }

  const key = rule.categoryIds[0];
  if (key) {
    for (const p of PARENT_CATEGORIES) {
      const c = p.children.find((ch: any) => ch.id === key || ch.legacyId === key);
      if (c) {
        return {
          categoryId: (c as any).legacyId ?? p.legacyId,
          parentCategory: p.label,
          childCategory: c.label,
        };
      }
      if (p.id === key || p.legacyId === key) return { categoryId: p.legacyId, parentCategory: p.label };
    }
    // A flat category with no home in the tree (cc_bill, other, …) — pass it on.
    if (DEFAULT_CATEGORIES.some((c: any) => c.id === key)) return { categoryId: key };
  }

  const fallback = goal.kind === GOAL_KINDS.INVESTMENT ? 'investments' : 'other';
  return { categoryId: fallback, parentCategory: findParentById(fallback)?.label };
};

/** Human label for the hint under the "Add to X" amount field. */
const goalTxnCategoryLabel = (cat: { categoryId: string; childCategory?: string }): string =>
  cat.childCategory
  || DEFAULT_CATEGORIES.find((c: any) => c.id === cat.categoryId)?.name
  || 'Other';

interface Props {
  /** The goal being funded, or null while closed. */
  goal: any | null;
  onClose: () => void;
}

const GoalFundModal: React.FC<Props> = ({ goal, onClose }) => {
  const theme = useTheme();
  const toast = useToast();
  const { submit } = useSubmitGuard();
  const categoryMaps = useCategoryMaps();

  const accounts = useEPurseStore((s: any) => s.accounts);
  const addTransaction = useEPurseStore((s: any) => s.addTransaction);
  const addGoalContribution = useEPurseStore((s: any) => s.addGoalContribution);
  const getGoalLifetimeSaved = useEPurseStore((s: any) => s.getGoalLifetimeSaved);

  const [fundText, setFundText] = useState('');
  const [fundAccountId, setFundAccountId] = useState<string | null>(null);

  // Reset the draft each time a NEW goal opens (not on every render — a stray
  // account tap or a re-render from an unrelated store update must not wipe
  // whatever's been typed).
  useEffect(() => {
    if (!goal) return;
    setFundText('');
    setFundAccountId(accounts[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goal?.id]);

  const auto = goal ? hasAutoRule(goal) : false;
  const cat = goal ? inferGoalTxnCategory(goal) : null;

  // How much is still needed. Only a goal with a target HAS a remaining amount —
  // a recurring goal has no finish line, so there is nothing to be short of and
  // nothing to overshoot.
  const target = Number(goal?.lifetimeTarget) || 0;
  const saved = goal && target > 0 ? getGoalLifetimeSaved(goal.id) : 0;
  const remaining = target > 0 ? Math.max(0, target - saved) : 0;
  const typed = parseAmount(fundText);
  const over = target > 0 && typed > remaining ? typed - remaining : 0;

  const confirmFund = () => submit(() => {
    const amt = parseAmount(fundText);
    if (!goal || amt <= 0) { onClose(); return; }
    if (!fundAccountId) {
      toast.error('Add an account first', 'You need at least one account to add this against.');
      return;
    }
    const nowIso = new Date().toISOString();
    // Own id, so it can double as the goal contribution's `sourceTxnId` —
    // `addTransaction` doesn't hand its id back, and one has to be picked
    // before either write so the two rows can point at each other.
    const txnId = `txn_goal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    addTransaction({
      id: txnId,
      amount: amt,
      type: 'debit',
      accountId: fundAccountId,
      categoryId: cat!.categoryId,
      ...(cat!.parentCategory ? { parentCategory: cat!.parentCategory } : {}),
      ...(cat!.childCategory ? { childCategory: cat!.childCategory } : {}),
      merchant: goal.name,
      cleanMerchant: goal.name,
      rawMerchant: goal.name,
      createdAt: nowIso,
    });
    // An auto-tracked goal already counts this — the category above was chosen
    // specifically to satisfy the goal's own rule — so a contribution on top
    // would double it. But that is an ASSUMPTION, so it gets checked rather
    // than trusted: ask the goal's real matcher whether the row it just wrote
    // actually matches, and fall back to the explicit link when it doesn't.
    //
    // Without this, any disagreement between the inference and the rule makes
    // "Add money" silently do nothing to the goal — money leaves the account and
    // the goal never moves, with no error anywhere. That is worth a cheap check.
    const matched = auto && ruleMatchesTxn(goalAutoRule(goal), {
      parentId: parentCatIdForTxn(
        { parentCategory: cat!.parentCategory, categoryId: cat!.categoryId },
        categoryMaps,
      ),
      categoryId: cat!.categoryId,
      childId: cat!.childCategory ? categoryMaps.childLabelToId[cat!.childCategory] : '',
      merchant: goal.name,
      at: nowIso,
    });
    if (!matched) {
      addGoalContribution(goal.id, amt, nowIso, txnId);
    }
    toast.success('Added to ' + goal.name, formatCurrency(amt));
    onClose();
  });

  return (
    <CenterModal
      visible={!!goal}
      title={goal ? `Add to ${goal.name}` : ''}
      message={
        auto
          ? 'This goal already counts matching spend automatically — this adds the same way, so only add what a bank message missed.'
          : 'This adds a real transaction, same as anything else you add by hand.'
      }
      primaryText="Add"
      secondaryText="Cancel"
      onPrimary={confirmFund}
      onSecondary={onClose}
      onClose={onClose}
    >
      <TextInput
        value={fundText}
        onChangeText={(t) => setFundText(sanitizeAmount(t))}
        placeholder="0"
        placeholderTextColor={theme.textMuted}
        keyboardType="decimal-pad"
        autoFocus
        maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
        style={[
          styles.fundInput,
          { color: theme.textPrimary, borderColor: theme.inputBorder, backgroundColor: theme.cardAlt },
        ]}
        accessibilityLabel="Amount"
      />
      {/* What's still needed, and a one-tap way to enter exactly that.
          Overshooting is NOT blocked: this mirrors a real transfer that has
          already happened, so refusing it would leave the goal disagreeing with
          the money. It is just never a SURPRISE — the same reasoning as the
          funding split, which makes a double entry visible rather than
          preventing it. */}
      {target > 0 ? (
        <View style={styles.remainingRow}>
          <Text style={[styles.remainingTxt, { color: over > 0 ? theme.warning : theme.textMuted }]}>
            {remaining > 0
              ? (over > 0
                  ? `${formatCurrency(over)} more than the ${formatCurrency(remaining)} still needed`
                  : `${formatCurrency(remaining)} left to reach ${formatCurrency(target)}`)
              : `Already at ${formatCurrency(target)} — this goes over the target`}
          </Text>
          {remaining > 0 && typed !== remaining ? (
            <TouchableOpacity
              onPress={() => { hapticLight(); setFundText(String(remaining)); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Use ${formatCurrency(remaining)}, the amount still needed`}
            >
              <Text style={[styles.remainingFill, { color: theme.primary }]}>Use this</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Which account it left. Skipped entirely with only one account —
          there's nothing to choose, so asking would just be one more tap on
          the thing this modal exists to keep fast. */}
      {accounts.length > 1 ? (
        <FormField label="From" style={styles.fundAccountField}>
          <FormChipRow>
            {accounts.map((a: any) => (
              <FormChip
                key={a.id}
                label={a.name}
                active={fundAccountId === a.id}
                onPress={() => setFundAccountId(a.id)}
                accentColor={theme.primary}
              />
            ))}
          </FormChipRow>
        </FormField>
      ) : null}
      {goal ? (
        <Text style={[styles.fundCatHint, { color: theme.textMuted }]}>
          Added under {goalTxnCategoryLabel(cat!)}
          {accounts.length <= 1 && accounts[0] ? ` · ${accounts[0].name}` : ''}
        </Text>
      ) : null}
    </CenterModal>
  );
};

const styles = StyleSheet.create({
  fundInput: {
    ...typography.h2,
    textAlign: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },
  fundAccountField: { marginTop: spacing.md, width: '100%' },
  remainingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  remainingTxt: { ...typography.tiny, flex: 1 },
  remainingFill: { ...typography.tiny, fontWeight: '700' },
  fundCatHint: { ...typography.tiny, marginTop: spacing.sm, textAlign: 'center' },
});

export default GoalFundModal;
