// =============================================================================
// ccStatement — one credit card's statement, payments and due status.
// -----------------------------------------------------------------------------
// PURE (imports only `dueDate`, itself pure), so the store, the two payment
// sheets (CCPaymentPromptModal / CCBillPaymentSheet) and AccountDetailsScreen
// all answer "what's left on this bill, and is it paid?" with the SAME math.
//
// Model: Billing Day → Statement → Due Day → Payment Date.
//   statementBalance — what the latest statement billed. Frozen for the cycle.
//   remainingDue     — what's still unpaid on THAT statement. Starts equal to
//                      statementBalance, drops with each payment, 0 = paid.
//   outstanding      — the card's live balance owed (account.balance). NOT the
//                      same number as either of the above, and never forced to be.
// =============================================================================

import { currentPaymentWindow } from './dueDate';

/** Days before the due date that count as "due soon". */
export const DUE_SOON_DAYS = 7;

/** What's still unpaid on the current statement, or null with no statement. */
export const statementRemaining = (acct) => {
  if (!acct || acct.statementBalance == null) return null;
  return Math.max(0, acct.remainingDue ?? acct.statementBalance);
};

/**
 * Apply one payment of `amount` to the card's CURRENT statement.
 *   'trueup' — the user says the bill is fully cleared → remaining 0.
 *   'settle' — reduce remaining by exactly `amount`; a payment smaller than
 *              what's left leaves the bill PARTIALLY paid, never "paid".
 * Returns the account-field patch plus the figures the payment history
 * records. No statement on file → nothing statement-side to change.
 */
export function applyStatementPayment(acct, amount, mode) {
  const before = statementRemaining(acct);
  if (before == null) return { patch: {}, remainingAfter: null, overpaid: 0 };
  const paid = Math.max(0, Number(amount) || 0);
  const remainingAfter = mode === 'trueup' ? 0 : Math.max(0, before - paid);
  return {
    patch: { remainingDue: remainingAfter },
    remainingAfter,
    overpaid: mode === 'trueup' ? 0 : Math.max(0, paid - before),
  };
}

/**
 * Due status for the current statement. Ordering matters where two could
 * apply: paid wins; then a passed due date (more urgent than "partially paid"
 * — still short AND late); then partially paid; then the countdown tiers.
 *
 * "due_date_passed", never "overdue": ePurse is local-only and can't know a
 * payment made outside the SMS it reads, so it states the date, not a verdict.
 */
export function ccPaymentStatus(acct, from = new Date()) {
  const remaining = statementRemaining(acct);
  if (remaining == null) return 'no_statement';
  if (remaining <= 0) return 'paid';
  const win = currentPaymentWindow(acct, from);
  if (win && win.daysToDue < 0) return 'due_date_passed';
  if (remaining < acct.statementBalance) return 'partially_paid';
  if (!win) return 'upcoming';
  if (win.daysToDue === 0) return 'due_today';
  if (win.daysToDue <= DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

/**
 * "today" / "tomorrow" / "in N days" / "N days ago" from a `currentPaymentWindow`
 * result — the due-date wording AccountDetailsScreen and the Accounts list row
 * both need, worded once so a bill can't read differently in the two places.
 */
export function dueRelativeText(payWindow) {
  if (!payWindow) return '';
  const n = payWindow.daysToDue;
  if (n < 0) return `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} ago`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

/** User-facing label per status. */
export const PAYMENT_STATUS_LABEL = {
  no_statement:    'No statement yet',
  upcoming:        'Upcoming',
  due_soon:        'Due soon',
  due_today:       'Due today',
  due_date_passed: 'Due date passed',
  partially_paid:  'Partially paid',
  paid:            'Paid',
};

/**
 * Accent colour per status — AccountDetailsScreen's Payment Details card and
 * the Accounts list row both tint the status the same way, so it's written
 * once here rather than as two identical ladders. `theme` is passed in
 * (not imported) to keep this module framework-free like the rest of it.
 */
export function ccStatusColor(status, theme) {
  if (status === 'paid') return theme.success;
  if (status === 'due_date_passed') return theme.danger;
  if (status === 'due_today' || status === 'due_soon') return theme.budgetNearLimit;
  if (status === 'partially_paid') return theme.primary;
  return theme.textMuted;
}

/**
 * Credit limit maths, UNCLAMPED: outstanding may exceed the limit (issuers
 * allow it), so available goes negative and utilization past 100% — shown as
 * an "Over limit" warning rather than hidden behind ₹0 / 100%.
 */
export function creditAvailability(outstanding, creditLimit) {
  if (!(creditLimit > 0)) return null;
  const owed = Math.max(0, Number(outstanding) || 0);
  return {
    availableCredit: creditLimit - owed,
    utilization: owed / creditLimit,
    overLimit: owed > creditLimit,
  };
}

/**
 * Card spend inside [start, end] (whole days, inclusive): debits only. Bill
 * payments never post as the card's own debits, so they can't inflate this;
 * refunds aren't netted off — too rare on a card ledger to be worth guessing.
 */
export function cycleSpend(txns, start, end) {
  if (!start || !end) return 0;
  const lo = start.getTime();
  const hi = end.getTime() + 86400000; // end day inclusive
  let sum = 0;
  for (const t of txns || []) {
    if (t.isIgnored || t.type !== 'debit') continue;
    const at = new Date(t.createdAt).getTime();
    if (at >= lo && at < hi) sum += Number(t.amount) || 0;
  }
  return sum;
}

/** The most recent logged payment — the spec's lastPaymentDate/Amount,
 *  derived from `paymentHistory` rather than stored twice. */
export const lastPayment = (acct) => {
  const h = acct?.paymentHistory;
  return h && h.length ? h[h.length - 1] : null;
};

/**
 * Validate the user-typed Card Details (add step + edit screen share this).
 * Returns the first problem as a user-facing message, or null. Days are
 * already clamped 1-31 as they're typed (`sanitizeDay`); an unusual
 * statement→due gap is a WARNING, never a block (`isUnusualPaymentGap`).
 * `statementBalance` is the one on file (edit mode) — the minimum can't be
 * more than the bill it belongs to. Outstanding vs limit is NOT validated:
 * issuers allow going over, and the detail screen flags it instead.
 */
export function validateCardDetails({ creditLimit, minimumDue, statementBalance } = {}) {
  if (creditLimit != null && !(creditLimit > 0)) return 'Credit limit must be more than ₹0.';
  if (minimumDue != null && minimumDue < 0) return "Minimum due can't be negative.";
  if (minimumDue != null && statementBalance != null && minimumDue > statementBalance) {
    return "Minimum due can't be more than the statement balance.";
  }
  return null;
}
