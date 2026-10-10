// =============================================================================
// lbEntryDisplay — how ONE ledger row on the person screen reads, shared by the
// row and its detail sheet so the two can't word the same entry differently.
// Each fact once: the title says WHAT it was, the meta line adds only what the
// title didn't (the kind, unless the title already is the kind) plus the date.
// =============================================================================
import { ENTRY_LABEL } from '../constants/lbEntries';
import { formatCurrency, formatDate } from './format';

export interface LbDisplayEntry {
  id: string;
  kind: string;
  amount: number;
  date: string;
  note?: string;
  isGroupLine?: boolean;
  groupName?: string;
  groupId?: string;
  sourceTxnId?: string | null;
  settledAt?: string | null;
}

/** 'outflow' = your own money left (Lent, Repaid); 'plain' = it arrived; lent/borrowed = a group's running net. */
export type LbEntryTone = 'outflow' | 'plain' | 'lent' | 'borrowed';

// Store-written notes, not something the user typed: a placeholder (hidden) or a
// "From txn: Swiggy" stamp (the merchant is the useful part).
const AUTO_NOTES = new Set(['Manual settlement']);
const FROM_TXN = /^From txn:\s*/;

/** The user-facing part of an entry's note — '' when the store wrote a placeholder. */
export function lbNoteText(note?: string | null): string {
  const n = (note || '').trim();
  return AUTO_NOTES.has(n) ? '' : n.replace(FROM_TXN, '').trim();
}

const kindLabel = (e: LbDisplayEntry) => (ENTRY_LABEL as Record<string, string>)[e.kind] || e.kind;

export function lbEntryTitle(e: LbDisplayEntry): string {
  if (e.isGroupLine) return e.groupName || 'Group';
  return lbNoteText(e.note) || kindLabel(e);
}

export function lbEntryMeta(e: LbDisplayEntry): string {
  if (e.isGroupLine) return 'Net from group';
  const date = formatDate(e.date);
  return lbEntryTitle(e) === kindLabel(e) ? date : `${kindLabel(e)} · ${date}`;
}

/** Lent / Repaid = your money leaving an account; Borrowed / Received back = arriving. */
export const lbMoneyOut = (kind: string) => kind === 'lent' || kind === 'borrow_repaid';

export function lbEntryTone(e: LbDisplayEntry): LbEntryTone {
  if (e.isGroupLine) return e.kind === 'lent' ? 'lent' : 'borrowed';
  return lbMoneyOut(e.kind) ? 'outflow' : 'plain';
}

/** Sign follows literal cash direction (+ arriving, − leaving); a group line follows its net. */
export function lbEntrySign(e: LbDisplayEntry): '+' | '−' {
  const t = lbEntryTone(e);
  return t === 'outflow' || t === 'borrowed' ? '−' : '+';
}

export type LbEntrySource = 'manual' | 'txn' | 'group';
export const lbEntrySource = (e: LbDisplayEntry): LbEntrySource =>
  e.isGroupLine || e.groupId ? 'group' : e.sourceTxnId ? 'txn' : 'manual';

// ── Recording an entry (LB form, Settle) ─────────────────────────────────────

/** The form's direction + "already settled" tick → the ledger kind it records. */
export const lbEffectiveKind = (kind: 'lent' | 'borrowed', alreadySettled: boolean) =>
  alreadySettled ? (kind === 'lent' ? 'lent_settled' : 'borrow_repaid') : kind;

/** The account field's label, by which way the money went. */
export const lbAccountFieldLabel = (kind: string) => (lbMoneyOut(kind) ? 'Paid From' : 'Received In');

/** The account choice for a ledger-only entry (an old loan, untracked cash). */
export const LB_NO_ACCOUNT = 'Not From an Account';

export function lbToastTitle(kind: string, amount: number, who: string): string {
  const amt = formatCurrency(amount);
  switch (kind) {
    case 'lent': return `Lent ${amt} to ${who}`;
    case 'borrowed': return `Borrowed ${amt} from ${who}`;
    case 'lent_settled': return `Settled ${amt} with ${who}`;
    default: return `Repaid ${amt} to ${who}`;
  }
}

/** Toast line when recordLbEntry linked an existing bank transfer instead of booking one. */
export const lbLinkedLine = (txn: { amount: number; createdAt?: string }) =>
  `Linked to your ${formatCurrency(txn.amount)} transfer of ${formatDate(txn.createdAt || '')}`;
