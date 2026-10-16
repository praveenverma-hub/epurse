// =============================================================================
// Who changed what in a shared group, and when (docs/SHARED_GROUP_SYNC.md §6). PURE.
//
// Read from the fold's own record — every version of every entry with its sender and the
// server's time, kept on every phone. With no admin, anyone may change anything; this is
// what lets the others see a wrong change and put it right.
// =============================================================================

import type { GroupShared } from '../types/group';
import type { ExpenseBody, SettlementBody } from './events';
import type { EntryState, Version } from './fold';

export type HistoryChange = 'amount' | 'payer' | 'split' | 'title' | 'date' | 'category';

export type HistoryItem = {
  /** Order in the group's history (server seq). */
  seq: number;
  /** Server time of the change. */
  at: string;
  /** Who made it — "You" for me. */
  by: string;
  action: 'added' | 'edited' | 'deleted';
  kind: 'expense' | 'settlement';
  /** The expense's id on the server (an old one's, for a change sent as a correction). */
  entityId: string;
  /** Expense title, or "Priya paid Rahul". */
  title: string;
  amountPaise: number;
  /** Edits only: the amount before, and what changed. */
  prevAmountPaise?: number;
  changes?: HistoryChange[];
};

const sameShares = (a: ExpenseBody, b: ExpenseBody) => JSON.stringify(a.shares) === JSON.stringify(b.shares);

function expenseChanges(a: ExpenseBody, b: ExpenseBody): HistoryChange[] {
  const out: HistoryChange[] = [];
  if (a.amountPaise !== b.amountPaise) out.push('amount');
  if (a.paidBy !== b.paidBy) out.push('payer');
  if (!sameShares(a, b) && a.amountPaise === b.amountPaise) out.push('split');
  if (a.title !== b.title) out.push('title');
  if (a.date.slice(0, 10) !== b.date.slice(0, 10)) out.push('date');
  if (a.categoryId !== b.categoryId) out.push('category');
  return out;
}

function namer(shared: GroupShared) {
  const { fold, myMemberId } = shared;
  const memberName = (id: string) => (id === myMemberId ? 'You' : fold.members[id]?.name ?? 'Someone');
  const userName = (userId: string) => {
    const id = fold.memberOrder.find((m) => fold.members[m].userId === userId);
    return id ? memberName(id) : 'Someone';
  };
  return { memberName, userName };
}

function itemsOf(shared: GroupShared, entityId: string, e: EntryState): HistoryItem[] {
  if (e.kind === 'correction') return [];
  const { memberName, userName } = namer(shared);
  const label = (d: ExpenseBody | SettlementBody) =>
    e.kind === 'expense' ? (d as ExpenseBody).title : `${memberName((d as SettlementBody).from)} paid ${memberName((d as SettlementBody).to)}`;
  const versions = e.versions as Version<ExpenseBody | SettlementBody>[];
  const out: HistoryItem[] = versions.map((v, i) => {
    const base = { seq: v.seq, at: v.at, by: userName(v.by), kind: e.kind, entityId, title: label(v.data), amountPaise: v.data.amountPaise };
    if (i === 0) return { ...base, action: 'added' as const };
    const prev = versions[i - 1].data;
    const changes = e.kind === 'expense' ? expenseChanges(prev as ExpenseBody, v.data as ExpenseBody)
      : (prev.amountPaise !== v.data.amountPaise ? ['amount' as const] : []);
    return { ...base, action: 'edited' as const, prevAmountPaise: prev.amountPaise, changes };
  });
  if (e.deleted) {
    const last = e.data;
    const seq = e.deleted.seq ?? Math.max(...versions.map((v) => v.seq));
    out.push({ seq, at: e.deleted.at, by: userName(e.deleted.by), action: 'deleted', kind: e.kind, entityId, title: label(last), amountPaise: last.amountPaise });
  }
  return out;
}

/** One expense's (or settlement's) history, newest first. Empty when the server has none. */
export function entryHistory(shared: GroupShared | undefined, entityId: string | undefined): HistoryItem[] {
  const e = entityId ? shared?.fold.entries[entityId] : undefined;
  return shared && e ? itemsOf(shared, entityId!, e).reverse() : [];
}

export type EntrySummary = {
  kind: 'expense' | 'settlement';
  title: string;
  amountPaise: number;
  date: string;
  /** Who paid — "You" for me. */
  paidBy: string;
  deleted: boolean;
};

/** What an expense or settlement is now (or was, if deleted) — the head of its history page. */
export function entrySummary(shared: GroupShared | undefined, entityId: string | undefined): EntrySummary | null {
  const e = entityId ? shared?.fold.entries[entityId] : undefined;
  if (!shared || !e || e.kind === 'correction') return null;
  const { memberName } = namer(shared);
  const deleted = !!e.deleted;
  if (e.kind === 'expense') {
    const d = e.data as ExpenseBody;
    return { kind: 'expense', title: d.title, amountPaise: d.amountPaise, date: d.date, paidBy: memberName(d.paidBy), deleted };
  }
  const d = e.data as SettlementBody;
  return { kind: 'settlement', title: `${memberName(d.from)} paid ${memberName(d.to)}`, amountPaise: d.amountPaise, date: d.date, paidBy: memberName(d.from), deleted };
}

/**
 * Everything that changed in the group, newest first — deletes included, which no longer
 * have a transaction to open. An edit of an old expense this phone never had (a late joiner)
 * shows from its correction.
 */
export function groupHistory(shared: GroupShared | undefined, limit = 100): HistoryItem[] {
  if (!shared) return [];
  const { userName } = namer(shared);
  const out: HistoryItem[] = [];
  for (const [id, e] of Object.entries(shared.fold.entries)) {
    if (e.kind !== 'correction') { out.push(...itemsOf(shared, id, e)); continue; }
    if (shared.fold.entries[e.data.correctsId]) continue;   // shown on the original
    const v = e.versions[0];
    const after = e.data.expense;
    out.push({
      seq: v.seq, at: v.at, by: userName(v.by), action: after ? 'edited' : 'deleted', kind: 'expense',
      entityId: e.data.correctsId, title: e.data.title, amountPaise: after?.amountPaise ?? 0, ...(after ? { changes: [] } : {}),
    });
  }
  return out.sort((a, b) => b.seq - a.seq).slice(0, limit);
}
