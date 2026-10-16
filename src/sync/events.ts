// =============================================================================
// Shared-group event format, v1 (docs/SHARED_GROUP_SYNC.md §6). PURE.
//
// Each event is JSON `{ v, at, type, ...body }`, encrypted before it leaves the
// phone. `parseEvent` is the structural half of the ONE validator every phone
// runs; the state rules (who may do what, given the history) are in fold.ts.
//
// FROZEN for v1. These limits are deliberately NOT `INPUT_LIMITS`: changing a
// form's limit must never change how an old event validates, or phones on
// different app versions would compute different balances. A new rule means a
// new `v` (and a `minSupportedVersion` bump), never an edit here.
// =============================================================================

import { isUuid } from './crypto';
import { isPhoneKey } from './phoneKey';

export const EVENT_VERSION = 1;

export const V1_LIMITS = {
  NAME_MAX: 40,
  TITLE_MAX: 40,
  CATEGORY_MAX: 40,
  EMOJI_MAX: 16,
  DATE_MAX: 40,
  /** ₹10 crore — MAX_ALLOWED_AMOUNT in paise. */
  MAX_PAISE: 10_000_000_000,
  MAX_SHARES: 100,
  MAX_MEMBERS: 100,
  /** Every pair of 100 members. */
  MAX_DEBTS: 4950,
} as const;

export type Share = { memberId: string; paise: number };

export type ExpenseBody = {
  entityId: string;
  amountPaise: number;
  title: string;
  categoryId: string;
  date: string;
  paidBy: string;
  shares: Share[];
};

export type SettlementBody = {
  entityId: string;
  from: string;
  to: string;
  amountPaise: number;
  date: string;
};

/** `from` owes `to` this much (always > 0). */
export type Debt = { from: string; to: string; paise: number };

export type CheckpointMember = { memberId: string; name: string; userId: string | null; archived: boolean };

/** Everything the next phone needs to start from here: no expenses, just people and who owes whom. */
export type CheckpointBody = {
  /** The seq this summarises — the server only accepts it while that's still the latest. */
  baseSeq: number;
  meta: { name: string; emoji: string | null; color: string | null } | null;
  /** In the order they were added. */
  members: CheckpointMember[];
  activeUsers: string[];
  deletedUsers: string[];
  debts: Debt[];
  /** Corrected expenses: the latest correction of each, so the next one can be checked against it. */
  corrections: CorrectionHead[];
};

export type CorrectionHead = { correctsId: string; head: string; deleted: boolean };

/**
 * An edit to an expense from before the last checkpoint. Phones that joined later never had
 * the original, so the change travels as its effect on who-owes-whom (`debts`); `expense` is
 * the new version for display (null = deleted).
 */
export type CorrectionBody = {
  entityId: string;
  correctsId: string;
  /** What it was built on: the latest correction of that expense, or `correctsId` if none. */
  base: string;
  title: string;
  date: string;
  debts: Debt[];
  expense: ExpenseBody | null;
};

export type SyncEvent =
  | { type: 'group.meta'; name: string; emoji: string | null; color: string | null }
  // phoneKey (Oct-17-26): optional fingerprint of the person's number (sync/phoneKey.ts) —
  // only links people to contacts, never touches a balance, so older phones dropping it is safe.
  | { type: 'member.add'; memberId: string; name: string; phoneKey?: string }
  | { type: 'member.claim'; memberId: string; userId: string }
  | { type: 'member.rename'; memberId: string; name: string }
  | { type: 'member.archive'; memberId: string }
  | { type: 'member.phone'; memberId: string; phoneKey: string }
  | ({ type: 'expense.upsert' } & ExpenseBody)
  | { type: 'expense.delete'; entityId: string }
  | ({ type: 'settlement.upsert' } & SettlementBody)
  | { type: 'settlement.delete'; entityId: string }
  | ({ type: 'group.checkpoint' } & CheckpointBody)
  | ({ type: 'expense.correct' } & CorrectionBody);

export type ParsedEvent = { at: string; event: SyncEvent };

export const encodeEvent = (event: SyncEvent, at: string): string =>
  JSON.stringify({ v: EVENT_VERSION, at, ...event });

const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const paise = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= V1_LIMITS.MAX_PAISE;
// A fixed pattern, not Date.parse: every phone must accept exactly the same strings.
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const date = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= V1_LIMITS.DATE_MAX && DATE_RE.test(v);
const optional = (v: unknown, ok: (x: string) => boolean): v is string | null | undefined =>
  v == null || (typeof v === 'string' && ok(v));

function parseShares(v: unknown, total: number): Share[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > V1_LIMITS.MAX_SHARES) return null;
  const seen = new Set<string>();
  let sum = 0;
  const out: Share[] = [];
  for (const s of v) {
    if (!s || !isUuid(s.memberId) || seen.has(s.memberId) || !paise(s.paise, 0)) return null;
    seen.add(s.memberId);
    sum += s.paise;
    out.push({ memberId: s.memberId, paise: s.paise });
  }
  return sum === total ? out : null;
}

function parseExpenseBody(o: any): ExpenseBody | null {
  if (!o || typeof o !== 'object') return null;
  if (!isUuid(o.entityId) || !paise(o.amountPaise, 1) || !text(o.title, V1_LIMITS.TITLE_MAX)) return null;
  if (!text(o.categoryId, V1_LIMITS.CATEGORY_MAX) || !date(o.date) || !isUuid(o.paidBy)) return null;
  const shares = parseShares(o.shares, o.amountPaise);
  if (!shares) return null;
  return {
    entityId: o.entityId, amountPaise: o.amountPaise, title: o.title,
    categoryId: o.categoryId, date: o.date, paidBy: o.paidBy, shares,
  };
}

function parseDebts(v: unknown): Debt[] | null {
  if (!Array.isArray(v) || v.length > V1_LIMITS.MAX_DEBTS) return null;
  const out: Debt[] = [];
  for (const d of v) {
    if (!d || !isUuid(d.from) || !isUuid(d.to) || d.from === d.to || !paise(d.paise, 1)) return null;
    out.push({ from: d.from, to: d.to, paise: d.paise });
  }
  return out;
}

const uuidList = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= V1_LIMITS.MAX_MEMBERS && v.every(isUuid) ? [...v] : null;

function parseCheckpoint(o: any): CheckpointBody | null {
  if (!Number.isSafeInteger(o.baseSeq) || o.baseSeq < 1) return null;
  let meta: CheckpointBody['meta'] = null;
  if (o.meta != null) {
    const m = o.meta;
    if (!text(m.name, V1_LIMITS.NAME_MAX)) return null;
    if (!optional(m.emoji, (e) => e.length <= V1_LIMITS.EMOJI_MAX)) return null;
    if (!optional(m.color, (c) => /^#[0-9a-fA-F]{6}$/.test(c))) return null;
    meta = { name: m.name, emoji: m.emoji ?? null, color: m.color ?? null };
  }
  if (!Array.isArray(o.members) || o.members.length > V1_LIMITS.MAX_MEMBERS) return null;
  const seen = new Set<string>();
  const members: CheckpointMember[] = [];
  for (const m of o.members) {
    if (!m || !isUuid(m.memberId) || seen.has(m.memberId) || !text(m.name, V1_LIMITS.NAME_MAX)) return null;
    if (!(m.userId === null || isUuid(m.userId)) || typeof m.archived !== 'boolean') return null;
    seen.add(m.memberId);
    members.push({ memberId: m.memberId, name: m.name, userId: m.userId, archived: m.archived });
  }
  const activeUsers = uuidList(o.activeUsers);
  const deletedUsers = uuidList(o.deletedUsers);
  const debts = parseDebts(o.debts);
  if (!activeUsers || !deletedUsers || !debts) return null;
  if (debts.some((d) => !seen.has(d.from) || !seen.has(d.to))) return null;
  if (o.corrections !== undefined && !Array.isArray(o.corrections)) return null;
  const corrections: CorrectionHead[] = [];
  for (const c of o.corrections ?? []) {
    if (!c || !isUuid(c.correctsId) || !isUuid(c.head) || typeof c.deleted !== 'boolean') return null;
    corrections.push({ correctsId: c.correctsId, head: c.head, deleted: c.deleted });
  }
  return { baseSeq: o.baseSeq, meta, members, activeUsers, deletedUsers, debts, corrections };
}

/** The event, rebuilt from known fields only — or null if anything is off. */
export function parseEvent(json: string | null): ParsedEvent | null {
  if (json == null) return null;
  let o: any;
  try { o = JSON.parse(json); } catch { return null; }
  if (!o || typeof o !== 'object' || o.v !== EVENT_VERSION || typeof o.at !== 'string') return null;
  const at: string = o.at;

  switch (o.type) {
    case 'group.meta':
      if (!text(o.name, V1_LIMITS.NAME_MAX)) return null;
      if (!optional(o.emoji, (e) => e.length <= V1_LIMITS.EMOJI_MAX)) return null;
      if (!optional(o.color, (c) => /^#[0-9a-fA-F]{6}$/.test(c))) return null;
      return { at, event: { type: o.type, name: o.name, emoji: o.emoji ?? null, color: o.color ?? null } };

    case 'member.add':
      if (!isUuid(o.memberId) || !text(o.name, V1_LIMITS.NAME_MAX)) return null;
      // A malformed fingerprint is dropped, never the person.
      return { at, event: { type: o.type, memberId: o.memberId, name: o.name, ...(isPhoneKey(o.phoneKey) ? { phoneKey: o.phoneKey } : {}) } };

    case 'member.rename':
      if (!isUuid(o.memberId) || !text(o.name, V1_LIMITS.NAME_MAX)) return null;
      return { at, event: { type: o.type, memberId: o.memberId, name: o.name } };

    case 'member.phone':
      if (!isUuid(o.memberId) || !isPhoneKey(o.phoneKey)) return null;
      return { at, event: { type: o.type, memberId: o.memberId, phoneKey: o.phoneKey } };

    case 'member.claim':
      if (!isUuid(o.memberId) || !isUuid(o.userId)) return null;
      return { at, event: { type: o.type, memberId: o.memberId, userId: o.userId } };

    case 'member.archive':
      if (!isUuid(o.memberId)) return null;
      return { at, event: { type: o.type, memberId: o.memberId } };

    case 'expense.upsert': {
      const body = parseExpenseBody(o);
      return body ? { at, event: { type: o.type, ...body } } : null;
    }

    case 'group.checkpoint': {
      const body = parseCheckpoint(o);
      return body ? { at, event: { type: o.type, ...body } } : null;
    }

    case 'expense.correct': {
      if (!isUuid(o.entityId) || !isUuid(o.correctsId) || !isUuid(o.base) || o.entityId === o.correctsId) return null;
      if (!text(o.title, V1_LIMITS.TITLE_MAX) || !date(o.date)) return null;
      const debts = parseDebts(o.debts);
      const expense = o.expense === null ? null : parseExpenseBody(o.expense);
      if (!debts || (o.expense !== null && !expense)) return null;
      if (expense && expense.entityId !== o.correctsId) return null;
      return { at, event: { type: o.type, entityId: o.entityId, correctsId: o.correctsId, base: o.base, title: o.title, date: o.date, debts, expense } };
    }

    case 'settlement.upsert':
      if (!isUuid(o.entityId) || !isUuid(o.from) || !isUuid(o.to) || o.from === o.to) return null;
      if (!paise(o.amountPaise, 1) || !date(o.date)) return null;
      return {
        at,
        event: { type: o.type, entityId: o.entityId, from: o.from, to: o.to, amountPaise: o.amountPaise, date: o.date },
      };

    case 'expense.delete':
    case 'settlement.delete':
      if (!isUuid(o.entityId)) return null;
      return { at, event: { type: o.type, entityId: o.entityId } };

    default:
      return null;
  }
}
