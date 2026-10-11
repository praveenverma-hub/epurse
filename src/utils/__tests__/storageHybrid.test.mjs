import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// STORAGE — hybridStorage (the zustand PersistStorage over SQLite + MMKV)
// -----------------------------------------------------------------------------
//   npm run test:storage
//
// Part A drives the storage directly with small states. Part B swaps it under the
// REAL useEPurseStore, runs real actions with freeze ON (an in-place mutation of a
// stored object throws), then reloads through a second storage instance and
// requires the reloaded state to equal the store's persisted state exactly.
// =============================================================================
import { register } from 'node:module';
register(`${PROJECT_ROOT}/src/utils/__tests__/_store-hook.mjs`, import.meta.url);

const { createHybridStorage, DEVICE_PREFIX } = await import(`${PROJECT_ROOT}/src/storage/hybridStorage.ts`);
const { createMemoryRecordStore } = await import(`${PROJECT_ROOT}/src/storage/recordStore.ts`);
const { createMemoryDeviceKv } = await import(`${PROJECT_ROOT}/src/storage/deviceKv.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const J = (v) => JSON.stringify(v);
// Key-order-independent JSON (undefined dropped, as storage drops it).
const stable = (v) => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
  ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]])) : val));

/** Record store that counts apply() calls and can be told to fail. */
function spyRecords() {
  const inner = createMemoryRecordStore();
  const spy = { applies: [], failNext: 0 };
  spy.store = {
    load: () => inner.load(),
    wipe: () => inner.wipe(),
    apply: async (cs) => {
      if (spy.failNext > 0) { spy.failNext--; throw new Error('disk full'); }
      spy.applies.push(cs);
      return inner.apply(cs);
    },
  };
  return spy;
}
const upserts = (cs, c) => cs?.rows?.[c]?.upsert?.length ?? 0;
const removes = (cs, c) => cs?.rows?.[c]?.remove?.length ?? 0;

console.log(`\n${C.bold}══════ Storage — hybridStorage ══════${C.reset}\n`);

// ── A. The storage on its own ───────────────────────────────────────────────
{
  const spy = spyRecords();
  const device = createMemoryDeviceKv();
  const errors = [];
  const h = createHybridStorage({ records: spy.store, device, flushDelayMs: 5, freeze: true, onError: (e) => errors.push(e) });

  h.setItem('s', { state: { userName: 'EMPTY-DEFAULT', transactions: [] }, version: 42 });
  await new Promise((r) => setTimeout(r, 20));
  check('A: a write BEFORE hydration is ignored (would overwrite stored data with defaults)',
    spy.applies.length === 0 && !h.isHydrated());

  check('A: a fresh install hydrates to null', (await h.getItem('s')) === null && h.isHydrated());

  const t1 = { id: 't1', amount: 10 }, t2 = { id: 't2', amount: 20 };
  const s1 = { transactions: [t1, t2], userName: 'Asha', monthlyAggregates: { '2026-06': { totalSpend: 5 } },
    googleAccount: { email: 'a@b.c' }, smsPermissionGranted: true };
  h.setItem('s', { state: s1, version: 42 });
  await h.flush();
  let snap = await spy.store.load();
  check('A: rows, kv, maps and version reach the record store',
    J(snap.rows.transactions.map((r) => r.value.id)) === J(['t1', 't2']) && snap.kv.userName === 'Asha'
    && snap.maps.monthlyAggregates['2026-06'].totalSpend === 5 && snap.meta.storeVersion === '42');
  check('A: device-local keys go to the device store, NOT the record store',
    !('googleAccount' in snap.kv) && !('smsPermissionGranted' in snap.kv)
    && JSON.parse(device.getString(`${DEVICE_PREFIX}googleAccount`)).email === 'a@b.c');

  spy.applies.length = 0;
  const t0 = { id: 't0', amount: 5 };
  const s2 = { ...s1, transactions: [t0, ...s1.transactions] };
  h.setItem('s', { state: s2, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: prepending one transaction writes ONE row, not the whole list',
    spy.applies.length === 1 && upserts(spy.applies[0], 'transactions') === 1 && !spy.applies[0].kv.upsert.length,
    J(spy.applies[0]));
  check('A: …and order is preserved', J(snap.rows.transactions.map((r) => r.value.id)) === J(['t0', 't1', 't2']));

  spy.applies.length = 0;
  const s3 = { ...s2, transactions: s2.transactions.map((t) => (t.id === 't1' ? { ...t, amount: 99 } : t)) };
  h.setItem('s', { state: s3, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: editing a row upserts it in place (same rid, same position, no delete)',
    upserts(spy.applies[0], 'transactions') === 1 && removes(spy.applies[0], 'transactions') === 0
    && J(snap.rows.transactions.map((r) => `${r.rid}:${r.value.amount}`)) === J(['t0:5', 't1:99', 't2:20']), J(snap.rows.transactions));

  spy.applies.length = 0;
  const s4 = { ...s3, transactions: s3.transactions.filter((t) => t.id !== 't2') };
  h.setItem('s', { state: s4, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: deleting a row removes exactly that row', removes(spy.applies[0], 'transactions') === 1 && snap.rows.transactions.length === 2);

  spy.applies.length = 0;
  let s = s4;
  for (let i = 0; i < 5; i++) { s = { ...s, userName: `name-${i}` }; h.setItem('s', { state: s, version: 42 }); }
  await h.flush();
  check('A: five quick changes coalesce into ONE transaction', spy.applies.length === 1 && (await spy.store.load()).kv.userName === 'name-4');

  spy.applies.length = 0;
  h.setItem('s', { state: s, version: 42 });
  await h.flush();
  check('A: an unchanged state writes nothing', spy.applies.length === 0);

  spy.failNext = 1;
  const s5 = { ...s, userName: 'after-failure', transactions: [{ id: 't9', amount: 1 }, ...s.transactions] };
  h.setItem('s', { state: s5, version: 42 });
  const ok = await h.flush();
  snap = await spy.store.load();
  check('A: a failed write reports failure and leaves the stored data untouched',
    ok === false && errors.length === 1 && snap.kv.userName === 'name-4' && snap.rows.transactions.length === 2);
  h.setItem('s', { state: s5, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: …and the next flush retries everything still pending',
    snap.kv.userName === 'after-failure' && J(snap.rows.transactions.map((r) => r.value.id)) === J(['t9', 't0', 't1']));

  const s6 = { ...s5, transactions: [...s5.transactions].reverse() };
  h.setItem('s', { state: s6, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: a full reorder (e.g. a sort) is stored in the new order',
    J(snap.rows.transactions.map((r) => r.value.id)) === J(['t1', 't0', 't9']));

  const d1 = { id: 'dup', n: 1 }, d2 = { id: 'dup', n: 2 }, noId = { n: 3 };
  const s7 = { ...s6, lentBorrowed: [d1, d2, noId] };
  h.setItem('s', { state: s7, version: 42 });
  await h.flush();
  const s8 = { ...s7, lentBorrowed: [d1, { ...d2, n: 22 }, noId] };
  h.setItem('s', { state: s8, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: rows sharing an id (or with none) stay separate, and editing one keeps both',
    J(snap.rows.lentBorrowed.map((r) => r.value.n)) === J([1, 22, 3]), J(snap.rows.lentBorrowed));

  spy.applies.length = 0;
  const s9 = { ...s8, monthlyAggregates: { ...s8.monthlyAggregates, '2026-07': { totalSpend: 7 } } };
  h.setItem('s', { state: s9, version: 42 });
  await h.flush();
  const s10 = { ...s9, monthlyAggregates: { '2026-07': s9.monthlyAggregates['2026-07'] } };
  h.setItem('s', { state: s10, version: 42 });
  await h.flush();
  snap = await spy.store.load();
  check('A: month maps write only the changed month, and drop a removed one',
    spy.applies[0].maps.monthlyAggregates.upsert.length === 1 && J(Object.keys(snap.maps.monthlyAggregates)) === J(['2026-07']));

  let threw = false;
  try { s10.transactions[0].amount = 1; } catch { threw = true; }
  check('A: with freeze on, mutating a stored row in place THROWS (it would never persist)', threw);

  const h2 = createHybridStorage({ records: spy.store, device });
  const back = await h2.getItem('s');
  // Every row/month collection always comes back — empty when it has nothing.
  const expected = { archivedTransactions: [], groups: [], goalContributions: [], budgetHistory: {}, goalHistory: {}, ...s10 };
  check('A: a second instance reloads exactly the last state (rows, order, kv, maps, device, version)',
    stable(back.state) === stable(expected) && back.version === 42, `${stable(back.state)}\n      vs ${stable(expected)}`);

  await h2.removeItem('s');
  snap = await spy.store.load();
  check('A: removeItem wipes the record store AND the device keys',
    snap.rows.transactions.length === 0 && J(snap.kv) === '{}' && device.getString(`${DEVICE_PREFIX}googleAccount`) === undefined);
}

// ── B. Under the REAL store ─────────────────────────────────────────────────
{
  const mod = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);
  const useStore = mod.useEPurseStore || mod.default;
  const S = () => useStore.getState();
  const records = createMemoryRecordStore();
  const device = createMemoryDeviceKv();
  const errors = [];
  const h = createHybridStorage({ records, device, flushDelayMs: 0, freeze: true, onError: (e) => errors.push(e) });
  useStore.persist.setOptions({ storage: h });
  await useStore.persist.rehydrate();

  useStore.setState({ transactions: [], archivedTransactions: [], lentBorrowed: [], groups: [], monthlyAggregates: {},
    accounts: [{ id: 'acc1', name: 'HDFC', type: 'Bank', mask: '4021', balance: 50000, primary: true }] });
  const now = Date.now();
  const ingest = (body, smsId, daysAgo = 2) =>
    S().ingestMessage(body, { sender: 'HDFCBK', receivedAt: new Date(now - daysAgo * 86400000).toISOString(), smsId });

  const steps = [
    ['ingest a UPI debit', () => ingest('Rs.450.00 debited from A/c xx4021 on 06-Aug-26 to SWIGGY via UPI. Avl bal Rs.42,310.50', 'sms-1')],
    ['ingest a salary credit', () => ingest('Your a/c xxxx4021 is credited with Rs.55,000.00 - SALARY AUG 2026.', 'sms-2')],
    ['ingest a CC bill payment', () => ingest('Rs.5,000.00 paid towards HDFC Credit Card XX4321 from A/c XX4021 on 07-Aug-26.', 'sms-3')],
    ['add a split transaction', () => S().addTransaction({ amount: 900, type: 'debit', merchant: 'Dinner', categoryId: 'food', accountId: 'acc1',
      isSplit: true, myShareAmount: 300, splitOthers: [{ contactId: 'c-r', name: 'Rahul', shareAmount: 300 }, { contactId: 'c-p', name: 'Priya', shareAmount: 300 }] })],
    ['create a group + group expense', () => {
      const gid = S().createGroup({ name: 'Goa', type: 'shared', members: [{ memberId: 'm1', name: 'Rahul', contactId: 'c-r' }] });
      S().addGroupExpense(gid, { amount: 2000, merchant: 'Hotel', categoryId: 'travel', paidByMemberId: 'me', accountId: 'acc1',
        shares: [{ memberId: 'me', name: 'You', shareAmount: 1000 }, { memberId: 'm1', name: 'Rahul', shareAmount: 1000 }] });
    }],
    ['record a lent entry from an account', () => S().recordLbEntry({ kind: 'lent', person: 'Neha', amount: 750 }, { accountId: 'acc1' })],
    ['edit a transaction', () => { const t = S().transactions.find((x) => x.smsId === 'sms-1'); S().updateTransaction(t.id, { merchant: 'Swiggy Instamart', amount: 470 }); }],
    ['recategorise a transaction', () => { const t = S().transactions.find((x) => x.smsId === 'sms-1'); S().updateTwoTierCategory(t.id, 'shopping', null); }],
    ['ignore then restore a transaction', () => { const t = S().transactions.find((x) => x.smsId === 'sms-2'); S().ignoreTransaction(t.id); S().unignoreTransaction(t.id); }],
    ['mark reviewed', () => S().markReviewed(S().transactions[0].id)],
    ['set a budget', () => S().setBudget({ perCategory: { food: 8000 } })],
    ['add a goal', () => S().addGoal({ name: 'Trip', emoji: '🏝️', lifetimeTarget: 50000 })],
    ['add a custom category', () => S().addCustomParent?.({ label: 'Pets', emoji: '🐶', color: '#F59E0B' })],
    ['delete a transaction', () => { const t = S().transactions.find((x) => x.merchant === 'Dinner'); if (t) S().deleteTransaction(t.id); }],
    ['set device-local state', () => useStore.setState({ smsPermissionGranted: true, googleAccount: { email: 'x@y.z' } })],
  ];

  for (const [name, fn] of steps) {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    await h.flush();
    check(`B: ${name} — no in-place mutation of stored data`, !err, err && String(err.stack).split('\n').slice(0, 3).join(' | '));
  }
  check('B: no write failed', errors.length === 0, String(errors[0]));

  const persisted = useStore.persist.getOptions().partialize(S());
  const h2 = createHybridStorage({ records, device });
  const back = await h2.getItem('@ePurse:store');
  check('B: reloading through a fresh storage gives back EXACTLY the persisted state',
    stable(back.state) === stable(persisted),
    (() => { const a = JSON.parse(stable(back.state)), b = JSON.parse(stable(persisted));
      return Object.keys({ ...a, ...b }).filter((k) => J(a[k]) !== J(b[k])).join(', '); })());
  check('B: …including the store version', back.version === useStore.persist.getOptions().version);
  check('B: the data really went through (transactions, LB, groups, goals)',
    back.state.transactions.length >= 4 && back.state.lentBorrowed.length >= 1 && back.state.groups.length === 1 && back.state.goals.length === 1,
    `${back.state.transactions.length} txns`);
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
