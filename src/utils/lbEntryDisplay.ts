// =============================================================================
// lbEntryDisplay — how ONE ledger row on the person screen reads, shared by the
// row and its detail sheet so the two can't word the same entry differently.
// Each fact once: the title says WHAT it was, the meta line adds only what the
// title didn't (the kind, unless the title already is the kind) plus the date.
// =============================================================================
import { ENTRY_LABEL } from '../constants/lbEntries';
import { formatDate } from './format';

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

export function lbEntryTone(e: LbDisplayEntry): LbEntryTone {
  if (e.isGroupLine) return e.kind === 'lent' ? 'lent' : 'borrowed';
  return e.kind === 'lent' || e.kind === 'borrow_repaid' ? 'outflow' : 'plain';
}

/** Sign follows literal cash direction (+ arriving, − leaving); a group line follows its net. */
export function lbEntrySign(e: LbDisplayEntry): '+' | '−' {
  const t = lbEntryTone(e);
  return t === 'outflow' || t === 'borrowed' ? '−' : '+';
}

export type LbEntrySource = 'manual' | 'txn' | 'group';
export const lbEntrySource = (e: LbDisplayEntry): LbEntrySource =>
  e.isGroupLine || e.groupId ? 'group' : e.sourceTxnId ? 'txn' : 'manual';
