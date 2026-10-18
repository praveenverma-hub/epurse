// =============================================================================
// Where a group's sharing stands, for the Groups list card's status line.
// =============================================================================
import type { Group } from '../types/group';

export type GroupSyncStatus = 'personal' | 'local' | 'waiting' | 'invited' | 'live' | 'ended';

/**
 * personal — a personal group (no sharing at all)
 * local    — a shared-type group nobody has been invited to yet: lives only on this phone
 * waiting  — live, but created offline or holding changes not sent yet
 * invited  — live, but nobody else has joined yet (only my phone has it in practice)
 * live     — syncing with the other members
 * ended    — I left / was removed / everyone else left; kept to read
 */
export function groupSyncStatus(group: Pick<Group, 'type' | 'shared'>): GroupSyncStatus {
  if (group.type !== 'shared') return 'personal';
  const sh = group.shared;
  if (!sh) return 'local';
  if (sh.status === 'ended') return 'ended';
  // Sent items stay in the outbox (with their seq) until folded — only unsent ones are "waiting".
  if (sh.status === 'pending' || (sh.outbox || []).some((o) => o.seq == null)) return 'waiting';
  // A member joins by claiming their row (userId); mine is one of them.
  const joined = Object.values(sh.fold?.members || {}).filter((m) => m.userId).length;
  return joined <= 1 ? 'invited' : 'live';
}

export const GROUP_SYNC_LABEL: Record<Exclude<GroupSyncStatus, 'personal'>, string> = {
  local: 'Only on your phone',
  waiting: 'Waiting to sync',
  invited: 'No one joined yet',
  live: 'Live',
  ended: 'Ended',
};
