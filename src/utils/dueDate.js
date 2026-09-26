// =============================================================================
// dueDate — parse the due-date string a CC-bill SMS carries, plus billing-CYCLE
// math from the two day-of-month fields learned onto the account
// (`statementDay`/`dueDay` — see `applyCcCycleInfoToAccount` in the store).
// -----------------------------------------------------------------------------
// Extracted from `utils/notifications.js` (Aug-26) so it can be used off the
// notification path. That module imports expo-notifications, which cannot load
// in the headless test runner and isn't available to the store's own code paths;
// this is plain date arithmetic and belongs somewhere both can reach.
// `notifications.js` re-exports `parseDueDate` from here, so existing callers are
// unaffected and there is exactly one implementation.
// =============================================================================

import { daysInMonth } from './reminderSchedule';

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a CC-bill due-date string as surfaced by the parser (CC_DUE_DATE_REGEX):
 *   "05-Aug-26" / "5 Aug 2026" / "05-08-26" / "05/08/2026".
 * Returns a Date at 00:00 local, or null if it can't be parsed. Two-digit years
 * map to 2000+YY. Numeric form is treated as DD-MM-YY (Indian convention).
 */
export function parseDueDate(dueStr) {
  if (!dueStr) return null;
  const s = String(dueStr).trim();
  let m = s.match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3,9})[\/\-\s](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let yr = parseInt(m[3], 10);
    if (mon == null) return null;
    if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    let yr = parseInt(m[3], 10);
    if (mon < 0 || mon > 11) return null;
    if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Whole days from `nowMs` until midnight on the due date.
 * 0 = due today, negative = overdue. Null when the date can't be parsed.
 *
 * Both sides are floored to local midnight before subtracting, so "due in 1 day"
 * means "tomorrow" regardless of the time of day — comparing raw timestamps would
 * call a bill due tomorrow morning "0 days" at 11pm tonight.
 */
export function daysUntilDue(dueStr, nowMs = Date.now()) {
  const due = parseDueDate(dueStr);
  if (!due) return null;
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/** Hour of day a CC bill-due reminder fires at. */
export const CC_REMINDER_HOUR = 10;

/**
 * When a CC bill-due reminder should actually fire (epoch ms), or null if the
 * date is unparseable or there is no usable moment left: 10:00 the day BEFORE
 * the due date, falling back to 10:00 on the due date itself if that has passed.
 *
 * Lives here rather than inside `scheduleCCBillDueReminder` because the store
 * records the same moment on the reminder it shows the user. When the scheduler
 * owned this arithmetic privately and returned only a notification id, the
 * listed time and the scheduled time were two independent calculations of the
 * same thing — the classic way a UI ends up confidently displaying the wrong
 * date. One function, both callers.
 */
export function ccReminderFireAt(dueStr, nowMs = Date.now()) {
  const due = parseDueDate(dueStr);
  if (!due) return null;

  const dayBefore = new Date(due);
  dayBefore.setDate(due.getDate() - 1);
  dayBefore.setHours(CC_REMINDER_HOUR, 0, 0, 0);

  const onDue = new Date(due);
  onDue.setHours(CC_REMINDER_HOUR, 0, 0, 0);

  // A minute of headroom: scheduling for "now" is a race with the OS, which
  // silently drops a trigger already in the past.
  const floor = nowMs + 60_000;
  if (dayBefore.getTime() > floor) return dayBefore.getTime();
  if (onDue.getTime() > floor) return onDue.getTime();
  return null; // due date already here/passed — the in-app chip covers it
}

const DAY_MS = 86400000;

/** Midnight local time for `d` — every function below compares whole days. */
const atMidnight = (d) => {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
};

/**
 * The next calendar date landing on `day` (1-31), `from` inclusive. Clamped to
 * the month's real length via `daysInMonth` (imported from `reminderSchedule`,
 * the same clamping `monthlyOccurrence` uses there) — day 31 in February lands
 * on the 28th/29th rather than overflowing into March.
 */
export function nextOccurrenceOfDay(day, from = new Date()) {
  const today = atMidnight(from);
  const y = today.getFullYear();
  const m = today.getMonth();
  const thisMonth = new Date(y, m, Math.min(day, daysInMonth(y, m)));
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  const nextM = m + 1;
  const year = y + Math.floor(nextM / 12);
  const month = ((nextM % 12) + 12) % 12;
  return new Date(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Mirror of `nextOccurrenceOfDay`, looking backward — most recent occurrence
 *  of `day` on/before `from`, clamped the same way. */
export function previousOccurrenceOfDay(day, from = new Date()) {
  const today = atMidnight(from);
  const y = today.getFullYear();
  const m = today.getMonth();
  const thisMonth = new Date(y, m, Math.min(day, daysInMonth(y, m)));
  if (thisMonth.getTime() <= today.getTime()) return thisMonth;
  const prevM = m - 1;
  const year = y + Math.floor(prevM / 12);
  const month = ((prevM % 12) + 12) % 12;
  return new Date(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Whole days from `from` to the next occurrence of `day` (1-31). 0 = today. */
export function daysUntilDayOfMonth(day, from = new Date()) {
  return Math.round((nextOccurrenceOfDay(day, from).getTime() - atMidnight(from).getTime()) / DAY_MS);
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/** A stored date (ISO string / epoch ms / Date) as local midnight, or null. */
export const toDay = (v) => {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : atMidnight(d);
};

// An actual statement date within this many days of the one the recurring
// billing day predicts is the SAME statement — the real date wins (issuers
// shift a day or two for weekends/holidays).
const SAME_STATEMENT_WINDOW = 10;
// An actual date older than this with no recurring day to fall back on is a
// past cycle, not the current one.
const ACTUAL_STALE_DAYS = 45;
// A real due date more than this after its statement can't belong to it.
const DUE_MAX_AFTER_STATEMENT = 60;

/** Statement→due spans outside this read as a typo'd day, not a real issuer. */
export const PAYMENT_GAP_MIN_DAYS = 5;
export const PAYMENT_GAP_MAX_DAYS = 45;
export const isUnusualPaymentGap = (days) =>
  days != null && (days < PAYMENT_GAP_MIN_DAYS || days > PAYMENT_GAP_MAX_DAYS);

/**
 * The most recent statement date on/before `from`. Priority (the billing
 * spec): the ACTUAL date a bill SMS reported → the recurring billing day →
 * nothing. The actual date only wins while it's plausibly the current
 * statement; once a newer one is due by the recurring day, that takes over.
 */
export function resolveStatementDate({ statementDay, lastStatementDate } = {}, from = new Date()) {
  const today = atMidnight(from);
  const actual = toDay(lastStatementDate);
  const derived = statementDay ? previousOccurrenceOfDay(statementDay, today) : null;
  if (actual && actual.getTime() <= today.getTime()) {
    if (!derived) {
      return daysBetween(actual, today) <= ACTUAL_STALE_DAYS ? { date: actual, source: 'actual' } : null;
    }
    // Same statement (a day or two off), or a NEWER one than the recurring day
    // predicts (the issuer moved the cycle) — either way the real date wins.
    if (Math.abs(daysBetween(derived, actual)) <= SAME_STATEMENT_WINDOW || actual > derived) {
      return { date: actual, source: 'actual' };
    }
  }
  return derived ? { date: derived, source: 'derived' } : null;
}

/**
 * The due date belonging to `statementDate`: the real one from the bill SMS if
 * it fits after that statement, else the FIRST occurrence of `dueDay` after the
 * statement date (short months clamp to their last day).
 */
export function resolveDueDate({ dueDay, lastDueDate } = {}, statementDate) {
  if (!statementDate) return null;
  const actual = toDay(lastDueDate);
  if (actual && actual > statementDate && daysBetween(statementDate, actual) <= DUE_MAX_AFTER_STATEMENT) {
    return { date: actual, source: 'actual' };
  }
  if (!dueDay) return null;
  return { date: nextOccurrenceOfDay(dueDay, addDays(statementDate, 1)), source: 'derived' };
}

/** Days from a statement on `statementDay` to its due on `dueDay` — for the
 *  "unusual gap" warning on the add/edit forms, before any bill has arrived. */
export function paymentGapDays(statementDay, dueDay, from = new Date()) {
  if (!statementDay || !dueDay) return null;
  const stmt = previousOccurrenceOfDay(statementDay, from);
  return daysBetween(stmt, nextOccurrenceOfDay(dueDay, addDays(stmt, 1)));
}

/**
 * The window between the latest statement and ITS due date — "how long do I
 * have to pay this bill". `daysToDue` is signed (negative = the due date has
 * passed); `progress` is 0-1 across the window. Null without a statement date
 * or a due date to anchor it.
 */
export function currentPaymentWindow(account = {}, from = new Date()) {
  const today = atMidnight(from);
  const stmt = resolveStatementDate(account, today);
  if (!stmt) return null;
  const due = resolveDueDate(account, stmt.date);
  if (!due) return null;
  const total = daysBetween(stmt.date, due.date);
  const elapsed = Math.min(total, Math.max(0, daysBetween(stmt.date, today)));
  return {
    statementDate: stmt.date,
    dueDate: due.date,
    statementSource: stmt.source,
    dueSource: due.source,
    daysToDue: daysBetween(today, due.date),
    progress: total > 0 ? elapsed / total : 1,
    gapDays: total,
    gapUnusual: isUnusualPaymentGap(total),
  };
}

/**
 * The BILLING cycle today falls in — statement to next statement, the spend
 * period (billing day 18, today 26 Sep → 19 Sep – 18 Oct). A statement day is
 * the LAST day of the cycle it closes. The previous statement comes from the
 * actual date when known (same priority as `resolveStatementDate`).
 */
export function currentBillingCycle({ statementDay, lastStatementDate } = {}, from = new Date()) {
  const today = atMidnight(from);
  const actual = toDay(lastStatementDate);
  const day = statementDay || (actual ? actual.getDate() : null);
  if (!day) return null;
  const end = nextOccurrenceOfDay(day, today);
  let prev = previousOccurrenceOfDay(day, addDays(end, -1));
  if (actual && actual < end && (Math.abs(daysBetween(prev, actual)) <= SAME_STATEMENT_WINDOW || actual > prev)) {
    prev = actual;
  }
  const start = addDays(prev, 1);
  const total = daysBetween(start, end) + 1;
  const elapsed = daysBetween(start, today) + 1;
  return {
    start,
    end,
    progress: Math.min(1, Math.max(0, elapsed / total)),
    daysLeft: daysBetween(today, end),
    totalDays: total,
  };
}
