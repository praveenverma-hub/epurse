// =============================================================================
// dueDate — parse the due-date string a CC-bill SMS carries.
// -----------------------------------------------------------------------------
// Extracted from `utils/notifications.js` (Aug-26) so it can be used off the
// notification path. That module imports expo-notifications, which cannot load
// in the headless test runner and isn't available to the store's own code paths;
// this is plain date arithmetic and belongs somewhere both can reach.
// `notifications.js` re-exports `parseDueDate` from here, so existing callers are
// unaffected and there is exactly one implementation.
// =============================================================================

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
