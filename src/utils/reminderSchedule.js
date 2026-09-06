// =============================================================================
// reminderSchedule — when does a reminder fire next?
// -----------------------------------------------------------------------------
// PURE. Zero imports, so the headless `.mjs` runner and the store can both use
// it (`utils/notifications.js` pulls in expo-notifications and loads in neither).
//
// WHY WE COMPUTE DATES OURSELVES instead of using a native repeating trigger:
// expo-notifications on SDK 50 offers DAILY / WEEKLY / YEARLY / CALENDAR triggers
// and **no MONTHLY one** — and `CalendarTriggerInput` is iOS-only. So "remind me
// on the 5th every month", the single most-wanted reminder in a money app, has no
// cross-platform native trigger at all.
//
// Rather than branch per platform per repeat kind (and inherit whatever each OS
// does with a short month), every reminder — one-off, weekly or monthly — is
// scheduled as plain one-off DATE triggers for its next few occurrences, and the
// queue is topped back up whenever the app opens (`reconcileReminders`). One code
// path, identical on both platforms, and fully testable here.
//
// The trade-off, stated plainly: a repeating reminder stays armed for
// QUEUE_DEPTH occurrences without the app being opened. Opening the app at any
// point re-arms it. That is strictly better than the alternative on Android
// (where monthly could not be scheduled at all) and it can never fire at the
// WRONG time — the failure mode is a missed reminder after months of never
// opening a finance app, not a wrong one.
// =============================================================================

/** Repeat rules a reminder can carry. `once` is the default. */
export const REPEAT = {
  ONCE:    'once',
  WEEKLY:  'weekly',
  MONTHLY: 'monthly',
};

export const REPEAT_VALUES = [REPEAT.ONCE, REPEAT.WEEKLY, REPEAT.MONTHLY];

/**
 * How many future occurrences of a REPEATING reminder we keep scheduled with the
 * OS at once. 3 is chosen against iOS's 64-pending-notification cap: even a user
 * with a dozen repeating reminders stays well under it, while still surviving a
 * couple of months of not opening the app.
 */
export const QUEUE_DEPTH = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days in a given month. `month` is 0-based, matching JS Date. */
export const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

/**
 * Next occurrence of a MONTHLY anchor, `monthsAhead` months after the anchor's
 * own month, with the day CLAMPED to that month's length.
 *
 * Clamping is the whole reason this is hand-rolled: `setMonth` overflows (Jan 31
 * + 1 month = Mar 3, silently skipping February), and a "monthly on the 31st"
 * reminder that skips February is a bug the user only finds by not being
 * reminded. Day 31 lands on Feb 28 — or 29 in a leap year, which `daysInMonth`
 * gets right because it asks the calendar rather than doing modulo arithmetic.
 */
const monthlyOccurrence = (anchor, monthsAhead) => {
  const y = anchor.getFullYear();
  const m = anchor.getMonth() + monthsAhead;
  // Normalise the year/month pair by hand — m may be ≥ 12 or negative.
  const year  = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const day   = Math.min(anchor.getDate(), daysInMonth(year, month));
  return new Date(year, month, day, anchor.getHours(), anchor.getMinutes(), 0, 0);
};

/**
 * The next `count` firing times (epoch ms, ascending) strictly after `from`.
 *
 * - `once`    → the anchor itself, or [] once it has passed.
 * - `weekly`  → same weekday + time as the anchor, every 7 days.
 * - `monthly` → same day-of-month + time as the anchor, clamped in short months.
 *
 * Times are built with the local-time `Date` constructor, so the wall-clock time
 * a user picked stays put across a DST shift instead of drifting by an hour.
 */
export const nextOccurrences = (anchorAt, repeat = REPEAT.ONCE, from = Date.now(), count = QUEUE_DEPTH) => {
  const anchorMs = Number(anchorAt);
  if (!Number.isFinite(anchorMs)) return [];

  if (repeat === REPEAT.ONCE) return anchorMs > from ? [anchorMs] : [];

  const wanted = Math.max(1, count);
  const out = [];

  if (repeat === REPEAT.WEEKLY) {
    // Step forward from the anchor in whole weeks. Starting from the anchor (not
    // from `now`) is what keeps the weekday and the time of day exact.
    let t = anchorMs;
    if (t <= from) {
      const weeksBehind = Math.ceil((from - t) / (7 * DAY_MS));
      t += weeksBehind * 7 * DAY_MS;
      // `ceil` can land exactly on `from`; one more week clears it.
      if (t <= from) t += 7 * DAY_MS;
    }
    for (let i = 0; i < wanted; i++) out.push(t + i * 7 * DAY_MS);
    return out;
  }

  if (repeat === REPEAT.MONTHLY) {
    const anchor = new Date(anchorMs);
    // Walk month by month from the anchor's own month. The bound is generous
    // rather than computed: a clamped day means occurrences aren't evenly
    // spaced, so there is no closed form to jump ahead with.
    let monthsAhead = 0;
    const monthsBehind =
      (new Date(from).getFullYear() - anchor.getFullYear()) * 12
      + (new Date(from).getMonth() - anchor.getMonth());
    if (monthsBehind > 0) monthsAhead = monthsBehind;
    for (let guard = 0; guard < 480 && out.length < wanted; guard++, monthsAhead++) {
      const t = monthlyOccurrence(anchor, monthsAhead).getTime();
      if (t > from) out.push(t);
    }
    return out;
  }

  return [];
};

/** The single next firing time (epoch ms), or `null` if there is none. */
export const nextOccurrence = (anchorAt, repeat = REPEAT.ONCE, from = Date.now()) =>
  nextOccurrences(anchorAt, repeat, from, 1)[0] ?? null;

/**
 * True when a reminder can never fire again — a one-off whose moment has passed.
 * A repeating reminder is never expired; that's the point of it.
 */
export const isReminderExpired = (reminder, from = Date.now()) => {
  if (!reminder) return true;
  const repeat = reminder.repeat || REPEAT.ONCE;
  if (repeat !== REPEAT.ONCE) return false;
  return Number(reminder.anchorAt) <= from;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Ordinal day-of-month: 5 → "5th". Matches ManageAccountModal's bill-cycle copy. */
const ordinal = (n) => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

/**
 * How the repeat rule reads in the UI — "Every Monday", "Monthly on the 5th".
 * The DAY comes from the anchor, so the label can never disagree with what was
 * actually scheduled.
 */
export const describeRepeat = (anchorAt, repeat = REPEAT.ONCE) => {
  const repeatRule = repeat || REPEAT.ONCE;
  if (repeatRule === REPEAT.ONCE) return 'Once';
  const d = new Date(Number(anchorAt));
  if (Number.isNaN(d.getTime())) return 'Once';
  if (repeatRule === REPEAT.WEEKLY) return `Every ${WEEKDAYS[d.getDay()]}`;
  if (repeatRule === REPEAT.MONTHLY) {
    const day = d.getDate();
    // Say so when the day gets clamped, rather than letting the user discover in
    // February that "the 31st" isn't a date every month has.
    const clampNote = day > 28 ? ' (or the last day, in shorter months)' : '';
    return `Monthly on the ${ordinal(day)}${clampNote}`;
  }
  return 'Once';
};
