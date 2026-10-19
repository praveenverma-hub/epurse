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
    // A deleted account is a past member here too: out of new splits, under Past Members.
    const gone = m.archived || (!!m.userId && shared.fold.deletedUsers.includes(m.userId));
    out.push({
      memberId: localId,
      name: m.name,
      contactId: prev?.contactId ?? null,
      phone: prev?.phone ?? null,
      // Linked to a contact on this phone — local only, kept across every pull.
      ...(prev?.contactName ? { contactName: prev.contactName } : {}),
      ...(prev?.noContact ? { noContact: true } : {}),
      ...(gone ? { archived: true } : {}),
    });
    seen.add(localId);
  }
  // Not on the server yet (unsent, or sent and not pulled back) — keep them, contact and all.
  // Not one that IS there under its own id: e.g. the person I just claimed.
  for (const m of local) {
    if (m.memberId === 'me' || m.isMe || seen.has(m.memberId)) continue;
    if (!shared.fold.members[shared.memberMap[m.memberId] ?? m.memberId]) out.push(m);
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
  /** Phone → fingerprint (sync/phoneKey.ts); omitted = send none. Injected so this stays fast in tests. */
  keyOf?: (phone: string) => string | null,
  /** My own number (Profile) — without its fingerprint nobody else can show me under their contact name. */
  myPhone?: string | null,
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

  // Sent again when I change my number — the group must hold the CURRENT one.
  const me = shared.myMemberId;
  if (me && myPhone && keyOf && fold.members[me] && !fold.members[me].archived) {
    const key = keyOf(myPhone);
    if (key && fold.phoneKeys?.[me] !== key) events.push({ type: 'member.phone', memberId: me, phoneKey: key });
  }

  for (const m of group.members) {
    if (m.memberId === 'me' || m.isMe) continue;
    const name = clip(m.name);
    if (!name) continue;
    const remoteId = memberMap[m.memberId] ?? (fold.members[m.memberId] ? m.memberId : null);
    // A number known here (picked from contacts, or linked later) → its fingerprint, so the
    // other phones can link this person to their own contacts. Slow, so only when it's sent.
    const keyFor = () => (keyOf && m.phone ? keyOf(m.phone) : null);
    if (!remoteId) {
      const id = newId();
      memberMap[m.memberId] = id;
      const key = keyFor();
      events.push({ type: 'member.add', memberId: id, name, ...(key ? { phoneKey: key } : {}) });
    } else if (fold.members[remoteId]) {
      if (fold.members[remoteId].name !== name) events.push({ type: 'member.rename', memberId: remoteId, name });
      if (m.phone && !fold.phoneKeys?.[remoteId] && !fold.members[remoteId].archived) {
        const key = keyFor();
        if (key) events.push({ type: 'member.phone', memberId: remoteId, phoneKey: key });
      }
    }
  }
  return { events, memberMap };
}

/** People nobody has joined as yet — who an invite can be for. */
export const unclaimedMembers = (shared: GroupShared): { memberId: string; name: string }[] =>
  shared.fold.memberOrder
    .filter((id) => !shared.fold.members[id].userId && !shared.fold.members[id].archived)
    .map((id) => ({ memberId: id, name: shared.fold.members[id].name }));

export type MemberStatus = {
  /** null for me — my row already says "You". */
  tag: 'Joined' | 'Not Joined' | 'Left' | 'Deleted Account' | 'Member' | null;
  /** Opened the group on their own phone at some point. */
  joined: boolean;
  canRemove: boolean;
  canAddBack: boolean;
};

/**
 * One person's row in the Members tab: their tag and what I may do about them. `shared` is
 * the group's sync state (absent for a group never shared). No admin: every member may
 * remove someone (at ₹0) or add a former member back — it's a money record between people
 * who trust each other, not a chat group (decided Oct-15-2026).
 */
export function memberStatus(shared: GroupShared | undefined, m: Pick<GroupMember, 'memberId' | 'isMe' | 'archived'>): MemberStatus {
  const none = { joined: false, canRemove: false, canAddBack: false };
  if (!shared) return { ...none, tag: m.isMe ? null : 'Member' };
  const live = shared.status !== 'ended';
  const userId = shared.fold.members[toRemoteMember(shared, m.memberId)]?.userId ?? null;
  const joined = !!userId || !!m.isMe;
  const hasAccess = !!userId && shared.fold.activeUsers.includes(userId);
  const deleted = !!userId && shared.fold.deletedUsers.includes(userId);

  const tag: MemberStatus['tag'] = m.isMe ? null
    : deleted ? 'Deleted Account'
    : m.archived ? 'Left'
    : joined ? 'Joined' : 'Not Joined';
  if (!live || m.isMe) return { ...none, tag, joined };
  return {
    tag,
    joined,
    // Archived but still with access = a removal whose server step failed: offered again to retry.
    canRemove: !m.archived || hasAccess,
    canAddBack: !!m.archived && !!userId && !hasAccess && !deleted,
  };
}
