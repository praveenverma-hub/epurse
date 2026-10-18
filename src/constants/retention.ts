// =============================================================================
// retention — how long ePurse keeps each kind of data, in ONE place. Change a
// number here and the store / backup / notification code follows; RETENTION_SUMMARY
// below is the plain-language table (checked against these values in test:retention).
//
// Financial history is KEPT until the user chooses to clean it up (Settings →
// Clean Up History). A clean-up folds those months into monthly totals
// ("aggregates") and drops the rows, so charts survive but the rows don't.
// =============================================================================

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// ── Transactions ─────────────────────────────────────────────────────────────
/** Transactions marked "ignored" (not real money movement) are dropped after this long. */
export const IGNORED_RETENTION_MS = 90 * DAY_MS;
/** Monthly totals (only written by a clean-up) kept this long; older months are deleted. */
export const AGG_RETENTION_MS = 3650 * DAY_MS;
/** Clean-up choices offered in Settings: "older than N years". */
export const CLEANUP_CHOICES_YEARS = [1, 2, 3, 5];
/** Goal figures for months older than this come from the month's rollover snapshot. */
export const GOAL_LIVE_WINDOW_MS = 90 * DAY_MS;
/** Compaction (ignored rows, debug SMS text, old totals) runs at most this often. */
export const COMPACT_THROTTLE = 6 * HOUR_MS;

// ── SMS bookkeeping ──────────────────────────────────────────────────────────
/** Card-payment prompts only fire for payments this recent; older SMS are ignored outright. */
export const CC_PROMPT_MAX_AGE_MS = 5 * DAY_MS;
/** Ignored/deleted SMS ids remembered so they're never re-imported (oldest dropped first). */
export const SUPPRESS_SMS_CAP = 2500;
/** Preview builds only: the full SMS text kept on a transaction for the debug sheet. */
export const RAW_SMS_RETENTION_MS = 3 * DAY_MS;

// ── Per-item caps ────────────────────────────────────────────────────────────
/** Payments remembered per credit card (oldest dropped first). */
export const PAYMENT_HISTORY_CAP = 24;
/** Notification-feed entries are dropped after this long — one billing cycle / budget month… */
export const NOTIFICATION_MAX_AGE_MS = 30 * DAY_MS;
/** …and only this many are kept (newest first). */
export const NOTIFICATION_MAX_ENTRIES = 80;
/** Unreviewed SMS shown to a new user at onboarding; the rest are marked reviewed. */
export const ONBOARDING_QUEUE_LIMIT = 5;

// ── Backups ──────────────────────────────────────────────────────────────────
/** Drive backups kept; older ones are pruned after a successful upload. */
export const KEEP_BACKUPS = 5;
/** The local copy taken just before a restore (for Undo) is deleted after this long. */
export const PRE_RESTORE_SNAPSHOT_MS = 7 * DAY_MS;

// ── Shared groups on the server (docs/SHARED_GROUP_SYNC.md §8b) ──────────────
/** A settled group with no activity this long gets a checkpoint from the next phone that syncs. */
export const SHARED_CHECKPOINT_SETTLED_QUIET_MS = 7 * DAY_MS;
/** Same for a group with money still owed. */
export const SHARED_CHECKPOINT_UNSETTLED_QUIET_MS = 30 * DAY_MS;
/**
 * Quiet this long, a group goes dormant: the server keeps it, its members and its latest
 * checkpoint, and drops older events; the next change wakes it. Groups never end from
 * inactivity. Mirrors `append_events` / `purge_expired` (20261016000000_dormant_groups.sql).
 */
export const SHARED_SERVER_IDLE_MS = 90 * DAY_MS;

const days = (ms: number) => Math.round(ms / DAY_MS);

/** Plain-language table of everything above — for docs and a quick read. */
export const RETENTION_SUMMARY: { data: string; keeps: string; then: string }[] = [
  { data: 'Transactions', keeps: 'until you clean up', then: 'folded into monthly totals, row dropped' },
  { data: 'Monthly totals', keeps: `${days(AGG_RETENTION_MS) / 365} years`, then: 'deleted' },
  { data: 'Ignored transactions', keeps: `${days(IGNORED_RETENTION_MS)} days`, then: 'dropped (never counted in totals)' },
  { data: 'Settled lent / borrowed', keeps: 'until you clean up', then: 'dropped only when a person nets to zero' },
  { data: 'Outstanding lent / borrowed', keeps: 'until settled', then: 'never dropped' },
  { data: 'Settled groups', keeps: 'until you clean up', then: 'removed (any debt keeps a group)' },
  { data: 'Card-payment prompts', keeps: `${days(CC_PROMPT_MAX_AGE_MS)} days`, then: 'older payments ignored' },
  { data: 'Ignored SMS ids', keeps: `last ${SUPPRESS_SMS_CAP}`, then: 'oldest dropped' },
  { data: 'Card payment history', keeps: `last ${PAYMENT_HISTORY_CAP} per card`, then: 'oldest dropped' },
  { data: 'Notification feed', keeps: `${days(NOTIFICATION_MAX_AGE_MS)} days, last ${NOTIFICATION_MAX_ENTRIES}`, then: 'dropped' },
  { data: 'Drive backups', keeps: `latest ${KEEP_BACKUPS}`, then: 'older ones deleted after an upload' },
  { data: 'Pre-restore copy (for Undo)', keeps: `${days(PRE_RESTORE_SNAPSHOT_MS)} days`, then: 'deleted; Undo no longer offered' },
  { data: 'Full SMS text (preview builds)', keeps: `${days(RAW_SMS_RETENTION_MS)} days`, then: 'stripped' },
  { data: 'Shared group on the server', keeps: 'while anyone is in it', then: 'gone when everyone has left or deleted their account' },
  { data: 'Shared group history on the server', keeps: `${days(SHARED_SERVER_IDLE_MS)} days after last activity`, then: 'only the latest checkpoint is kept (who owes whom); every phone keeps its full copy' },
];
