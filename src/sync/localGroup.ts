// =============================================================================
// Synced group ⇄ the app's own Group (docs/SHARED_GROUP_SYNC.md §8). PURE.
//
// Member ids: a member that already existed here before syncing keeps its local
// id (`c_<contactId>`, so its contact link survives) and `memberMap` points it at
// its server id. Everyone else uses the server id directly. The member I claimed
// is always `'me'` locally.
// =============================================================================

import type { Group, GroupMember, GroupShared } from '../types/group';
import type { SyncEvent } from './events';
import { V1_LIMITS } from './events';

export const toRemoteMember = (shared: GroupShared, localId: string): string =>
  (localId === 'me' ? shared.myMemberId : shared.memberMap[localId]) ?? localId;

/** Is this person (local member id) the group's admin, as last seen on the server? */
export function isGroupAdmin(shared: GroupShared, localMemberId: string): boolean {
  const userId = shared.fold.members[toRemoteMember(shared, localMemberId)]?.userId;
  return !!userId && (shared.admins ?? []).includes(userId);
}

/** A member's balance in a synced group, in paise (0 = settled). */
export const memberBalancePaise = (shared: GroupShared, localMemberId: string): number =>
  shared.fold.balances[toRemoteMember(shared, localMemberId)] ?? 0;

export function toLocalMember(shared: GroupShared, remoteId: string): string {
  if (remoteId === shared.myMemberId) return 'me';
  for (const [local, remote] of Object.entries(shared.memberMap)) if (remote === remoteId) return local;
  return remoteId;
}

/** The group's members (without 'me' — the store adds it) as the server history has them. */
export function membersFromFold(local: GroupMember[], shared: GroupShared): GroupMember[] {
  const byId = new Map(local.map((m) => [m.memberId, m]));
  const out: GroupMember[] = [];
  const seen = new Set<string>();
  for (const remoteId of shared.fold.memberOrder) {
    if (remoteId === shared.myMemberId) continue;
    const localId = toLocalMember(shared, remoteId);
    const m = shared.fold.members[remoteId];
    const prev = byId.get(localId);
    out.push({
      memberId: localId,
      name: m.name,
      contactId: prev?.contactId ?? null,
      phone: prev?.phone ?? null,
      ...(m.archived ? { archived: true } : {}),
    });
    seen.add(localId);
  }
  // Added here but not on the server yet — keep them until they're sent. Not one that IS on the
  // server under its own id: e.g. the person I just claimed, shown until then under the admin's name.
  for (const m of local) {
    if (m.memberId === 'me' || m.isMe || seen.has(m.memberId)) continue;
    if (!shared.memberMap[m.memberId] && !shared.fold.members[m.memberId]) out.push(m);
  }
  return out;
}

const clip = (s: string) => s.trim().slice(0, V1_LIMITS.NAME_MAX);
const hexOrNull = (c: string | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);
const emojiOrNull = (e: string | undefined) => (e && e.length <= V1_LIMITS.EMOJI_MAX ? e : null);

/** The group's name/emoji/colour as a `group.meta` event (v1 limits applied). */
export const metaOf = (group: Pick<Group, 'name' | 'emoji' | 'color'>): Extract<SyncEvent, { type: 'group.meta' }> =>
  ({ type: 'group.meta', name: clip(group.name), emoji: emojiOrNull(group.emoji), color: hexOrNull(group.color) });

/**
 * What to send after a local edit of a synced group: name/emoji/colour, new people,
 * renames. Returns the events and the member map with the new people's server ids.
 * Removing someone isn't an edit — they're archived through Leave / Remove (₹0 only).
 */
export function planGroupChanges(
  group: Pick<Group, 'name' | 'emoji' | 'color' | 'members'>,
  shared: GroupShared,
  newId: () => string,
): { events: SyncEvent[]; memberMap: Record<string, string> } {
  const events: SyncEvent[] = [];
  const memberMap = { ...shared.memberMap };
  const { fold } = shared;

  const meta = metaOf(group);
  // No colour on the server: the colour here is just this phone's default, not an edit.
  const colorChanged = fold.meta?.color != null && fold.meta.color !== meta.color;
  if (meta.name && (!fold.meta || fold.meta.name !== meta.name || fold.meta.emoji !== meta.emoji || colorChanged)) {
    events.push(meta);
  }

  for (const m of group.members) {
    if (m.memberId === 'me' || m.isMe) continue;
    const name = clip(m.name);
    if (!name) continue;
    const remoteId = memberMap[m.memberId] ?? (fold.members[m.memberId] ? m.memberId : null);
    if (!remoteId) {
      const id = newId();
      memberMap[m.memberId] = id;
      events.push({ type: 'member.add', memberId: id, name });
    } else if (fold.members[remoteId] && fold.members[remoteId].name !== name) {
      events.push({ type: 'member.rename', memberId: remoteId, name });
    }
  }
  return { events, memberMap };
}

/** People not yet claimed by anyone — the "Which one are you?" list when joining. */
export const unclaimedMembers = (shared: GroupShared): { memberId: string; name: string }[] =>
  shared.fold.memberOrder
    .filter((id) => !shared.fold.members[id].userId && !shared.fold.members[id].archived)
    .map((id) => ({ memberId: id, name: shared.fold.members[id].name }));
