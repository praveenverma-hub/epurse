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
import { Ionicons } from '@expo/vector-icons';
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

// 'fullOwed' = the payer covers the whole bill; every OTHER member owes an equal
// share of the full amount and the payer's own share is 0.
type SplitMode = 'equal' | 'percent' | 'amount' | 'fullOwed';

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
  // For personal groups, use a single-member array ['me'] for the split calculation
  // (personal groups have no member list, but the user is always the implicit payer).
  const allMembers = useMemo(() => {
    if (!isShared) {
      // Personal group → single implicit member 'me' for split math.
      return [{ memberId: 'me', name: 'You', isMe: true }];
    }
    const ms = group?.members || [];
    if (!ms.some((m) => m.memberId === 'me')) {
      return [{ memberId: 'me', name: 'You', isMe: true }, ...ms];
    }
    return ms;
  }, [group, isShared]);
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
        const amt = Number(editTxn.amount) || 0;
        setShares(
          eg.shares.map((sh: any) => ({
            memberId: sh.memberId,
            name: sh.name,
            shareAmount: Number(sh.shareAmount) || 0,
            percent: amt > 0 ? Math.round(((Number(sh.shareAmount) || 0) / amt) * 100) : 0,
          })),
        );
        // Detect the ORIGINAL split shape so editing behaves naturally and stays
        // in sync (equal/fullOwed auto-rebalance when the amount changes; only a
        // genuinely custom split locks to manual 'amount' entry):
        //   • equal    → all members' shares are (near-)equal
        //   • fullOwed → payer's share is 0 and the others' shares are (near-)equal
        //   • else     → custom amounts
        const payerId = eg.paidByMemberId;
        const eq = (vals: number[]) => vals.length > 0 && vals.every((v) => Math.abs(v - vals[0]) <= 1);
        const allVals = eg.shares.map((x: any) => Number(x.shareAmount) || 0);
        const payerShare = Number(eg.shares.find((x: any) => x.memberId === payerId)?.shareAmount) || 0;
        const otherVals = eg.shares.filter((x: any) => x.memberId !== payerId).map((x: any) => Number(x.shareAmount) || 0);
        setSplitMode(
          eg.shares.length > 1 && eq(allVals)
            ? 'equal'
            : payerShare === 0 && otherVals.length > 0 && eq(otherVals)
              ? 'fullOwed'
              : 'amount',
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

  // Auto-split shares (equal / fullOwed) are computed fresh at submit time
  // (handleAdd) to avoid races where submitRef reads a stale snapshot. This effect
  // only fills the display preview; the saved shares come from handleAdd's live calc.
  useEffect(() => {
    if ((splitMode !== 'equal' && splitMode !== 'fullOwed') || !allMembers.length) return;
    const amt = amount || 0;

    if (splitMode === 'fullOwed') {
      // Payer covers the bill; the OTHER members split the full amount equally.
      const otherIdx = allMembers.map((_, i) => i).filter((i) => i !== payerIdx);
      const n = otherIdx.length || 1;
      const each = amt > 0 ? parseFloat((amt / n).toFixed(2)) : 0;
      const next = allMembers.map((m) => ({ memberId: m.memberId, name: m.name, shareAmount: 0, percent: 0 }));
      let allocated = 0;
      otherIdx.forEach((idx, k) => {
        const a = amt > 0 && k === otherIdx.length - 1 ? parseFloat((amt - allocated).toFixed(2)) : each;
        allocated = parseFloat((allocated + a).toFixed(2));
        next[idx] = { memberId: allMembers[idx].memberId, name: allMembers[idx].name, shareAmount: a, percent: amt > 0 ? Math.round((a / amt) * 100) : 0 };
      });
      setShares(next);
      return;
    }

    const each = amt > 0 ? parseFloat((amt / allMembers.length).toFixed(2)) : 0;
    setShares(allMembers.map((m, i) => ({
      memberId: m.memberId,
      name: m.name,
      shareAmount: amt > 0 && i === allMembers.length - 1
        ? parseFloat((amt - each * (allMembers.length - 1)).toFixed(2))
        : each,
      percent: Math.round(100 / allMembers.length),
    })));
  }, [amount, splitMode, allMembers, payerIdx]);

  const updateShare = useCallback((idx: number, value: number, field: 'percent' | 'shareAmount') => {
    setShares((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  const handleSetMode = useCallback((m: SplitMode) => {
    setSplitMode((prev) => {
      // Switching INTO manual ₹ entry → clear the fields so the user types each
      // amount from scratch (0/empty by default). equal & fullOwed are seeded by
      // the auto-split effect; percent keeps its values.
      if (m === 'amount' && prev !== 'amount') {
        setShares((s) => s.map((x) => ({ ...x, shareAmount: 0 })));
      }
      return m;
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
      } else if (splitMode === 'fullOwed') {
        // Payer covers the bill (share 0); the OTHER members owe — equal by default
        // but each is editable. If untouched (others sum to ~0), fall back to an
        // equal split; otherwise honour the entered amounts and validate the total.
        const others = shares.filter((x) => x.memberId !== payerMemberId);
        const sumOthers = others.reduce((s, x) => s + (Number(x.shareAmount) || 0), 0);
        if (sumOthers <= 0.005) {
          const n = others.length || 1;
          const each = parseFloat((amount / n).toFixed(2));
          let allocated = 0;
          const amtBy: Record<string, number> = {};
          others.forEach((x, k) => {
            const a = k === others.length - 1 ? parseFloat((amount - allocated).toFixed(2)) : each;
            allocated = parseFloat((allocated + a).toFixed(2));
            amtBy[x.memberId] = a;
          });
          finalShares = shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: x.memberId === payerMemberId ? 0 : (amtBy[x.memberId] || 0) }));
        } else {
          if (Math.abs(sumOthers - amount) > 0.5) {
            toast.warning('Shares must total the amount', `Others total ${formatCurrency(sumOthers)} of ${formatCurrency(amount)}.`);
            return;
          }
          finalShares = shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: x.memberId === payerMemberId ? 0 : (Number(x.shareAmount) || 0) }));
        }
      } else {
        // equal — compute fresh from the live amount + members at submit time.
        // Do NOT trust the `shares` STATE here: it's filled asynchronously by the
        // equal-split effect, and the pinned-footer submit (submitRef) can fire
        // while that snapshot still holds 0 for "me" — which, since equal mode has
        // no sum reconciliation, would silently persist a 0 share (the bug where
        // the txn/group card showed ₹0 while totals were correct).
        const n = allMembers.length || 1;
        const each = parseFloat((amount / n).toFixed(2));
        finalShares = allMembers.map((m, i) => ({
          memberId: m.memberId,
          name: m.name,
          shareAmount: i === n - 1
            ? parseFloat((amount - each * (n - 1)).toFixed(2))
            : each,
        }));
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
            {(['equal', 'percent', 'amount', 'fullOwed'] as SplitMode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeChip, splitMode === m && { borderColor: theme.primary, backgroundColor: theme.primary + '14' }]}
                onPress={() => handleSetMode(m)}
              >
                <View style={styles.modeChipInner}>
                  {m === 'fullOwed' && (
                    <Ionicons
                      name="hand-left-outline"
                      size={14}
                      color={splitMode === m ? theme.primary : colors.textSecondary}
                      style={styles.modeChipIcon}
                    />
                  )}
                  <Text style={[styles.modeChipTxt, splitMode === m && { color: theme.primary }]} numberOfLines={1}>
                    {m === 'equal' ? '⚖️ Equal' : m === 'percent' ? '% Percent' : m === 'amount' ? '₹ Amount' : 'Full owed'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          {splitMode === 'fullOwed' && (
            <Text style={styles.modeHint}>You pay the whole bill — everyone else owes an equal share.</Text>
          )}

          {/* Per-member breakdown — scrollable bordered box. Equal is read-only;
              percent/amount are editable; Full-owed locks ONLY the payer (others
              edit their owed ₹). Each row is annotated with who paid vs. who owes. */}
          <ScrollView
            style={styles.sharesList}
            contentContainerStyle={styles.sharesListContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {shares.map((s, idx) => {
              const isPayer = s.memberId === payerMemberId;
              const isMe = s.memberId === 'me';
              const payerIsMe = payerMemberId === 'me';
              const isPercent = splitMode === 'percent';
              // equal → all read-only; fullOwed → only the payer is locked (0).
              const editable = splitMode === 'amount' || isPercent || (splitMode === 'fullOwed' && !isPayer);
              // Payer fronted the bill; everyone else owes them their share. When
              // YOU paid, the others "owe you"; otherwise they just "owe".
              const oweLabel = isPayer ? '✓ Paid' : isMe ? 'owe' : payerIsMe ? 'Owes you' : 'Owes';
              return (
              <View key={s.memberId} style={[styles.shareRow, idx < shares.length - 1 && styles.shareRowDivider]}>
                <View style={styles.shareNameWrap}>
                  <Text style={styles.shareName} numberOfLines={1}>
                    {isMe ? '👤 You' : s.name}
                  </Text>
                  <Text style={[styles.shareOwe, isPayer && styles.sharePaid]} numberOfLines={1}>
                    {oweLabel}
                  </Text>
                </View>
                {!editable ? (
                  <Text style={styles.shareEqualAmt}>{formatCurrency(Number(s.shareAmount) || 0)}</Text>
                ) : (
                  <>
                    {/* Computed ₹ for percent mode — fixed width so the input column
                        stays aligned regardless of how many digits each row shows. */}
                    {isPercent && (
                      <Text style={styles.shareAmt} numberOfLines={1}>
                        {amount > 0 ? formatCurrency((amount * (s.percent || 0)) / 100) : ''}
                      </Text>
                    )}
                    <TextInput
                      style={styles.shareInput}
                      value={isPercent ? (s.percent ? String(s.percent) : '') : (s.shareAmount ? String(s.shareAmount) : '')}
                      onChangeText={(v) => updateShare(idx, parseFloat(v.replace(/[^\d.]/g, '')) || 0, isPercent ? 'percent' : 'shareAmount')}
                      keyboardType="decimal-pad"
                      maxLength={isPercent ? 3 : INPUT_LIMITS.AMOUNT_MAX_LEN}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                    />
                    <Text style={styles.shareSuffix}>{isPercent ? '%' : '₹'}</Text>
                  </>
                )}
              </View>
              );
            })}
          </ScrollView>
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
  // 4 modes → 2×2 grid so the longer "Full owed" label fits without truncation.
  modeRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  modeChip: {
    flexGrow: 1, flexBasis: '46%', paddingVertical: spacing.sm,
    borderRadius: radius.pill, alignItems: 'center',
    borderWidth: 1, borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  modeChipInner: { flexDirection: 'row', alignItems: 'center' },
  modeChipIcon: { marginRight: 4 },
  modeChipTxt: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700' },
  modeHint:   { ...typography.tiny, color: colors.textMuted, marginTop: -spacing.xs, marginBottom: spacing.sm },
  // Bordered, scrollable box so a long member list doesn't push the form around.
  sharesList: {
    maxHeight: 200, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.divider, borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  sharesListContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  shareRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  shareRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  // Name + owe-label on one row: name shrinks/ellipsizes, label keeps its width.
  shareNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', marginRight: spacing.sm },
  shareName: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  shareOwe: { ...typography.tiny, color: colors.textMuted, fontWeight: '600', marginLeft: spacing.xs, flexShrink: 0 },
  sharePaid: { color: colors.success },
  // Wide enough to view ~6 digits; fixed width keeps the input column aligned.
  shareInput: {
    width: 100, backgroundColor: colors.card,
    borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6,
    textAlign: 'center', color: colors.textPrimary,
    ...typography.bodyBold, fontWeight: '700',
    borderWidth: 1, borderColor: colors.divider,
  },
  shareSuffix: { marginLeft: 4, ...typography.small, color: colors.textSecondary },
  // Fixed width + right-aligned so rows with fewer digits don't shift the input.
  shareAmt:    { width: 78, textAlign: 'right', marginRight: spacing.sm, ...typography.small, color: colors.textMuted },
  shareEqualAmt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  equalHint:   { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
});
