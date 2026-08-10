// =============================================================================
// SMS SYNC TESTS — syncNow(), the one inbox sweep behind two entry points.
// -----------------------------------------------------------------------------
//   node --no-warnings src/utils/__tests__/smsSync.test.mjs
//
// `syncNow` is called by useSmsSync's mount/foreground lifecycle AND by the
// Dashboard's pull-to-refresh, which shows the user a message based on what it
// returns. So the return value is a contract, not a detail: a wrong `status`
// shows the wrong toast, and a wrong `added` lies about what just synced.
//
// The device's answers (platform, permission, inbox contents) come from
// `globalThis.__smsStub`, read at call time by the stubs in _store-hook.mjs.
// The REAL store and the REAL parser run underneath — only the native leaves
// are swapped, so ingestion, dedup and compaction behave as in production.
// =============================================================================
import { register } from 'node:module';
register('./_store-hook.mjs', import.meta.url);

const ROOT = new URL('../../../', import.meta.url).pathname;
const { syncNow } = await import(`${ROOT}src/hooks/useSmsSync.js`);
const { useEPurseStore } = await import(`${ROOT}src/store/ePurseStore.js`);
const { Platform } = await import('react-native');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

/** A bank SMS the real parser accepts (same shape as storeIntegration's). */
const msg = (id, amount, at, merchant = 'STORE') => ({
  _id: id,
  address: 'HDFCBK',
  body: `Rs.${amount} debited from A/c XX4021 at ${merchant} on 22-07-26.`,
  date: at,
});

const reset = (stub = {}) => {
  globalThis.__smsStub = { osPermission: true, inbox: [], ...stub };
  Platform.OS = 'android';
  useEPurseStore.setState({
    transactions: [], accounts: [], archivedTransactions: [], lentBorrowed: [],
    suppressedSmsIds: [], monthlyAggregates: {}, groups: [],
    lastSmsDate: null, lastSmsSync: null, lastCompactedAt: null,
    userOnboardedAt: 0, activeGroupZoneId: null,
    pendingCCPaymentQueue: [], ccHandledSmsIds: [], userPhones: [],
    budgetHistory: {},
    smsPermissionGranted: true, smsAutoImport: true,
  });
};
const st = () => useEPurseStore.getState();

// ── Status matrix — each one drives a different message on the Dashboard ─────
console.log('\n── status matrix ──');

reset();
Platform.OS = 'ios';
let r = await syncNow();
check("iOS → 'unsupported' (no inbox to read, so not a failure)", r.status === 'unsupported', JSON.stringify(r));

reset();
useEPurseStore.setState({ smsPermissionGranted: false, smsAutoImport: false });
r = await syncNow();
check("both store flags off → 'no-permission'", r.status === 'no-permission', JSON.stringify(r));

reset({ osPermission: false });
r = await syncNow();
check("flags on but OS permission revoked → 'no-permission'", r.status === 'no-permission', JSON.stringify(r));

reset({ throwOnRead: true });
r = await syncNow();
check("readInbox throws → 'error', never a rejected promise", r.status === 'error', JSON.stringify(r));
check('a failed read does NOT stamp lastSmsSync (it did not sync)', st().lastSmsSync === null, String(st().lastSmsSync));

reset();
r = await syncNow();
check("empty inbox → 'ok' with nothing added", r.status === 'ok' && r.scanned === 0 && r.added === 0, JSON.stringify(r));
check('an empty-but-successful sweep DOES stamp lastSmsSync', typeof st().lastSmsSync === 'number');

// ── added: the number the toast says out loud ────────────────────────────────
console.log('\n── added count ──');

reset({ inbox: [msg('1', 500, now - DAY), msg('2', 750, now - 2 * DAY, 'CAFE')] });
r = await syncNow();
check('two parseable messages → added 2', r.added === 2, JSON.stringify(r));
check('scanned reports what was read, not what was kept', r.scanned === 2, JSON.stringify(r));
check('the transactions really landed', st().transactions.length === 2);

// Re-sweeping the SAME messages must add nothing — dedup by smsId.
r = await syncNow();
check('re-sweeping identical messages → added 0 (dedup holds)', r.added === 0, JSON.stringify(r));

reset({ inbox: [{ _id: '9', address: 'VM-JIOMNY', body: 'Your recharge plan expires soon. Click here!', date: now - DAY }] });
r = await syncNow();
check("junk SMS → 'ok' but added 0 (scanned 1)", r.status === 'ok' && r.scanned === 1 && r.added === 0, JSON.stringify(r));

// THE mutation-sensitive case. `added` is measured before compaction on purpose:
// compaction drops raw rows past the 90-day window, so measuring after it nets
// the two together. Seed three rows old enough to be compacted away, sweep in
// one new one, and the count must still be 1 — not 0.
reset({ inbox: [msg('n1', 400, now - DAY)] });
useEPurseStore.setState({
  transactions: [100, 120, 140].map((age, i) => ({
    id: `old${i}`, amount: 200, type: 'debit', categoryId: 'food',
    merchant: 'OLD', accountId: null, isReviewed: true,
    createdAt: new Date(now - age * DAY).toISOString(),
  })),
});
const beforeLen = st().transactions.length;
r = await syncNow();
check('3 stale rows seeded for compaction to eat', beforeLen === 3);
check('compaction did drop them (otherwise this case proves nothing)',
  st().transactions.length < beforeLen + 1, `len=${st().transactions.length}`);
check('added counts the NEW row, uncontaminated by compaction', r.added === 1, JSON.stringify(r));

// ── cursor + lock ───────────────────────────────────────────────────────────
console.log('\n── cursor & lock ──');

reset({ inbox: [msg('c1', 100, now - 3 * DAY), msg('c2', 200, now - DAY, 'CAFE')] });
await syncNow();
check('cursor advances to the NEWEST swept SMS date', st().lastSmsDate === now - DAY, String(st().lastSmsDate));

reset({ inbox: [msg('s1', 100, now - DAY)] });
await syncNow();
const firstCursor = st().lastSmsDate;
globalThis.__smsStub.inbox = [];
await syncNow();
check('an empty later sweep does not rewind the cursor', st().lastSmsDate === firstCursor);

reset({ inbox: [msg('l1', 100, now - DAY)] });
const [a, b] = await Promise.all([syncNow(), syncNow()]);
const statuses = [a.status, b.status].sort();
check("two concurrent sweeps → one runs, one is 'busy'",
  statuses[0] === 'busy' && statuses[1] === 'ok', JSON.stringify(statuses));
check('the locked-out call ingests nothing twice', st().transactions.length === 1, String(st().transactions.length));
check('the inbox was read exactly once', globalThis.__smsStub.readCount === 1, String(globalThis.__smsStub.readCount));

// The lock must be released even when the sweep blew up, or refresh dies forever.
reset({ throwOnRead: true });
await syncNow();
globalThis.__smsStub.throwOnRead = false;
globalThis.__smsStub.inbox = [msg('after', 300, now - DAY)];
r = await syncNow();
check('the lock is released after an error (next sweep still works)', r.status === 'ok' && r.added === 1, JSON.stringify(r));

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${fail === 0 ? C.green : C.red}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail === 0 ? 0 : 1);
