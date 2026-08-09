// =============================================================================
// Activity → Filter → Date Range — calendar-month + custom-range logic
// -----------------------------------------------------------------------------
//   npm run test:dateRange
//
// Calendar arithmetic reads as obviously correct and is off by one day at the
// boundaries. Every case here pins a boundary: the first instant of a month, the
// last instant, the 31st (where naive setMonth overflows), and a custom range's
// end DAY being inclusive while its end BOUND is exclusive.
//
// `now` is injected into every helper, so these assertions don't change meaning
// depending on the day the suite runs.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const { monthStart, resolveRange, inRange, buildDateRangeOptions } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/dateRange.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const iso = (s) => new Date(s).toISOString();

// Compare LOCAL calendar fields, never toISOString(): a month boundary is local
// midnight, which in IST is 18:30Z on the previous day. Asserting on the UTC
// string would fail here and pass in London for code that is identical — and the
// filter must mean the user's August, not UTC's.
const isLocalMidnight = (d, y, m, day) =>
  d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day &&
  d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
const show = (d) => d.toString().slice(0, 24);

console.log(`\n${C.bold}══════ Activity date-range filter ══════${C.reset}\n`);

// A deliberately awkward "today": the 31st, in a month that follows a 30-day
// month, at nearly midnight.
const NOW = new Date('2026-08-31T23:30:00');

// ── monthStart ──
{
  check('monthStart(0) = 1st of this month at local 00:00',
    isLocalMidnight(monthStart(0, NOW), 2026, 8, 1), show(monthStart(0, NOW)));

  // The bug this guards: on the 31st, `setMonth(getMonth() - 1)` against a
  // 30-day target overflows into the month AFTER the one intended
  // (31 Mar → "31 Feb" → 3 Mar). Anchoring to the 1st first prevents it.
  check('monthStart(-1) from the 31st = 1st of last month',
    isLocalMidnight(monthStart(-1, NOW), 2026, 7, 1), show(monthStart(-1, NOW)));
  const mar31 = new Date('2026-03-31T12:00:00');
  check('monthStart(-1) from 31 Mar = 1 Feb (no short-month overflow)',
    isLocalMidnight(monthStart(-1, mar31), 2026, 2, 1), show(monthStart(-1, mar31)));
  const jan15 = new Date('2026-01-15T12:00:00');
  check('monthStart(-2) crosses a year boundary',
    isLocalMidnight(monthStart(-2, jan15), 2025, 11, 1), show(monthStart(-2, jan15)));
}

// ── This / Last / month-before-last are disjoint and complete ──
{
  const mThis = resolveRange('mThis', null, NOW);
  const mLast = resolveRange('mLast', null, NOW);
  const mPrev = resolveRange('mPrev', null, NOW);

  check('mLast ends exactly where mThis starts (no gap, no overlap)',
    mLast.end.getTime() === mThis.start.getTime());
  check('mPrev ends exactly where mLast starts',
    mPrev.end.getTime() === mLast.start.getTime());

  // Boundary instants — the ones a cutoff-based filter got wrong.
  check('first instant of August is in This Month',   inRange(iso('2026-08-01T00:00:00'), mThis));
  check('last instant of July is NOT in This Month',  !inRange(iso('2026-07-31T23:59:59'), mThis));
  check('last instant of July IS in Last Month',      inRange(iso('2026-07-31T23:59:59'), mLast));
  check('first instant of August is NOT in Last Month', !inRange(iso('2026-08-01T00:00:00'), mLast));
  check('30 June is in the month before last',        inRange(iso('2026-06-30T18:00:00'), mPrev));
  check('1 July is NOT in the month before last',     !inRange(iso('2026-07-01T00:00:01'), mPrev));

  // Every day belongs to exactly one of the three.
  let overlaps = 0;
  for (const d of ['2026-06-05', '2026-07-04', '2026-08-03', '2026-08-31']) {
    const n = [mThis, mLast, mPrev].filter((r) => inRange(iso(`${d}T09:00:00`), r)).length;
    if (n !== 1) overlaps++;
  }
  check('each sample day falls in exactly one of the three months', overlaps === 0);

  // A txn later today must still count as This Month (why mThis has no end).
  check('a txn later today is still in This Month', inRange(iso('2026-08-31T23:59:59'), mThis));
}

// ── Custom range ──
{
  const r = resolveRange('custom', { from: new Date('2026-05-10T15:00:00'), to: new Date('2026-05-12T02:00:00') }, NOW);

  check('custom: start is local midnight of the FROM day',
    isLocalMidnight(r.start, 2026, 5, 10), show(r.start));
  check('custom: a txn at 00:05 on the from-day is included',
    inRange(iso('2026-05-10T00:05:00'), r));
  check('custom: the day BEFORE the range is excluded',
    !inRange(iso('2026-05-09T23:59:59'), r));
  // The end day is INCLUSIVE even though the bound is exclusive — picking
  // 12 May must include everything that happened on the 12th.
  check('custom: 23:59 on the TO day is included (end day inclusive)',
    inRange(iso('2026-05-12T23:59:59'), r));
  check('custom: the day after the TO day is excluded',
    !inRange(iso('2026-05-13T00:00:00'), r));

  const inverted = resolveRange('custom', { from: new Date('2026-05-12'), to: new Date('2026-05-10') }, NOW);
  check('custom: an inverted range is swapped, not empty',
    inverted.start.getTime() === r.start.getTime() && inverted.end.getTime() === r.end.getTime());

  const sameDay = resolveRange('custom', { from: new Date('2026-05-10T08:00'), to: new Date('2026-05-10T20:00') }, NOW);
  check('custom: from === to selects that whole single day',
    inRange(iso('2026-05-10T00:00:00'), sameDay) &&
    inRange(iso('2026-05-10T23:59:59'), sameDay) &&
    !inRange(iso('2026-05-11T00:00:00'), sameDay));

  check('custom: incomplete range returns null (filter is skipped, nothing hidden)',
    resolveRange('custom', { from: new Date(), to: null }, NOW) === null &&
    resolveRange('custom', null, NOW) === null);
}

// ── Rolling options still roll ──
{
  const wk = resolveRange('week', null, NOW);
  check('week: still a rolling 7 days, not a calendar week',
    wk.end === null && inRange(iso('2026-08-26T12:00:00'), wk) && !inRange(iso('2026-08-20T12:00:00'), wk));
  check('year1: reaches back across the year boundary',
    inRange(iso('2025-10-01T12:00:00'), resolveRange('year1', null, NOW)));
}

// ── Guards ──
{
  check('an unknown id returns null rather than an empty range',
    resolveRange('month3', null, NOW) === null);   // the old id — must not silently match
  check('a txn with an unparseable date is excluded, not crashed on',
    inRange('not-a-date', resolveRange('mThis', null, NOW)) === false);
  check('no range = everything passes', inRange(iso('2020-01-01'), null) === true);
}

// ── Option rows ──
{
  const opts = buildDateRangeOptions(null, NOW);
  check('option ids are the six expected',
    opts.map((o) => o.id).join(',') === 'week,mThis,mLast,mPrev,year1,custom',
    opts.map((o) => o.id).join(','));
  check('month names are derived from `now`',
    opts[1].sublabel === 'August 2026' && opts[2].sublabel === 'July 2026' && opts[3].label === 'June 2026',
    `${opts[1].sublabel} / ${opts[2].sublabel} / ${opts[3].label}`);
  check('custom row prompts when unset',
    opts[5].sublabel === 'Pick a start and end date');
  check('custom row summarises the picked dates',
    buildDateRangeOptions({ from: new Date('2026-05-10'), to: new Date('2026-05-12') }, NOW)[5]
      .sublabel.includes('→'));
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
