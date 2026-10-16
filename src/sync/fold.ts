// =============================================================================
// Shared-group fold (docs/SHARED_GROUP_SYNC.md §6–§8b). PURE and DETERMINISTIC.
//
// Every phone folds the same server events, in seq order, into the same state —
// that is the whole guarantee that totals and balances agree. So nothing here
// may read the clock, local data or settings: only the event and the state
// built from the events before it. An event that breaks a rule is skipped, the
// same way on every phone.
//
// Money is tracked twice, always in step: `balances` (per member: + = is owed,
// − = owes) and `debts` (who owes whom, per pair — what Lent/Borrowed shows).
// Edits: any member, last one (by seq) wins; every version is kept with who and when.
//
// Checkpoints: a phone holding the full history VERIFIES a checkpoint against its
// own state; a phone missing history (late joiner, restored phone) ADOPTS it.
// Either way, every entry before it is frozen: the rules ignore it from then on,
// exactly as a phone that never saw it would. Later edits to a frozen expense
// arrive as `expense.correct` — the change in who-owes-whom.
// =============================================================================

import {
  parseEvent, type CheckpointBody, type CorrectionBody, type Debt, type ExpenseBody,
  type SettlementBody, type SyncEvent,
} from './events';

export type MemberState = { name: string; userId: string | null; archived: boolean };

/** One saved version of an entry: who sent it and the server's time. */
export type Version<T> = { seq: number; by: string; at: string; data: T };

type EntryOf<K extends string, T> = {
  kind: K;
  /** Who added it. */
  createdBy: string;
  /** The current version (= the last of `versions`). */
  data: T;
  versions: Version<T>[];
  /** `seq` absent on folds saved before Oct-15-26. */
  deleted: { by: string; at: string; seq?: number } | null;
  /** From before the last checkpoint: shown in history, ignored by the rules. */
  frozen: boolean;
};

export type EntryState =
  | EntryOf<'expense', ExpenseBody>
  | EntryOf<'settlement', SettlementBody>
  | EntryOf<'correction', CorrectionBody>;

export type GroupFold = {
  /** Last applied server seq — the sync cursor. */
  seq: number;
  meta: { name: string; emoji: string | null; color: string | null } | null;
  /** User ids with server access right now. */
  activeUsers: string[];
  /** User ids that deleted their account — shown as "Deleted Account". */
  deletedUsers: string[];
  members: Record<string, MemberState>;
  /** memberIds in the order they were added, for stable display. */
  memberOrder: string[];
  entries: Record<string, EntryState>;
  balances: Record<string, number>;
  /** `${a}|${b}` (a < b) → what b owes a; negative = a owes b. Zero pairs are dropped. */
  debts: Record<string, number>;
  /** This phone has every entry from this seq on (0 = from the start). */
  historyFrom: number;
  lastCheckpoint: number;
  /** A checkpoint that disagreed with this phone's history — show "Balances Disagree". */
  checkpointMismatch: number | null;
  /** Server time of the last event — when the group went quiet (absent on folds saved before Oct-14-26). */
  lastAt?: string | null;
  /** Corrected expense id → its latest correction (a correction must build on it). */
  corrections?: Record<string, { head: string; deleted: boolean }>;
  /**
   * memberId → phone fingerprint (sync/phoneKey.ts), for linking people to contacts.
   * Kept OUT of MemberState and checkpoints on purpose: it never decides a balance, and
   * phones that don't know it must still build identical checkpoints.
   */
  phoneKeys?: Record<string, string>;
};

/** A row of `group_events`, with the ciphertext already opened (null = couldn't be). */
export type IncomingEvent = {
  seq: number;
  eventId: string;
  authorId: string | null;
  systemType: string | null;
  systemSubject: string | null;
  plaintext: string | null;
  /** Server time (`group_events.created_at`) — a phone's own clock can be wrong. */
  createdAt: string;
};

export type Rejection = { seq: number; eventId: string; reason: string };

export const MAX_MEMBERS = 100;

export const emptyFold = (): GroupFold => ({
  seq: 0, meta: null, activeUsers: [], deletedUsers: [], members: {}, memberOrder: [], entries: {},
  balances: {}, debts: {}, historyFrom: 0, lastCheckpoint: 0, checkpointMismatch: null, lastAt: null, corrections: {},
  phoneKeys: {},
});

// Maps and arrays are copied once per fold; member/entry objects are replaced, never mutated.
const cloneFold = (f: GroupFold): GroupFold => ({
  ...f,
  activeUsers: [...f.activeUsers],
  deletedUsers: [...f.deletedUsers],
  members: { ...f.members },
  memberOrder: [...f.memberOrder],
  entries: { ...f.entries },
  balances: { ...f.balances },
  debts: { ...f.debts },
  corrections: { ...f.corrections },
  phoneKeys: { ...f.phoneKeys },
});

/** The entry as the rules see it: frozen ones don't exist. */
const live = (f: GroupFold, id: string): EntryState | undefined => {
  const e = f.entries[id];
  return e && !e.frozen ? e : undefined;
};

// ── Money ────────────────────────────────────────────────────────────────────

function addDebt(pairs: Record<string, number>, from: string, to: string, paise: number) {
  if (from === to || paise === 0) return;
  const [a, b, sign] = to < from ? [to, from, 1] : [from, to, -1];
  const key = `${a}|${b}`;
  const v = (pairs[key] ?? 0) + sign * paise;
  if (v === 0) delete pairs[key];
  else pairs[key] = v;
}

/** Pair map → sorted list, each debt positive. */
export function debtList(pairs: Record<string, number>): Debt[] {
  return Object.keys(pairs).sort().map((key) => {
    const [a, b] = key.split('|');
    const v = pairs[key];
    return v > 0 ? { from: b, to: a, paise: v } : { from: a, to: b, paise: -v };
  });
}

/** Who owes whom because of one expense: every sharer except the payer owes the payer. */
export const expenseDebts = (e: ExpenseBody): Debt[] =>
  e.shares.filter((s) => s.memberId !== e.paidBy && s.paise > 0)
    .map((s) => ({ from: s.memberId, to: e.paidBy, paise: s.paise }));

function entryDebts(e: EntryState): Debt[] {
  switch (e.kind) {
    case 'expense': return expenseDebts(e.data);
    // `from` paid `to`: what `from` owed shrinks, i.e. `to` now owes `from`.
    case 'settlement': return [{ from: e.data.to, to: e.data.from, paise: e.data.amountPaise }];
    case 'correction': return e.data.debts;
  }
}

function applyDebts(f: GroupFold, debts: Debt[], sign: 1 | -1) {
  for (const d of debts) {
    addDebt(f.debts, d.from, d.to, sign * d.paise);
    addBalance(f, d.to, sign * d.paise);
    addBalance(f, d.from, -sign * d.paise);
  }
}

function addBalance(f: GroupFold, memberId: string, delta: number) {
  const v = (f.balances[memberId] ?? 0) + delta;
  if (v === 0) delete f.balances[memberId];
  else f.balances[memberId] = v;
}

// ── Checkpoints and corrections (built by the app, applied here) ─────────────

/** This phone's state as a checkpoint — also what an incoming checkpoint is compared against. */
export const buildCheckpoint = (f: GroupFold): CheckpointBody => ({
  baseSeq: f.seq,
  meta: f.meta,
  members: f.memberOrder.map((id) => ({ memberId: id, ...f.members[id] })),
  activeUsers: [...f.activeUsers].sort(),
  deletedUsers: [...f.deletedUsers].sort(),
  debts: debtList(f.debts),
  corrections: Object.keys(f.corrections ?? {}).sort().map((id) => ({ correctsId: id, ...f.corrections![id] })),
});

const sameCheckpoint = (a: CheckpointBody, b: CheckpointBody) => {
  // Named fields only — the parsed event also carries `type`.
  const norm = (c: CheckpointBody) => JSON.stringify({
    baseSeq: c.baseSeq,
    meta: c.meta,
    members: c.members,
    activeUsers: [...c.activeUsers].sort(),
    deletedUsers: [...c.deletedUsers].sort(),
    debts: [...c.debts].sort((x, y) => (x.from + x.to < y.from + y.to ? -1 : 1)),
    corrections: [...c.corrections].sort((x, y) => (x.correctsId < y.correctsId ? -1 : 1)),
  });
  return norm(a) === norm(b);
};

/**
 * An edit (or delete, `next` null) of a FROZEN expense, as the change in who-owes-whom.
 * null when this phone doesn't hold that frozen expense — the UI only offers Edit when it does.
 * `from` = the version it changes, when a correction not yet in the history already changed it;
 * `base` = that correction's id (else the latest one in the history).
 */
export function buildCorrection(
  f: GroupFold, correctionId: string, correctsId: string, next: ExpenseBody | null, from?: ExpenseBody, base?: string,
): CorrectionBody | null {
  const old = f.entries[correctsId];
  if (!old || !old.frozen || old.kind !== 'expense' || old.deleted) return null;
  const pairs: Record<string, number> = {};
  for (const d of expenseDebts(from ?? old.data)) addDebt(pairs, d.from, d.to, -d.paise);
  if (next) for (const d of expenseDebts(next)) addDebt(pairs, d.from, d.to, d.paise);
  return {
    entityId: correctionId,
    correctsId,
    base: base ?? f.corrections?.[correctsId]?.head ?? correctsId,
    title: (next ?? from ?? old.data).title,
    date: (next ?? from ?? old.data).date,
    debts: debtList(pairs),
    expense: next,
  };
}

// ── Rules ────────────────────────────────────────────────────────────────────

const involved = (e: EntryState | undefined): Set<string> => {
  if (!e) return new Set();
  switch (e.kind) {
    case 'expense': return new Set([e.data.paidBy, ...e.data.shares.map((s) => s.memberId)]);
    case 'settlement': return new Set([e.data.from, e.data.to]);
    case 'correction': return new Set(e.data.debts.flatMap((d) => [d.from, d.to]));
  }
};

/** Members an entry may reference: existing, and not archived unless already on this entry. */
function badMembers(f: GroupFold, ids: string[], prev: EntryState | undefined): string | null {
  const already = involved(prev);
  for (const id of ids) {
    const m = f.members[id];
    if (!m) return 'unknown_member';
    if (m.archived && !already.has(id)) return 'archived_member';
  }
  return null;
}

/** Someone who has left settled at ₹0 and isn't here to see changes: nothing may move their balance. */
function movesPastMember(f: GroupFold, before: Debt[], after: Debt[]): boolean {
  const net: Record<string, number> = {};
  for (const [debts, sign] of [[before, -1], [after, 1]] as const) {
    for (const d of debts) {
      net[d.from] = (net[d.from] ?? 0) - sign * d.paise;
      net[d.to] = (net[d.to] ?? 0) + sign * d.paise;
    }
  }
  return Object.entries(net).some(([id, n]) => n !== 0 && f.members[id]?.archived);
}

function applySystem(f: GroupFold, type: string, subject: string | null): string | null {
  if (!subject) return 'bad_system';
  switch (type) {
    case 'group_created':
    case 'member_joined':
      if (!f.activeUsers.includes(subject)) f.activeUsers.push(subject);
      f.deletedUsers = f.deletedUsers.filter((u) => u !== subject);
      // Back after leaving or being removed: they're their old self again, in new expenses too.
      for (const [id, m] of Object.entries(f.members)) {
        if (m.userId === subject && m.archived) f.members[id] = { ...m, archived: false };
      }
      return null;
    case 'member_left':
    case 'member_removed':
    case 'member_deleted':
      f.activeUsers = f.activeUsers.filter((u) => u !== subject);
      if (type === 'member_deleted' && !f.deletedUsers.includes(subject)) f.deletedUsers.push(subject);
      return null;
    default:
      return 'unknown_system';
  }
}

function freezeAll(f: GroupFold) {
  for (const id of Object.keys(f.entries)) {
    if (!f.entries[id].frozen) f.entries[id] = { ...f.entries[id], frozen: true };
  }
}

function applyCheckpoint(f: GroupFold, cp: CheckpointBody, seq: number, missingHistory: boolean): string | null {
  if (cp.baseSeq !== seq - 1) return 'bad_checkpoint';
  freezeAll(f);
  f.lastCheckpoint = seq;

  if (!missingHistory) {
    if (sameCheckpoint(buildCheckpoint({ ...f, seq: cp.baseSeq }), cp)) return null;
    // Keep what our own history says; only a phone without history has to trust it.
    f.checkpointMismatch = seq;
    return 'checkpoint_mismatch';
  }

  f.meta = cp.meta;
  f.members = {};
  f.memberOrder = [];
  for (const m of cp.members) {
    f.members[m.memberId] = { name: m.name, userId: m.userId, archived: m.archived };
    f.memberOrder.push(m.memberId);
  }
  f.activeUsers = [...cp.activeUsers];
  f.deletedUsers = [...cp.deletedUsers];
  f.debts = {};
  f.balances = {};
  applyDebts(f, cp.debts, 1);
  f.corrections = Object.fromEntries(cp.corrections.map((c) => [c.correctsId, { head: c.head, deleted: c.deleted }]));
  f.historyFrom = seq;
  return null;
}

function applyData(f: GroupFold, ev: SyncEvent, author: string, seq: number, at: string): string | null {
  switch (ev.type) {
    case 'group.meta':
      f.meta = { name: ev.name, emoji: ev.emoji, color: ev.color };
      return null;

    case 'member.add':
      if (f.members[ev.memberId]) return 'member_exists';
      if (f.memberOrder.length >= MAX_MEMBERS) return 'too_many_members';
      f.members[ev.memberId] = { name: ev.name, userId: null, archived: false };
      f.memberOrder.push(ev.memberId);
      if (ev.phoneKey) f.phoneKeys = { ...f.phoneKeys, [ev.memberId]: ev.phoneKey };
      return null;

    case 'member.phone':
      if (!f.members[ev.memberId]) return 'unknown_member';
      f.phoneKeys = { ...f.phoneKeys, [ev.memberId]: ev.phoneKey };
      return null;

    case 'member.claim': {
      const m = f.members[ev.memberId];
      if (ev.userId !== author) return 'claim_for_other';
      if (!m || m.archived) return 'unknown_member';
      if (m.userId) return 'already_claimed';
      if (Object.values(f.members).some((x) => x.userId === author)) return 'claimed_twice';
      f.members[ev.memberId] = { ...m, userId: author };
      return null;
    }

    case 'member.rename': {
      const m = f.members[ev.memberId];
      if (!m) return 'unknown_member';
      f.members[ev.memberId] = { ...m, name: ev.name };
      return null;
    }

    case 'member.archive': {
      const m = f.members[ev.memberId];
      if (!m || m.archived) return 'unknown_member';
      if ((f.balances[ev.memberId] ?? 0) !== 0) return 'not_settled';
      f.members[ev.memberId] = { ...m, archived: true };
      return null;
    }

    case 'expense.upsert':
    case 'settlement.upsert': {
      const kind = ev.type === 'expense.upsert' ? 'expense' : 'settlement';
      const prev = live(f, ev.entityId);
      if (prev && prev.kind !== kind) return 'wrong_kind';
      if (prev?.deleted) return 'deleted';

      const { type: _t, ...data } = ev;
      const version = { seq, by: author, at, data };
      const next = {
        kind,
        createdBy: prev ? prev.createdBy : author,
        data,
        versions: prev ? [...prev.versions, version] : [version],
        deleted: null,
        frozen: false,
      } as EntryState;
      const bad = badMembers(f, [...involved(next)], prev);
      if (bad) return bad;
      if (prev && movesPastMember(f, entryDebts(prev), entryDebts(next))) return 'past_member';

      if (prev) applyDebts(f, entryDebts(prev), -1);
      applyDebts(f, entryDebts(next), 1);
      f.entries[ev.entityId] = next;
      return null;
    }

    case 'expense.delete':
    case 'settlement.delete': {
      const kind = ev.type === 'expense.delete' ? 'expense' : 'settlement';
      const prev = live(f, ev.entityId);
      if (!prev || prev.kind !== kind || prev.deleted) return 'unknown_entry';
      // Any member, like editing (decided Oct-15-2026).
      if (movesPastMember(f, entryDebts(prev), [])) return 'past_member';
      applyDebts(f, entryDebts(prev), -1);
      f.entries[ev.entityId] = { ...prev, deleted: { by: author, at, seq } } as EntryState;
      return null;
    }

    case 'expense.correct': {
      if (live(f, ev.entityId)) return 'entry_exists';
      // A live expense is simply edited; only frozen (or, on a late joiner, unseen) ones are corrected.
      if (live(f, ev.correctsId)) return 'not_frozen';
      const { type: _t, ...data } = ev;
      const entry: EntryState = {
        kind: 'correction', createdBy: author, data, versions: [{ seq, by: author, at, data }], deleted: null, frozen: false,
      };
      for (const d of data.debts) if (!f.members[d.from] || !f.members[d.to]) return 'unknown_member';
      // Built on the latest version, else two edits made at once would both count (last one wins
      // instead: the phone that lost rebuilds its edit on top — expenses.ts reconcileOutbox).
      const chain = f.corrections?.[data.correctsId];
      if (chain?.deleted) return 'deleted';
      if (data.base !== (chain?.head ?? data.correctsId)) return 'stale_correction';
      if (movesPastMember(f, [], data.debts)) return 'past_member';
      applyDebts(f, data.debts, 1);
      f.entries[ev.entityId] = entry;
      f.corrections = { ...f.corrections, [data.correctsId]: { head: ev.entityId, deleted: data.expense === null } };

      // Display only: a phone that still holds the original shows it updated in place.
      const orig = f.entries[ev.correctsId];
      if (orig && orig.kind === 'expense') {
        f.entries[ev.correctsId] = data.expense
          ? { ...orig, data: data.expense, versions: [...orig.versions, { seq, by: author, at, data: data.expense }] }
          : { ...orig, deleted: { by: author, at, seq } };
      }
      return null;
    }

    case 'group.checkpoint':
      return 'bad_checkpoint'; // handled in applyMut, which knows whether history is missing
  }
}

function applyMut(f: GroupFold, e: IncomingEvent): string | null {
  if (e.seq <= f.seq) return 'already_applied';
  // Seqs are contiguous on the server; a jump means events before it were compacted away.
  const missingHistory = e.seq > f.seq + 1;
  f.seq = e.seq;
  f.lastAt = e.createdAt;

  if (e.systemType) return applySystem(f, e.systemType, e.systemSubject);

  const parsed = parseEvent(e.plaintext);
  if (parsed?.event.type === 'group.checkpoint' && missingHistory) {
    // The server checked membership; a phone missing history can't, and has to start somewhere.
    return applyCheckpoint(f, parsed.event, e.seq, true);
  }
  if (!e.authorId || !f.activeUsers.includes(e.authorId)) return 'not_member';
  if (!parsed) return 'unreadable';
  if (parsed.event.type === 'group.checkpoint') return applyCheckpoint(f, parsed.event, e.seq, false);
  return applyData(f, parsed.event, e.authorId, e.seq, e.createdAt);
}

/** Folds events (any order in; applied in seq order) onto `fold`. Never mutates `fold`. */
export function foldEvents(fold: GroupFold, events: IncomingEvent[]): { fold: GroupFold; rejected: Rejection[] } {
  const f = cloneFold(fold);
  const rejected: Rejection[] = [];
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const reason = applyMut(f, e);
    if (reason && reason !== 'already_applied') rejected.push({ seq: e.seq, eventId: e.eventId, reason });
  }
  return { fold: f, rejected };
}
