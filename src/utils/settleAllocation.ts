// =============================================================================
// Which of a person's open balances a repayment settles — "Settles: Goa Trip · Direct".
// A person's Lent/Borrowed net is the sum of every row, but each shared group shows (and
// syncs) its own part, so a settlement recorded without a group leaves the group open.
// These split the PAID amount over the parts the user picks; nothing beyond it is settled.
// =============================================================================

export interface LbRowLike {
  kind: string;
  amount: number;
  date?: string;
  groupId?: string | null;
  memberId?: string | null;
}

export interface GroupLike {
  id: string;
  name: string;
  type?: string;
  members?: { memberId: string; archived?: boolean }[];
  shared?: { status?: string } | null;
}

export interface SettlePart {
  /** groupId, or 'direct'. */
  key: string;
  groupId: string | null;
  memberId: string | null;
  label: string;
  /** What's open in the settlement's direction (> 0). */
  open: number;
}

export interface SettleAllocation {
  groupId: string | null;
  memberId: string | null;
  amount: number;
}

export const DIRECT_KEY = 'direct';
const MIN = 0.005;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** +1 = they owe me more; the same sign rule as the store's getPersonBalances. */
const lbSign = (kind: string) => (kind === 'lent' || kind === 'borrow_repaid' ? 1
  : kind === 'borrowed' || kind === 'lent_settled' ? -1 : 0);

/** 'lent_settled' closes what they owe me (+), 'borrow_repaid' what I owe them (−). */
const settleDirection = (kind: string) => (kind === 'lent_settled' ? 1 : kind === 'borrow_repaid' ? -1 : 0);

/**
 * A person's balances that this settlement could close, groups first (oldest first),
 * then Direct. Only parts open in the settlement's direction; never an ended group or
 * one where they're a past member — nothing may move those balances.
 */
export function openSettleParts(entries: LbRowLike[], kind: string, groups: GroupLike[]): SettlePart[] {
  const dir = settleDirection(kind);
  if (!dir) return [];
  const byGroup = new Map<string, { sum: number; first: string; memberId: string | null }>();
  let direct = 0;
  for (const e of entries) {
    const v = lbSign(e.kind) * (Number(e.amount) || 0);
    if (!e.groupId) { direct += v; continue; }
    const cur = byGroup.get(e.groupId) || { sum: 0, first: e.date || '', memberId: null };
    cur.sum += v;
    if (e.date && (!cur.first || e.date < cur.first)) cur.first = e.date;
    if (!cur.memberId && e.memberId) cur.memberId = e.memberId;
    byGroup.set(e.groupId, cur);
  }
  const parts: (SettlePart & { first: string })[] = [];
  for (const [groupId, g] of byGroup) {
    const group = groups.find((x) => x.id === groupId);
    if (!group || group.shared?.status === 'ended') continue;
    if (g.memberId && group.members?.some((m) => m.memberId === g.memberId && m.archived)) continue;
    const open = r2(dir * g.sum);
    if (open >= MIN) parts.push({ key: groupId, groupId, memberId: g.memberId, label: group.name, open, first: g.first });
  }
  parts.sort((a, b) => a.first.localeCompare(b.first));
  const out: SettlePart[] = parts.map(({ first: _f, ...p }) => p);
  const openDirect = r2(dir * direct);
  if (openDirect >= MIN) out.push({ key: DIRECT_KEY, groupId: null, memberId: null, label: 'Direct', open: openDirect });
  return out;
}

/**
 * The parts to start with: the one whose open balance IS the amount, else parts in
 * order until the amount is covered.
 */
export function preselectSettleParts(parts: SettlePart[], amount: number): string[] {
  if (!(amount > 0) || !parts.length) return [];
  const exact = parts.filter((p) => Math.abs(p.open - amount) < MIN);
  if (exact.length === 1) return [exact[0].key];
  const keys: string[] = [];
  let left = amount;
  for (const p of parts) {
    if (left < MIN) break;
    keys.push(p.key);
    left -= p.open;
  }
  return keys;
}

/**
 * The paid amount over the picked parts, in the parts' order, each up to what's open.
 * Only the paid amount is used; anything paid beyond the picked parts goes to Direct
 * (it then reads the other way round, e.g. "you owe Rohit"). Nothing picked → all Direct.
 */
export function allocateSettle(parts: SettlePart[], selected: string[], amount: number): SettleAllocation[] {
  const out: SettleAllocation[] = [];
  let left = r2(amount);
  let direct = 0;
  for (const p of parts) {
    if (!selected.includes(p.key) || left < MIN) continue;
    const take = r2(Math.min(p.open, left));
    left = r2(left - take);
    if (p.groupId) out.push({ groupId: p.groupId, memberId: p.memberId, amount: take });
    else direct = r2(direct + take);
  }
  direct = r2(direct + left);
  if (direct >= MIN) out.push({ groupId: null, memberId: null, amount: direct });
  return out;
}

/** True when the parts are worth asking about — at least one group is open. */
export const hasGroupParts = (parts: SettlePart[]) => parts.some((p) => p.groupId);
