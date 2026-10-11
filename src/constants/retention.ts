// =============================================================================
// retention — how long ePurse keeps each kind of data, in ONE place. Change a
// number here and the store / backup / notification code follows; RETENTION_SUMMARY
// below is the plain-language table (checked against these values in test:retention).
//
// "Raw" = the full transaction row. Older spend is folded into monthly totals
// ("aggregates") and the raw rows are dropped, so history charts survive but
// individual rows (and their notes, merchants, SMS text) don't.
// =============================================================================

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// ── Transactions ─────────────────────────────────────────────────────────────
/** Raw transactions kept this long; older ones fold into monthly totals, then drop. */
export const RAW_RETENTION_MS = 90 * DAY_MS;
/** Monthly totals kept this long; older months are deleted. */
export const AGG_RETENTION_MS = 730 * DAY_MS;
/** Settled lent/borrow (rows and tagged transactions): kept this long from when RECORDED, never folded into totals. */
export const LB_SETTLED_RETENTION_MS = 730 * DAY_MS;
/** Compaction (the clean-up that applies the limits above) runs at most this often. */
export const COMPACT_THROTTLE = 6 * HOUR_MS;

// ── Groups ───────────────────────────────────────────────────────────────────
/** A group untouched this long AND fully settled is removed. Anyone still owing keeps it alive. */
export const GROUP_INACTIVE_PRUNE_MS = 180 * DAY_MS;

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
/** Notification-feed entries are dropped after this long… */
export const NOTIFICATION_MAX_AGE_MS = 15 * DAY_MS;
/** …and only this many are kept (newest first). */
export const NOTIFICATION_MAX_ENTRIES = 80;
/** Unreviewed SMS shown to a new user at onboarding; the rest are marked reviewed. */
export const ONBOARDING_QUEUE_LIMIT = 5;

// ── Backups ──────────────────────────────────────────────────────────────────
/** Drive backups kept; older ones are pruned after a successful upload. */
export const KEEP_BACKUPS = 5;
/** The local copy taken just before a restore (for Undo) is deleted after this long. */
export const PRE_RESTORE_SNAPSHOT_MS = 7 * DAY_MS;

const days = (ms: number) => Math.round(ms / DAY_MS);

/** Plain-language table of everything above — for docs and a quick read. */
export const RETENTION_SUMMARY: { data: string; keeps: string; then: string }[] = [
  { data: 'Transactions', keeps: `${days(RAW_RETENTION_MS)} days`, then: 'folded into monthly totals, row dropped' },
  { data: 'Monthly totals', keeps: `${days(AGG_RETENTION_MS)} days`, then: 'deleted' },
  { data: 'Ignored transactions', keeps: `${days(RAW_RETENTION_MS)} days`, then: 'dropped (never counted in totals)' },
  { data: 'Settled lent / borrowed', keeps: `${days(LB_SETTLED_RETENTION_MS)} days`, then: 'dropped' },
  { data: 'Outstanding lent / borrowed', keeps: 'until settled', then: 'never dropped' },
  { data: 'Split transactions', keeps: `${days(RAW_RETENTION_MS)} days`, then: 'folded like any other' },
  { data: 'Settled, inactive groups', keeps: `${days(GROUP_INACTIVE_PRUNE_MS)} days idle`, then: 'removed (any debt keeps a group)' },
  { data: 'Card-payment prompts', keeps: `${days(CC_PROMPT_MAX_AGE_MS)} days`, then: 'older payments ignored' },
  { data: 'Ignored SMS ids', keeps: `last ${SUPPRESS_SMS_CAP}`, then: 'oldest dropped' },
  { data: 'Card payment history', keeps: `last ${PAYMENT_HISTORY_CAP} per card`, then: 'oldest dropped' },
  { data: 'Notification feed', keeps: `${days(NOTIFICATION_MAX_AGE_MS)} days, last ${NOTIFICATION_MAX_ENTRIES}`, then: 'dropped' },
  { data: 'Drive backups', keeps: `latest ${KEEP_BACKUPS}`, then: 'older ones deleted after an upload' },
  { data: 'Pre-restore copy (for Undo)', keeps: `${days(PRE_RESTORE_SNAPSHOT_MS)} days`, then: 'deleted; Undo no longer offered' },
  { data: 'Full SMS text (preview builds)', keeps: `${days(RAW_SMS_RETENTION_MS)} days`, then: 'stripped' },
];
