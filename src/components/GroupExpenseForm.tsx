// =============================================================================
// GroupExpenseForm — the shared body for adding a manual expense to a group.
// Rendered inside two shells:
//   • GroupExpenseSheet  — bottom-sheet modal (tagging an existing txn from Activity).
//   • AddGroupExpenseScreen — full screen (the Groups-tab "+" FAB).
// Personal groups: amount + merchant + category.
// Shared groups:  same + who paid + split among members.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButtonBase from './GradientButton';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { formatCurrency } from '../utils/format';
import { INPUT_LIMITS, sanitizeAmount, parseAmount } from '../utils/validation';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { useEPurseStore } from '../store/ePurseStore';
import { useToast } from './Toast';
import { TwoTierCategorySheet } from './TwoTierCategorySheet';
import type { Group, GroupShare, GroupExpenseData } from '../types/group';

const GradientButton = GradientButtonBase as React.FC<{
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: object;
}>;

interface AccountLike {
  id: string;
  name: string;
  type?: string;
}

type SplitMode = 'equal' | 'percent' | 'amount';

interface GroupExpenseFormProps {
  /** Target group. */
  group: Group;
  onAdd: (expenseData: GroupExpenseData) => void;
  /** When tagging an EXISTING transaction, its amount — prefilled and locked here. */
  presetAmount?: number;
  /**
   * Sheet shells pass their `visible` flag so the form resets each time it opens.
   * Screen shells omit it (defaults to visible) — the form resets once on mount.
   */
  visible?: boolean;
  /**
   * Hide the category picker. Set when the form is reached from the manage
   * modal (review queue / Activity tagging) — the category was already chosen
   * there, so showing it again is redundant.
   */
  hideCategory?: boolean;
  /**
   * When set, the form opens in EDIT mode: fields are prefilled from this
   * existing group transaction and the submit button reads "Save changes".
   */
  editTxn?: any;
  /**
   * Hide the form's own submit button. The shell then renders a pinned footer
   * button and triggers submit via `submitRef`.
   */
  hideSubmit?: boolean;
  /** Shells assign the latest submit handler here to drive their footer button. */
  submitRef?: React.MutableRefObject<(() => void) | null>;
}

export default function GroupExpenseForm({ group, onAdd, presetAmount, visible = true, hideCategory = false, editTxn, hideSubmit = false, submitRef }: GroupExpenseFormProps) {
  const theme = useTheme();
  const toast = useToast();
  const accounts = useEPurseStore((s: any) => s.accounts) as AccountLike[];

  const [amountRaw, setAmountRaw] = useState('');
  const [merchant, setMerchant] = useState('');
  const [payerIdx, setPayerIdx] = useState(0); // index into allMembers
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [shares, setShares] = useState<GroupShare[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [parentCat, setParentCat] = useState<string | null>(null);
  const [childCat, setChildCat] = useState<string | null>(null);
  const [catSheet, setCatSheet] = useState(false);

  const isShared = group?.type === 'shared';
  // Guarantee the built-in 'me' member is present for shared groups, even if a stored
  // group lost it (e.g. an older edit) — so "You" always shows in payer + split.
  const allMembers = useMemo(() => {
    const ms = group?.members || [];
    if (group?.type === 'shared' && !ms.some((m) => m.memberId === 'me')) {
      return [{ memberId: 'me', name: 'You', isMe: true }, ...ms];
    }
    return ms;
  }, [group]);
  const amount = parseAmount(amountRaw);
  // memberId of the currently-selected payer — drives the "Paid / owes" labels.
  const payerMemberId = allMembers[payerIdx]?.memberId;
  // Tagging an existing txn → amount comes from that txn and is fixed (so the
  // split math matches the real transaction). Manual add → free entry.
  const amountLocked = typeof presetAmount === 'number' && presetAmount > 0;

  // Reset on open (sheet) / mount (screen). In edit mode, prefill from editTxn.
  useEffect(() => {
    if (visible === false) return;
    setCatSheet(false);

    if (editTxn) {
      const eg = editTxn.groupSplit;
      setAmountRaw(String(editTxn.amount ?? ''));
      // 'Group Expense' is the placeholder default — show it as empty so the hint shows.
      setMerchant(editTxn.merchant && editTxn.merchant !== 'Group Expense' ? editTxn.merchant : '');
      setParentCat(editTxn.parentCategory ?? null);
      setChildCat(editTxn.childCategory ?? null);
      setAccountId(editTxn.accountId ?? accounts[0]?.id ?? null);

      if (eg && eg.shares?.length) {
        const pIdx = allMembers.findIndex((m) => m.memberId === eg.paidByMemberId);
        setPayerIdx(pIdx >= 0 ? pIdx : 0);
        // Stored shares are absolute ₹ amounts → prefill in 'amount' mode faithfully.
        setSplitMode('amount');
        const amt = Number(editTxn.amount) || 0;
        setShares(
          eg.shares.map((sh: any) => ({
            memberId: sh.memberId,
            name: sh.name,
            shareAmount: Number(sh.shareAmount) || 0,
            percent: amt > 0 ? Math.round(((Number(sh.shareAmount) || 0) / amt) * 100) : 0,
          })),
        );
      } else {
        setPayerIdx(0);
        setSplitMode('equal');
        if (group?.members) {
          setShares(group.members.map((m) => ({
            memberId: m.memberId, name: m.name, shareAmount: 0,
            percent: Math.round(100 / group.members.length),
          })));
        }
      }
      return;
    }

    setAmountRaw(amountLocked ? String(presetAmount) : '');
    setMerchant('');
    setPayerIdx(0);
    setSplitMode('equal');
    setAccountId(accounts[0]?.id || null);
    setParentCat(null);
    setChildCat(null);
    if (group?.members) {
      setShares(
        group.members.map((m) => ({
          memberId: m.memberId,
          name: m.name,
          shareAmount: 0,
          percent: Math.round(100 / group.members.length),
        })),
      );
    }
  }, [visible, group, accounts, amountLocked, presetAmount, editTxn, allMembers]);

  // Recompute equal shares when amount changes in equal mode
  useEffect(() => {
    if (splitMode !== 'equal' || !amount || !allMembers.length) return;
    const each = parseFloat((amount / allMembers.length).toFixed(2));
    setShares(allMembers.map((m, i) => ({
      memberId: m.memberId,
      name: m.name,
      shareAmount: i === allMembers.length - 1
        ? parseFloat((amount - each * (allMembers.length - 1)).toFixed(2))
        : each,
      percent: Math.round(100 / allMembers.length),
    })));
  }, [amount, splitMode, allMembers]);

  const updateShare = useCallback((idx: number, value: number, field: 'percent' | 'shareAmount') => {
    setShares((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  const handleAdd = () => {
    if (amount <= 0) {
      toast.warning('Amount required', 'Enter the expense amount.');
      return;
    }
    if (amount > MAX_ALLOWED_AMOUNT) {
      toast.error('Amount too large', 'Maximum allowed is ₹10,00,00,000 (10 crore).');
      return;
    }
    const payer = allMembers[payerIdx] || { memberId: 'me', name: 'You' };

    // Resolve final per-member shareAmounts from the active split mode, and validate
    // they reconcile to the full amount (so account delta = my share + lent legs).
    let finalShares: GroupShare[] = [];
    if (isShared) {
      if (splitMode === 'percent') {
        const sumPct = shares.reduce((s, x) => s + (Number(x.percent) || 0), 0);
        if (Math.abs(sumPct - 100) > 0.5) {
          toast.warning('Percentages must total 100%', `Currently ${Math.round(sumPct)}%.`);
          return;
        }
        // Convert % → ₹; the last member absorbs the rounding remainder so shares sum exactly.
        let allocated = 0;
        finalShares = shares.map((x, i) => {
          const amt = i === shares.length - 1
            ? parseFloat((amount - allocated).toFixed(2))
            : parseFloat(((amount * (Number(x.percent) || 0)) / 100).toFixed(2));
          allocated = parseFloat((allocated + amt).toFixed(2));
          return { memberId: x.memberId, name: x.name, shareAmount: amt };
        });
      } else if (splitMode === 'amount') {
        const sumAmt = shares.reduce((s, x) => s + (Number(x.shareAmount) || 0), 0);
        if (Math.abs(sumAmt - amount) > 0.5) {
          toast.warning('Shares must total the amount', `Currently ${formatCurrency(sumAmt)} of ${formatCurrency(amount)}.`);
          return;
        }
        finalShares = shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: Number(x.shareAmount) || 0 }));
      } else {
        // equal — the effect already computed shareAmounts that sum to the amount.
        finalShares = shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: Number(x.shareAmount) || 0 }));
      }
    }

    const expenseData: GroupExpenseData = {
      amount,
      merchant: merchant.trim() || 'Group Expense',
      // categoryId is derived from the two-tier labels by addGroupExpense; pass labels through.
      ...(parentCat ? { parentCategory: parentCat } : {}),
      ...(childCat ? { childCategory: childCat } : {}),
      paidByMemberId: payer.memberId,
      paidByName: payer.name,
      shares: finalShares,
      accountId: payer.memberId === 'me' ? accountId : null,
    };
    onAdd(expenseData);
  };

  // Expose the latest submit handler so a shell can drive its pinned footer button.
  useEffect(() => { if (submitRef) submitRef.current = handleAdd; });

  return (
    <>
      {/* Amount — prefilled & locked when tagging an existing transaction */}
      <TextInput
        style={[styles.amountInput, amountLocked && styles.amountInputLocked]}
        placeholder="₹ 0"
        placeholderTextColor={colors.textMuted}
        value={amountRaw}
        onChangeText={(t) => setAmountRaw(sanitizeAmount(t))}
        keyboardType="decimal-pad"
        maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
        editable={!amountLocked}
        autoFocus={!amountLocked}
      />
      {amountLocked && <Text style={styles.amountHint}>From the transaction</Text>}

      {/* Merchant */}
      <TextInput
        style={styles.nameInput}
        placeholder="What was this for?"
        placeholderTextColor={colors.textMuted}
        value={merchant}
        onChangeText={setMerchant}
        maxLength={60}
      />

      {/* Category — hidden when reached from the manage modal (already set there) */}
      {!hideCategory && (
        <TouchableOpacity style={styles.catRow} onPress={() => setCatSheet(true)} activeOpacity={0.75}>
          <Text style={styles.catLabel}>Category</Text>
          <View style={styles.catValueWrap}>
            <Text style={[styles.catValue, !childCat && styles.catValueMuted]} numberOfLines={1}>
              {childCat ? `${parentCat} › ${childCat}` : 'Other (tap to choose)'}
            </Text>
            <Text style={styles.catChevron}>›</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Account — personal groups (no payer concept) */}
      {!isShared && accounts.length > 1 && (
        <>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.accountRow}>
            {accounts.map((a) => (
              <TouchableOpacity
                key={a.id}
                style={[styles.accountChip, accountId === a.id && { borderColor: theme.primary, backgroundColor: theme.primary + '14' }]}
                onPress={() => setAccountId(a.id)}
              >
                <Text
                  style={[styles.accountChipTxt, accountId === a.id && { color: theme.primary }]}
                  numberOfLines={1}
                >
                  {a.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {/* Payer → account → split (shared only) */}
      {isShared && (
        <>
          <Text style={styles.sectionLabel}>Who paid?</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.payerRow}
            contentContainerStyle={styles.payerRowContent}
          >
            {allMembers.map((m, i) => (
              <TouchableOpacity
                key={m.memberId}
                style={[styles.payerChip, payerIdx === i && { borderColor: theme.primary, backgroundColor: theme.primary + '14' }]}
                onPress={() => setPayerIdx(i)}
              >
                <Text style={[styles.payerChipTxt, payerIdx === i && { color: theme.primary }]}>
                  {m.isMe ? '👤 You' : m.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Account — only when YOU paid; sits below "Who paid" */}
          {allMembers[payerIdx]?.isMe && accounts.length > 1 && (
            <>
              <Text style={styles.sectionLabel}>Account</Text>
              <View style={styles.accountRow}>
                {accounts.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.accountChip, accountId === a.id && { borderColor: theme.primary, backgroundColor: theme.primary + '14' }]}
                    onPress={() => setAccountId(a.id)}
                  >
                    <Text
                      style={[styles.accountChipTxt, accountId === a.id && { color: theme.primary }]}
                      numberOfLines={1}
                    >
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionLabel}>Split</Text>
          <View style={styles.modeRow}>
            {(['equal', 'percent', 'amount'] as SplitMode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeChip, splitMode === m && { borderColor: theme.primary, backgroundColor: theme.primary + '14' }]}
                onPress={() => setSplitMode(m)}
              >
                <Text style={[styles.modeChipTxt, splitMode === m && { color: theme.primary }]}>
                  {m === 'equal' ? '⚖️ Equal' : m === 'percent' ? '% Percent' : '₹ Amount'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Per-member breakdown — always visible. Equal mode shows the computed
              share read-only; percent/amount modes are editable. Each row is
              annotated with who paid vs. who owes (relative to the selected payer)
              so the debt direction is explicit. */}
          <View style={styles.sharesList}>
            {shares.map((s, idx) => {
              const isPayer = s.memberId === payerMemberId;
              const isMe = s.memberId === 'me';
              // Payer fronted the bill; everyone else owes them their share.
              const oweLabel = isPayer ? '✓ Paid' : isMe ? 'You owe' : 'Owes';
              return (
              <View key={s.memberId} style={styles.shareRow}>
                <View style={styles.shareNameWrap}>
                  <Text style={styles.shareName} numberOfLines={1}>
                    {isMe ? '👤 You' : s.name}
                  </Text>
                  <Text style={[styles.shareOwe, isPayer && styles.sharePaid]} numberOfLines={1}>
                    {oweLabel}
                  </Text>
                </View>
                {splitMode === 'equal' ? (
                  <Text style={styles.shareEqualAmt}>{formatCurrency(Number(s.shareAmount) || 0)}</Text>
                ) : (
                  <>
                    <TextInput
                      style={styles.shareInput}
                      value={String(splitMode === 'percent' ? (s.percent ?? '') : (s.shareAmount ?? ''))}
                      onChangeText={(v) => updateShare(idx, parseFloat(v.replace(/[^\d.]/g, '')) || 0, splitMode === 'percent' ? 'percent' : 'shareAmount')}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.shareSuffix}>{splitMode === 'percent' ? '%' : '₹'}</Text>
                    {splitMode === 'percent' && amount > 0 && (
                      <Text style={styles.shareAmt}>{formatCurrency((amount * (s.percent || 0)) / 100)}</Text>
                    )}
                  </>
                )}
              </View>
              );
            })}
          </View>
        </>
      )}

      {!hideSubmit && (
        <GradientButton
          title={editTxn ? 'Save changes' : 'Add Expense'}
          onPress={handleAdd}
          disabled={amount <= 0}
          style={{ marginTop: spacing.md }}
        />
      )}

      <TwoTierCategorySheet
        visible={catSheet && !hideCategory}
        merchant={merchant.trim() || 'Group Expense'}
        currentParent={parentCat || undefined}
        currentChild={childCat || undefined}
        onClose={() => setCatSheet(false)}
        onSave={(parent: string, child: string) => {
          setParentCat(parent);
          setChildCat(child);
          setCatSheet(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  amountInput: {
    fontSize: 34, fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1.5, borderBottomColor: colors.divider,
    marginBottom: spacing.sm,
  },
  amountInputLocked: { color: colors.textSecondary, borderBottomColor: 'transparent' },
  amountHint: { ...typography.tiny, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.xs, marginBottom: spacing.sm },
  nameInput: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    ...typography.body,
    marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.divider,
  },
  catRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.divider,
  },
  catLabel:     { ...typography.body, color: colors.textSecondary },
  catValueWrap: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginLeft: spacing.sm },
  catValue:     { ...typography.body, color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
  catValueMuted:{ color: colors.textMuted, fontWeight: '400' },
  catChevron:   { ...typography.h3, color: colors.textMuted, marginLeft: 6 },
  sectionLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
  // Wrapping grid (no horizontal scroll) — full-screen form has the room.
  accountRow:   { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  accountChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, marginRight: 8, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.divider,
    backgroundColor: colors.background, maxWidth: 160,
  },
  // Constant weight so selecting a chip recolours it without changing its width
  // (a fontWeight change would resize the text and make the row jump horizontally).
  accountChipTxt: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  payerRow:   { marginBottom: spacing.sm },
  // flexGrow:1 makes the content fill the viewport when there are few chips, so a
  // narrow row isn't scrollable (fixes the "jump right on scroll" with few items).
  payerRowContent: { flexGrow: 1 },
  payerChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, marginRight: 8,
    borderWidth: 1.5, borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  // Constant weight — see accountChipTxt note (prevents the "Who paid" row jumping on tap).
  payerChipTxt: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  modeRow:    { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  modeChip: {
    flex: 1, paddingVertical: spacing.sm,
    borderRadius: radius.pill, alignItems: 'center',
    borderWidth: 1, borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  modeChipTxt: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700' },
  sharesList: { marginBottom: spacing.xs },
  shareRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.xs,
  },
  shareNameWrap: { flex: 1, marginRight: spacing.sm },
  shareName: { ...typography.body, color: colors.textPrimary },
  shareOwe: { ...typography.tiny, color: colors.textMuted, fontWeight: '600', marginTop: 1 },
  sharePaid: { color: colors.success },
  shareInput: {
    width: 64, backgroundColor: colors.background,
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6,
    textAlign: 'center', color: colors.textPrimary,
    ...typography.bodyBold, fontWeight: '700',
    borderWidth: 1, borderColor: colors.divider,
  },
  shareSuffix: { marginLeft: 4, ...typography.small, color: colors.textSecondary },
  shareAmt:    { marginLeft: 8, ...typography.small, color: colors.textMuted },
  shareEqualAmt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  equalHint:   { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
});
