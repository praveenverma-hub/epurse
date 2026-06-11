// =============================================================================
// GroupExpenseSheet — bottom sheet to add a manual expense to a group.
// Personal groups: amount + merchant + category.
// Shared groups:  same + who paid + split among members.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
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

interface GroupExpenseSheetProps {
  visible: boolean;
  /** Target group — must be set when visible. */
  group: Group | null;
  onClose: () => void;
  onAdd: (expenseData: GroupExpenseData) => void;
  /** When tagging an EXISTING transaction, its amount — prefilled and locked here. */
  presetAmount?: number;
}

export default function GroupExpenseSheet({ visible, group, onClose, onAdd, presetAmount }: GroupExpenseSheetProps) {
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
  const amount = parseFloat(amountRaw.replace(/[^\d.]/g, '')) || 0;
  // Tagging an existing txn → amount comes from that txn and is fixed (so the
  // split math matches the real transaction). Manual add → free entry.
  const amountLocked = typeof presetAmount === 'number' && presetAmount > 0;

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    setAmountRaw(amountLocked ? String(presetAmount) : '');
    setMerchant('');
    setPayerIdx(0);
    setSplitMode('equal');
    setAccountId(accounts[0]?.id || null);
    setParentCat(null);
    setChildCat(null);
    setCatSheet(false);
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
  }, [visible, group, accounts, amountLocked, presetAmount]);

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

  if (!group) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.bodyContent}
            >
            <Text style={styles.title}>Add Expense · {group.name}</Text>

            {/* Amount — prefilled & locked when tagging an existing transaction */}
            <TextInput
              style={[styles.amountInput, amountLocked && styles.amountInputLocked]}
              placeholder="₹ 0"
              placeholderTextColor={colors.textMuted}
              value={amountRaw}
              onChangeText={setAmountRaw}
              keyboardType="decimal-pad"
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

            {/* Category */}
            <TouchableOpacity style={styles.catRow} onPress={() => setCatSheet(true)} activeOpacity={0.75}>
              <Text style={styles.catLabel}>Category</Text>
              <View style={styles.catValueWrap}>
                <Text style={[styles.catValue, !childCat && styles.catValueMuted]} numberOfLines={1}>
                  {childCat ? `${parentCat} › ${childCat}` : 'Other (tap to choose)'}
                </Text>
                <Text style={styles.catChevron}>›</Text>
              </View>
            </TouchableOpacity>

            {/* Account — personal groups (no payer concept) */}
            {!isShared && accounts.length > 1 && (
              <>
                <Text style={styles.sectionLabel}>Account</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountRow}>
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
                </ScrollView>
              </>
            )}

            {/* Payer → account → split (shared only) */}
            {isShared && (
              <>
                <Text style={styles.sectionLabel}>Who paid?</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.payerRow}>
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
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.accountRow}>
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
                    </ScrollView>
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

                {splitMode !== 'equal' && (
                  <View style={styles.sharesList}>
                    {shares.map((s, idx) => (
                      <View key={s.memberId} style={styles.shareRow}>
                        <Text style={styles.shareName} numberOfLines={1}>
                          {s.memberId === 'me' ? '👤 You' : s.name}
                        </Text>
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
                      </View>
                    ))}
                  </View>
                )}

                {splitMode === 'equal' && amount > 0 && (
                  <Text style={styles.equalHint}>
                    {formatCurrency(parseFloat((amount / Math.max(allMembers.length, 1)).toFixed(2)))} per person
                  </Text>
                )}
              </>
            )}

            <GradientButton
              title="Add Expense"
              onPress={handleAdd}
              disabled={amount <= 0}
              style={{ marginTop: spacing.md }}
            />
            <TouchableOpacity style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>

      <TwoTierCategorySheet
        visible={catSheet}
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss:    { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    maxHeight: '90%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md },
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
  accountRow:   { flexDirection: 'row', marginBottom: spacing.sm },
  accountChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill, marginRight: 8,
    borderWidth: 1.5, borderColor: colors.divider,
    backgroundColor: colors.background, maxWidth: 140,
  },
  // Constant weight so selecting a chip recolours it without changing its width
  // (a fontWeight change would resize the text and make the row jump horizontally).
  accountChipTxt: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  payerRow:   { flexDirection: 'row', marginBottom: spacing.sm },
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
  bodyContent: { paddingBottom: spacing.sm },
  sharesList: { marginBottom: spacing.xs },
  shareRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: spacing.xs,
  },
  shareName: { flex: 1, ...typography.body, color: colors.textPrimary },
  shareInput: {
    width: 64, backgroundColor: colors.background,
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6,
    textAlign: 'center', color: colors.textPrimary,
    ...typography.bodyBold, fontWeight: '700',
    borderWidth: 1, borderColor: colors.divider,
  },
  shareSuffix: { marginLeft: 4, ...typography.small, color: colors.textSecondary },
  shareAmt:    { marginLeft: 8, ...typography.small, color: colors.textMuted },
  equalHint:   { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  cancel:      { marginTop: spacing.sm, alignItems: 'center' },
  cancelTxt:   { ...typography.body, color: colors.textSecondary },
});
