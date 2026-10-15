// =============================================================================
// Cash can't go below ₹0 — it's the notes in your pocket. A card runs a balance
// (it's owed), and a bank's figure comes from its SMS, so only Cash is held to it.
// Checked where the USER spends from Cash (forms), never in applyDelta: reversals
// and undo must always be able to move a balance back.
// =============================================================================

export interface CashAccount { type?: string; balance?: number | null }

/**
 * null when `amount` fits; otherwise the cash available (≥ 0). `alreadyOut` = what this
 * same entry already took from it (editing an expense frees its old amount first).
 */
export function cashShortfall(account: CashAccount | null | undefined, amount: number, alreadyOut = 0): number | null {
  if (!account || account.type !== 'Cash') return null;
  const available = Math.round(((Number(account.balance) || 0) + alreadyOut) * 100) / 100;
  return Number(amount) > available + 0.005 ? Math.max(0, available) : null;
}

export const NOT_ENOUGH_CASH = 'Not enough cash';
/** The message under the error title — how to fix it. */
export const notEnoughCashText = (available: number, fmt: (v: number) => string) =>
  `Cash has ${fmt(available)}. Pick another account, or tap the balance on your Cash account to set how much you have.`;
