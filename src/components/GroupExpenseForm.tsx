// =============================================================================
// GroupExpenseForm — the shared body for adding a manual expense to a group.
// Rendered inside two shells:
//   • GroupExpenseSheet  — bottom-sheet modal (tagging an existing txn from Activity).
//   • AddGroupExpenseScreen — full screen (the Groups-tab "+" FAB).
// Personal groups: amount + merchant + category.
// Shared groups:  same + who paid + split among members (state in useGroupSplit,
// shared with AddTransactionScreen's group mode).
// =============================================================================
import React, { useEffect, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButtonBase from './GradientButton';
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
import SplitPage from './SplitPage';
import { useGroupSplit } from '../hooks/useGroupSplit';
import SplitBreakdownLines from './SplitBreakdownLines';
import Modal from './AppModal';
import { defaultAccountId } from '../utils/defaultAccount';
import type { Group, GroupExpenseData } from '../types/group';

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
  const [accountId, setAccountId] = useState<string | null>(null);
  const [parentCat, setParentCat] = useState<string | null>(null);
  const [childCat, setChildCat] = useState<string | null>(null);
  const [catSheet, setCatSheet] = useState(false);
  // The split editor page (Paid By / Method / People).
  const [splitPageOpen, setSplitPageOpen] = useState(false);

  const amount = parseAmount(amountRaw);
  const split = useGroupSplit({ group, amount, active: visible !== false, editTxn, lockPayerToMe });
  const { isShared, payerIsMe } = split;
  // Tagging an existing txn → amount comes from that txn and is fixed (so the
  // split math matches the real transaction). Manual add → free entry.
  const amountLocked = typeof presetAmount === 'number' && presetAmount > 0;

  // Reset on open (sheet) / mount (screen). In edit mode, prefill from editTxn.
  useEffect(() => {
    if (visible === false) return;
    setCatSheet(false);
    setSplitPageOpen(false);

    if (editTxn) {
      setAmountRaw(String(editTxn.amount ?? ''));
      setDate(editTxn.createdAt ? new Date(editTxn.createdAt) : new Date());
      // 'Group Expense' is the placeholder default — show it as empty so the hint shows.
      setMerchant(editTxn.merchant && editTxn.merchant !== 'Group Expense' ? editTxn.merchant : '');
      setNote(editTxn.note || '');
      setParentCat(editTxn.parentCategory ?? null);
      setChildCat(editTxn.childCategory ?? null);
      setAccountId(editTxn.accountId ?? defaultAccountId(accounts));
      return;
    }

    setAmountRaw(amountLocked ? String(presetAmount) : '');
    setDate(new Date());
    setMerchant('');
    setNote('');
    setAccountId(defaultAccountId(accounts));
    setParentCat(null);
    setChildCat(null);
  }, [visible, group, accounts, amountLocked, presetAmount, editTxn]);

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
    const res = split.resolveShares();
    if (!res.ok) {
      toast.warning(res.title, res.message);
      return;
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
      paidByMemberId: res.paidByMemberId,
      paidByName: res.paidByName,
      shares: res.shares,
      accountId: res.paidByMemberId === 'me' ? accountId : null,
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
            icon="pie-chart-outline"
            label="Split"
            value={split.summary}
            accentColor={theme.primary}
            onPress={() => setSplitPageOpen(true)}
          >
            <SplitBreakdownLines rows={split.breakdownRows} />
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
            {...split.pageProps}
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
