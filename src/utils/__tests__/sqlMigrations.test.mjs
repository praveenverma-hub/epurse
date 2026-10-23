// =============================================================================
// Shared-group server — every migration in supabase/migrations/, applied in order
// to REAL PostgreSQL (PGlite, in-process), then called the way PostgREST calls it:
// as role `authenticated` with the caller's id in `request.jwt.claim.sub`.
//     npm run test:sql
//
// What the fake server in groupScenarios can't show: NULL semantics, grants, row-level
// security, plpgsql control flow, triggers. Supabase's own schemas (auth, realtime,
// pg_net, pg_cron) are small stand-ins below. Not covered: two sessions racing (PGlite
// has one connection) — the locks are checked by reading the functions instead.
// =============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PROJECT_ROOT } from './paths.mjs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};

const db = new PGlite({ extensions: { pgcrypto } });

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema realtime;
  create table realtime.messages (extension text, topic text);
  create function realtime.topic() returns text language sql as $$ select '' $$;
  create table realtime.sent (payload jsonb, event text, topic text);
  create function realtime.send(p jsonb, e text, t text, priv boolean) returns void language sql as
    $$ insert into realtime.sent values (p, e, t) $$;

  create schema net;
  create table net.calls (url text, body jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as
    $$ insert into net.calls values (url, body); select 1::bigint $$;

  create schema cron;
  create function cron.schedule(name text, at text, cmd text) returns bigint language sql as $$ select 1::bigint $$;
`);

const dir = `${PROJECT_ROOT}/supabase/migrations`;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  // pg_cron / pg_net are Supabase extensions: their stand-ins are above.
  const sql = readFileSync(`${dir}/${file}`, 'utf8').replace(/^create extension if not exists (pg_cron|pg_net)\b.*$/gm, '');
  try {
    await db.exec(sql);
  } catch (e) {
    console.log(`\x1b[31mmigration ${file} failed: ${e.message}\x1b[0m`);
    process.exit(1);
  }
}
await db.exec(`grant usage on schema public to anon, authenticated, service_role;`);

// ── Calling as a user ───────────────────────────────────────────────────────

const users = [];
async function newUser() {
  const id = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [id]);
  users.push(id);
  return id;
}

/** One PostgREST request: its own transaction, as `role` with `user` signed in. Returns rows or { error }. */
async function as(user, sql, params = [], role = 'authenticated') {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [role, user ?? '']);
      return (await tx.query(sql, params)).rows;
    });
  } catch (e) {
    return { error: e.message };
  }
}
const errorOf = (r) => (r && !Array.isArray(r) ? r.error : null);
const sys = async (sql, params = []) => (await db.query(sql, params)).rows;

const token = () => randomBytes(32).toString('base64url');
const hashHex = (t) => createHash('sha256').update(t).digest('hex');
const sealed = () => ({ event_id: randomUUID(), key_epoch: 1, nonce: 'n'.repeat(32), ciphertext: 'c' });

async function newGroup(owner) {
  const g = randomUUID();
  const r = await as(owner, 'select public.create_group($1)', [g]);
  if (errorOf(r)) throw new Error(errorOf(r));
  return g;
}
async function invite(by, g, memberId = null) {
  const id = randomUUID(), t = token();
  const r = await as(by, 'select public.create_invite($1, $2, $3, $4)', [id, g, hashHex(t), memberId]);
  return { id, t, error: errorOf(r) };
}
const redeem = (user, id, t) => as(user, 'select * from public.redeem_invite($1, $2)', [id, t]);
const append = (user, g, rows) => as(user, 'select * from public.append_events($1, $2::jsonb)', [g, JSON.stringify(rows)]);
const membersOf = async (g) => (await sys('select user_id from public.group_members where group_id = $1', [g])).map((r) => r.user_id);

console.log('\n— invite tokens (F01) —');
{
  const owner = await newUser(), mallory = await newUser();
  const g = await newGroup(owner);
  const inv = await invite(owner, g);
  check('invite created', !inv.error, inv.error);

  for (const [label, t] of [['NULL token', null], ['empty token', ''], ['short token', 'abc'], ['wrong token', token()]]) {
    const r = await redeem(mallory, inv.id, t);
    check(`${label} → invalid invite`, /invalid invite/.test(errorOf(r) ?? ''), JSON.stringify(r));
  }
  check('…and none of them joined or used the invite',
    !(await membersOf(g)).includes(mallory) && (await sys('select used_at from public.group_invites where id = $1', [inv.id]))[0].used_at === null);

  const ok = await redeem(mallory, inv.id, inv.t);
  check('the right token joins', !errorOf(ok) && (await membersOf(g)).includes(mallory), JSON.stringify(ok));
  const again = await redeem(mallory, inv.id, inv.t);
  check('a retried redeem by the same person succeeds without a second join',
    !errorOf(again) && (await sys(`select count(*)::int n from public.group_events where group_id = $1 and system_type = 'member_joined'`, [g]))[0].n === 1);
  const someoneElse = await newUser();
  check('a used invite refuses anyone else', /expired or used/.test(errorOf(await redeem(someoneElse, inv.id, inv.t)) ?? ''));

  const exp = await invite(owner, g);
  await sys(`update public.group_invites set expires_at = now() - interval '1 minute' where id = $1`, [exp.id]);
  check('an expired invite is refused', /expired or used/.test(errorOf(await redeem(someoneElse, exp.id, exp.t)) ?? ''));
  const rev = await invite(owner, g);
  await sys('update public.group_invites set revoked_at = now() where id = $1', [rev.id]);
  check('a revoked invite is refused', /expired or used/.test(errorOf(await redeem(someoneElse, rev.id, rev.t)) ?? ''));
  check('signed out → refused', /not signed in/.test(errorOf(await redeem(null, rev.id, rev.t)) ?? ''));
  check('a malformed token hash can\'t be stored', /bad request/.test(errorOf(await as(owner, 'select public.create_invite($1, $2, $3)', [randomUUID(), g, 'xyz'])) ?? ''));
  check('nor a NULL one', /bad request/.test(errorOf(await as(owner, 'select public.create_invite($1, $2, $3)', [randomUUID(), g, null])) ?? ''));
}

console.log('\n— outsiders and internals —');
{
  const owner = await newUser(), outsider = await newUser();
  const g = await newGroup(owner);
  await append(owner, g, [sealed()]);
  check('an outsider reads no events', (await as(outsider, 'select * from public.group_events where group_id = $1', [g])).length === 0);
  check('…no members', (await as(outsider, 'select * from public.group_members where group_id = $1', [g])).length === 0);
  check('…no group row', (await as(outsider, 'select * from public.groups where id = $1', [g])).length === 0);
  check('…and can\'t read invites at all', /permission denied/.test(errorOf(await as(outsider, 'select * from public.group_invites')) ?? ''));
  check('an outsider can\'t append', /not a member/.test(errorOf(await append(outsider, g, [sealed()])) ?? ''));
  check('…or invite', /not a member/.test((await invite(outsider, g)).error ?? ''));
  check('…or checkpoint', /not a member/.test(errorOf(await as(outsider, 'select public.append_checkpoint($1, 2, $2::jsonb)', [g, JSON.stringify(sealed())])) ?? ''));
  check('…or confirm a checkpoint', /not a member/.test(errorOf(await as(outsider, 'select public.ack_checkpoint($1, 2)', [g])) ?? ''));
  check('…or remove someone', /not a member/.test(errorOf(await as(outsider, 'select public.remove_member($1, $2)', [g, owner])) ?? ''));
  for (const [fn, args] of [
    ['_append_system', `'${g}', 'member_joined', '${outsider}'`],
    ['_remove_member', `'${g}', '${owner}', 'member_removed'`],
    ['_lock_user', `'${outsider}'`],
    ['purge_expired', ''],
    ['purge_user', `'${owner}'`],
  ]) {
    check(`members can't call ${fn}`, /permission denied/.test(errorOf(await as(owner, `select public.${fn}(${args})`)) ?? ''));
  }
  check('anon can\'t call client functions', /permission denied/.test(errorOf(await as(null, 'select public.create_group($1)', [randomUUID()], 'anon')) ?? ''));
  check('a member\'s client can\'t write tables directly',
    /permission denied/.test(errorOf(await as(owner, 'insert into public.group_members (group_id, user_id) values ($1, $2)', [g, outsider])) ?? ''));
}

console.log('\n— NULL inputs —');
{
  const owner = await newUser();
  const g = await newGroup(owner);
  check('create_group(NULL) → bad request', /bad request/.test(errorOf(await as(owner, 'select public.create_group(NULL)')) ?? ''));
  check('append_events(NULL) → refused', /1-50 events/.test(errorOf(await as(owner, 'select * from public.append_events($1, NULL)', [g])) ?? ''));
  check('an event with no id → refused', /bad request/.test(errorOf(await append(owner, g, [{ ...sealed(), event_id: null }])) ?? ''));
  check('append_checkpoint with a NULL base → refused (was: skipped the race check)',
    /bad request/.test(errorOf(await as(owner, 'select public.append_checkpoint($1, NULL, $2::jsonb)', [g, JSON.stringify(sealed())])) ?? ''));
  check('remove_member(NULL) → bad request', /bad request/.test(errorOf(await as(owner, 'select public.remove_member($1, NULL)', [g])) ?? ''));
  check('readd_member(NULL) → bad request', /bad request/.test(errorOf(await as(owner, 'select public.readd_member($1, NULL)', [g])) ?? ''));
  check('ack_checkpoint(NULL) → bad request', /bad request/.test(errorOf(await as(owner, 'select public.ack_checkpoint($1, NULL)', [g])) ?? ''));
  check('register_push_token(NULL) → bad push token', /bad push token/.test(errorOf(await as(owner, 'select public.register_push_token(NULL)')) ?? ''));
}

console.log('\n— invite for a person (F05) —');
{
  const owner = await newUser(), priya = await newUser(), other = await newUser();
  const g = await newGroup(owner);
  const priyaMember = randomUUID();
  const inv = await invite(owner, g, priyaMember);
  const r = await redeem(priya, inv.id, inv.t);
  check('redeem says who the invite is for', !errorOf(r) && r[0].r_member_id === priyaMember, JSON.stringify(r));
  const row = (await sys(`select system_member from public.group_events where group_id = $1 and system_type = 'member_joined'`, [g]))[0];
  check('…and the join row carries it for every phone', row?.system_member === priyaMember);
  check('a retry says the same', (await redeem(priya, inv.id, inv.t))[0]?.r_member_id === priyaMember);
  const plain = await invite(owner, g);
  const r2 = await redeem(other, plain.id, plain.t);
  check('a plain invite is for a new person (NULL)', !errorOf(r2) && r2[0].r_member_id === null);
}

console.log('\n— membership —');
{
  const owner = await newUser(), rahul = await newUser(), stranger = await newUser();
  const g = await newGroup(owner);
  const inv = await invite(owner, g);
  await redeem(rahul, inv.id, inv.t);
  const rahulsInvite = await invite(rahul, g);
  await as(owner, 'select public.remove_member($1, $2)', [g, rahul]);
  check('removed', !(await membersOf(g)).includes(rahul));
  check('a removed member\'s open invites stop working (F09)',
    /expired or used/.test(errorOf(await redeem(stranger, rahulsInvite.id, rahulsInvite.t)) ?? ''));

  // Compaction deletes the member_removed row: Add Back used to need it.
  await sys(`delete from public.group_events where group_id = $1 and system_type = 'member_removed'`, [g]);
  const back = await as(owner, 'select public.readd_member($1, $2)', [g, rahul]);
  check('Add Back still works once the removal row is compacted away', !errorOf(back) && (await membersOf(g)).includes(rahul), JSON.stringify(back));
  check('…and they\'re no longer a "former member"', (await sys('select * from public.group_former_members where group_id = $1', [g])).length === 0);
  check('Add Back refuses a stranger', /not a former member/.test(errorOf(await as(owner, 'select public.readd_member($1, $2)', [g, stranger])) ?? ''));

  await as(rahul, 'select public.leave_group($1)', [g]);
  check('leaving makes a former member too', (await sys('select user_id from public.group_former_members where group_id = $1', [g]))[0]?.user_id === rahul);
  const inv2 = await invite(owner, g);
  await redeem(rahul, inv2.id, inv2.t);
  check('rejoining by invite clears it', (await sys('select * from public.group_former_members where group_id = $1', [g])).length === 0);

  // 50 accounts per group.
  const big = await newGroup(owner);
  for (let i = 0; i < 49; i++) {
    const u = await newUser(), x = await invite(owner, big);
    await redeem(u, x.id, x.t);
  }
  const late = await newUser(), x = await invite(owner, big);
  check('the 51st person → group is full', /group is full/.test(errorOf(await redeem(late, x.id, x.t)) ?? ''));
  check('…and the invite is still unused', (await sys('select used_at from public.group_invites where id = $1', [x.id]))[0].used_at === null);
}

console.log('\n— checkpoints need a second phone (F02) —');
{
  const a = await newUser(), b = await newUser();
  const g = await newGroup(a);
  const inv = await invite(a, g);
  await redeem(b, inv.id, inv.t);
  await append(a, g, [sealed(), sealed()]);
  const last = (await sys('select last_seq from public.groups where id = $1', [g]))[0].last_seq;
  const cp = sealed();
  const ok = await as(a, 'select public.append_checkpoint($1, $2, $3::jsonb) ok', [g, last, JSON.stringify(cp)]);
  check('checkpoint posted', ok[0]?.ok === true, JSON.stringify(ok));
  const cpSeq = Number(last) + 1;

  const expire = () => sys(`update public.groups set expires_at = now() - interval '1 day' where id = $1`, [g]);
  const count = async () => (await sys('select count(*)::int n from public.group_events where group_id = $1', [g]))[0].n;
  const before = await count();
  await expire();
  await sys('select public.purge_expired()');
  check('an unconfirmed checkpoint deletes nothing', await count() === before);
  check('…and the group isn\'t parked forever', (await sys(`select expires_at <> 'infinity' as finite from public.groups where id = $1`, [g]))[0].finite);

  check('the author can\'t confirm their own', (await as(a, 'select public.ack_checkpoint($1, $2) ok', [g, cpSeq]))[0]?.ok === false);
  check('a wrong seq isn\'t confirmed', (await as(b, 'select public.ack_checkpoint($1, $2) ok', [g, cpSeq - 1]))[0]?.ok === false);
  check('another member confirms it', (await as(b, 'select public.ack_checkpoint($1, $2) ok', [g, cpSeq]))[0]?.ok === true);
  await expire();
  await sys('select public.purge_expired()');
  const left = await sys('select seq from public.group_events where group_id = $1 order by seq', [g]);
  check('then compaction keeps the checkpoint and everything after it', left.length > 0 && Number(left[0].seq) === cpSeq, JSON.stringify(left));
  check('…and remembers the compacted ids', (await sys('select count(*)::int n from public.group_compacted_ids where group_id = $1', [g]))[0].n === before - left.length);
}

console.log('\n— push reaches every member —');
{
  const owner = await newUser();
  const g = await newGroup(owner);
  const others = [];
  for (let i = 0; i < 49; i++) {
    const u = await newUser(), x = await invite(owner, g);
    await redeem(u, x.id, x.t);
    others.push(u);
    for (let p = 0; p < 5; p++) {
      await as(u, 'select public.register_push_token($1)', [`ExponentPushToken[${randomBytes(12).toString('hex')}]`]);
    }
  }
  await sys('delete from net.calls');
  await sys('update public.groups set last_push_at = null where id = $1', [g]);
  await append(owner, g, [sealed()]);
  const calls = await sys('select body from net.calls');
  const msgs = calls[0]?.body ?? [];
  const tokens = await sys('select token, user_id from public.push_tokens');
  const userOf = new Map(tokens.map((t) => [t.token, t.user_id]));
  const reached = new Set(msgs.map((m) => userOf.get(m.to)));
  check('one request of at most 100 messages (Expo\'s limit)', calls.length === 1 && msgs.length <= 100, `${calls.length} calls, ${msgs.length} msgs`);
  check('every other member gets one (was: 100 newest tokens, so some got none)', others.every((u) => reached.has(u)), `${reached.size}/49`);
  check('never the author', !reached.has(owner));
  check('a realtime poke went out', (await sys(`select count(*)::int n from realtime.sent where topic = $1`, [`group:${g}`]))[0].n > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
