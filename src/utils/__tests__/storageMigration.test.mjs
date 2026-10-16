import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// STORAGE — one-time AsyncStorage → SQLite + MMKV migration
// -----------------------------------------------------------------------------
//   npm run test:storage
//
// Uses the REAL SQL (better-sqlite3) for the record store. The end-to-end case
// takes a real store's persisted value at an OLDER version, migrates it, then
// hydrates the real store from the new storage so the normal `migrate` chain runs.
// =============================================================================
import { register } from 'node:module';
register(`${PROJECT_ROOT}/src/utils/__tests__/_store-hook.mjs`, import.meta.url);
import { openNodeSqlDriver } from './_sqliteNodeDriver.mjs';

const { migrateFromLegacy, MIGRATED_META, LEGACY_STORE_KEY } = await import(`${PROJECT_ROOT}/src/storage/legacyMigration.ts`);
const { createHybridStorage, DEVICE_PREFIX } = await import(`${PROJECT_ROOT}/src/storage/hybridStorage.ts`);
const { createSqlRecordStore } = await import(`${PROJECT_ROOT}/src/storage/recordStore.ts`);
const { createMemoryDeviceKv } = await import(`${PROJECT_ROOT}/src/storage/deviceKv.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const J = (v) => JSON.stringify(v);
const fresh = () => ({ records: createSqlRecordStore(openNodeSqlDriver()), device: createMemoryDeviceKv() });
const isEmpty = async (records) => { const s = await records.load(); return s.rows.transactions.length === 0 && J(s.kv) === '{}'; };

console.log(`\n${C.bold}══════ Storage — AsyncStorage migration ══════${C.reset}\n`);

// ── 1. Fresh install ────────────────────────────────────────────────────────
{
  const { records, device } = fresh();
  const r = await migrateFromLegacy({ readLegacy: async () => null, records, device });
  check('fresh: no AsyncStorage value → "fresh", marked done', r.status === 'fresh' && !!(await records.readMeta())[MIGRATED_META]);
  const again = await migrateFromLegacy({ readLegacy: async () => { throw new Error('must not read'); }, records, device });
  check('fresh: a second launch does not migrate again', again.status === 'already');
}

// ── 2. Failures leave nothing behind and do NOT mark done ───────────────────
{
  const { records, device } = fresh();
  const r = await migrateFromLegacy({ readLegacy: async () => '{not json', records, device });
  check('corrupt: an unreadable value fails, unmarked, nothing written',
    r.status === 'failed' && !(await records.readMeta())[MIGRATED_META] && await isEmpty(records), J(r));

  const r2 = await migrateFromLegacy({ readLegacy: async () => { throw new Error('io'); }, records, device });
  check('read error: fails, unmarked', r2.status === 'failed' && !(await records.readMeta())[MIGRATED_META]);
}
{
  const { records, device } = fresh();
  const flaky = { ...records, load: records.load, readMeta: records.readMeta, wipe: records.wipe,
    apply: async (cs) => { if (cs.rows) throw new Error('disk full'); return records.apply(cs); } };
  const legacy = J({ state: { transactions: [{ id: 't1', amount: 5 }], userName: 'A' }, version: 42 });
  const r = await migrateFromLegacy({ readLegacy: async () => legacy, records: flaky, device });
  check('write error: fails, unmarked, no partial copy', r.status === 'failed' && !(await records.readMeta())[MIGRATED_META] && await isEmpty(records), J(r));
}
{
  // A CRASH mid-copy: once the write fails, nothing else runs (the clean-up wipe can't
  // rescue an early "done" mark). The mark must only ever be written after verifying.
  const { records, device } = fresh();
  let crashed = false;
  const dying = { load: records.load, readMeta: records.readMeta,
    wipe: async () => { if (crashed) throw new Error('process killed'); return records.wipe(); },
    apply: async (cs) => { if (cs.rows) { crashed = true; throw new Error('process killed'); } return records.apply(cs); } };
  const legacy = J({ state: { transactions: [{ id: 't1' }], userName: 'A' }, version: 42 });
  await migrateFromLegacy({ readLegacy: async () => legacy, records: dying, device });
  check('crash: a copy killed midway is NEVER marked done (next launch retries)', !(await records.readMeta())[MIGRATED_META]);
}
{
  const { records } = fresh();
  // A device store that silently loses one key — the verify step must catch it.
  const inner = createMemoryDeviceKv();
  const lossy = { ...inner, set: (k, v) => { if (!k.endsWith('googleAccount')) inner.set(k, v); } };
  const legacy = J({ state: { transactions: [], userName: 'A', googleAccount: { email: 'a@b.c' } }, version: 42 });
  const r = await migrateFromLegacy({ readLegacy: async () => legacy, records, device: lossy });
  check('verify: a copy that does not read back identically FAILS (and names only the key)',
    r.status === 'failed' && r.reason.includes('googleAccount') && !r.reason.includes('a@b.c'), J(r));
  check('verify: …and the half-copy is wiped, unmarked', await isEmpty(records) && !(await records.readMeta())[MIGRATED_META]);
}
{
  const { records, device } = fresh();
  await records.apply({ kv: { upsert: [{ key: 'userName', value: 'LEFTOVER' }], remove: [] },
    rows: { transactions: { upsert: [{ rid: 'junk', seq: 1, value: { id: 'junk' } }], remove: [] } } });
  device.set(`${DEVICE_PREFIX}googleAccount`, J({ email: 'old' }));
  const legacy = J({ state: { transactions: [{ id: 't1' }], userName: 'Real' }, version: 42 });
  const r = await migrateFromLegacy({ readLegacy: async () => legacy, records, device });
  const s = await records.load();
  check('retry: leftovers of an interrupted attempt are cleared first',
    r.status === 'migrated' && s.kv.userName === 'Real' && J(s.rows.transactions.map((x) => x.value.id)) === J(['t1'])
    && device.getString(`${DEVICE_PREFIX}googleAccount`) === undefined, J(r));
}

// ── 3. End to end with the REAL store ───────────────────────────────────────
{
  const mod = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);
  const useStore = mod.useEPurseStore || mod.default;
  const S = () => useStore.getState();
  const { version: CURRENT, partialize } = useStore.persist.getOptions();

  useStore.setState({ transactions: [], archivedTransactions: [], lentBorrowed: [], groups: [], monthlyAggregates: {},
    accounts: [{ id: 'acc1', name: 'HDFC', type: 'Bank', mask: '4021', balance: 50000, primary: true }] });
  const now = Date.now();
  S().ingestMessage('Rs.450.00 debited from A/c xx4021 on 06-Aug-26 to SWIGGY via UPI. Avl bal Rs.42,310.50',
    { sender: 'HDFCBK', receivedAt: new Date(now - 2 * 86400000).toISOString(), smsId: 'sms-1' });
  S().addLentBorrowed({ kind: 'lent', person: 'Neha', contactId: 'c-n', amount: 750, date: new Date().toISOString() });
  const gid = S().createGroup({ name: 'Goa', type: 'shared', members: [{ memberId: 'm1', name: 'Rahul', contactId: 'c-r' }] });
  S().addGroupExpense(gid, { amount: 2000, merchant: 'Hotel', categoryId: 'travel', paidByMemberId: 'me', accountId: 'acc1',
    shares: [{ memberId: 'me', name: 'You', shareAmount: 1000 }, { memberId: 'm1', name: 'Rahul', shareAmount: 1000 }] });
  S().addGoal({ name: 'Trip', emoji: '🏝️', lifetimeTarget: 50000 });
  useStore.setState({ userName: 'Praveen', smsPermissionGranted: true, googleAccount: { email: 'p@x.y' },
    monthlyAggregates: { '2026-05': { totalSpend: 1234, totalIncome: 0, byCategory: { food: 1234 } } } });

  // What an OLD install has on disk: version 41, an SMS body on a txn (v42 strips it) and
  // stale picker labels on another (v43 re-derives them).
  const OLD = 41;
  const persisted = JSON.parse(J(partialize(S())));
  persisted.transactions[0] = { ...persisted.transactions[0], smsText: 'Rs.450.00 debited … Avl bal Rs.42,310.50' };
  persisted.transactions.push({ id: 'stale1', amount: 100, type: 'debit', categoryId: 'borrow_repaid', parentCategory: 'Food & Dining', childCategory: 'Restaurants', createdAt: new Date().toISOString() });
  const legacyRaw = J({ state: persisted, version: OLD });

  const { records, device } = fresh();
  const r = await migrateFromLegacy({ readLegacy: async () => legacyRaw, records, device });
  check('e2e: a real v41 store migrates and verifies', r.status === 'migrated' && r.counts.transactions === persisted.transactions.length, J(r));
  const meta = await records.readMeta();
  check('e2e: stored AS-IS at its old version (persist migrates on hydrate)', meta.storeVersion === String(OLD) && meta.legacyVersion === String(OLD));

  const lost = { transactions: persisted.transactions.length, lb: S().lentBorrowed.length };
  useStore.setState({ transactions: [], lentBorrowed: [], groups: [], goals: [], userName: '', googleAccount: null });
  const h = createHybridStorage({ records, device, flushDelayMs: 0 });
  useStore.persist.setOptions({ storage: h });
  await useStore.persist.rehydrate();
  await h.flush();
  check('e2e: the real store hydrates every record from the new storage',
    S().transactions.length === lost.transactions && S().lentBorrowed.length === lost.lb && S().groups.length === 1
    && S().goals.length === 1 && S().userName === 'Praveen' && S().googleAccount?.email === 'p@x.y'
    && S().monthlyAggregates['2026-05'].totalSpend === 1234);
  check('e2e: the normal migrate chain ran (v42 stripped the SMS body, v43 fixed stale labels)', S().transactions.every((t) => t.smsText === undefined)
    && S().transactions.find((t) => t.id === 'stale1')?.childCategory === 'Repaid');
  const after = await records.load();
  check('e2e: …and the migrated result was written back at the current version',
    after.meta.storeVersion === String(CURRENT) && after.rows.transactions.every((x) => x.value.smsText === undefined));
  check('e2e: a later launch does not migrate again',
    (await migrateFromLegacy({ readLegacy: async () => legacyRaw, records, device })).status === 'already');
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
