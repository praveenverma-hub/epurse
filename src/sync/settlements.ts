// =============================================================================
// Settlement sync (docs/SHARED_GROUP_SYNC.md §7). PURE.
//
// A settle in a live group is a Lent/Borrowed row tagged with the group
// (`lent_settled` = they paid me, `borrow_repaid` = I paid them). Those rows ARE
// the local copy of the group's settlements that involve me — settlements between
// two other people change nothing on this phone, so they're never written locally.
// =============================================================================

import type { Group, GroupShared } from '../types/group';
import { isUuid } from './crypto';
import { V1_LIMITS, type SettlementBody } from './events';
import { toLocalMember, toRemoteMember } from './localGroup';

export const SETTLE_KINDS = new Set(['lent_settled', 'borrow_repaid']);

/** The bits of a Lent/Borrowed row this needs. */
export type SyncLbRow = {
  id: string;
  kind: string;
  person?: string;
  contactId?: string | null;
  amount: number;
  date?: string;
  groupId?: string;
  /** Local member id of the other person (rows made before Oct-14-26 may lack it). */
  memberId?: string | null;
  sourceTxnId?: string;
  syncId?: string;
  syncOrigin?: 'remote';
  syncRejected?: string;
  [k: string]: unknown;
};

export type LbOp =
  | { kind: 'lbCreate'; row: SyncLbRow }
  | { kind: 'lbUpdate'; rowId: string; fields: Partial<SyncLbRow> }
  | { kind: 'lbRemove'; rowId: string }
  | { kind: 'lbFlag'; rowId: string; syncRejected: string | null };

const norm = (s?: string | null) => (s || '').trim().toLowerCase();

/** Which group member a row is about (local id) — by memberId, else contact, else an unambiguous name. */
export function lbRowMember(group: Group, row: SyncLbRow): string | null {
  const others = (group.members || []).filter((m) => !m.isMe);
  if (row.memberId && others.some((m) => m.memberId === row.memberId)) return row.memberId;
  const byContact = row.contactId ? others.filter((m) => m.contactId === row.contactId) : [];
  if (byContact.length === 1) return byContact[0].memberId;
  const byName = others.filter((m) => norm(m.name) === norm(row.person));
  return byName.length === 1 ? byName[0].memberId : null;
}

/** A settle row as the server sees it — or null if it can't be sent. */
export function projectSettlement(row: SyncLbRow, syncId: string, group: Group, shared: GroupShared): SettlementBody | null {
  const me = shared.myMemberId;
  if (!me || !SETTLE_KINDS.has(row.kind)) return null;
  const amountPaise = Math.round(Number(row.amount) * 100);
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1 || amountPaise > V1_LIMITS.MAX_PAISE) return null;
  const local = lbRowMember(group, row);
  const them = local ? toRemoteMember(shared, local) : null;
  if (!them || !isUuid(them) || them === me) return null;
  const [from, to] = row.kind === 'lent_settled' ? [them, me] : [me, them];
  // Same key order as events.ts parses, so a projection and the server's copy compare as strings.
  return { entityId: syncId, from, to, amountPaise, date: (row.date || '').slice(0, V1_LIMITS.DATE_MAX) };
}

const involvesMe = (d: SettlementBody, me: string) => d.from === me || d.to === me;

/** Rows of this group that are settlements. */
export const groupSettleRows = (group: Group, lb: SyncLbRow[]) =>
  lb.filter((r) => r.groupId === group.id && SETTLE_KINDS.has(r.kind));

/** Server settlements involving me — deleted and frozen ones too. */
export function settlementsWithMe(shared: GroupShared): [string, SettlementBody][] {
  const me = shared.myMemberId;
  if (!me) return [];
  const out: [string, SettlementBody][] = [];
  for (const [id, e] of Object.entries(shared.fold.entries)) {
    if (e.kind === 'settlement' && involvesMe(e.data, me)) out.push([id, e.data]);
  }
  return out;
}

/** The local row a server settlement should be. */
function localRowFields(group: Group, shared: GroupShared, d: SettlementBody) {
  const me = shared.myMemberId!;
  const other = d.from === me ? d.to : d.from;
  const memberId = toLocalMember(shared, other);
  const m = (group.members || []).find((x) => x.memberId === memberId);
  return {
    kind: d.to === me ? 'lent_settled' : 'borrow_repaid',
    memberId,
    person: m?.name || shared.fold.members[other]?.name || 'Member',
    contactId: m?.contactId || null,
    amount: d.amountPaise / 100,
    date: d.date,
  };
}

/** What to do to this phone's Lent/Borrowed rows so they match the server's settlements. */
export function planIncomingSettlements(group: Group, lb: SyncLbRow[], pendingIds: Set<string>): LbOp[] {
  const shared = group.shared;
  if (!shared?.myMemberId) return [];
  const rows = groupSettleRows(group, lb);
  const bySyncId = new Map(rows.filter((r) => r.syncId).map((r) => [r.syncId!, r]));
  const ops: LbOp[] = [];

  for (const [id, d] of settlementsWithMe(shared)) {
    if (pendingIds.has(id)) continue;
    const local = bySyncId.get(id);
    if (shared.fold.entries[id].deleted) {
      if (local) ops.push({ kind: 'lbRemove', rowId: local.id });
      continue;
    }
    const want = localRowFields(group, shared, d);
    if (!local) {
      ops.push({
        kind: 'lbCreate',
        row: {
          id: `lb_sync_${id}`, ...want, phone: null, note: `Group settle · ${group.name}`,
          createdAt: d.date, groupId: group.id, syncId: id, syncOrigin: 'remote',
        },
      });
      continue;
    }
    const sameMember = lbRowMember(group, local) === want.memberId;
    if (local.kind !== want.kind || Math.round(local.amount * 100) !== d.amountPaise || local.date !== want.date || !sameMember) {
      ops.push({ kind: 'lbUpdate', rowId: local.id, fields: want });
    }
    if (local.syncRejected) ops.push({ kind: 'lbFlag', rowId: local.id, syncRejected: null });
  }

  // Mine, sent, and still not in the history: the rules skipped it on every phone.
  for (const r of bySyncId.values()) {
    if (r.syncOrigin === 'remote' || pendingIds.has(r.syncId!) || shared.fold.entries[r.syncId!]) continue;
    const body = projectSettlement(r, r.syncId!, group, shared);
    const key = body ? JSON.stringify(body) : null;
    if (key && r.syncRejected !== key) ops.push({ kind: 'lbFlag', rowId: r.id, syncRejected: key });
  }
  return ops;
}
