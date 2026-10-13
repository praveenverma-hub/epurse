// =============================================================================
// Shared groups — invite, join, claim, send, pull, leave (docs/SHARED_GROUP_SYNC.md).
//
// A shared group goes live on its FIRST invite; until someone is invited nothing
// leaves the phone. Expense changes never call anything here directly: the store
// subscription in sync/engine.ts queues them (sync/expenses.ts planOutgoing) and
// asks `flushGroup` to send. `flushGroup` pulls, sends the outbox, pulls, then posts a
// checkpoint if one is due; one group at a time, so a send and a pull never interleave.
//
// Order that matters: a new group's key is saved to the store BEFORE anything is
// sent, so a crash mid-way can never leave a server group nobody holds the key to.
// =============================================================================

import { useEPurseStore } from '../store/ePurseStore';
import { randomBytes } from '../backup/random';
import { bytesToBase64, base64ToBytes } from '../backup/envelope';
import { DEFAULT_CATEGORIES } from '../constants/categories';
import type { Group, GroupShared } from '../types/group';
import { generateGroupKey, randomUuid, sealEvent, openEvent, MAX_CIPHERTEXT_CHARS } from './crypto';
import { encodeEvent, V1_LIMITS, type SyncEvent } from './events';
import { buildCheckpoint, emptyFold, foldEvents, type IncomingEvent, type Rejection } from './fold';
import { checkpointDue } from './checkpoint';
import { newInvite, buildInviteLink, parseInviteLink } from './invite';
import { membersFromFold, metaOf, toRemoteMember, unclaimedMembers } from './localGroup';
import { planIncoming, reconcileOutbox, type OutboxItem } from './expenses';
import {
  rpcCreateGroup, rpcAppendEvents, rpcAppendCheckpoint, rpcCreateInvite, rpcRedeemInvite, rpcLeaveGroup,
  fetchEvents, fetchMyGroupIds, type EventRow, type SealedRow,
} from './api';
import { ensureSyncSession } from './session';
import { SyncError } from './errors';

const store = () => useEPurseStore.getState() as any;
const getGroup = (id: string): Group | undefined => store().groups.find((g: Group) => g.id === id);
export const BUILT_IN_CATEGORIES = new Set<string>(DEFAULT_CATEGORIES.map((c: { id: string }) => c.id));
export const newSyncId = () => randomUuid(randomBytes);

function requireShared(id: string): { group: Group; shared: GroupShared } {
  const group = getGroup(id);
  if (!group?.shared) throw new SyncError('NOT_MEMBER', 'This group isn\'t shared.');
  return { group, shared: group.shared };
}

const myName = (): string => {
  const s = store();
  const name = (s.userName || s.googleAccount?.name || 'Me').trim();
  return name.slice(0, V1_LIMITS.NAME_MAX) || 'Me';
};

const keyFor = (shared: GroupShared, epoch: number): Uint8Array | null =>
  shared.keys[String(epoch)] ? base64ToBytes(shared.keys[String(epoch)]) : null;

const toIncoming = (shared: GroupShared, r: EventRow): IncomingEvent => {
  let plaintext: string | null = null;
  if (r.ciphertext && r.nonce && r.key_epoch != null) {
    const key = keyFor(shared, r.key_epoch);
    if (key) plaintext = openEvent(key, shared.remoteId, r.event_id, r.key_epoch, { nonce: r.nonce, ciphertext: r.ciphertext });
  }
  return {
    seq: r.seq, eventId: r.event_id, authorId: r.author_id, systemType: r.system_type,
    systemSubject: r.system_subject, plaintext, createdAt: r.created_at,
  };
};

/**
 * Writes `shared` and everything that follows from it — members, name, and the
 * server's expenses applied to this phone's transactions — in ONE store write.
 */
function commit(localId: string, pulled: GroupShared, onlyIfChanged = false) {
  const group = getGroup(localId);
  if (!group) return;
  const shared = { ...pulled, outbox: reconcileOutbox(pulled) };
  const next: Group = { ...group, shared, members: membersFromFold(group.members, shared) };
  const ops = planIncoming(next, store().transactions, BUILT_IN_CATEGORIES, store().lentBorrowed);
  const before = pulled.outbox ?? [];
  const sameOutbox = shared.outbox.length === before.length && shared.outbox.every((o, i) => o === before[i]);
  if (onlyIfChanged && !ops.length && sameOutbox) return;
  store().setSharedGroupState(localId, shared, { members: next.members, meta: shared.fold.meta ?? undefined, ops });
}

/** Pulls everything new for one group and applies it. Returns what the rules skipped. */
export async function pullGroup(localId: string): Promise<Rejection[]> {
  const rejected: Rejection[] = [];
  for (let page = 0; ; page++) {
    const { shared } = requireShared(localId);
    const rows = await fetchEvents(shared.remoteId, shared.fold.seq);
    if (!rows.length) {
      // Nothing new — still put back anything this phone has drifted from (e.g. a row of a
      // frozen settlement whose Repayment was deleted here).
      if (!page) commit(localId, shared, true);
      break;
    }
    // Re-read: the outbox may have grown while we were waiting.
    const latest = requireShared(localId).shared;
    const res = foldEvents(latest.fold, rows.map((r) => toIncoming(latest, r)));
    rejected.push(...res.rejected);
    commit(localId, { ...latest, fold: res.fold, syncedAt: new Date().toISOString() });
    if (rows.length < 500) break;
  }
  return rejected;
}

const sealRows = (shared: GroupShared, items: OutboxItem[]): SealedRow[] => {
  const key = keyFor(shared, shared.keyEpoch);
  if (!key) throw new SyncError('LINK_DAMAGED', 'This group\'s key is missing on this phone.');
  // The eventId was fixed when queued, so a resend is recognised by the server, not doubled.
  return items.map((o) => ({
    event_id: o.eventId,
    key_epoch: shared.keyEpoch,
    ...sealEvent(key, shared.remoteId, o.eventId, shared.keyEpoch, encodeEvent(o.event, o.at), randomBytes),
  }));
};

async function doFlush(localId: string) {
  let { shared } = requireShared(localId);
  if (shared.status === 'ended') return;
  await ensureSyncSession();

  if (shared.status === 'pending') {
    await rpcCreateGroup(shared.remoteId);  // safe to repeat
    shared = { ...requireShared(localId).shared, status: 'active' };
    store().setSharedGroupState(localId, shared);
  } else {
    // Pull first: an edit of an expense that a checkpoint has frozen meanwhile must go as a correction.
    await pullGroup(localId);
  }

  for (;;) {
    const batch = (requireShared(localId).shared.outbox ?? []).filter((o) => !o.seq).slice(0, 50);
    if (!batch.length) break;
    let res;
    try {
      res = await rpcAppendEvents(shared.remoteId, sealRows(requireShared(localId).shared, batch));
    } catch (e) {
      if (e instanceof SyncError && (e.code === 'NOT_MEMBER' || e.code === 'GROUP_ENDED')) {
        commit(localId, { ...requireShared(localId).shared, status: 'ended' });
      }
      throw e;
    }
    // Sent items stay (with their seq) until the pull folds them in: dropped now, the store
    // subscription would see the change as unsent and queue it again.
    const seqs = new Map((res ?? []).map((r) => [r.r_event_id, Number(r.r_seq)]));
    const cur = requireShared(localId).shared;
    store().setSharedGroupState(localId, { ...cur, outbox: (cur.outbox ?? []).map((o) => (seqs.has(o.eventId) ? { ...o, seq: seqs.get(o.eventId) } : o)) });
    if (!batch.some((o) => seqs.has(o.eventId))) break;
  }
  await pullGroup(localId);
  await postCheckpointIfDue(localId).catch(() => {});  // retried on the next sync
}

async function postCheckpointIfDue(localId: string) {
  const { shared } = requireShared(localId);
  if (!checkpointDue(shared, Date.now())) return;
  const cp = buildCheckpoint(shared.fold);
  const item: OutboxItem = { eventId: newSyncId(), at: new Date().toISOString(), event: { type: 'group.checkpoint', ...cp } };
  const row = sealRows(shared, [item])[0];
  if (row.ciphertext.length > MAX_CIPHERTEXT_CHARS) return;  // too many people/debts for one event: the server keeps the history
  // false = something landed first; the next quiet spell tries again.
  if (await rpcAppendCheckpoint(shared.remoteId, cp.baseSeq, row)) await pullGroup(localId);
}

const chains = new Map<string, Promise<void>>();

/** Sends this group's queued changes, then pulls. Calls for one group run one after another. */
export function flushGroup(localId: string): Promise<void> {
  const prev = chains.get(localId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => doFlush(localId));
  chains.set(localId, next);
  return next;
}

/** Turns a local shared group into a live one, with me as its first member. Run by the first invite. */
async function startSharing(localId: string): Promise<void> {
  const userId = await ensureSyncSession();
  const group = getGroup(localId);
  if (!group || group.type !== 'shared' || group.shared) return;

  const memberMap: Record<string, string> = { me: newSyncId() };
  for (const m of group.members) if (m.memberId !== 'me' && !m.isMe) memberMap[m.memberId] = newSyncId();
  const at = new Date().toISOString();
  const others = group.members.filter((m) => m.memberId !== 'me' && !m.isMe);
  const first: SyncEvent[] = [
    metaOf(group),
    { type: 'member.add', memberId: memberMap.me, name: myName() },
    { type: 'member.claim', memberId: memberMap.me, userId },
    ...others.map((m): SyncEvent => ({ type: 'member.add', memberId: memberMap[m.memberId], name: m.name.trim().slice(0, V1_LIMITS.NAME_MAX) || 'Member' })),
  ];

  // Queued, not sent: the store subscription then appends the group's existing
  // expenses AFTER these, so people always exist on the server before their expenses.
  store().setSharedGroupState(localId, {
    remoteId: newSyncId(),
    keys: { '1': bytesToBase64(generateGroupKey(randomBytes)) },
    keyEpoch: 1,
    myMemberId: memberMap.me,
    memberMap,
    fold: emptyFold(),
    status: 'pending',
    syncedAt: null,
    outbox: first.map((event) => ({ eventId: newSyncId(), at, event })),
  } satisfies GroupShared);
  await flushGroup(localId);
}

/**
 * A single-use invite link, valid 48 hours — made live first if this is the group's
 * first invite. With `forMember` (a local memberId) the link is for that person and
 * their phone claims the name by itself. Share it privately: it carries the group key.
 */
export async function createInviteLink(localId: string, forMember?: string): Promise<string> {
  await ensureSyncSession();
  const group = getGroup(localId);
  if (!group || group.type !== 'shared') throw new SyncError('NOT_MEMBER', 'Only shared groups can be shared.');
  if (!group.shared) await startSharing(localId);
  else if (group.shared.status === 'ended') throw new SyncError('GROUP_ENDED', 'This group is no longer shared.');
  else await flushGroup(localId);  // people added here since — the link may be for one of them

  const { shared } = requireShared(localId);
  const key = keyFor(shared, shared.keyEpoch);
  if (!key) throw new SyncError('LINK_DAMAGED', 'This group\'s key is missing on this phone.');
  const remoteMember = forMember ? toRemoteMember(shared, forMember) : null;
  const claimable = remoteMember && shared.fold.members[remoteMember] && !shared.fold.members[remoteMember].userId
    ? remoteMember : null;

  const inv = newInvite(randomBytes);
  await rpcCreateInvite(inv.inviteId, shared.remoteId, inv.tokenHashHex);
  return buildInviteLink(inv.inviteId, inv.token, key, claimable);
}

/**
 * Joins from an invite link. Returns the local group id and, for a link made for one
 * person, who that is — the screen claims it, or asks "Who Are You?" if it can't.
 */
export async function joinFromLink(link: string): Promise<{ groupId: string; forMember: string | null }> {
  const parsed = parseInviteLink(link.trim());
  if (!parsed) throw new SyncError('INVITE_INVALID', 'That isn\'t an ePurse invite link.');
  await ensureSyncSession();
  const redeemed = await rpcRedeemInvite(parsed.inviteId, parsed.token);

  const existing = store().groups.find((g: Group) => g.shared?.remoteId === redeemed.groupId);
  if (existing) {
    await pullGroup(existing.id);
    return { groupId: existing.id, forMember: parsed.memberId };
  }

  const localId: string = store().createGroup({ name: 'Shared Group', type: 'shared', members: [] });
  store().setSharedGroupState(localId, {
    remoteId: redeemed.groupId,
    keys: { [String(redeemed.keyEpoch)]: bytesToBase64(parsed.key) },
    keyEpoch: redeemed.keyEpoch,
    myMemberId: null,
    memberMap: {},
    fold: emptyFold(),
    status: 'active',
    syncedAt: null,
    outbox: [],
  } satisfies GroupShared);

  const rejected = await pullGroup(localId);
  if (rejected.some((r) => r.reason === 'unreadable')) {
    // A wrong key in the link: leave again rather than keep a group we can't read.
    await rpcLeaveGroup(redeemed.groupId).catch(() => {});
    store().deleteGroup(localId);
    throw new SyncError('LINK_DAMAGED', 'This invite link is damaged. Ask for a new one.');
  }
  return { groupId: localId, forMember: parsed.memberId };
}

export const getUnclaimedMembers = (localId: string) => unclaimedMembers(requireShared(localId).shared);

// For one-off actions that need the server's answer now (claim, leave) — not the outbox.
async function sendNow(localId: string, events: SyncEvent[]) {
  const { shared } = requireShared(localId);
  const at = new Date().toISOString();
  await rpcAppendEvents(shared.remoteId, sealRows(shared, events.map((event) => ({ eventId: newSyncId(), at, event }))));
  await pullGroup(localId);
}

/** "This one is me" — or, with no memberId, adds me under my own name. */
export async function claimMember(localId: string, memberId: string | null): Promise<void> {
  const userId = await ensureSyncSession();
  const id = memberId ?? newSyncId();
  await sendNow(localId, [
    ...(memberId ? [] : [{ type: 'member.add', memberId: id, name: myName() } as SyncEvent]),
    { type: 'member.claim', memberId: id, userId },
  ]);
  const { shared } = requireShared(localId);
  if (shared.fold.members[id]?.userId !== userId) {
    throw new SyncError('CLAIM_TAKEN', 'Someone else just picked that name. Choose again.');
  }
  // Re-applies every expense with this name as 'me' — mine now show as mine.
  commit(localId, { ...shared, myMemberId: id, memberMap: { ...shared.memberMap, me: id } });
}

/** My balance in a synced group, in paise (0 = settled). */
export function myBalancePaise(localId: string): number {
  const { shared } = requireShared(localId);
  return shared.myMemberId ? shared.fold.balances[shared.myMemberId] ?? 0 : 0;
}

/** Leave: only at ₹0. History stays on every phone; this one keeps its copy as a local group. */
export async function leaveSharedGroup(localId: string): Promise<void> {
  await flushGroup(localId);
  if (myBalancePaise(localId) !== 0) {
    throw new SyncError('NOT_SETTLED', 'Settle up first — you can leave once your balance in this group is ₹0.');
  }
  const { shared } = requireShared(localId);
  if (shared.myMemberId && !shared.fold.members[shared.myMemberId]?.archived) {
    await sendNow(localId, [{ type: 'member.archive', memberId: shared.myMemberId }]);
  }
  await rpcLeaveGroup(shared.remoteId);
  store().setSharedGroupState(localId, { ...requireShared(localId).shared, status: 'ended', outbox: [] });
}

/** Sends and pulls every live group; groups the server no longer has me in are marked ended. */
export async function syncAllSharedGroups(): Promise<void> {
  const live = store().groups.filter((g: Group) => g.shared && g.shared.status !== 'ended');
  if (!live.length) return;
  const userId = await ensureSyncSession();
  const mine = await fetchMyGroupIds(userId);
  for (const g of live) {
    if (g.shared!.status === 'active' && !mine.has(g.shared!.remoteId)) {
      store().setSharedGroupState(g.id, { ...g.shared!, status: 'ended' });
      continue;
    }
    await flushGroup(g.id).catch(() => {});
  }
}
