// =============================================================================
// accountFlow — "This Month" cash flow + month-wise balance trend for a single
// account's ledger (Bank/Cash/Debit/Wallet — non-Credit-Card accounts, whose
// AccountDetailsScreen insights are otherwise built entirely from
// `utils/ccStatement`/`dueDate`) — plus `netWorthTrend`, the same backward
// reconstruction applied ACROSS every account for the Accounts screen's own
// "vs last month" stat.
// -----------------------------------------------------------------------------
// PURE. Only imports `utils/format` (itself dependency-free) and the
// `TRANSACTION_TYPES` enum, so the headless `.mjs` runner can exercise it too.
//
// `type` (not `amount`'s sign — amount is always stored positive, see
// `applyDelta` in the store) is what decides direction: CREDIT moves money
// into the account, DEBIT moves it out. Self-transfers and LB entries carry
// ordinary debit/credit types and DO move the real account balance (unlike
// the "spend" predicates in `utils/split.js`, which exist to exclude them
// from spend TOTALS only) — so both functions here read every ledger row,
// not a spend-filtered subset.
// =============================================================================

import { monthKey as toMonthKey } from './format';
import { TRANSACTION_TYPES, ACCOUNT_TYPES } from '../constants/categories';
import { txnBelongsToAccount } from './accountMatch';

const MONTH_LABEL = (d) => d.toLocaleDateString('en-IN', { month: 'short' });

/**
 * Money in / out / net for the given calendar month (current month by
 * default). `txns` is expected to already be this account's own ledger
 * (e.g. `txnBelongsToAccount`-filtered) — no account matching happens here.
 */
export const monthMoneyFlow = (txns, forMonthKey = toMonthKey(new Date())) => {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of txns || []) {
    if (toMonthKey(t.createdAt) !== forMonthKey) continue;
    const amt = Number(t.amount || 0);
    if (t.type === TRANSACTION_TYPES.CREDIT) moneyIn += amt;
    else if (t.type === TRANSACTION_TYPES.DEBIT) moneyOut += amt;
  }
  return { moneyIn, moneyOut, netFlow: moneyIn - moneyOut };
};

/**
 * Last `months` calendar months' END-OF-MONTH balance, oldest → newest,
 * reconstructed BACKWARDS from the account's current balance — there is no
 * stored history of past balances, only the running total plus the ledger
 * that moved it (`applyDelta`'s exact sign*amount logic, mirrored here).
 *
 * `since` (epoch ms, typically the account's `anchoredAt` or its earliest
 * ledger row) marks the oldest point the reconstruction can vouch for: a
 * balance "correction" or the account simply not existing yet means walking
 * further back would silently repeat a wrong number rather than a real one.
 * Buckets older than `since` come back with `known: false` and are meant to
 * be dropped by the caller (trimming the chart to only the months we can
 * actually stand behind, rather than padding it with invented flat history).
 */
/**
 * @param {any[]} txns
 * @param {number} currentBalance
 * @param {{ months?: number, now?: Date, since?: number | null }} [opts]
 */
export const accountBalanceTrend = (txns, currentBalance, { months = 6, now = new Date(), since = null } = {}) => {
  const buckets = Array.from({ length: months }, (_, i) => {
    const monthsBack = months - 1 - i;
    const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0, 23, 59, 59, 999);
    return { key: toMonthKey(d), label: MONTH_LABEL(d), cutoff: Math.min(monthEnd.getTime(), now.getTime()) };
  });

  const sorted = [...(txns || [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  let running = Number(currentBalance || 0);
  let idx = 0;
  const out = new Array(buckets.length);
  for (let i = buckets.length - 1; i >= 0; i--) {
    const { cutoff } = buckets[i];
    while (idx < sorted.length && new Date(sorted[idx].createdAt).getTime() > cutoff) {
      const t = sorted[idx];
      const sign = t.type === TRANSACTION_TYPES.DEBIT ? -1 : 1;
      running -= sign * Number(t.amount || 0);
      idx++;
    }
    out[i] = { key: buckets[i].key, label: buckets[i].label, total: running, known: since == null || cutoff >= since };
  }
  return out;
};

/**
 * Net worth NOW vs at the end of LAST calendar month — for an "up/down X% vs
 * last month" stat on the Accounts screen. Reconstructed per account (via
 * `accountBalanceTrend` on that account's own ledger, walking backwards from
 * its current balance, same as Balance Trend above), then combined with the
 * exact same asset/liability rule `selectEPurseNetWorth` (the store) uses —
 * a Credit Card's balance only ever SUBTRACTS (never adds) — so this can
 * never disagree with the headline Net Worth figure shown elsewhere.
 *
 * An account with no history before last month (newly added, or its balance
 * anchored/corrected this month) contributes 0 to the LAST-month total
 * rather than being dropped from the comparison entirely — it genuinely had
 * no recorded balance back then, so its current balance shows up honestly
 * as part of this month's change, not as a silently-ignored account.
 */
export const netWorthTrend = (accounts, transactions, { now = new Date() } = {}) => {
  const list = accounts || [];
  const txns = transactions || [];
  const contribute = (type, bal) => (type === ACCOUNT_TYPES.CREDIT_CARD ? Math.min(bal, 0) : bal);

  let current = 0;
  let previous = 0;
  for (const a of list) {
    if (a.archived || a.includeInNetWorth === false) continue;
    const bal = a.balance ?? 0;
    current += contribute(a.type, bal);

    const ledger = txns.filter((t) => !t.isIgnored && txnBelongsToAccount(t, a, list));
    const since = a.anchoredAt ?? (ledger.length
      ? Math.min(...ledger.map((t) => new Date(t.createdAt).getTime()))
      : now.getTime());
    const [lastMonth] = accountBalanceTrend(ledger, bal, { months: 2, now, since });
    previous += lastMonth.known ? contribute(a.type, lastMonth.total) : 0;
  }

  const hasComparison = current !== 0 || previous !== 0;
  const deltaPct = previous !== 0
    ? ((current - previous) / Math.abs(previous)) * 100
    : (current > 0 ? 100 : current < 0 ? -100 : 0);
  return { current, previous, deltaPct, hasComparison };
};
