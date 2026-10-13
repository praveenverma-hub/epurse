// =============================================================================
// When a phone posts a checkpoint (docs/SHARED_GROUP_SYNC.md §8b). PURE.
//
// After a quiet spell the next phone that syncs posts one; the server takes only the
// first (append_checkpoint checks the base seq), so several phones trying is fine.
// It keeps the group on the server for a year instead of 90 days from its last activity.
// =============================================================================

import {
  SHARED_CHECKPOINT_SETTLED_QUIET_MS, SHARED_CHECKPOINT_UNSETTLED_QUIET_MS,
} from '../constants/retention';
import type { GroupShared } from '../types/group';

/** When the group went quiet — older saved folds have no `lastAt`, so fall back to the newest entry version. */
function lastActivity(shared: GroupShared): number {
  const f = shared.fold;
  if (f.lastAt) return Date.parse(f.lastAt);
  let latest = NaN;
  for (const e of Object.values(f.entries)) {
    for (const v of e.versions) {
      const t = Date.parse(v.at);
      if (!(t <= latest)) latest = t;
    }
  }
  return latest;
}

export function checkpointDue(shared: GroupShared, nowMs: number): boolean {
  const f = shared.fold;
  if (shared.status !== 'active' || !shared.myMemberId || (shared.outbox ?? []).length) return false;
  // Nothing new since the last one; or this phone disagreed with one (don't argue with it).
  if (f.seq <= f.lastCheckpoint || f.checkpointMismatch != null) return false;
  const quiet = Object.keys(f.balances).length ? SHARED_CHECKPOINT_UNSETTLED_QUIET_MS : SHARED_CHECKPOINT_SETTLED_QUIET_MS;
  const at = lastActivity(shared);
  return Number.isFinite(at) && nowMs - at >= quiet;
}
