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
import { Text, TextInput, StyleSheet } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import type { TextStyle } from 'react-native';
import { GOAL_KINDS } from '../constants/goals';
import { DEFAULT_CATEGORIES } from '../constants/categories';
import { hasAutoRule, goalAutoRule } from '../utils/goalPlan';
import { INPUT_LIMITS, sanitizeAmount, parseAmount } from '../utils/validation';
import { formatCurrency } from '../utils/format';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useToast } from './Toast';
import CenterModal from './CenterModal';
import { FormField, FormChipRow, FormChip } from './FormField';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Which spend category a hand-logged top-up lands in. */
const inferGoalTxnCategory = (goal: any): string => {
  const rule = goalAutoRule(goal);
  if (rule.parentIds[0]) return rule.parentIds[0];
  if (rule.categoryIds[0]) return rule.categoryIds[0];
  return goal.kind === GOAL_KINDS.INVESTMENT ? 'investments' : 'other';
};

/** Human label for the hint under the "Add to X" amount field. */
const goalTxnCategoryLabel = (categoryId: string): string =>
  DEFAULT_CATEGORIES.find((c: any) => c.id === categoryId)?.name || 'Other';

interface Props {
  /** The goal being funded, or null while closed. */
  goal: any | null;
  onClose: () => void;
}

const GoalFundModal: React.FC<Props> = ({ goal, onClose }) => {
  const theme = useTheme();
  const toast = useToast();
  const { submit } = useSubmitGuard();

  const accounts = useEPurseStore((s: any) => s.accounts);
  const addTransaction = useEPurseStore((s: any) => s.addTransaction);
  const addGoalContribution = useEPurseStore((s: any) => s.addGoalContribution);

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
  const categoryId = goal ? inferGoalTxnCategory(goal) : null;

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
      categoryId,
      merchant: goal.name,
      cleanMerchant: goal.name,
      rawMerchant: goal.name,
      createdAt: nowIso,
    });
    // An auto-tracked goal already counts this — its category was chosen
    // specifically to satisfy the goal's own rule — so a manual contribution
    // on top would double it. Only a goal with nothing to match on needs the
    // explicit link.
    if (!auto) {
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
          Added under {goalTxnCategoryLabel(categoryId as string)}
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
  fundCatHint: { ...typography.tiny, marginTop: spacing.sm, textAlign: 'center' },
});

export default GoalFundModal;
