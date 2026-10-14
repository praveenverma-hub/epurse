// =============================================================================
// Expense sync, both directions (docs/SHARED_GROUP_SYNC.md §7–§8). PURE.
//
// OUTGOING — `planOutgoing` is the ONE check point: whatever changed a live group's
// expenses (add, edit, ignore, untag, delete, SMS refund…), it compares the group's
// transactions with the server history and queues the difference. No action has to
// remember to "send" anything.
//
// INCOMING — `planIncoming` turns the server history into operations on local
// transactions (create / update / remove), which the store applies in the SAME write
// as the new history. That matters: in between, the outgoing check would mistake a
// remote edit for a local one and send the old version back.
//
// Compared in REMOTE terms going out (server member ids, paise) and in LOCAL terms
// coming in ('me', rupees) — so claiming my name re-maps old expenses to 'me'.
// =============================================================================

import type { Group, GroupShared } from '../types/group';
import { isUuid } from './crypto';
import { V1_LIMITS, type ExpenseBody, type SyncEvent } from './events';
import { buildCorrection } from './fold';
import { planGroupChanges, toLocalMember, toRemoteMember } from './localGroup';
import {
  groupSettleRows, planIncomingSettlements, projectSettlement, settlementsWithMe, type LbOp, type SyncLbRow,
} from './settlements';

/** `seq` = sent, the server's seq for it; kept until a pull folds past it, so it can't be queued twice. */
export type OutboxItem = { eventId: string; at: string; event: SyncEvent; seq?: number };

/** The ids an outbox item is about — a correction is about the expense it corrects. */
const itemIds = (o: OutboxItem): string[] =>
  o.event.type === 'expense.correct' ? [o.event.entityId, o.event.correctsId]
    : 'entityId' in o.event ? [o.event.entityId] : [];

/** The version a frozen expense is at once the outbox's corrections land (undefined = none pending; null = deleted). */
function pendingVersion(outbox: OutboxItem[], id: string): ExpenseBody | null | undefined {
  let v: ExpenseBody | null | undefined;
  for (const o of outbox) if (o.event.type === 'expense.correct' && o.event.correctsId === id) v = o.event.expense;
  return v;
}

/**
 * After a pull: drop what the history now has, and turn an UNSENT edit or delete of an
 * expense that a checkpoint has since frozen into a correction — sent as a plain edit, it
 * would count as a second, new expense. Same eventId, so a send already under way can't double it.
 */
export function reconcileOutbox(shared: GroupShared): OutboxItem[] {
  const f = shared.fold;
  const out: OutboxItem[] = [];
  for (const o of (shared.outbox ?? []).filter((x) => !(x.seq && x.seq <= f.seq))) {
    const ev = o.event;
    const id = (ev.type === 'expense.upsert' || ev.type === 'expense.delete') && !o.seq ? ev.entityId : null;
    const entry = id ? f.entries[id] : undefined;
    if (!id || !entry || !entry.frozen || entry.kind !== 'expense') { out.push(o); continue; }
    const from = pendingVersion(out, id);
    if (from === null || entry.deleted) continue;
    const next = ev.type === 'expense.upsert' ? (({ type: _t, ...body }) => body)(ev) : null;
    const c = buildCorrection(f, o.eventId, id, next, from);
    if (c) out.push({ ...o, event: { type: 'expense.correct', ...c } });
  }
  return out;
}

/** The bits of a local transaction this needs (the store's txn is a superset). */
export type SyncTxn = {
  id: string;
  type?: string;
  amount: number;
  merchant?: string;
  cleanMerchant?: string;
  categoryId?: string;
  createdAt?: string;
  groupId?: string;
  groupSplit?: { paidByMemberId: string; paidByName?: string; shares: { memberId: string; name?: string; shareAmount: number }[] };
  isGroupMemo?: boolean;
  isIgnored?: boolean;
  accountId?: string | null;
  syncId?: string;
  syncOrigin?: 'remote';
  /** The projection that the server rejected — not re-sent until the expense changes. */
  syncRejected?: string;
  [k: string]: unknown;
};

const titleOf = (t: SyncTxn) =>
  ((t.cleanMerchant || t.merchant || '').trim().slice(0, V1_LIMITS.TITLE_MAX)) || 'Group Expense';
const sharedCategory = (t: SyncTxn, builtIns: Set<string>) =>
  (t.categoryId && builtIns.has(t.categoryId) ? t.categoryId : 'other');

/** A group expense as the server sees it — or null if it can't be sent (yet). */
export function projectExpense(t: SyncTxn, syncId: string, shared: GroupShared, builtIns: Set<string>): ExpenseBody | null {
  const split = t.groupSplit;
  if (t.type !== 'debit' || t.isIgnored || !split?.shares?.length) return null;
  const total = Math.round(Number(t.amount) * 100);
  if (!Number.isSafeInteger(total) || total < 1 || total > V1_LIMITS.MAX_PAISE) return null;

  const paidBy = toRemoteMember(shared, split.paidByMemberId);
  // Two local ids can be one person (me + the name I claimed): one share, summed.
  const byMember = new Map<string, number>();
  for (const s of split.shares) {
    const id = toRemoteMember(shared, s.memberId);
    byMember.set(id, (byMember.get(id) ?? 0) + Math.round(Number(s.shareAmount) * 100));
  }
  const shares = [...byMember].map(([memberId, paise]) => ({ memberId, paise }));
  if (!isUuid(paidBy) || shares.some((s) => !isUuid(s.memberId) || !Number.isSafeInteger(s.paise))) return null;
  // Rupee shares can round to a paisa off the total: the payer (or the biggest share) absorbs it.
  const diff = total - shares.reduce((a, s) => a + s.paise, 0);
  if (diff) {
    const i = Math.max(0, shares.findIndex((s) => s.memberId === paidBy));
    const target = shares.some((s) => s.memberId === paidBy) ? i : shares.reduce((b, s, j) => (s.paise > shares[b].paise ? j : b), 0);
    shares[target] = { ...shares[target], paise: shares[target].paise + diff };
  }
  if (shares.some((s) => s.paise < 0) || new Set(shares.map((s) => s.memberId)).size !== shares.length) return null;

  // Same key order as events.ts parses, so a projection and the server's copy compare as strings.
  return {
    entityId: syncId,
    amountPaise: total,
    title: titleOf(t),
    categoryId: sharedCategory(t, builtIns),
    date: (t.createdAt || '').slice(0, V1_LIMITS.DATE_MAX),
    paidBy,
    shares,
  };
}

const sameMap = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** `syncRejected` for an expense that can't be sent at all (vs the server's rules skipping it). */
export const UNSENDABLE = 'unsendable';

/**
 * What a live group has to send now. null = nothing. `syncIds` gives transactions their
 * server id the first time they can be sent; `shared.outbox` has the new events appended.
 */
export function planOutgoing(
  group: Group, txns: SyncTxn[], newId: () => string, builtIns: Set<string>, at: string, lb: SyncLbRow[] = [],
): { shared: GroupShared; syncIds: Record<string, string>; lbSyncIds: Record<string, string>; flags: Record<string, string | null> } | null {
  const shared = group.shared;
  if (!shared || shared.status === 'ended' || !shared.myMemberId) return null;
  const outbox = shared.outbox ?? [];
  const pending = new Set(outbox.map((o) => JSON.stringify(o.event)));
  const events: SyncEvent[] = [];
  const push = (ev: SyncEvent) => {
    const key = JSON.stringify(ev);
    if (!pending.has(key)) { pending.add(key); events.push(ev); }
  };

  const people = planGroupChanges(group, shared, newId);
  people.events.forEach(push);
  const mapped: GroupShared = { ...shared, memberMap: people.memberMap };

  // An edit/delete of an expense from before the last checkpoint goes as a correction,
  // built on the version the outbox's own corrections have already reached.
  const queued: OutboxItem[] = [...outbox];
  const correct = (id: string, next: ExpenseBody | null) => {
    const from = pendingVersion(queued, id);
    if (from === null) return;
    const base = from ?? (shared.fold.entries[id].data as ExpenseBody);
    if (next && JSON.stringify(base) === JSON.stringify(next)) return;
    const c = buildCorrection(shared.fold, newId(), id, next, from);
    if (!c) return;
    const ev: SyncEvent = { type: 'expense.correct', ...c };
    events.push(ev);
    queued.push({ eventId: '', at, event: ev });
  };

  const syncIds: Record<string, string> = {};
  const flags: Record<string, string | null> = {};
  const here = new Set<string>();
  for (const t of txns) {
    if (t.groupId !== group.id) continue;
    const syncId = t.syncId ?? newId();
    const body = projectExpense(t, syncId, mapped, builtIns);
    // Never on the server and can't go there as it is (e.g. no split): say so, don't stay silent.
    const unsendable = !body && t.type === 'debit' && !t.isIgnored && !(t.syncId && shared.fold.entries[t.syncId]);
    if (unsendable !== (t.syncRejected === UNSENDABLE)) {
      if (unsendable) flags[t.id] = UNSENDABLE;
      else if (t.syncRejected === UNSENDABLE) flags[t.id] = null;
    }
    if (!body) continue;
    if (!t.syncId) syncIds[t.id] = syncId;
    here.add(syncId);

    const entry = shared.fold.entries[syncId];
    if (entry && (entry.deleted || entry.kind !== 'expense')) continue;
    const key = JSON.stringify(body);
    if (entry?.frozen) { correct(syncId, body); continue; }
    if (entry && JSON.stringify(entry.data) === key) continue;
    if (t.syncRejected === key) continue;
    push({ type: 'expense.upsert', ...body });
  }
  // On the server but no longer an expense of this group here: deleted, untagged or ignored.
  for (const [id, e] of Object.entries(shared.fold.entries)) {
    if (e.kind !== 'expense' || e.deleted || here.has(id)) continue;
    if (e.frozen) correct(id, null);
    else push({ type: 'expense.delete', entityId: id });
  }

  // Settlements: the group's settle rows in Lent/Borrowed (sync/settlements.ts).
  const lbSyncIds: Record<string, string> = {};
  const settled = new Set<string>();
  for (const r of groupSettleRows(group, lb)) {
    const syncId = r.syncId ?? newId();
    const body = projectSettlement(r, syncId, group, mapped);
    if (!body) continue;
    if (!r.syncId) lbSyncIds[r.id] = syncId;
    settled.add(syncId);

    const entry = shared.fold.entries[syncId];
    if (entry && (entry.frozen || entry.deleted || entry.kind !== 'settlement')) continue;
    const key = JSON.stringify(body);
    if (entry && JSON.stringify(entry.data) === key) continue;
    if (r.syncRejected === key) continue;
    push({ type: 'settlement.upsert', ...body });
  }
  // Gone here (e.g. its Repayment transaction was deleted). Ones between other people never live here.
  // A frozen one can't be deleted: the pull puts its row back, and settling the other way undoes it.
  for (const [id] of settlementsWithMe(shared)) {
    const e = shared.fold.entries[id];
    if (!e.deleted && !e.frozen && !settled.has(id)) push({ type: 'settlement.delete', entityId: id });
  }

  if (!events.length && !Object.keys(syncIds).length && !Object.keys(lbSyncIds).length && !Object.keys(flags).length
    && sameMap(people.memberMap, shared.memberMap)) return null;
  return {
    shared: { ...mapped, outbox: [...outbox, ...events.map((event) => ({ eventId: newId(), at, event }))] },
    syncIds,
    lbSyncIds,
    flags,
  };
}

// ── Incoming ────────────────────────────────────────────────────────────────

export type IncomingOp =
  | { kind: 'create'; txn: SyncTxn }
  | { kind: 'update'; txnId: string; fields: Partial<SyncTxn> }
  | { kind: 'remove'; txnId: string }
  | { kind: 'flag'; txnId: string; syncRejected: string | null }
  | LbOp;

/** The local shape of a server expense, given who is who on this phone. */
function localFields(body: ExpenseBody, shared: GroupShared) {
  const name = (id: string) => (id === shared.myMemberId ? 'You' : shared.fold.members[id]?.name ?? 'Member');
  const paidBy = toLocalMember(shared, body.paidBy);
  return {
    amount: body.amountPaise / 100,
    merchant: body.title,
    categoryId: body.categoryId,
    createdAt: body.date,
    groupSplit: {
      paidByMemberId: paidBy,
      paidByName: name(body.paidBy),
      shares: body.shares.map((s) => ({ memberId: toLocalMember(shared, s.memberId), name: name(s.memberId), shareAmount: s.paise / 100 })),
    },
    isGroupMemo: paidBy !== 'me',
  };
}

// What has to match for a local copy to count as up to date.
const localKey = (t: Pick<SyncTxn, 'amount' | 'createdAt' | 'groupSplit'>, title: string, category: string) =>
  JSON.stringify([
    Math.round(t.amount * 100), title, category, t.createdAt,
    t.groupSplit?.paidByMemberId, (t.groupSplit?.shares ?? []).map((s) => [s.memberId, Math.round(s.shareAmount * 100)]),
  ]);

/**
 * Entities whose change was SENT, is now inside the history's seq range, and isn't in it:
 * the rules skipped it on every phone. Read from the outbox BEFORE `reconcileOutbox` drops
 * those items. Exact, unlike "has a server id but isn't on the server", which also catches
 * anything that simply wasn't sent yet.
 */
export function skippedBySend(shared: GroupShared): Set<string> {
  const f = shared.fold;
  const out = new Set<string>();
  for (const o of shared.outbox ?? []) {
    const ev = o.event;
    if (!o.seq || o.seq > f.seq) continue;
    if ((ev.type === 'expense.upsert' || ev.type === 'settlement.upsert') && !f.entries[ev.entityId]) out.add(ev.entityId);
  }
  return out;
}

/** What to do to this phone's transactions and settle rows so they match the server history. */
export function planIncoming(
  group: Group, txns: SyncTxn[], builtIns: Set<string>, lb: SyncLbRow[] = [], skipped: Set<string> = new Set(),
): IncomingOp[] {
  const shared = group.shared;
  if (!shared) return [];
  const pendingIds = new Set((shared.outbox ?? []).flatMap(itemIds));
  const bySyncId = new Map(txns.filter((t) => t.groupId === group.id && t.syncId).map((t) => [t.syncId!, t]));
  const ops: IncomingOp[] = [];

  for (const [id, entry] of Object.entries(shared.fold.entries)) {
    // Frozen ones too: a phone that has them keeps them up to date from corrections.
    if (entry.kind !== 'expense' || pendingIds.has(id)) continue;
    const local = bySyncId.get(id);
    if (entry.deleted) {
      if (local) ops.push({ kind: 'remove', txnId: local.id });
      continue;
    }
    const want = localFields(entry.data, shared);
    if (!local) {
      ops.push({
        kind: 'create',
        txn: {
          id: `sync_${id}`, syncId: id, syncOrigin: 'remote', type: 'debit', source: 'sync',
          isReviewed: true, isSplit: false, splitWith: [], groupId: group.id, accountId: null, ...want,
        },
      });
      continue;
    }
    const localCategory = sharedCategory(local, builtIns);
    const have = localKey(local, titleOf(local), localCategory);
    const target = localKey(want, want.merchant, want.categoryId);
    if (have !== target) {
      const fields: Partial<SyncTxn> = { amount: want.amount, merchant: want.merchant, createdAt: want.createdAt, groupSplit: want.groupSplit, isGroupMemo: want.isGroupMemo };
      if (local.cleanMerchant) fields.cleanMerchant = want.merchant;
      // A custom category here reads as 'other' on the server — keep it unless the server changed it.
      if (want.categoryId !== localCategory) fields.categoryId = want.categoryId;
      ops.push({ kind: 'update', txnId: local.id, fields });
    }
    if (local.syncRejected) ops.push({ kind: 'flag', txnId: local.id, syncRejected: null });
  }

  // Mine, sent, and skipped by the rules on every phone.
  for (const t of bySyncId.values()) {
    if (!skipped.has(t.syncId!) || pendingIds.has(t.syncId!)) continue;
    const body = projectExpense(t, t.syncId!, shared, builtIns);
    const key = body ? JSON.stringify(body) : null;
    if (key && t.syncRejected !== key) ops.push({ kind: 'flag', txnId: t.id, syncRejected: key });
  }
  return [...ops, ...planIncomingSettlements(group, lb, pendingIds, skipped)];
}
