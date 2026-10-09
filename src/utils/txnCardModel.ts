// =============================================================================
// txnCardModel — WHAT a transaction card says, decided in one pure place.
//
// TransactionItem only renders this. Every list (Home, Activity, Account Details,
// Group Detail, Goal Detail) shows the same anatomy, so the rules for "which
// chip wins", "whose account is this", "is this really my spend" live here once
// and are unit-tested (`npm run test:txnCard`), not re-derived per screen.
//
// Anatomy (Oct-9-26):
//   tier 1  icon · merchant ............................ amount
//   tier 2  sub-category · account (or "Rohit paid") ... "of ₹900" (share ≠ bill)
//   tier 3  date [note]  CHIP CHIP +N .................. Split · 3
// =============================================================================
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, TRANSACTION_TYPES } from '../constants/categories';
import { debitDisplayAmount, groupLbChipKind, splitLbChipKind } from './split';
import type { GroupMember, GroupSplit } from '../types/group';

/** The fields a card / split view reads (the store txn is a superset). */
export interface CardTxn {
  id?: string;
  type?: string;
  amount: number;
  merchant?: string;
  categoryId?: string;
  childCategory?: string;
  accountId?: string;
  accountType?: string;
  accountMask?: string;
  bankName?: string;
  source?: string;
  note?: string;
  isHidden?: boolean;
  isIgnored?: boolean;
  isRefund?: boolean;
  isSplit?: boolean;
  isSplitMemo?: boolean;
  splitPaidBy?: { contactId?: string | null; name?: string } | null;
  myShareAmount?: number;
  splitWith?: { contactId?: string | null; name?: string; shareAmount?: number }[];
  groupId?: string;
  groupSplit?: GroupSplit;
  isGroupMemo?: boolean;
}
/** Only the members matter here — resolves payer / share names. */
export interface CardGroup { members?: GroupMember[] }
export interface CardAccount { name?: string; mask?: string; type?: string; bankName?: string }

export type CardContext = (typeof CARD_CONTEXT)[keyof typeof CARD_CONTEXT];
type ChipTone = 'warning' | 'income' | 'neutral' | 'lent' | 'borrowed';
export interface CardChip {
  kind: string;
  label: string;
  tone: ChipTone;
  /** Printed after the label — only when it's a number the card doesn't already show. */
  amount?: number;
}

export interface TxnCard {
  title: string;
  meta: string;
  amount: { value: number; sign: '+' | '−'; tone: 'income' | 'expense' | 'muted'; notInvolved: boolean };
  /** The full bill, shown as "of ₹X" when it differs from my amount; else null. */
  totalHint: number | null;
  chips: CardChip[];
  overflow: number;
  splitCount: number;
  hasNote: boolean;
  showGroupRibbon: boolean;
}

/** Where the card is shown — each drops what that screen already says. */
export const CARD_CONTEXT = {
  DEFAULT: 'default', // Home, Activity, Goal Detail
  ACCOUNT: 'account', // Account Details: the account is the page, so don't repeat it
  GROUP: 'group',     // Group Detail: the group is the page; who paid matters more
} as const;

/** Beyond this the row turns into a wall of tags — the rest go to "+N". */
export const MAX_CHIPS = 2;

// Highest first. The first two that apply are shown.
const CHIP: Record<string, CardChip> = {
  ignored:  { kind: 'ignored',  label: 'IGNORED',  tone: 'warning' },
  refund:   { kind: 'refund',   label: 'REFUND',   tone: 'income' },
  excluded: { kind: 'excluded', label: 'EXCLUDED', tone: 'warning' },
  self:     { kind: 'self',     label: 'SELF',     tone: 'neutral' },
  lent:     { kind: 'lent',     label: 'LENT',     tone: 'lent' },
  settled:  { kind: 'settled',  label: 'SETTLED',  tone: 'lent' },
  borrowed: { kind: 'borrowed', label: 'BORROWED', tone: 'borrowed' },
  repaid:   { kind: 'repaid',   label: 'REPAID',   tone: 'borrowed' },
  private:  { kind: 'private',  label: 'PRIVATE',  tone: 'neutral' },
};

/**
 * "HDFC ··4521", "ICICI Card ··9876", "Cash". Prefers the live account's own name
 * (the user may have renamed it); otherwise builds one from what the txn carries.
 */
export function txnAccountLabel(txn: CardTxn | null | undefined, account?: CardAccount | null): string {
  if (!txn) return '';
  const mask = txn.accountMask || account?.mask || null;
  const withMask = (name: string) => (mask && !name.includes(mask) ? `${name}${name ? ' ' : ''}··${mask}` : name);
  if (account?.name) return withMask(account.name);
  const type = txn.accountType || account?.type || null;
  const bank = (txn.bankName || account?.bankName || '').replace(/\s+bank$/i, '').trim();
  if (bank) {
    const kind = type === ACCOUNT_TYPES.CREDIT_CARD ? ' Card' : type === ACCOUNT_TYPES.DEBIT_CARD ? ' Debit' : '';
    return withMask(`${bank}${kind}`);
  }
  if (type) return withMask((ACCOUNT_TYPE_LABEL as Record<string, string>)[type] || type);
  return mask ? `··${mask}` : '';
}

/** Who fronted the money when it wasn't me, or null. */
export function txnPayerName(txn: CardTxn | null | undefined, group?: CardGroup | null): string | null {
  if (!txn) return null;
  if (txn.isGroupMemo && txn.groupSplit) {
    const id = txn.groupSplit.paidByMemberId;
    const member = (group?.members || []).find((m) => m.memberId === id);
    return firstName(member?.name || txn.groupSplit.paidByName) || 'Someone';
  }
  if (txn.isSplitMemo) return firstName(txn.splitPaidBy?.name) || 'Someone';
  return null;
}

function firstName(name: string | null | undefined): string {
  const s = (name || '').trim();
  return s ? s.split(/\s+/)[0] : '';
}

/**
 * What I fronted for the others on a bill I paid AND kept a share of — the one
 * number such a card can't otherwise show (it shows my share "of ₹bill").
 * 0 when I didn't pay, kept no share (then the card's amount IS the loan), or no
 * one else is on it.
 */
function lentOnBill(txn: CardTxn): number {
  if (txn.type !== TRANSACTION_TYPES.DEBIT) return 0;
  const sum = (xs: { shareAmount?: number }[]) => xs.reduce((t, x) => t + (Number(x.shareAmount) || 0), 0);
  let mine = 0;
  let others = 0;
  if (txn.groupSplit?.shares?.length) {
    if (txn.groupSplit.paidByMemberId !== 'me') return 0;
    mine = Number(txn.groupSplit.shares.find((x) => x.memberId === 'me')?.shareAmount) || 0;
    others = sum(txn.groupSplit.shares.filter((x) => x.memberId !== 'me'));
  } else if (txn.isSplit && !txn.isSplitMemo) {
    mine = Number(txn.myShareAmount) || 0;
    others = sum(txn.splitWith || []);
  }
  return mine > 0 && others > 0.005 ? Math.round(others * 100) / 100 : 0;
}

function statusChip(txn: CardTxn): CardChip | null {
  const c = txn.categoryId;
  if (c === 'self' || txn.childCategory === 'Self') return CHIP.self;
  if (c === 'lent') return CHIP.lent;
  if (c === 'lent_settled') return CHIP.settled;
  if (c === 'borrowed') return CHIP.borrowed;
  if (c === 'borrow_repaid') return CHIP.repaid;
  return null;
}

/**
 * `group` / `account` are resolved by the caller; `categoryName` is the fallback
 * label when the txn has no sub-category; `isExcluded` = the user's spend rule
 * excludes this debit's parent.
 */
export function buildTxnCard(
  txn: CardTxn,
  { group = null, account = null, categoryName = '', isExcluded = false, context = CARD_CONTEXT.DEFAULT }: {
    group?: CardGroup | null; account?: CardAccount | null; categoryName?: string; isExcluded?: boolean; context?: CardContext | string;
  } = {},
): TxnCard {
  const isCredit = txn.type === TRANSACTION_TYPES.CREDIT;
  const bill = Number(txn.amount) || 0;

  // ── amount: what this costs ME ───────────────────────────────────────────
  const share = isCredit ? bill : Number(debitDisplayAmount(txn)) || 0;
  const iPaidGroup = txn.groupSplit?.paidByMemberId === 'me';
  // In a shared group with a 0 share I owe nothing — unless I fronted the bill.
  const notInvolved = !!txn.groupId && !isCredit && !iPaidGroup && share === 0;
  const value = !!txn.groupId && iPaidGroup && share === 0 ? bill : share;
  // Muted only when IGNORED. A borrowed (someone-else-paid) bill keeps full ink —
  // "Rohit paid" + BORROWED already say whose money it was, and the share is still a
  // real cost to me. EXCLUDED keeps full ink too (that money did leave).
  const tone: TxnCard['amount']['tone'] = isCredit ? 'income' : txn.isIgnored ? 'muted' : 'expense';
  const totalHint = !isCredit && bill > 0 && (notInvolved || Math.abs(value - bill) > 0.009) ? bill : null;

  // ── tier 2: what + whose money ───────────────────────────────────────────
  const what = txn.childCategory || categoryName || '';
  const payer = txnPayerName(txn, group);
  let whose = '';
  if (payer) whose = `${payer} paid`;
  else if (context === CARD_CONTEXT.GROUP && txn.groupSplit) whose = 'You paid';
  else if (context === CARD_CONTEXT.ACCOUNT) whose = txn.source === 'manual' ? 'Manual entry' : '';
  else whose = txnAccountLabel(txn, account);
  const meta = [what, whose].filter(Boolean).join(' · ');

  // ── tier 3: chips, highest priority first ────────────────────────────────
  const lbKind: string | null = groupLbChipKind(txn) || splitLbChipKind(txn);
  // Borrowed / fully-lent: the card's amount already IS that money → bare chip.
  // Paid + kept a share: the lent part is shown nowhere else → "LENT ₹600".
  const lent = lbKind ? 0 : lentOnBill(txn);
  const candidates = [
    txn.isIgnored && CHIP.ignored,
    isCredit && txn.isRefund && CHIP.refund,
    !isCredit && isExcluded && CHIP.excluded,
    statusChip(txn),
    lbKind ? CHIP[lbKind] : lent > 0 ? { ...CHIP.lent, amount: lent } : null,
    !txn.isIgnored && txn.isHidden && CHIP.private,
  ].filter((c): c is CardChip => !!c);
  // A category LENT and a split's LENT framing are the same fact — show it once.
  const chips = candidates.filter((c, i) => candidates.findIndex((x) => x.label === c.label) === i);

  return {
    title: (txn.merchant || '').trim() || 'Transaction',
    meta,
    amount: { value, sign: isCredit ? '+' as const : '−' as const, tone, notInvolved },
    totalHint,
    chips: chips.slice(0, MAX_CHIPS),
    overflow: Math.max(0, chips.length - MAX_CHIPS),
    // People on the bill, me included. A group split is shown by the group ribbon.
    splitCount: txn.isSplit && !txn.groupId ? (txn.splitWith || []).length + 1 : 0,
    hasNote: !!(txn.note && txn.note.trim()),
    showGroupRibbon: !!group && context !== CARD_CONTEXT.GROUP,
  };
}
