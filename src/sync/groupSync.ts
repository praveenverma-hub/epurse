// =============================================================================
// Shared groups — invite, join, claim, pull, leave (docs/SHARED_GROUP_SYNC.md
// phase 2). A shared group goes live on its FIRST invite: until someone is invited
// nothing leaves the phone. These are online actions called straight from screens;
// expense sync with the offline outbox is phase 3.
//
// Order that matters: a new group's key is saved to the store BEFORE anything is
// sent, so a crash mid-way can never leave a server group nobody holds the key to.
// =============================================================================

import { useEPurseStore } from '../store/ePurseStore';
import { randomBytes } from '../backup/random';
import { bytesToBase64, base64ToBytes } from '../backup/envelope';
import type { Group, GroupShared } from '../types/group';
import { generateGroupKey, randomUuid, sealEvent, openEvent } from './crypto';
import { encodeEvent, V1_LIMITS, type SyncEvent } from './events';
import { emptyFold, foldEvents, type IncomingEvent, type Rejection } from './fold';
import { newInvite, buildInviteLink, parseInviteLink } from './invite';
import { membersFromFold, metaOf, planGroupChanges, toRemoteMember, unclaimedMembers } from './localGroup';
import {
  rpcCreateGroup, rpcAppendEvents, rpcCreateInvite, rpcRedeemInvite, rpcLeaveGroup,
  fetchEvents, fetchMyGroupIds, type EventRow, type SealedRow,
} from './api';
import { ensureSyncSession } from './session';
import { SyncError } from './errors';

const store = () => useEPurseStore.getState() as any;
const getGroup = (id: string): Group | undefined => store().groups.find((g: Group) => g.id === id);

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

function save(localId: string, shared: GroupShared) {
  const group = getGroup(localId);
  const meta = shared.fold.meta ?? undefined;
  store().setSharedGroupState(localId, shared, {
    members: group ? membersFromFold(group.members, shared) : undefined,
    meta,
  });
}

/** Pulls everything new for one group and applies it. Returns what the rules skipped. */
export async function pullGroup(localId: string): Promise<Rejection[]> {
  let { shared } = requireShared(localId);
  const rejected: Rejection[] = [];
  for (;;) {
    const rows = await fetchEvents(shared.remoteId, shared.fold.seq);
    if (!rows.length) break;
    const res = foldEvents(shared.fold, rows.map((r) => toIncoming(shared, r)));
    rejected.push(...res.rejected);
    shared = { ...shared, fold: res.fold, syncedAt: new Date().toISOString() };
    save(localId, shared);
    if (rows.length < 500) break;
  }
  return rejected;
}

async function send(localId: string, events: SyncEvent[]) {
  const { shared } = requireShared(localId);
  const key = keyFor(shared, shared.keyEpoch);
  if (!key) throw new SyncError('LINK_DAMAGED', 'This group\'s key is missing on this phone.');
  const at = new Date().toISOString();
  const rows: SealedRow[] = events.map((ev) => {
    const eventId = randomUuid(randomBytes);
    return { event_id: eventId, key_epoch: shared.keyEpoch, ...sealEvent(key, shared.remoteId, eventId, shared.keyEpoch, encodeEvent(ev, at), randomBytes) };
  });
  for (let i = 0; i < rows.length; i += 50) await rpcAppendEvents(shared.remoteId, rows.slice(i, i + 50));
  await pullGroup(localId);
}

/** Turns a local shared group into a live one, with me as its first member. Run by the first invite. */
async function startSharing(localId: string): Promise<void> {
  const userId = await ensureSyncSession();
  const group = getGroup(localId);
  if (!group || group.type !== 'shared' || group.shared) return;

  const memberMap: Record<string, string> = { me: randomUuid(randomBytes) };
  for (const m of group.members) if (m.memberId !== 'me' && !m.isMe) memberMap[m.memberId] = randomUuid(randomBytes);

  const shared: GroupShared = {
    remoteId: randomUuid(randomBytes),
    keys: { '1': bytesToBase64(generateGroupKey(randomBytes)) },
    keyEpoch: 1,
    myMemberId: memberMap.me,
    memberMap,
    fold: emptyFold(),
    status: 'active',
    syncedAt: null,
  };
  store().setSharedGroupState(localId, shared);
  await rpcCreateGroup(shared.remoteId);

  const others = group.members.filter((m) => m.memberId !== 'me' && !m.isMe);
  await send(localId, [
    metaOf(group),
    { type: 'member.add', memberId: memberMap.me, name: myName() },
    { type: 'member.claim', memberId: memberMap.me, userId },
    ...others.map((m): SyncEvent => ({ type: 'member.add', memberId: memberMap[m.memberId], name: m.name.trim().slice(0, V1_LIMITS.NAME_MAX) || 'Member' })),
  ]);
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
  else if (group.shared.status !== 'active') throw new SyncError('GROUP_ENDED', 'This group is no longer shared.');
  else await pushGroupChanges(localId);  // people added here since — the link may be for one of them

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

/** "This one is me" — or, with no memberId, adds me under my own name. */
export async function claimMember(localId: string, memberId: string | null): Promise<void> {
  const userId = await ensureSyncSession();
  const id = memberId ?? randomUuid(randomBytes);
  await send(localId, [
    ...(memberId ? [] : [{ type: 'member.add', memberId: id, name: myName() } as SyncEvent]),
    { type: 'member.claim', memberId: id, userId },
  ]);
  const { shared } = requireShared(localId);
  if (shared.fold.members[id]?.userId !== userId) {
    throw new SyncError('CLAIM_TAKEN', 'Someone else just picked that name. Choose again.');
  }
  save(localId, { ...shared, myMemberId: id, memberMap: { ...shared.memberMap, me: id } });
}

/** Sends local edits of a synced group (name, emoji, colour, new people, renames). */
export async function pushGroupChanges(localId: string): Promise<void> {
  const { group, shared } = requireShared(localId);
  if (shared.status !== 'active') return;
  const plan = planGroupChanges(group, shared, () => randomUuid(randomBytes));
  if (!plan.events.length) return;
  store().setSharedGroupState(localId, { ...shared, memberMap: plan.memberMap });
  await send(localId, plan.events);
}

/** My balance in a synced group, in paise (0 = settled). */
export function myBalancePaise(localId: string): number {
  const { shared } = requireShared(localId);
  return shared.myMemberId ? shared.fold.balances[shared.myMemberId] ?? 0 : 0;
}

/** Leave: only at ₹0. History stays on every phone; this one keeps its copy as a local group. */
export async function leaveSharedGroup(localId: string): Promise<void> {
  await ensureSyncSession();
  await pullGroup(localId);
  if (myBalancePaise(localId) !== 0) {
    throw new SyncError('NOT_SETTLED', 'Settle up first — you can leave once your balance in this group is ₹0.');
  }
  const { shared } = requireShared(localId);
  if (shared.myMemberId && !shared.fold.members[shared.myMemberId]?.archived) {
    await send(localId, [{ type: 'member.archive', memberId: shared.myMemberId }]);
  }
  await rpcLeaveGroup(shared.remoteId);
  save(localId, { ...requireShared(localId).shared, status: 'ended' });
}

/** Pulls every live group and marks the ones the server no longer has me in as ended. */
export async function syncAllSharedGroups(): Promise<void> {
  const live = store().groups.filter((g: Group) => g.shared?.status === 'active');
  if (!live.length) return;
  const userId = await ensureSyncSession();
  const mine = await fetchMyGroupIds(userId);
  for (const g of live) {
    if (!mine.has(g.shared!.remoteId)) {
      save(g.id, { ...g.shared!, status: 'ended' });
      continue;
    }
    await pullGroup(g.id).catch(() => {});
  }
}
