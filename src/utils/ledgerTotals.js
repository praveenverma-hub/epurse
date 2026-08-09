// =============================================================================
// Totals for a LIST of transactions (the Activity screen's footer).
//
// Extracted from TransactionsScreen for one reason: it must agree with
// getMonthlySpend / getMonthlyIncome / getMonthlyRefunds, and while it lived
// inline in the screen it silently drifted from them. It applied only
// `spendExcluded`, so a ₹9,000 self-transfer counted as ₹9,000 out AND ₹9,000
// in, lending ₹1,500 and being repaid read as spend plus income, refunds were
// counted as income, and rows surfaced by the Ignored chip were added to the
// totals. The footer contradicted Home for the very same transactions.
//
// Living here means `ledgerTotals.test.mjs` can assert it equals the store
// selectors for the same data — a drift becomes a failing test, not a number
// nobody cross-checks.
//
// The four conditions, matching the selectors exactly:
//   1. `isIgnored`            — ignoring removes a txn from every total, even
//                               though the Ignored chip can put it in the list.
//   2. NON_SPEND categories   — self / lent / borrowed / settlements / cc_bill
//                               move real money but are not spending or earning.
//                               A self-transfer would otherwise hit BOTH sides.
//   3. refunds                — net DOWN spend; they are not income.
//   4. `spendExcluded`        — group memos, excluded groups, and the parents
//                               switched off in Spend Rules.
// =============================================================================
import { NON_SPEND_CATEGORY_IDS } from '../constants/categories';
import {
  debitDisplayAmount, isGroupExcluded, isMemoTxn, isRefundCredit, spendContribution,
} from './split';

/** Plain-English reason for the footer's "not counted" line. */
export const NON_SPEND_LABEL = {
  self:          'self-transfers',
  lent:          'lent',
  borrowed:      'borrowed',
  lent_settled:  'settlements',
  borrow_repaid: 'settlements',
  cc_bill:       'card bills',
};

/**
 * @param txns          the rows currently listed
 * @param groups        store groups (spendExcluded needs them; missing ⇒ nothing excluded)
 * @param spendExcluded injected from the store, so this module stays importable
 *                      without pulling the whole store into a unit test
 * @returns {{ debit: number, credit: number, refund: number, excluded: number, reasons: string[] }}
 *          `debit` is Spent (net of refunds, your share only) and `credit` is
 *          real income. `excluded` is what was left out, for the secondary line.
 *          NOTE the double braces: `@returns { a, b }` is read by TypeScript as a
 *          TYPE expression, and it silently inferred `Number` for the whole object.
 */
export function computeLedgerTotals(txns, groups, spendExcluded) {
  let debit = 0, credit = 0, refund = 0, excluded = 0;
  const reasons = new Set();

  for (const t of txns || []) {
    if (t.isIgnored) { excluded += t.amount || 0; reasons.add('ignored'); continue; }

    const nonSpend = NON_SPEND_CATEGORY_IDS.has(t.categoryId);
    if (nonSpend || spendExcluded?.(t, groups)) {
      excluded += debitDisplayAmount(t);   // returns the full amount for credits
      // Name the actual reason. A bare "not counted" is no explanation at all —
      // and this string is printed in an exported statement, where the reader may
      // not have the app in front of them.
      reasons.add(
        nonSpend                     ? (NON_SPEND_LABEL[t.categoryId] || 'transfers')
          : isMemoTxn(t)             ? 'paid by someone else'
          : isGroupExcluded(t, groups) ? 'excluded groups'
          : 'categories excluded in Spend Rules',
      );
      continue;
    }

    if (t.type === 'credit') {
      if (isRefundCredit(t)) refund += t.amount || 0;
      else credit += t.amount || 0;
    } else {
      debit += spendContribution(t);
    }
  }

  // Clamped like getMonthlySpend: refunds exceeding spend must not read as
  // negative money out.
  return { debit: Math.max(0, debit - refund), credit, refund, excluded, reasons: [...reasons] };
}
