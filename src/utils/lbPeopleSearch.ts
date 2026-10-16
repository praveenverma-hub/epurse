// =============================================================================
// lbPeopleSearch — "who is this?" suggestions for the LB form's name field, from
// the people ALREADY on the ledger (no contacts permission needed). Picking one
// reuses that exact person (name + contact + number), so a second entry for
// someone joins their ledger instead of starting a duplicate "Rohit" / "Rohti".
// =============================================================================

export interface LbPerson {
  personKey: string;
  person: string;
  contactId?: string | null;
  phone?: string | null;
  net: number;
}

/**
 * Up to `limit` people whose name matches `query`: a word that STARTS with it ranks
 * first ("roh" → "Rohit Sharma", "sharma" → "Rohit Sharma"), then a match anywhere
 * in the name; ties go to the bigger open balance. Empty query → none.
 */
export function suggestLbPeople(people: LbPerson[], query: string, limit = 3): LbPerson[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { p: LbPerson; rank: number }[] = [];
  for (const p of people) {
    const name = (p.person || '').trim().toLowerCase();
    if (!name) continue;
    if (name === q) continue; // already typed in full — nothing to suggest
    const rank = name.split(/\s+/).some((w) => w.startsWith(q)) ? 0 : name.includes(q) ? 1 : -1;
    if (rank >= 0) scored.push({ p, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || Math.abs(b.p.net) - Math.abs(a.p.net))
    .slice(0, limit)
    .map((s) => s.p);
}

/** Below this an open balance is rounding, not money owed. */
const OPEN_MIN = 0.5;

/**
 * Who a settlement of `kind` can close, biggest balance first: 'lent_settled' (they pay
 * me back) → people who owe me; 'borrow_repaid' (I pay them back) → people I owe. Any
 * other kind → none. The ONE list every settle picker shows. `net` keeps its sign.
 */
export function openBalancePeople(people: LbPerson[], kind: string | null | undefined): LbPerson[] {
  const sign = kind === 'lent_settled' ? 1 : kind === 'borrow_repaid' ? -1 : 0;
  if (!sign) return [];
  return people.filter((p) => sign * p.net >= OPEN_MIN).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
}

const last10 = (p?: string | null) => (p || '').replace(/\D/g, '').slice(-10);

/** The ledger person a picked contact / name is — same contact, number or name — or null. */
export function findLbPerson(people: LbPerson[], who: { contactId?: string | null; phone?: string | null; name?: string | null }): LbPerson | null {
  const ph = last10(who.phone);
  const name = (who.name || '').trim().toLowerCase();
  return people.find((p) => (who.contactId && p.contactId === who.contactId) || (ph.length === 10 && last10(p.phone) === ph))
    ?? people.find((p) => !!name && (p.person || '').trim().toLowerCase() === name)
    ?? null;
}

/**
 * A settlement bigger than what's open with them flips who owes whom by the rest
 * (Rohit owed ₹500, he paid ₹800 → you owe Rohit ₹300). null when it fits.
 */
export function settleExtra(kind: string | null | undefined, amount: number, person: LbPerson | null): { open: number; extra: number } | null {
  const sign = kind === 'lent_settled' ? 1 : kind === 'borrow_repaid' ? -1 : 0;
  if (!sign || !(amount > 0)) return null;
  const open = Math.max(0, sign * (person?.net ?? 0));
  const extra = Math.round((amount - open) * 100) / 100;
  return extra >= OPEN_MIN ? { open, extra } : null;
}
