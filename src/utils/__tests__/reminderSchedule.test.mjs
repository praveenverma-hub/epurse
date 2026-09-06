// =============================================================================
// Reminder scheduling math — next occurrence(s) for once / weekly / monthly
// -----------------------------------------------------------------------------
//   npm run test:reminders
//
// Every reminder in the app is scheduled as explicit one-off dates computed HERE
// (see the header of reminderSchedule.js for why, in one line: SDK 50 has no
// cross-platform monthly trigger). So if this arithmetic is wrong, a repeating
// reminder fires on the wrong day — or, worse, silently skips a month.
//
// `from` is injected into every helper, so no assertion here changes meaning
// depending on the day the suite runs. Comparisons are on LOCAL calendar fields,
// never toISOString(): the times are built with the local-time Date constructor,
// and in IST a local midnight is 18:30Z the day before — asserting on the UTC
// string would fail here and pass in London for identical code (same lesson as
// dateRange.test.mjs).
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const {
  REPEAT, QUEUE_DEPTH, daysInMonth,
  nextOccurrences, nextOccurrence, isReminderExpired, describeRepeat,
} = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/reminderSchedule.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

/** Local-time constructor, mirroring how the util builds its dates. */
const at = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
/** "2026-09-12 09:00" for a readable failure message + field-wise comparison. */
const fmt = (ms) => {
  if (ms == null) return 'null';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtAll = (list) => list.map(fmt).join(' | ');

console.log(`\n${C.bold}══════ Reminder schedule ══════${C.reset}`);

// ── once ────────────────────────────────────────────────────────────────────
console.log('\n── once ──');
{
  const anchor = at(2026, 9, 12, 9, 0);
  const before = at(2026, 9, 10, 9, 0);
  const after  = at(2026, 9, 13, 9, 0);

  check('a future one-off returns exactly its own moment',
    fmtAll(nextOccurrences(anchor, REPEAT.ONCE, before)) === '2026-09-12 09:00',
    fmtAll(nextOccurrences(anchor, REPEAT.ONCE, before)));

  check('…and never more than one, whatever the count asked for',
    nextOccurrences(anchor, REPEAT.ONCE, before, 5).length === 1);

  check('a past one-off returns nothing', nextOccurrences(anchor, REPEAT.ONCE, after).length === 0);

  // The boundary that decides whether a reminder due *this instant* is still
  // scheduled or dropped as spent. Strictly-after keeps it out of the queue —
  // scheduling a notification for `now` is a race with the OS.
  check('the anchor moment itself counts as passed (strictly after)',
    nextOccurrences(anchor, REPEAT.ONCE, anchor).length === 0);

  check('nextOccurrence agrees with nextOccurrences',
    fmt(nextOccurrence(anchor, REPEAT.ONCE, before)) === '2026-09-12 09:00');

  check('a garbage anchor yields nothing rather than NaN dates',
    nextOccurrences(undefined, REPEAT.ONCE, before).length === 0
    && nextOccurrences(NaN, REPEAT.MONTHLY, before).length === 0);
}

// ── weekly ──────────────────────────────────────────────────────────────────
console.log('\n── weekly ──');
{
  // 2026-09-12 is a Saturday.
  const anchor = at(2026, 9, 12, 9, 0);
  check('the anchor really is a Saturday (fixture sanity)', new Date(anchor).getDay() === 6);

  const fromBefore = nextOccurrences(anchor, REPEAT.WEEKLY, at(2026, 9, 10));
  check('before the anchor: starts AT the anchor, then every 7 days',
    fmtAll(fromBefore) === '2026-09-12 09:00 | 2026-09-19 09:00 | 2026-09-26 09:00',
    fmtAll(fromBefore));

  check('the queue is QUEUE_DEPTH deep by default', fromBefore.length === QUEUE_DEPTH);

  // Weeks behind the anchor is where a naive `while` loop or a floor/ceil slip
  // shows up: a month later the next hit must still be a Saturday at 9:00.
  const fromLater = nextOccurrences(anchor, REPEAT.WEEKLY, at(2026, 10, 14, 12, 0));
  check('a month past the anchor: still Saturdays, still 09:00',
    fmtAll(fromLater) === '2026-10-17 09:00 | 2026-10-24 09:00 | 2026-10-31 09:00',
    fmtAll(fromLater));
  check('…and every one of them is a Saturday',
    fromLater.every((t) => new Date(t).getDay() === 6));

  // `ceil` can land exactly on `from`; the util adds one more week. Without that
  // guard this returns the current instant and the OS drops it.
  const exact = nextOccurrences(anchor, REPEAT.WEEKLY, at(2026, 9, 19, 9, 0));
  check('landing exactly on an occurrence moves to the NEXT one',
    fmt(exact[0]) === '2026-09-26 09:00', fmt(exact[0]));

  check('a same-day-but-earlier `from` still returns today',
    fmt(nextOccurrence(anchor, REPEAT.WEEKLY, at(2026, 9, 12, 8, 59))) === '2026-09-12 09:00');
}

// ── monthly ─────────────────────────────────────────────────────────────────
console.log('\n── monthly ──');
{
  const anchor = at(2026, 9, 5, 10, 30);
  const list = nextOccurrences(anchor, REPEAT.MONTHLY, at(2026, 9, 1));
  check('the 5th, three months running, time preserved',
    fmtAll(list) === '2026-09-05 10:30 | 2026-10-05 10:30 | 2026-11-05 10:30', fmtAll(list));

  check('once this month\'s has passed, it starts next month',
    fmt(nextOccurrence(anchor, REPEAT.MONTHLY, at(2026, 9, 6))) === '2026-10-05 10:30',
    fmt(nextOccurrence(anchor, REPEAT.MONTHLY, at(2026, 9, 6))));

  // THE case that makes this file exist. `setMonth(+1)` on Jan 31 yields Mar 3,
  // so a naive implementation skips February entirely — the user just isn't
  // reminded that month and nothing surfaces the miss.
  const jan31 = at(2026, 1, 31, 9, 0);
  const shortMonths = nextOccurrences(jan31, REPEAT.MONTHLY, at(2026, 1, 1), 4);
  check('the 31st clamps into short months instead of skipping them',
    fmtAll(shortMonths) === '2026-01-31 09:00 | 2026-02-28 09:00 | 2026-03-31 09:00 | 2026-04-30 09:00',
    fmtAll(shortMonths));

  check('…and February is never skipped (a naive setMonth would land on Mar 3)',
    shortMonths.some((t) => new Date(t).getMonth() === 1));

  // 2028 is a leap year: the same reminder must land on the 29th, not the 28th.
  const leap = nextOccurrences(at(2028, 1, 31, 9, 0), REPEAT.MONTHLY, at(2028, 2, 1), 1);
  check('a leap February clamps to the 29th, not the 28th',
    fmt(leap[0]) === '2028-02-29 09:00', fmt(leap[0]));
  check('daysInMonth asks the calendar (Feb 2028 = 29, Feb 2026 = 28)',
    daysInMonth(2028, 1) === 29 && daysInMonth(2026, 1) === 28);

  // Crossing a year boundary is the other place hand-rolled month arithmetic
  // breaks (month 12 must become January of the next year, not month 12).
  const yearEnd = nextOccurrences(at(2026, 11, 20, 8, 0), REPEAT.MONTHLY, at(2026, 11, 25), 3);
  check('rolls across the year boundary correctly',
    fmtAll(yearEnd) === '2026-12-20 08:00 | 2027-01-20 08:00 | 2027-02-20 08:00', fmtAll(yearEnd));

  // A long-dormant reminder (app not opened for a year) must resume on the right
  // day rather than replaying every missed month.
  const dormant = nextOccurrences(at(2026, 3, 15, 7, 0), REPEAT.MONTHLY, at(2027, 6, 20), 2);
  check('a year-dormant monthly resumes on the correct future day',
    fmtAll(dormant) === '2027-07-15 07:00 | 2027-08-15 07:00', fmtAll(dormant));
  check('…and never returns a time already in the past',
    dormant.every((t) => t > at(2027, 6, 20)));
}

// ── expiry ──────────────────────────────────────────────────────────────────
console.log('\n── expiry (what reconcile drops) ──');
{
  const past   = { repeat: REPEAT.ONCE,    anchorAt: at(2026, 9, 1) };
  const future = { repeat: REPEAT.ONCE,    anchorAt: at(2026, 9, 30) };
  const weekly = { repeat: REPEAT.WEEKLY,  anchorAt: at(2026, 9, 1) };
  const now    = at(2026, 9, 15);

  check('a spent one-off is expired', isReminderExpired(past, now));
  check('a pending one-off is not', !isReminderExpired(future, now));
  check('a repeating reminder is NEVER expired, however old its anchor',
    !isReminderExpired(weekly, now));
  check('a missing record is treated as expired rather than crashing',
    isReminderExpired(null, now) && isReminderExpired(undefined, now));
  check('a record with no repeat field defaults to once',
    isReminderExpired({ anchorAt: at(2026, 9, 1) }, now));
}

// ── labels ──────────────────────────────────────────────────────────────────
console.log('\n── repeat labels ──');
{
  check('once', describeRepeat(at(2026, 9, 12), REPEAT.ONCE) === 'Once');
  check('weekly names the anchor\'s own weekday',
    describeRepeat(at(2026, 9, 12), REPEAT.WEEKLY) === 'Every Saturday',
    describeRepeat(at(2026, 9, 12), REPEAT.WEEKLY));
  check('monthly names the anchor\'s own day, ordinalised',
    describeRepeat(at(2026, 9, 5), REPEAT.MONTHLY) === 'Monthly on the 5th',
    describeRepeat(at(2026, 9, 5), REPEAT.MONTHLY));
  check('…and 1st/2nd/3rd/11th/21st are ordinalised correctly',
    describeRepeat(at(2026, 9, 1), REPEAT.MONTHLY) === 'Monthly on the 1st'
    && describeRepeat(at(2026, 9, 2), REPEAT.MONTHLY) === 'Monthly on the 2nd'
    && describeRepeat(at(2026, 9, 3), REPEAT.MONTHLY) === 'Monthly on the 3rd'
    && describeRepeat(at(2026, 9, 11), REPEAT.MONTHLY) === 'Monthly on the 11th'
    && describeRepeat(at(2026, 9, 21), REPEAT.MONTHLY) === 'Monthly on the 21st');

  // The label has to admit the clamp — otherwise the user reads "Monthly on the
  // 31st" and finds out in February that it isn't every month.
  check('a >28 monthly day says so in the label',
    describeRepeat(at(2026, 1, 31), REPEAT.MONTHLY)
      === 'Monthly on the 31st (or the last day, in shorter months)',
    describeRepeat(at(2026, 1, 31), REPEAT.MONTHLY));
  check('…and a safe day carries no such note',
    !describeRepeat(at(2026, 9, 28), REPEAT.MONTHLY).includes('shorter'));

  check('a garbage anchor degrades to "Once" rather than "Every Invalid Date"',
    describeRepeat(NaN, REPEAT.WEEKLY) === 'Once');
}

console.log(`\n${C.bold}──────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}`);
if (fail) process.exit(1);
