// =============================================================================
// Lent/Borrowed follows the group's history (docs/SHARED_GROUP_SYNC.md §8b). PURE.
//
// A live group's balances are the server history's; Lent/Borrowed shows them as rows.
// Usually the rows of this phone's expenses and settlements add up to it exactly. They
// don't when part of the history is only known as a checkpoint (joined or restored after
// a dormant group was compacted) or as a correction of an expense this phone never had.
// Then one "Earlier balance" row per person makes up the difference — so what Lent/
// Borrowed shows, what Settle settles and what Leave checks are always the same number.
//
// Rows of changes not on the server yet (unsent, or skipped: NOT SYNCED) aren't compared.
// =============================================================================

import type { Group } from '../types/group';
import { debtList } from './fold';
import { itemIds, type SyncTxn } from './expenses';
import { toLocalMember, toRemoteMember } from './localGroup';
import { SETTLE_KINDS, lbRowMember, type LbOp, type SyncLbRow } from './settlements';

export const EARLIER_BALANCE_PREFIX = 'lb_earlier_';
/** + = they owe me. */
const SIGN: Record<string, number> = { lent: 1, borrow_repaid: 1, borrowed: -1, lent_settled: -1 };

export function planBalanceRows(group: Group, txns: SyncTxn[], lb: SyncLbRow[], at: string): LbOp[] {
  const shared = group.shared;
  if (!shared?.myMemberId || shared.status !== 'active') return [];
  const me = shared.myMemberId;

  const want: Record<string, number> = {};
  for (const d of debtList(shared.fold.debts)) {
    if (d.to === me) want[d.from] = (want[d.from] ?? 0) + d.paise;
    else if (d.from === me) want[d.to] = (want[d.to] ?? 0) - d.paise;
  }

  const pending = new Set((shared.outbox ?? []).flatMap(itemIds));
  const onServer = (syncId?: string, rejected?: string) => !!syncId && !pending.has(syncId) && !rejected;
  const txnById = new Map(txns.map((t) => [t.id, t]));
  const have: Record<string, number> = {};
  const earlier = new Map<string, SyncLbRow>();   // server member id → its "Earlier balance" row
  for (const r of lb) {
    if (r.groupId !== group.id || !(r.kind in SIGN)) continue;
    const local = lbRowMember(group, r);
    if (!local) continue;
    const id = toRemoteMember(shared, local);
    if (r.id.startsWith(EARLIER_BALANCE_PREFIX)) { earlier.set(id, r); continue; }
    const src = SETTLE_KINDS.has(r.kind) ? r : txnById.get(r.sourceTxnId ?? '');
    if (!src || !onServer(src.syncId as string | undefined, src.syncRejected as string | undefined)) continue;
    have[id] = (have[id] ?? 0) + SIGN[r.kind] * Math.round(Number(r.amount) * 100);
  }

  const ops: LbOp[] = [];
  for (const id of new Set([...Object.keys(want), ...Object.keys(have), ...earlier.keys()])) {
    const diff = (want[id] ?? 0) - (have[id] ?? 0);
    const row = earlier.get(id);
    if (Math.abs(diff) <= 1) {   // a paisa of rounding isn't a balance
      if (row) ops.push({ kind: 'lbRemove', rowId: row.id });
      continue;
    }
    const kind = diff > 0 ? 'lent' : 'borrowed';
    const amount = Math.abs(diff) / 100;
    if (row) {
      if (row.kind !== kind || Math.round(row.amount * 100) !== Math.abs(diff)) ops.push({ kind: 'lbUpdate', rowId: row.id, fields: { kind, amount } });
      continue;
    }
    const localId = toLocalMember(shared, id);
    const m = (group.members || []).find((x) => x.memberId === localId);
    ops.push({
      kind: 'lbCreate',
      row: {
        id: `${EARLIER_BALANCE_PREFIX}${group.id}_${localId}`, kind, amount, memberId: localId,
        person: m?.name || shared.fold.members[id]?.name || 'Member', contactId: m?.contactId || null, phone: null,
        note: `Earlier balance · ${group.name}`, date: at, createdAt: at, groupId: group.id, syncOrigin: 'remote',
      },
    });
  }
  return ops;
}
