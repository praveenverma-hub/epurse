// =============================================================================
// cardLimit — a credit card's Available Credit / Utilization (Oct-10-26). Pure,
// tested in test:cardLimit; the card page reads it, nothing else does the maths.
//
//  • BANK FIRST. The bank's own "Avl Limit Rs X" from the latest card SMS
//    (`reportedAvailable`) is ground truth at that moment — it already nets
//    unbilled spends and, on a combined limit, the other cards' spends. Any card
//    spend/payment AFTER that SMS is applied on top, so it stays current.
//  • Else LIMIT − OUTSTANDING, from the limit the user typed (or an SMS reported).
//  • COMBINED LIMIT: cards linked by `limitGroupId` share one limit — outstanding,
//    later spends and the freshest bank figure are taken across the whole group.
// =============================================================================

export interface LimitCard {
  id: string;
  balance?: number;
  creditLimit?: number | null;
  limitGroupId?: string | null;
  reportedAvailable?: { amount: number; at: string } | null;
}

export interface LimitTxn {
  accountId?: string | null;
  type: string;
  amount: number;
  createdAt: string;
  isIgnored?: boolean;
}

export interface CardLimitPosition {
  /** The (shared) credit limit, when known. */
  limit: number | null;
  /** Unclamped — negative when over the limit. */
  available: number;
  /** used / limit, or null without a limit. */
  utilization: number | null;
  overLimit: boolean;
  /** 'bank' = from the bank's SMS figure (adjusted); 'limit' = limit − outstanding. */
  source: 'bank' | 'limit';
  /** When the bank figure was reported (source 'bank'). */
  asOf: string | null;
  /** Every card on this limit (just this one when not linked). */
  group: LimitCard[];
}

/** This card plus every card sharing its limit. */
export function limitGroupCards<T extends LimitCard>(card: T, accounts: T[]): T[] {
  if (!card.limitGroupId) return [card];
  const group = accounts.filter((a) => a.limitGroupId === card.limitGroupId);
  return group.length ? group : [card];
}

const time = (iso: string) => new Date(iso).getTime();

export function cardLimitPosition(card: LimitCard, accounts: LimitCard[], txns: LimitTxn[]): CardLimitPosition | null {
  const group = limitGroupCards(card, accounts);
  const ids = new Set(group.map((c) => c.id));
  const limit = [card, ...group].map((c) => c.creditLimit).find((l): l is number => typeof l === 'number' && l > 0) ?? null;

  const snap = group
    .map((c) => c.reportedAvailable)
    .filter((r): r is { amount: number; at: string } => !!r && r.amount >= 0 && !Number.isNaN(time(r.at)))
    .sort((a, b) => time(b.at) - time(a.at))[0];

  let available: number;
  let source: 'bank' | 'limit';
  if (snap) {
    // Spends after the bank's figure use more of the limit; payments/refunds free it.
    const after = time(snap.at);
    let moved = 0;
    for (const t of txns) {
      if (t.isIgnored || !t.accountId || !ids.has(t.accountId) || time(t.createdAt) <= after) continue;
      moved += t.type === 'debit' ? Number(t.amount) || 0 : -(Number(t.amount) || 0);
    }
    available = snap.amount - moved;
    source = 'bank';
  } else if (limit) {
    const owed = group.reduce((sum, c) => sum + Math.abs(Number(c.balance) || 0), 0);
    available = limit - owed;
    source = 'limit';
  } else {
    return null;
  }

  return {
    limit,
    available,
    utilization: limit ? (limit - available) / limit : null,
    overLimit: available < 0,
    source,
    asOf: source === 'bank' ? snap!.at : null,
    group,
  };
}

/**
 * Cards that LOOK like they share one combined limit — same bank, same limit — but
 * aren't linked yet and weren't declined. A suggestion only: two cards from one bank
 * with equal limits is also common, so the user confirms (never auto-linked).
 */
export function limitLinkSuggestions<T extends LimitCard & { type?: string; bankName?: string | null; archived?: boolean; mask?: string | null }>(
  accounts: T[], declined: string[] = [],
): { a: T; b: T; limit: number }[] {
  const cards = accounts.filter((c) => c.type === 'Credit Card' && !c.archived && (c.creditLimit ?? 0) > 0 && (c.bankName || '').trim());
  const out: { a: T; b: T; limit: number }[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      if ((a.bankName || '').trim().toLowerCase() !== (b.bankName || '').trim().toLowerCase()) continue;
      if (a.creditLimit !== b.creditLimit) continue;
      if (a.limitGroupId && a.limitGroupId === b.limitGroupId) continue;
      if (declined.includes(limitPairKey(a.id, b.id))) continue;
      out.push({ a, b, limit: a.creditLimit as number });
    }
  }
  return out;
}

/** Order-independent key for a pair of cards (declines are remembered by it). */
export const limitPairKey = (a: string, b: string) => [a, b].sort().join('|');
