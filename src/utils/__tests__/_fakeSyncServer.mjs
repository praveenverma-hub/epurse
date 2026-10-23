// =============================================================================
// In-memory stand-in for the Supabase side of shared-group sync (test-only).
// Exports the same functions as src/sync/api.ts, and follows the LATEST version
// of each SQL function in supabase/migrations/ (the SQL itself is tested by test:sql) — so the real groupSync, fold and
// crypto run against it unchanged. Row-level security is modelled where reads
// depend on it (only members see a group's rows).
//
//   globalThis.__syncUser   — the signed-in user of the phone currently acting
//   server.now              — the server clock: Date.now(), which tests move
//   server.offline          — every call fails like a dropped connection
//   server.failOnce(name)   — the next call to that RPC fails like a dropped connection
//   server.loseReplyOnce(name) — the next call to it WORKS, but its reply is lost (network error)
// =============================================================================
import { PROJECT_ROOT } from './paths.mjs';

const { syncErrorFor } = await import(`${PROJECT_ROOT}/src/sync/api.ts`);
const { sha256Hex } = await import(`${PROJECT_ROOT}/src/sync/crypto.ts`);

const DAY = 86_400_000;

export const server = {
  get now() { return Date.now(); },
  offline: false,
  failing: new Set(),
  losing: new Set(),
  groups: new Map(),        // id → { id, created_by, last_seq, key_epoch, checkpoint_seq, verified_checkpoint_seq, last_event_at, expires_at, dormant_at, last_push_at }
  members: [],              // { group_id, user_id, role, joined_at }
  invites: new Map(),       // id → { group_id, created_by, token_hash, expires_at, used_by, used_at, revoked_at, member_id }
  events: [],               // { group_id, seq, event_id, author_id, key_epoch, nonce, ciphertext, system_type, system_subject, system_member, created_at }
  former: new Set(),        // `${group}|${user}` — group_former_members
  beforeAppend: null,       // test hook: runs once, inside the next append_events, before it writes (a race)
  deletedUsers: new Set(),
  compacted: new Map(),     // event_id → { group_id, seq } — group_compacted_ids
  pokes: [],                // realtime broadcasts { group, seq }
  pushes: [],               // push sends { group, to: [user ids] }
  failOnce(name) { this.failing.add(name); },
  loseReplyOnce(name) { this.losing.add(name); },
  reset() {
    this.offline = false;
    this.failing.clear(); this.losing.clear();
    this.groups.clear(); this.members = []; this.invites.clear(); this.events = [];
    this.deletedUsers.clear(); this.compacted.clear(); this.pokes = []; this.pushes = []; this.former.clear(); this.beforeAppend = null;
  },
};

let joinedCounter = 0;
const uid = () => globalThis.__syncUser ?? null;
const iso = () => new Date(server.now).toISOString();
const raise = (msg) => { throw syncErrorFor(msg); };
const net = (name) => {
  if (server.offline || server.failing.delete(name)) throw syncErrorFor('fetch failed');
};
const isMember = (g, u = uid()) => server.members.some((m) => m.group_id === g && m.user_id === u);
const membersOf = (g) => server.members.filter((m) => m.group_id === g);

// The trigger on groups.last_seq (20261015000000_realtime_push.sql): a poke always,
// a push at most every 10 minutes, never for a checkpoint, never to the author.
function onActivity(g) {
  server.pokes.push({ group: g.id, seq: g.last_seq });
  if (g.checkpoint_seq === g.last_seq) return;
  if (g.last_push_at != null && g.last_push_at >= server.now - 10 * 60_000) return;
  const to = membersOf(g.id).map((m) => m.user_id).filter((u) => u !== uid());
  if (to.length) { server.pushes.push({ group: g.id, to }); g.last_push_at = server.now; }
}

function appendSystem(groupId, type, subject, member = null) {
  const g = server.groups.get(groupId);
  g.last_seq += 1;
  server.events.push({ group_id: groupId, seq: g.last_seq, event_id: crypto.randomUUID(), author_id: null,
    key_epoch: null, nonce: null, ciphertext: null, system_type: type, system_subject: subject, system_member: member, created_at: iso() });
  onActivity(g);
}

function removeMember(groupId, userId, type) {
  const before = server.members.length;
  server.members = server.members.filter((m) => !(m.group_id === groupId && m.user_id === userId));
  if (server.members.length === before) return;
  if (!membersOf(groupId).length) {
    server.groups.delete(groupId);
    server.events = server.events.filter((e) => e.group_id !== groupId);   // on delete cascade
    for (const [id, inv] of server.invites) if (inv.group_id === groupId) server.invites.delete(id);
    return;
  }
  if (!membersOf(groupId).some((m) => m.role === 'admin')) {
    const next = [...membersOf(groupId)].sort((a, b) => a.joined_at - b.joined_at || (a.user_id < b.user_id ? -1 : 1))[0];
    next.role = 'admin';
  }
  // 20261024000000: their open invites stop working; a leaver/removed person is a former member.
  for (const inv of server.invites.values()) {
    if (inv.group_id === groupId && inv.created_by === userId && !inv.used_at && !inv.revoked_at) inv.revoked_at = server.now;
  }
  if (type === 'member_left' || type === 'member_removed') server.former.add(`${groupId}|${userId}`);
  appendSystem(groupId, type, userId);
}

// ── RPCs (same names and shapes as src/sync/api.ts) ──────────────────────────

export async function rpcCreateGroup(groupId) {
  net('create_group');
  if (!uid()) raise('not signed in');
  if (server.groups.has(groupId)) {
    if (isMember(groupId)) return;
    raise('group id in use');
  }
  if (server.members.filter((m) => m.user_id === uid()).length >= 100) raise('too many groups');
  server.groups.set(groupId, { id: groupId, created_by: uid(), last_seq: 0, key_epoch: 1, checkpoint_seq: null,
    verified_checkpoint_seq: null, last_event_at: null, expires_at: server.now + 90 * DAY, dormant_at: null, last_push_at: null });
  server.members.push({ group_id: groupId, user_id: uid(), role: 'admin', joined_at: ++joinedCounter });
  appendSystem(groupId, 'group_created', uid());
}

export async function rpcAppendEvents(groupId, rows) {
  net('append_events');
  if (server.beforeAppend) { const race = server.beforeAppend; server.beforeAppend = null; race(groupId); }
  if (!isMember(groupId)) raise('not a member');
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 50) raise('batch must hold 1-50 events');
  const g = server.groups.get(groupId);
  const out = [];
  let inserted = false;
  for (const r of rows) {
    const found = server.events.find((e) => e.event_id === r.event_id) ?? server.compacted.get(r.event_id);
    if (found) {
      if (found.group_id !== groupId) raise('event id in use');
      out.push({ r_event_id: r.event_id, r_seq: found.seq });
      continue;
    }
    if (r.key_epoch !== g.key_epoch) raise('stale key epoch');
    g.last_seq += 1;
    server.events.push({ group_id: groupId, seq: g.last_seq, event_id: r.event_id, author_id: uid(), key_epoch: g.key_epoch,
      nonce: r.nonce, ciphertext: r.ciphertext, system_type: null, system_subject: null, created_at: iso() });
    inserted = true;
    out.push({ r_event_id: r.event_id, r_seq: g.last_seq });
  }
  if (inserted) {
    Object.assign(g, { last_event_at: server.now, expires_at: server.now + 90 * DAY, dormant_at: null });
    onActivity(g);   // one UPDATE of last_seq per batch → one trigger run
  }
  if (server.losing.delete('append_events')) throw syncErrorFor('fetch failed');
  return out;
}

export async function rpcAppendCheckpoint(groupId, baseSeq, row) {
  net('append_checkpoint');
  if (!isMember(groupId)) raise('not a member');
  const g = server.groups.get(groupId);
  if (server.events.some((e) => e.event_id === row.event_id && e.group_id === groupId)) return true;
  if (g.last_seq !== baseSeq) return false;
  if (row.key_epoch !== g.key_epoch) raise('stale key epoch');
  g.last_seq += 1;
  server.events.push({ group_id: groupId, seq: g.last_seq, event_id: row.event_id, author_id: uid(), key_epoch: g.key_epoch,
    nonce: row.nonce, ciphertext: row.ciphertext, system_type: null, system_subject: null, created_at: iso() });
  g.checkpoint_seq = g.last_seq;
  onActivity(g);
  return true;
}

export async function rpcAckCheckpoint(groupId, seq) {
  net('ack_checkpoint');
  const g = server.groups.get(groupId);
  if (!g || !isMember(groupId)) raise('not a member');
  if (g.checkpoint_seq !== seq) return false;
  if (server.events.some((e) => e.group_id === groupId && e.seq === seq && e.author_id === uid())) return false;
  g.verified_checkpoint_seq = Math.max(g.verified_checkpoint_seq ?? 0, seq);
  return true;
}

export async function rpcCreateInvite(inviteId, groupId, tokenHashHex, memberId = null) {
  net('create_invite');
  if (!isMember(groupId)) raise('not a member');
  const open = [...server.invites.values()].filter((i) => i.group_id === groupId && !i.used_at && !i.revoked_at && i.expires_at > server.now);
  if (open.length >= 20) raise('too many open invites');
  const expires = server.now + 2 * DAY;
  server.invites.set(inviteId, { group_id: groupId, created_by: uid(), token_hash: tokenHashHex, expires_at: expires, used_by: null, used_at: null, revoked_at: null, member_id: memberId });
  return new Date(expires).toISOString();
}

export async function rpcRedeemInvite(inviteId, token) {
  net('redeem_invite');
  if (!uid()) raise('not signed in');
  const inv = server.invites.get(inviteId);
  if (!token || token.length < 32 || !inv || inv.token_hash !== sha256Hex(token)) raise('invalid invite');
  if (!server.groups.has(inv.group_id)) raise('group has ended');
  if (!isMember(inv.group_id)) {
    if (inv.used_at || inv.revoked_at || inv.expires_at <= server.now) raise('invite expired or used');
    if (membersOf(inv.group_id).length >= 50) raise('group is full');
    if (server.members.filter((m) => m.user_id === uid()).length >= 100) raise('too many groups');
    server.members.push({ group_id: inv.group_id, user_id: uid(), role: 'member', joined_at: ++joinedCounter });
    server.former.delete(`${inv.group_id}|${uid()}`);
    Object.assign(inv, { used_by: uid(), used_at: server.now });
    appendSystem(inv.group_id, 'member_joined', uid(), inv.member_id ?? null);
  }
  const g = server.groups.get(inv.group_id);
  return { groupId: g.id, keyEpoch: g.key_epoch, lastSeq: g.last_seq, memberId: inv.member_id ?? null };
}

export async function rpcLeaveGroup(groupId) {
  net('leave_group');
  if (!uid()) raise('not signed in');
  if (server.groups.has(groupId)) removeMember(groupId, uid(), 'member_left');
}

export async function rpcRemoveMember(groupId, userId) {
  net('remove_member');
  if (!isMember(groupId)) raise('not a member');
  removeMember(groupId, userId, 'member_removed');
}

export async function rpcReaddMember(groupId, userId) {
  net('readd_member');
  if (!isMember(groupId)) raise('not a member');
  if (isMember(groupId, userId)) return;
  if (!server.former.has(`${groupId}|${userId}`)) raise('not a former member');
  if (server.deletedUsers.has(userId)) raise('insert or update on table "group_members" violates foreign key constraint');
  if (membersOf(groupId).length >= 50) raise('group is full');
  if (server.members.filter((m) => m.user_id === userId).length >= 100) raise('member has too many groups');
  server.former.delete(`${groupId}|${userId}`);
  server.members.push({ group_id: groupId, user_id: userId, role: 'member', joined_at: ++joinedCounter });
  appendSystem(groupId, 'member_joined', userId);
}

export const rpcRegisterPushToken = async () => { net('register_push_token'); };
export const rpcUnregisterPushToken = async () => { net('unregister_push_token'); };
export const hasSyncSession = async () => !!uid();

export async function fetchEvents(groupId, afterSeq, limit = 500) {
  net('fetch_events');
  if (!isMember(groupId)) return [];   // row-level security
  return server.events.filter((e) => e.group_id === groupId && e.seq > afterSeq)
    .sort((a, b) => a.seq - b.seq).slice(0, limit).map(({ group_id: _g, ...r }) => ({ ...r }));
}

export async function fetchMyGroupIds(userId) {
  net('fetch_my_groups');
  return new Set(server.members.filter((m) => m.user_id === userId).map((m) => m.group_id));
}

export { syncErrorFor };

// ── Server-only jobs (Edge Function / cron) ──────────────────────────────────

/** delete-account Edge Function: purge_user, then the auth user goes (author_id stays since 20261018). */
export function serverDeleteAccount(userId) {
  for (const m of server.members.filter((x) => x.user_id === userId)) removeMember(m.group_id, userId, 'member_deleted');
  for (const [id, inv] of server.invites) if (inv.created_by === userId) server.invites.delete(id);
  server.deletedUsers.add(userId);
}

/** purge_expired (20261024000000_audit_fixes.sql): compact quiet groups up to a checkpoint ANOTHER phone confirmed, mark dormant. */
export function serverPurgeExpired() {
  for (const g of server.groups.values()) {
    if (g.expires_at > server.now) continue;
    const upTo = g.verified_checkpoint_seq;
    if (upTo != null) {
      for (const e of server.events) if (e.group_id === g.id && e.seq < upTo) server.compacted.set(e.event_id, { group_id: g.id, seq: e.seq });
      server.events = server.events.filter((e) => !(e.group_id === g.id && e.seq < upTo));
      g.expires_at = Infinity;
    }
    g.dormant_at ??= server.now;
  }
}
