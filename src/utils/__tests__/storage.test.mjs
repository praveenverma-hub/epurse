import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// STORAGE — key encoding, SQLite schema, RecordStore contract
// -----------------------------------------------------------------------------
//   npm run test:storage
//
// The record-store contract runs against BOTH implementations (real SQL via
// better-sqlite3, and memory), so mock mode and the device can't drift apart.
// See docs/STORAGE_MIGRATION.md.
// =============================================================================
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqlDriver } from './_sqliteNodeDriver.mjs';

const K = await import(`${PROJECT_ROOT}/src/storage/keyFormat.ts`);
const { SCHEMA_VERSION } = await import(`${PROJECT_ROOT}/src/storage/schema.ts`);
const { createSqlRecordStore, createMemoryRecordStore, migrateSchema } =
  await import(`${PROJECT_ROOT}/src/storage/recordStore.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const J = (v) => JSON.stringify(v);
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

console.log(`\n${C.bold}══════ Storage — keys, schema, record store ══════${C.reset}\n`);

// ── 1. Key encoding ─────────────────────────────────────────────────────────
{
  const seq24 = Uint8Array.from({ length: 24 }, (_, i) => i);
  check('keys: 24 bytes → 32-char base64url MMKV key (known vector)',
    K.bytesToKvKey(seq24) === 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYX', K.bytesToKvKey(seq24));
  check('keys: base64url uses - and _ (never + / =)',
    K.bytesToKvKey(Uint8Array.from([0xfb, 0xff, 0xbf])) === '-_-_');
  const hex = K.bytesToHex(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));
  check('keys: 32 bytes → 64 lowercase hex', K.isDbKey(hex) && hex.startsWith('fffefd'), hex);
  check('keys: validators reject wrong shapes',
    !K.isDbKey(hex.toUpperCase()) && !K.isDbKey(hex.slice(1)) && !K.isKvKey('short') && K.isKvKey(K.bytesToKvKey(seq24)));
  check('keys: PRAGMA uses the raw-key form', K.dbKeyPragma(hex) === `PRAGMA key = "x'${hex}'";`);
  check('keys: PRAGMA refuses anything but 64 hex (it is interpolated into SQL)',
    await throws(() => K.dbKeyPragma(`${hex.slice(0, 60)}'; --`)));
  check('keys: a non-multiple-of-3 byte count is refused, not silently padded',
    await throws(() => K.bytesToKvKey(new Uint8Array(4))));
}

// ── 2. Schema ───────────────────────────────────────────────────────────────
{
  const d = openNodeSqlDriver();
  await migrateSchema(d);
  await migrateSchema(d); // idempotent
  const [{ user_version }] = await d.all('PRAGMA user_version;');
  check(`schema: user_version = ${SCHEMA_VERSION} after migrate (run twice)`, user_version === SCHEMA_VERSION);
  const tables = (await d.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;")).map((r) => r.name);
  check('schema: every table exists',
    J(tables) === J(['archived_txn', 'goal_contribution', 'grp', 'kv', 'lent_borrowed', 'meta', 'month_doc', 'txn']), J(tables));
}

// ── 3. RecordStore contract — SQL and memory ────────────────────────────────
const txn = (id, extra = {}) => ({ id, amount: 100, type: 'debit', createdAt: '2026-08-15T10:00:00.000Z', ...extra });

async function contract(label, store) {
  const empty = await store.load();
  check(`${label}: an empty store loads empty`,
    empty.rows.transactions.length === 0 && J(empty.maps.monthlyAggregates) === '{}' && J(empty.kv) === '{}');

  await store.apply({
    rows: {
      transactions: { upsert: [
        { rid: 't2', seq: 2, value: txn('t2') },
        { rid: 't1', seq: 1, value: txn('t1', { note: 'chai ☕ — ₹' }) },
        { rid: 't3', seq: 3, value: txn('t3') },
      ], remove: [] },
      lentBorrowed: { upsert: [{ rid: 'l1', seq: 1, value: { id: 'l1', kind: 'lent', amount: 750 } }], remove: [] },
    },
    maps: { monthlyAggregates: { upsert: [{ key: '2026-07', value: { totalSpend: 1200 } }], remove: [] } },
    kv: { upsert: [{ key: 'userName', value: 'Praveen' }, { key: 'budget', value: { perCategory: { food: 8000 } } }], remove: [] },
    meta: { storeVersion: '42' },
  });
  let s = await store.load();
  check(`${label}: rows come back in seq order, not insert order`, J(s.rows.transactions.map((r) => r.rid)) === J(['t1', 't2', 't3']));
  check(`${label}: a document round-trips exactly (unicode included)`, J(s.rows.transactions[0].value) === J(txn('t1', { note: 'chai ☕ — ₹' })));
  check(`${label}: readMeta returns bookkeeping without loading rows`, J(await store.readMeta()) === J({ storeVersion: '42' }));
  check(`${label}: maps, kv and meta round-trip`,
    s.maps.monthlyAggregates['2026-07'].totalSpend === 1200 && s.kv.userName === 'Praveen'
    && s.kv.budget.perCategory.food === 8000 && s.meta.storeVersion === '42' && s.rows.lentBorrowed[0].value.amount === 750);

  await store.apply({ rows: { transactions: { upsert: [{ rid: 't2', seq: 2, value: txn('t2', { amount: 999 }) }], remove: ['t3'] } },
    kv: { upsert: [], remove: ['budget'] }, maps: { monthlyAggregates: { upsert: [], remove: ['2026-07'] } } });
  s = await store.load();
  check(`${label}: upsert replaces, remove deletes (rows, kv, maps)`,
    s.rows.transactions.length === 2 && s.rows.transactions[1].value.amount === 999
    && !('budget' in s.kv) && !('2026-07' in s.maps.monthlyAggregates), J(s.rows.transactions.map((r) => r.rid)));

  await store.apply({ rows: { transactions: { upsert: [
    { rid: 'dupA', seq: 10, value: { id: 'same', amount: 1 } },
    { rid: 'dupB', seq: 11, value: { id: 'same', amount: 2 } },
    { rid: 'noid', seq: 12, value: { amount: 3 } },
  ], remove: [] } } });
  s = await store.load();
  check(`${label}: two rows sharing an id, and a row with none, are all kept`,
    J(s.rows.transactions.slice(2).map((r) => r.value.amount)) === J([1, 2, 3]));

  const before = J(await store.load());
  const failed = await throws(() => store.apply({
    rows: { transactions: { upsert: [{ rid: 'ok', seq: 20, value: txn('ok') }, { rid: 'bad', seq: 21, value: { n: 10n } }], remove: ['t1'] } },
    kv: { upsert: [{ key: 'userName', value: 'CHANGED' }], remove: [] },
  }));
  check(`${label}: a failing flush throws…`, failed);
  check(`${label}: …and applies NOTHING (atomic)`, J(await store.load()) === before);
  check(`${label}: undefined is refused, not silently dropped`,
    await throws(() => store.apply({ kv: { upsert: [{ key: 'x', value: undefined }], remove: [] } })));

  await store.wipe();
  s = await store.load();
  check(`${label}: wipe removes every record`,
    s.rows.transactions.length === 0 && s.rows.lentBorrowed.length === 0 && J(s.kv) === '{}' && J(s.meta) === '{}');
}

await contract('sql', createSqlRecordStore(openNodeSqlDriver()));
await contract('memory', createMemoryRecordStore());

// ── 4. SQL specifics ────────────────────────────────────────────────────────
{
  const d = openNodeSqlDriver();
  const store = createSqlRecordStore(d);
  await store.apply({ rows: { transactions: { upsert: [{ rid: 'r1', seq: 1, value: txn('t9', {
    accountId: 'acc1', categoryId: 'food', groupId: 'g1', smsId: 'sms-9', isIgnored: true, amount: 450.5 }) }], remove: [] } } });
  const [row] = await d.all('SELECT id, month, account_id, category_id, group_id, type, amount, sms_id, is_ignored, created_at FROM txn;');
  check('sql: indexed columns are filled from the document',
    row.id === 't9' && row.account_id === 'acc1' && row.category_id === 'food' && row.group_id === 'g1'
    && row.sms_id === 'sms-9' && row.is_ignored === 1 && row.amount === 450.5 && row.type === 'debit'
    && row.created_at === Date.parse('2026-08-15T10:00:00.000Z') && /^2026-0[78]$/.test(row.month), J(row));

  const dir = mkdtempSync(join(tmpdir(), 'epurse-storage-'));
  try {
    const file = join(dir, 'test.db');
    let fd = openNodeSqlDriver(file);
    await createSqlRecordStore(fd).apply({ kv: { upsert: [{ key: 'userName', value: 'Persisted' }], remove: [] },
      rows: { groups: { upsert: [{ rid: 'g1', seq: 1, value: { id: 'g1', name: 'Goa' } }], remove: [] } } });
    await fd.close();
    fd = openNodeSqlDriver(file);
    const s = await createSqlRecordStore(fd).load();
    await fd.close();
    check('sql: data survives closing and reopening the file', s.kv.userName === 'Persisted' && s.rows.groups[0].value.name === 'Goa');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
