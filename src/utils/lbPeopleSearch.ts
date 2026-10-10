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
