// =============================================================================
// Shared lent/borrowed entry display helpers.
//
// Pulled out of LentBorrowedScreen when the per-person detail screen landed —
// both render the same ledger rows, and the label map and sign rule must agree
// or the same entry reads differently on the two screens.
// =============================================================================

/** Row label per ledger kind. Matches the four categories in the LB info sheet. */
export const ENTRY_LABEL = {
  lent: 'Lent',
  borrowed: 'Borrowed',
  lent_settled: 'Received back',
  borrow_repaid: 'Repaid',
};

/**
 * True when the kind moves the net in YOUR favour.
 * Mirrors getPersonBalances' additive formula:
 *   net = Σlent − Σlent_settled − Σborrowed + Σborrow_repaid
 */
export const isPositiveEntry = (kind) => kind === 'lent' || kind === 'borrow_repaid';
