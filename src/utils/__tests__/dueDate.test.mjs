// =============================================================================
// dueDate — day-of-month cycle math: occurrences, the statement→due PAYMENT
// window, the statement→statement BILLING cycle, actual-date priority, and the
// unusual-gap warning (the credit-card billing spec).
//   npm run test:dueDate
//
// Every case injects a fixed `from` — never `Date.now()` — so these assertions
// never depend on the day the suite happens to run (see dateRange.test.mjs's
// own header note on why that discipline matters here).
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const {
  nextOccurrenceOfDay, daysUntilDayOfMonth, currentPaymentWindow, currentBillingCycle,
  resolveStatementDate, resolveDueDate, paymentGapDays, isUnusualPaymentGap,
} = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/dueDate.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const isDate = (d, y, m, day) => d.getFullYear() === y && d.getMonth() === m && d.getDate() === day;
const show = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

console.log(`\n${C.bold}══════ dueDate — bill-cycle math ══════${C.reset}\n`);

// ── nextOccurrenceOfDay ──────────────────────────────────────────────────────
{
  const from = new Date(2026, 2, 10); // March 10, 2026
  const stillAhead = nextOccurrenceOfDay(15, from);
  check('a day still ahead this month resolves in THIS month', isDate(stillAhead, 2026, 2, 15), show(stillAhead));

  const today = nextOccurrenceOfDay(10, from);
  check('the day matching today is inclusive — returns today, not next month', isDate(today, 2026, 2, 10), show(today));

  const alreadyPassed = nextOccurrenceOfDay(5, from);
  check('a day already passed this month rolls to NEXT month', isDate(alreadyPassed, 2026, 3, 5), show(alreadyPassed));

  const shortMonth = nextOccurrenceOfDay(31, new Date(2026, 1, 5)); // Feb 2026 — not a leap year
  check('day 31 clamps to Feb 28 in a non-leap year', isDate(shortMonth, 2026, 1, 28), show(shortMonth));

  const leapMonth = nextOccurrenceOfDay(31, new Date(2024, 1, 5)); // Feb 2024 — a leap year
  check('day 31 clamps to Feb 29 in a leap year', isDate(leapMonth, 2024, 1, 29), show(leapMonth));
}

// ── daysUntilDayOfMonth ───────────────────────────────────────────────────────
{
  const from = new Date(2026, 2, 10); // March 10, 2026
  check('the day itself is 0 days away', daysUntilDayOfMonth(10, from) === 0, `${daysUntilDayOfMonth(10, from)}`);
  check('tomorrow is 1 day away', daysUntilDayOfMonth(11, from) === 1, `${daysUntilDayOfMonth(11, from)}`);
  // March 10 -> April 5: 21 days left in March (31-10) + 5 = 26.
  check('a day next month counts the FULL remaining span', daysUntilDayOfMonth(5, from) === 26, `${daysUntilDayOfMonth(5, from)}`);
}

// ── currentPaymentWindow — statement → ITS due date ─────────────────────────
// Bills on the 20th, due on the 7th — the due day is numerically SMALLER than
// the statement day, so the due date belonging to a statement falls in the
// FOLLOWING month ("first occurrence of the due day after the statement").
{
  const mid = currentPaymentWindow({ statementDay: 20, dueDay: 7 }, new Date(2026, 2, 25)); // Mar 25
  check('statement is THIS month\'s statement day', isDate(mid.statementDate, 2026, 2, 20), show(mid.statementDate));
  check('due rolls into NEXT month', isDate(mid.dueDate, 2026, 3, 7), show(mid.dueDate));
  check('progress is 5 of 18 days', Math.abs(mid.progress - 5 / 18) < 1e-9, `${mid.progress}`);
  check('daysToDue is 13', mid.daysToDue === 13, `${mid.daysToDue}`);

  const before = currentPaymentWindow({ statementDay: 20, dueDay: 7 }, new Date(2026, 2, 5)); // Mar 5
  check('before this month\'s statement day, the statement is LAST month\'s', isDate(before.statementDate, 2026, 1, 20), show(before.statementDate));
  check('…and the due date is THIS month\'s', isDate(before.dueDate, 2026, 2, 7), show(before.dueDate));
  check('daysToDue is 2', before.daysToDue === 2, `${before.daysToDue}`);

  const passed = currentPaymentWindow({ statementDay: 20, dueDay: 7 }, new Date(2026, 3, 10)); // Apr 10
  check('after the due date (before the next statement), daysToDue goes NEGATIVE', passed.daysToDue === -3, `${passed.daysToDue}`);

  const same = currentPaymentWindow({ statementDay: 15, dueDay: 15 }, new Date(2026, 2, 20));
  check('a same-day statement/due pair still gets a real window (due next month)',
    same.dueDate > same.statementDate && isDate(same.dueDate, 2026, 3, 15), show(same.dueDate));

  check('no due day → no window', currentPaymentWindow({ statementDay: 20 }, new Date(2026, 2, 25)) === null);
}

// ── actual statement / due date priority ────────────────────────────────────
{
  const today = new Date(2026, 8, 26); // 26 Sep 2026
  // Issuer generated it a day late (holiday) — the real date wins.
  const shifted = resolveStatementDate({ statementDay: 18, lastStatementDate: new Date(2026, 8, 19).toISOString() }, today);
  check('an actual statement date near the recurring day WINS', shifted.source === 'actual' && isDate(shifted.date, 2026, 8, 19), show(shifted.date));
  // A stale actual date (last month's) — the recurring day's newer statement wins.
  const stale = resolveStatementDate({ statementDay: 18, lastStatementDate: new Date(2026, 7, 18).toISOString() }, today);
  check('a PAST cycle\'s actual date yields to the newer recurring one', stale.source === 'derived' && isDate(stale.date, 2026, 8, 18), show(stale.date));
  // No recurring day at all — a recent actual date still works on its own.
  const onlyActual = resolveStatementDate({ lastStatementDate: new Date(2026, 8, 10).toISOString() }, today);
  check('an actual date works without any billing day', onlyActual?.source === 'actual', JSON.stringify(onlyActual));
  check('…but not once it\'s long stale', resolveStatementDate({ lastStatementDate: new Date(2026, 5, 1).toISOString() }, today) === null);

  const dueActual = resolveDueDate({ dueDay: 7, lastDueDate: new Date(2026, 9, 9).toISOString() }, new Date(2026, 8, 19));
  check('an actual due date after the statement WINS', dueActual.source === 'actual' && isDate(dueActual.date, 2026, 9, 9), show(dueActual.date));
  const dueOld = resolveDueDate({ dueDay: 7, lastDueDate: new Date(2026, 8, 7).toISOString() }, new Date(2026, 8, 19));
  check('an actual due date BEFORE the statement belongs to an older bill — ignored',
    dueOld.source === 'derived' && isDate(dueOld.date, 2026, 9, 7), show(dueOld.date));
}

// ── currentBillingCycle — statement → next statement (the spec's example) ───
{
  const c = currentBillingCycle({ statementDay: 18 }, new Date(2026, 8, 26)); // 26 Sep
  check('billing day 18, 26 Sep → cycle starts 19 Sep', isDate(c.start, 2026, 8, 19), show(c.start));
  check('…and ends 18 Oct', isDate(c.end, 2026, 9, 18), show(c.end));
  const prev = currentBillingCycle({ statementDay: 18 }, new Date(2026, 8, 18)); // statement day itself
  check('ON the statement day, that day CLOSES the previous cycle (19 Aug → 18 Sep)',
    isDate(prev.start, 2026, 7, 19) && isDate(prev.end, 2026, 8, 18), `${show(prev.start)} -> ${show(prev.end)}`);
  check('…with 0 days left', prev.daysLeft === 0, `${prev.daysLeft}`);
  const shifted = currentBillingCycle({ statementDay: 18, lastStatementDate: new Date(2026, 8, 19).toISOString() }, new Date(2026, 8, 26));
  check('an actual (shifted) statement date moves the cycle start', isDate(shifted.start, 2026, 8, 20), show(shifted.start));
  const feb = currentBillingCycle({ statementDay: 31 }, new Date(2026, 1, 10)); // Feb 2026
  check('billing day 31 closes on Feb 28 in a short month', isDate(feb.end, 2026, 1, 28), show(feb.end));
}

// ── unusual statement→due gap (warn, never block) ───────────────────────────
{
  check('a normal 18-day gap is fine', paymentGapDays(20, 7, new Date(2026, 2, 25)) === 18 && !isUnusualPaymentGap(18));
  check('a 2-day gap is unusual', isUnusualPaymentGap(paymentGapDays(20, 22, new Date(2026, 2, 25))), `${paymentGapDays(20, 22, new Date(2026, 2, 25))}`);
  check('a missing day has no gap to judge', paymentGapDays(20, null) === null && !isUnusualPaymentGap(null));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
