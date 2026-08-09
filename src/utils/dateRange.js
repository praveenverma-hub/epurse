// =============================================================================
// Date-range filter helpers (Activity tab → Filter → Date Range).
//
// Pure and dependency-free so the headless `.mjs` runner can import them: this
// is calendar arithmetic, which is exactly the kind of code that looks obviously
// right and is off by one day at a month boundary.
//
// Calendar months, NOT rolling windows. "August" is what a bank statement, the
// Budget screen and the Analytics tab all mean by a month; "past 30 days"
// straddles two of them and shifts every day, so the same filter answered a
// different question depending on when you opened it. The rolling options that
// remain (`week`, `year1`) are deliberately rolling — nobody means "since
// 1 January" by "last year" on a ledger.
//
// Because a calendar month has an END, every range is `{ start, end }`. This
// replaced a bare cutoff, which could only express "newer than X".
//
// Every function takes `now` so tests are deterministic — without it the suite
// would pass or fail depending on the day it runs.
// =============================================================================
import { formatDateLabel } from './format';

/** Midnight on the 1st, `offset` months from `now`'s month. */
export function monthStart(offset, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // setDate(1) BEFORE setMonth: on the 31st, `setMonth(d.getMonth() - 1)` on a
  // 30-day target month overflows into the month AFTER the one intended
  // (31 Mar → "31 Feb" → 3 Mar). Anchoring to the 1st first makes it exact.
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d;
}

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Exclusive upper bound: the whole of the chosen end day is included. */
export const dayAfter = (d) => { const x = startOfDay(d); x.setDate(x.getDate() + 1); return x; };

export function pastDate(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

const monthName = (d) => d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/** Option rows for the filter panel. Month names come from `now`, so they never go stale. */
export function buildDateRangeOptions(custom, now = new Date()) {
  return [
    { id: 'week',  label: 'Last Week',  sublabel: 'Past 7 days' },
    { id: 'mThis', label: 'This Month', sublabel: monthName(monthStart(0, now)) },
    { id: 'mLast', label: 'Last Month', sublabel: monthName(monthStart(-1, now)) },
    { id: 'mPrev', label: monthName(monthStart(-2, now)), sublabel: 'Month before last' },
    { id: 'year1', label: 'Last 1 Year', sublabel: 'Past 365 days' },
    {
      id: 'custom',
      label: 'Custom range…',
      sublabel: custom?.from && custom?.to
        ? `${formatDateLabel(custom.from)} → ${formatDateLabel(custom.to)}`
        : 'Pick a start and end date',
    },
  ];
}

/**
 * `{ start, end }` for a range id; `end: null` means "no upper bound".
 * Returns null for an unknown id or an incomplete custom range — callers treat
 * null as "don't filter", which is the safe direction (show everything rather
 * than silently hide rows).
 */
export function resolveRange(rangeId, custom, now = new Date()) {
  switch (rangeId) {
    case 'week':  return { start: pastDate(7, now),   end: null };
    case 'year1': return { start: pastDate(365, now), end: null };
    // No end bound: transactions can't be dated in the future, and leaving it
    // open means a txn added later today is still inside "This Month".
    case 'mThis': return { start: monthStart(0, now),  end: null };
    case 'mLast': return { start: monthStart(-1, now), end: monthStart(0, now) };
    case 'mPrev': return { start: monthStart(-2, now), end: monthStart(-1, now) };
    case 'custom': {
      if (!custom?.from || !custom?.to) return null;
      // Tolerate an inverted range rather than showing nothing: the pickers are
      // independent, so choosing the end date first is an easy mistake to make.
      const a = startOfDay(custom.from);
      const b = startOfDay(custom.to);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { start: lo, end: dayAfter(hi) };
    }
    default: return null;
  }
}

/** True if `iso` falls inside `range`. End is EXCLUSIVE. */
export function inRange(iso, range) {
  if (!range) return true;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts >= range.start.getTime() && ts < (range.end ? range.end.getTime() : Infinity);
}
