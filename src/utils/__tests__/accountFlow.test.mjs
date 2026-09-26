// =============================================================================
// accountFlow — "This Month" money in/out/net + month-wise Balance Trend
// reconstruction for a Bank/Cash/Debit/Wallet account (AccountDetailsScreen).
//   npm run test:accountFlow
//
// Dates are always injected (`now`) — never Date.now() — so these never depend
// on the day the suite happens to run.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const { monthMoneyFlow, accountBalanceTrend, netWorthTrend } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/accountFlow.js');
const { monthKey } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/format.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

console.log(`\n${C.bold}══════ accountFlow — this-month flow + balance trend ══════${C.reset}\n`);

const txn = (createdAt, type, amount) => ({ createdAt, type, amount });

// ── monthMoneyFlow ───────────────────────────────────────────────────────────
{
  const now = new Date(2026, 8, 15); // Sep 15, 2026
  const mk = monthKey(now);
  const txns = [
    txn(new Date(2026, 8, 2), 'credit', 50000),   // salary, this month
    txn(new Date(2026, 8, 10), 'debit', 12000),   // this month
    txn(new Date(2026, 8, 12), 'debit', 3000),    // this month
    txn(new Date(2026, 7, 28), 'debit', 9000),    // last month — excluded
  ];
  const { moneyIn, moneyOut, netFlow } = monthMoneyFlow(txns, mk);
  check('sums CREDIT rows in the target month as moneyIn', moneyIn === 50000, `${moneyIn}`);
  check('sums DEBIT rows in the target month as moneyOut', moneyOut === 15000, `${moneyOut}`);
  check('netFlow = moneyIn − moneyOut', netFlow === 35000, `${netFlow}`);

  const empty = monthMoneyFlow([], mk);
  check('no transactions → all zero, no crash', empty.moneyIn === 0 && empty.moneyOut === 0 && empty.netFlow === 0);

  const other = monthMoneyFlow(txns, monthKey(new Date(2020, 0, 1)));
  check('a month with no matching rows is all zero', other.moneyIn === 0 && other.moneyOut === 0);
}

// ── accountBalanceTrend ──────────────────────────────────────────────────────
{
  const now = new Date(2026, 8, 15); // Sep 15, 2026
  // One debit per month for the last 3 months + this month, nothing older.
  const txns = [
    txn(new Date(2026, 8, 5), 'debit', 1000),   // Sep (this month)
    txn(new Date(2026, 7, 20), 'credit', 5000), // Aug
    txn(new Date(2026, 7, 5), 'debit', 2000),   // Aug
    txn(new Date(2026, 6, 10), 'debit', 500),   // Jul
  ];
  const currentBalance = 10000;
  const trend = accountBalanceTrend(txns, currentBalance, { months: 4, now });
  check('returns one bucket per requested month, oldest → newest', trend.length === 4, `${trend.length}`);
  check('the last bucket (this month) is exactly the current balance', trend[3].total === 10000, `${trend[3].total}`);
  // End of Aug = current balance minus Sep's own delta (a 1000 debit reversed: +1000).
  check('end of Aug reconstructed by undoing Sep\'s delta', trend[2].total === 11000, `${trend[2].total}`);
  // End of Jul = end-of-Aug minus Aug's own deltas (a +5000 credit and a -2000 debit, both undone).
  check('end of Jul reconstructed by undoing Aug\'s deltas too', trend[1].total === 8000, `${trend[1].total}`);
  check('labels read as short month names', /^[A-Z][a-z]{2}$/.test(trend[0].label), trend[0].label);

  // `since` trims buckets this reconstruction can't vouch for.
  const sinceJul1 = new Date(2026, 6, 1).getTime(); // Jul 1, 2026
  const trimmed = accountBalanceTrend(txns, currentBalance, { months: 4, now, since: sinceJul1 });
  check('a bucket entirely before `since` (Jun) comes back known:false', trimmed[0].known === false);
  check('buckets at/after `since` (Jul onward) come back known:true', trimmed[1].known === true && trimmed[3].known === true);

  const noSince = accountBalanceTrend(txns, currentBalance, { months: 4, now });
  check('omitting `since` marks every bucket known (no trimming)', noSince.every((b) => b.known === true));

  // Empty ledger — every past bucket repeats the same (unearned) number; a
  // caller is expected to pass `since = now` for a brand-new account so only
  // the current bucket survives filtering, not a fabricated flat history.
  const freshAccount = accountBalanceTrend([], 500, { months: 3, now, since: now.getTime() });
  check('with `since = now`, only the current-month bucket is known', freshAccount.filter((b) => b.known).length === 1);
  check('that one known bucket is the current balance', freshAccount[2].total === 500 && freshAccount[2].known === true);
}

// ── netWorthTrend ─────────────────────────────────────────────────────────
{
  const now = new Date(2026, 8, 15); // Sep 15, 2026
  const bank = { id: 'a1', type: 'Bank', balance: 12000, anchoredAt: new Date(2026, 5, 1).getTime() };
  // ₹2,000 debit this month — end of Aug (last month) must reconstruct to 14000.
  const txns = [
    { accountId: 'a1', createdAt: new Date(2026, 8, 5), type: 'debit', amount: 2000 },
  ];
  const accounts = [bank];
  const trend = netWorthTrend(accounts, txns, { now });
  check('current equals the account\'s raw balance (Bank, not a Credit Card)',
    trend.current === 12000, `${trend.current}`);
  check('previous reconstructs end-of-last-month by undoing this month\'s debit',
    trend.previous === 14000, `${trend.previous}`);
  check('deltaPct is negative — net worth SHRANK vs last month',
    trend.deltaPct < 0, `${trend.deltaPct}`);
  check('hasComparison is true when there is real money on either side', trend.hasComparison === true);

  // A Credit Card contributes only its owed (negative) balance — same rule as
  // selectEPurseNetWorth — both now AND when reconstructing last month.
  const card = { id: 'a2', type: 'Credit Card', balance: -3000, anchoredAt: new Date(2026, 5, 1).getTime() };
  const cardTxns = [
    { accountId: 'a2', createdAt: new Date(2026, 8, 10), type: 'debit', amount: 1000 }, // this month's spend
  ];
  const withCard = netWorthTrend([bank, card], [...txns, ...cardTxns], { now });
  check('Credit Card liability included in current total', withCard.current === 12000 - 3000, `${withCard.current}`);
  // End of Aug: card owed 3000 − 1000 (this month's spend undone) = 2000.
  check('…and in the reconstructed LAST-month total too', withCard.previous === 14000 - 2000, `${withCard.previous}`);

  // A brand-new account (added this month, no history before it) contributes
  // 0 to LAST month rather than being dropped — its balance shows as growth.
  const fresh = { id: 'a3', type: 'Cash', balance: 5000 };
  const freshTxns = [{ accountId: 'a3', createdAt: new Date(2026, 8, 12), type: 'credit', amount: 5000 }];
  const withFresh = netWorthTrend([fresh], freshTxns, { now });
  check('a brand-new account\'s prior balance is 0, not dropped', withFresh.previous === 0, `${withFresh.previous}`);
  check('…so it reads as a gain (deltaPct 100, current > 0, previous 0)', withFresh.deltaPct === 100);

  // No accounts at all — no comparison to draw, no division by zero either.
  const empty = netWorthTrend([], [], { now });
  check('no accounts → hasComparison is false', empty.hasComparison === false);
  check('…and deltaPct falls back to 0, not NaN/Infinity', empty.deltaPct === 0, `${empty.deltaPct}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
