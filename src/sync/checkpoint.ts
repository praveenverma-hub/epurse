// =============================================================================
// When a phone posts a checkpoint (docs/SHARED_GROUP_SYNC.md §8b). PURE.
//
// After a quiet spell the next phone that syncs posts one; the server takes only the
// first (append_checkpoint checks the base seq), so several phones trying is fine.
// It's what a dormant group keeps on the server (§9) and where late joiners start.
// =============================================================================

import {
  SHARED_CHECKPOINT_SETTLED_QUIET_MS, SHARED_CHECKPOINT_UNSETTLED_QUIET_MS,
} from '../constants/retention';
import type { GroupShared } from '../types/group';

export function checkpointDue(shared: GroupShared, nowMs: number): boolean {
  const f = shared.fold;
  if (shared.status !== 'active' || !shared.myMemberId || (shared.outbox ?? []).length) return false;
  // Nothing new since the last one; or this phone disagreed with one (don't argue with it).
  if (f.seq <= f.lastCheckpoint || f.checkpointMismatch != null) return false;
  const quiet = Object.keys(f.balances).length ? SHARED_CHECKPOINT_UNSETTLED_QUIET_MS : SHARED_CHECKPOINT_SETTLED_QUIET_MS;
  const at = Date.parse(f.lastAt ?? '');   // when the group went quiet (server time)
  return Number.isFinite(at) && nowMs - at >= quiet;
}
