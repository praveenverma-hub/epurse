// =============================================================================
// GroupExpenseForm — the shared body for adding a manual expense to a group.
// Rendered inside two shells:
//   • GroupExpenseSheet  — bottom-sheet modal (tagging an existing txn from Activity).
//   • AddGroupExpenseScreen — full screen (the Groups-tab "+" FAB).
// Personal groups: amount + merchant + category.
// Shared groups:  same + who paid + split among members.
// =============================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButtonBase from './GradientButton';
import { formatCurrency } from '../utils/format';
import { INPUT_LIMITS, sanitizeAmount, parseAmount } from '../utils/validation';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { useEPurseStore } from '../store/ePurseStore';
import { useToast } from './Toast';
import { TwoTierCategorySheet } from './TwoTierCategorySheet';
import DateField from './DateField';
import {
  FormField,
  FormTextInput,
  FormAmountInput,
  FormNoteField,
  FormValueRow,
  FormValueCard,
} from './FormField';
import AccountField from './AccountField';
import SplitPage, { SPLIT_MODE_LABEL, type SplitMode } from './SplitPage';
import { evenAmounts, fullOwedShares } from '../utils/splitShares';
import SplitBreakdownLines from './SplitBreakdownLines';
import Modal from './AppModal';
import { defaultAccountId } from '../utils/defaultAccount';
import type { Group, GroupShare, GroupExpenseData } from '../types/group';

const GradientButton = GradientButtonBase as React.FC<{
  title: string;
  onPress: () => void;
  disabled?: boolean;
  flat?: boolean;
  style?: object;
}>;

interface AccountLike {
  id: string;
  name: string;
  type?: string;
}


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
  /**
   * Lock the payer to "You" and hide the "Who paid?" selector. Set when editing a
   * real account-backed debit (SMS / manual-with-account) — the money already left
   * the user's account, so flipping it to a memo would wrongly reverse the balance.
   */
  lockPayerToMe?: boolean;
  /** Fires when the mandatory fields (amount + merchant) become filled/empty — shells use it to show their Add button. */
  onReadyChange?: (ready: boolean) => void;
}

export default function GroupExpenseForm({ group, onAdd, presetAmount, visible = true, hideCategory = false, editTxn, hideSubmit = false, submitRef, lockPayerToMe = false, onReadyChange }: GroupExpenseFormProps) {
  const theme = useTheme();
  const toast = useToast();
  const accounts = useEPurseStore((s: any) => s.accounts) as AccountLike[];

  const [amountRaw, setAmountRaw] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');
  const [payerIdx, setPayerIdx] = useState(0); // index into allMembers
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [shares, setShares] = useState<GroupShare[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [parentCat, setParentCat] = useState<string | null>(null);
  const [childCat, setChildCat] = useState<string | null>(null);
  const [catSheet, setCatSheet] = useState(false);
  // The split editor page (Paid By / Method / People).
  const [splitPageOpen, setSplitPageOpen] = useState(false);

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
  const meIdx = useMemo(() => Math.max(0, allMembers.findIndex((m) => m.isMe || m.memberId === 'me')), [allMembers]);
  // memberId of the currently-selected payer — drives the "Paid / owes" labels.
  const payerMemberId = allMembers[payerIdx]?.memberId;
  // Tagging an existing txn → amount comes from that txn and is fixed (so the
  // split math matches the real transaction). Manual add → free entry.
  const amountLocked = typeof presetAmount === 'number' && presetAmount > 0;

  // Reset on open (sheet) / mount (screen). In edit mode, prefill from editTxn.
  useEffect(() => {
    if (visible === false) return;
    setCatSheet(false);
    setSplitPageOpen(false);

    if (editTxn) {
      const eg = editTxn.groupSplit;
      setAmountRaw(String(editTxn.amount ?? ''));
      setDate(editTxn.createdAt ? new Date(editTxn.createdAt) : new Date());
      // 'Group Expense' is the placeholder default — show it as empty so the hint shows.
      setMerchant(editTxn.merchant && editTxn.merchant !== 'Group Expense' ? editTxn.merchant : '');
      setNote(editTxn.note || '');
      setParentCat(editTxn.parentCategory ?? null);
      setChildCat(editTxn.childCategory ?? null);
      setAccountId(editTxn.accountId ?? defaultAccountId(accounts));

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
    setDate(new Date());
    setMerchant('');
    setNote('');
    setPayerIdx(0);
    setSplitMode('equal');
    setAccountId(defaultAccountId(accounts));
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

  // When the payer is locked to me (editing a real account debit), force it — runs
  // after the reset/prefill effect so it overrides any prefilled payer.
  useEffect(() => {
    if (lockPayerToMe) setPayerIdx(meIdx);
  }, [lockPayerToMe, meIdx, visible, editTxn]);

  // Initialize selectedMembers when group changes or form resets
  useEffect(() => {
    if (visible === false) return;
    if (editTxn?.groupSplit?.shares) {
      // In edit mode, select members who have non-zero shares
      const active = new Set<string>(
        editTxn.groupSplit.shares.filter((s: any) => (Number(s.shareAmount) || 0) > 0).map((s: any) => String(s.memberId))
      );
      setSelectedMembers(active);
    } else {
      // Default: select all members
      setSelectedMembers(new Set(allMembers.map(m => m.memberId)));
    }
  }, [visible, allMembers, editTxn]);

  // Auto-split shares (equal / fullOwed) are computed fresh at submit time
  // (handleAdd) to avoid races where submitRef reads a stale snapshot. This effect
  // only fills the display preview; the saved shares come from handleAdd's live calc.
  useEffect(() => {
    if ((splitMode !== 'equal' && splitMode !== 'fullOwed') || !allMembers.length) return;
    const amt = amount || 0;

    if (splitMode === 'fullOwed') {
      // Payer covers the bill; the OTHER members split the full amount equally.
      const owed = fullOwedShares(amt, allMembers.length, payerIdx);
      setShares(allMembers.map((m, i) => ({
        memberId: m.memberId, name: m.name, shareAmount: owed[i], percent: amt > 0 ? Math.round((owed[i] / amt) * 100) : 0,
      })));
      return;
    }

    // Equal split among SELECTED members only
    const selected = allMembers.filter((m) => selectedMembers.has(m.memberId));
    const parts = evenAmounts(amt, selected.length);
    const n = selected.length || 1;
    setShares(allMembers.map((m) => {
      const k = selected.findIndex((x) => x.memberId === m.memberId);
      return { memberId: m.memberId, name: m.name, shareAmount: k >= 0 ? parts[k] : 0, percent: k >= 0 ? Math.round(100 / n) : 0 };
    }));
  }, [amount, splitMode, allMembers, payerIdx, selectedMembers]);

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
    if (merchantRequired && !merchant.trim()) {
      toast.warning('Missing merchant', 'Please enter who you paid / received from.');
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
          const parts = evenAmounts(amount, others.length || 1);
          const amtBy: Record<string, number> = {};
          others.forEach((x, k) => { amtBy[x.memberId] = parts[k]; });
          finalShares = shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: x.memberId === payerMemberId ? 0 : (amtBy[x.memberId] || 0) }));
        } else {
          if (Math.abs(sumOthers - amount) > 0.5) {
            toast.warning('Shares must total the amount', `Others total ${formatCurrency(sumOthers)} of ${formatCurrency(amount)}.`);
            return;
          }
          finalShares = shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: x.memberId === payerMemberId ? 0 : (Number(x.shareAmount) || 0) }));
        }
      } else {
        // equal — compute fresh from the live amount + SELECTED members at submit time.
        // Do NOT trust the `shares` STATE here: it's filled asynchronously by the
        // equal-split effect, and the pinned-footer submit (submitRef) can fire
        // while that snapshot still holds 0 for "me" — which, since equal mode has
        // no sum reconciliation, would silently persist a 0 share (the bug where
        // the txn/group card showed ₹0 while totals were correct).
        const selected = allMembers.filter(m => selectedMembers.has(m.memberId));
        if (selected.length === 0) {
          toast.warning('No members selected', 'Select at least one member for equal split.');
          return;
        }
        const parts = evenAmounts(amount, selected.length);
        finalShares = allMembers.map((m) => {
          const k = selected.findIndex((x) => x.memberId === m.memberId);
          return { memberId: m.memberId, name: m.name, shareAmount: k >= 0 ? parts[k] : 0 };
        });
      }
    }

    const expenseData: GroupExpenseData = {
      amount,
      merchant: merchant.trim() || 'Group Expense',
      note: note.trim(),
      // Send the date whenever the field is actually SHOWN — the render condition
      // below is `(!amountLocked || editTxn)`, and gating the value on `amountLocked`
      // alone meant an edit rendered a working date picker whose value was thrown
      // away: you could change the date, save, and nothing happened. `amountLocked`
      // without `editTxn` is the tag-an-existing-SMS flow, where the transaction's own
      // date is authoritative and must not be overwritten with today's.
      date: (!amountLocked || editTxn) ? date.toISOString() : undefined,
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

  // Tagging an existing transaction keeps ITS merchant, so only a new/edited entry needs one.
  const merchantRequired = !(amountLocked && !editTxn);
  useEffect(() => {
    onReadyChange?.(amount > 0 && (!merchantRequired || merchant.trim().length > 0));
  }, [amount, merchant, merchantRequired, onReadyChange]);

  // Expose the latest submit handler so a shell can drive its pinned footer button.
  useEffect(() => { if (submitRef) submitRef.current = handleAdd; });

  // ── Split summary (the one-line row on the main form) ───────────────────────
  const payerName = allMembers[payerIdx]?.isMe ? 'You' : allMembers[payerIdx]?.name || 'You';
  const participantCount =
    splitMode === 'equal'
      ? selectedMembers.size
      : splitMode === 'fullOwed'
        ? Math.max(0, allMembers.length - 1)
        : shares.filter((x) => (Number(x.shareAmount) || 0) > 0 || (Number(x.percent) || 0) > 0).length;
  const payerIsMe = !!allMembers[payerIdx]?.isMe;
  // Per-member rupee amounts for the read-only breakdown under the Split row.
  // Percent mode stores only `percent` until submit, so derive ₹ from it here.
  const splitBreakdownRows = shares
    .map((x) => ({
      name: x.memberId === 'me' ? 'You' : x.name || 'Member',
      amount: splitMode === 'percent' ? (amount * (Number(x.percent) || 0)) / 100 : Number(x.shareAmount) || 0,
      tag: x.memberId === payerMemberId ? 'Paid' : undefined,
    }))
    .filter((r) => r.amount > 0);

  return (
    <>
      {/* Amount — prefilled & locked when tagging an existing transaction */}
      <FormField
        label="Amount (₹)"
        hint={amountLocked ? 'From the transaction — not editable' : undefined}
      >
        <FormAmountInput
          placeholder="0"
          value={amountRaw}
          onChangeText={(t: string) => setAmountRaw(sanitizeAmount(t))}
          maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
          locked={amountLocked}
          autoFocus={!amountLocked}
        />
      </FormField>

      {/* Merchant */}
      <FormField label="Merchant / Description">
        <FormTextInput
          placeholder="e.g. Dinner, Groceries, Cab"
          value={merchant}
          onChangeText={setMerchant}
          maxLength={INPUT_LIMITS.MERCHANT_MAX}
        />
      </FormField>

      {/* Optional fields as ONE card of already-filled values (see FormValueRow);
          only Amount is mandatory here. */}
      <FormValueCard>
        {/* Category — hidden when reached from the manage modal (already set there) */}
        {!hideCategory && (
          <FormValueRow
            leading={parentCat ? '🏷️' : '📌'}
            label="Category"
            value={childCat || 'Select'}
            isPlaceholder={!childCat}
            accentColor={theme.primary}
            onPress={() => setCatSheet(true)}
          />
        )}

        {/* Split — a one-line summary + breakdown; the editor (payer, mode, who owes
            what) lives on its own page. Shared groups only. */}
        {isShared && (
          <FormValueRow
            icon="people-outline"
            label="Split"
            value={`${payerName} paid · ${SPLIT_MODE_LABEL[splitMode]}`}
            accentColor={theme.primary}
            onPress={() => setSplitPageOpen(true)}
          >
            <SplitBreakdownLines rows={splitBreakdownRows} />
          </FormValueRow>
        )}

        {/* Account — personal groups always; shared only when YOU paid (otherwise
            it's a memo with no account). Defaults to the primary account. */}
        {(!isShared || payerIsMe) && (
          <AccountField
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            accentColor={theme.primary}
          />
        )}

        {/* Date — hidden when tagging an existing transaction with no `editTxn`
            loaded (we don't know its real date here, so there's nothing
            meaningful to show); locked (but shown) when editing one we DO
            have loaded, same reasoning as the locked amount. */}
        {(!amountLocked || editTxn) && (
          <DateField
            variant="value"
            value={date}
            onChange={setDate}
            maximumDate={new Date()}
            disabled={amountLocked}
            accentColor={theme.primary}
          />
        )}

        <FormNoteField
          value={note}
          onChangeText={setNote}
          maxLength={INPUT_LIMITS.NOTE_MAX}
          accentColor={theme.primary}
        />
      </FormValueCard>

      {/* ── Split page ─────────────────────────────────────────────────────── */}
      {isShared && (
        <Modal visible={splitPageOpen} animationType="slide" onRequestClose={() => setSplitPageOpen(false)}>
          <SplitPage
            onBack={() => setSplitPageOpen(false)}
            onDone={() => setSplitPageOpen(false)}
            accentColor={theme.primary}
            payer={{
              options: allMembers.map((m) => ({ id: m.memberId, label: m.isMe ? 'You' : m.name })),
              selectedId: payerMemberId ?? 'me',
              onSelect: (id) => setPayerIdx(Math.max(0, allMembers.findIndex((m) => m.memberId === id))),
              lockedNote: lockPayerToMe ? "You — the money already left your account, so this can't change." : undefined,
            }}
            mode={splitMode}
            onModeChange={handleSetMode}
            valueUnit={splitMode === 'percent' ? 'percent' : 'amount'}
            total={amount}
            rows={shares.map((s, idx) => {
              const isPayer = s.memberId === payerMemberId;
              return {
                id: s.memberId,
                name: s.name || 'Member',
                isMe: s.memberId === 'me',
                isPayer,
                percent: Number(s.percent) || 0,
                amount: Number(s.shareAmount) || 0,
                // equal → ticks; fullOwed → only the payer is locked (0).
                editable: splitMode === 'amount' || splitMode === 'percent' || (splitMode === 'fullOwed' && !isPayer),
                onChange: (v: number) => updateShare(idx, v, splitMode === 'percent' ? 'percent' : 'shareAmount'),
                checked: selectedMembers.has(s.memberId),
                onToggle: splitMode === 'equal'
                  ? () => setSelectedMembers((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.memberId)) next.delete(s.memberId); else next.add(s.memberId);
                      return next;
                    })
                  : undefined,
              };
            })}
          />
        </Modal>
      )}

      {!hideSubmit && (
        <GradientButton
          flat
          title={editTxn ? 'Save Changes' : 'Add Expense'}
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
