// =============================================================================
// ccStatement — statement payments, due status, credit availability, cycle spend.
//   npm run test:ccStatement
//
// Every date is injected (`from`), never `Date.now()`, so the status tiers
// can't drift with the day the suite runs.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const {
  statementRemaining, applyStatementPayment, ccPaymentStatus, creditAvailability,
  cycleSpend, lastPayment, validateCardDetails,
} = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/ccStatement.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

console.log(`\n${C.bold}══════ ccStatement ══════${C.reset}\n`);

// ── payments against a statement ────────────────────────────────────────────
{
  const card = { statementBalance: 10000, remainingDue: 10000 };
  check('remaining starts at the statement balance', statementRemaining(card) === 10000);
  check('no statement → no remaining', statementRemaining({ statementBalance: null }) === null);

  const part = applyStatementPayment(card, 4000, 'settle');
  check('₹4,000 of ₹10,000 leaves ₹6,000 — NOT paid', part.remainingAfter === 6000 && part.patch.remainingDue === 6000, JSON.stringify(part));
  const second = applyStatementPayment({ ...card, remainingDue: 6000 }, 6000, 'settle');
  check('a second payment for the rest pays it off', second.remainingAfter === 0 && second.overpaid === 0, JSON.stringify(second));
  const over = applyStatementPayment({ ...card, remainingDue: 1000 }, 1500, 'settle');
  check('an overpayment floors at 0 and reports the excess', over.remainingAfter === 0 && over.overpaid === 500, JSON.stringify(over));
  const tu = applyStatementPayment(card, 1, 'trueup');
  check('True-up clears the statement whatever the amount', tu.remainingAfter === 0 && tu.overpaid === 0, JSON.stringify(tu));
  const none = applyStatementPayment({ statementBalance: null }, 500, 'settle');
  check('no statement on file → nothing statement-side changes', none.remainingAfter === null && Object.keys(none.patch).length === 0);
}

// ── due status — bills on the 20th, due the 7th; statement 20 Mar 2026 ──────
{
  const base = { statementBalance: 5000, remainingDue: 5000, statementDay: 20, dueDay: 7 };
  const at = (y, m, d) => new Date(y, m, d);
  check('no statement → no_statement', ccPaymentStatus({ statementBalance: null }, at(2026, 2, 25)) === 'no_statement');
  check('13 days before due → upcoming', ccPaymentStatus(base, at(2026, 2, 25)) === 'upcoming', ccPaymentStatus(base, at(2026, 2, 25)));
  check('7 days before due → due_soon', ccPaymentStatus(base, at(2026, 2, 31)) === 'due_soon', ccPaymentStatus(base, at(2026, 2, 31)));
  check('1 day before due → due_soon', ccPaymentStatus(base, at(2026, 3, 6)) === 'due_soon');
  check('on the due date → due_today', ccPaymentStatus(base, at(2026, 3, 7)) === 'due_today');
  check('after the due date → due_date_passed (never "overdue")', ccPaymentStatus(base, at(2026, 3, 10)) === 'due_date_passed');
  const partial = { ...base, remainingDue: 2000 };
  check('part-paid, still before due → partially_paid', ccPaymentStatus(partial, at(2026, 2, 25)) === 'partially_paid');
  check('part-paid AND past due → due_date_passed wins (more urgent)', ccPaymentStatus(partial, at(2026, 3, 10)) === 'due_date_passed');
  check('fully paid → paid, even past the due date', ccPaymentStatus({ ...base, remainingDue: 0 }, at(2026, 3, 10)) === 'paid');
  check('a statement with no due day known → upcoming, not a crash',
    ccPaymentStatus({ statementBalance: 5000, remainingDue: 5000 }, at(2026, 2, 25)) === 'upcoming');
}

// ── credit availability — unclamped ─────────────────────────────────────────
{
  const ok = creditAvailability(30000, 100000);
  check('available = limit − outstanding', ok.availableCredit === 70000 && Math.abs(ok.utilization - 0.3) < 1e-9 && !ok.overLimit, JSON.stringify(ok));
  const over = creditAvailability(118000, 100000);
  check('over the limit: available goes NEGATIVE (not clamped to 0)', over.availableCredit === -18000, JSON.stringify(over));
  check('…utilization passes 100%', Math.abs(over.utilization - 1.18) < 1e-9, `${over.utilization}`);
  check('…and it is flagged overLimit', over.overLimit === true);
  check('no limit → nothing to compute', creditAvailability(5000, null) === null && creditAvailability(5000, 0) === null);
}

// ── cycle spend ─────────────────────────────────────────────────────────────
{
  const start = new Date(2026, 8, 19);
  const end = new Date(2026, 9, 18);
  const txns = [
    { type: 'debit', amount: 1000, createdAt: new Date(2026, 8, 19, 9).toISOString() },   // first day — in
    { type: 'debit', amount: 500, createdAt: new Date(2026, 9, 18, 22).toISOString() },   // last day, late — in
    { type: 'debit', amount: 700, createdAt: new Date(2026, 8, 18, 23).toISOString() },   // day before — out
    { type: 'debit', amount: 300, createdAt: new Date(2026, 9, 19, 1).toISOString() },    // day after — out
    { type: 'credit', amount: 9999, createdAt: new Date(2026, 8, 25).toISOString() },     // not spend
    { type: 'debit', amount: 400, isIgnored: true, createdAt: new Date(2026, 8, 25).toISOString() },
  ];
  check('cycle spend counts debits on every day of the cycle, inclusive', cycleSpend(txns, start, end) === 1500, `${cycleSpend(txns, start, end)}`);
}

// ── last payment — derived, not stored twice ────────────────────────────────
{
  check('last payment is the newest history entry',
    lastPayment({ paymentHistory: [{ amount: 1 }, { amount: 2 }] }).amount === 2);
  check('no history → null', lastPayment({ paymentHistory: [] }) === null && lastPayment({}) === null);
}

// ── form validation ─────────────────────────────────────────────────────────
{
  check('all blank is valid (every field is optional)', validateCardDetails({}) === null);
  check('a ₹0 credit limit is rejected', !!validateCardDetails({ creditLimit: 0 }));
  check('a positive limit is fine', validateCardDetails({ creditLimit: 50000 }) === null);
  check('minimum due above the statement is rejected', !!validateCardDetails({ minimumDue: 900, statementBalance: 800 }));
  check('minimum due equal to the statement is fine', validateCardDetails({ minimumDue: 800, statementBalance: 800 }) === null);
  check('minimum due with no statement on file is fine', validateCardDetails({ minimumDue: 900 }) === null);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
