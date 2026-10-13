import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// ENCRYPTED BACKUP — payload / restore fidelity (Phase 2)
// -----------------------------------------------------------------------------
//   npm run test:payload
//
// Two questions, and they pull in opposite directions:
//
//   1. Does the backup LEAK the original SMS?   → allow-list must be tight
//   2. Does a restore BREAK the app?            → allow-list must be complete
//
// A field-by-field assertion would only prove the list matches itself. So the
// real test drives the REAL store: seed it richly, back up, WIPE, restore, and
// assert every selector — spend, income, breakdown, budget, person balances,
// aggregates — returns byte-identical results. If the allow-list drops a field
// the app needs, a selector moves and this fails.
// =============================================================================
import { register } from 'node:module';
register(`${PROJECT_ROOT}/src/utils/__tests__/_store-hook.mjs`, import.meta.url);

const mod = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);
const useStore = mod.useEPurseStore || mod.default;
const S = () => useStore.getState();

const { buildBackupPayload, readBackupPayload, unknownTxnFields, TXN_FIELDS, STORE_KEYS,
  STORE_KEYS_EXCLUDED, REWARD_KEYS, migrateRestoredState } =
  await import(`${PROJECT_ROOT}/src/backup/payload.ts`);
const { useRewardStore } = await import(`${PROJECT_ROOT}/src/store/useRewardStore.ts`);
const R = () => useRewardStore.getState();
const { sealBackup, openBackup, DEFAULT_KDF } =
  await import(`${PROJECT_ROOT}/src/backup/envelope.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const J = (v) => JSON.stringify(v);

let seed = 42;
const fakeRandom = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[i] = seed & 0xff; }
  return out;
};
const FAST = { randomBytes: fakeRandom, kdf: { ...DEFAULT_KDF, N: 1024 } };

const BLANK = {
  transactions: [], archivedTransactions: [], accounts: [], lentBorrowed: [], groups: [],
  monthlyAggregates: {}, suppressedSmsIds: [], ccHandledSmsIds: [], excludedExpenseParents: [],
  budget: null, budgetHistory: {}, customParents: [], customChildren: [], manualTxnSeq: 0,
  userName: null, userPhones: [], lastSmsDate: null, lastCompactedAt: 0, userOnboardedAt: 0,
  activeGroupZoneId: null, declinedAccountLinks: [],
  // Anything asserted after the "wipe" MUST be listed here, or the restore check
  // passes on state that was never actually cleared. Dropping `ccBills` from
  // STORE_KEYS used to leave the CC-bill assertion below green for exactly that
  // reason — the test was reading the pre-wipe value.
  ccBills: {},
};

console.log(`\n${C.bold}══════ Encrypted Backup — payload & restore fidelity ══════${C.reset}\n`);

// ── Seed a store that exercises every subsystem ──────────────────────────────
useStore.setState({ ...BLANK, accounts: [{ id: 'acc1', name: 'HDFC', type: 'Bank', mask: '4021', balance: 50000 }] });
const now = Date.now();
const ingest = (sender, body, smsId) =>
  S().ingestMessage(body, { sender, receivedAt: now - 2 * 86400000, smsId });

ingest('HDFCBK', 'Rs.450.00 debited from A/c xx4021 on 06-Aug-26 to SWIGGY via UPI. Avl bal Rs.42,310.50', 'sms-1');
ingest('HDFCBK', 'INR 1,299 spent on HDFC Credit Card ending 4321 at AMAZON on 05-Aug-26.', 'sms-2');
ingest('HDFCBK', 'Your a/c xxxx5678 is credited with Rs.55,000.00 - SALARY AUG 2026.', 'sms-3');
// A CC bill payment — this path once stored the FULL message on the txn.
ingest('HDFCBK', 'Rs.5,000.00 paid towards HDFC Credit Card XX4321 from A/c XX4021 on 07-Aug-26.', 'sms-4');
// Pre-onboarding history lands in archivedTransactions — completeness must see those rows too.
S().ingestMessage('Rs.120.00 debited from A/c xx4021 on 01-Jul-26 to ZOMATO via UPI.',
  { sender: 'HDFCBK', receivedAt: now - 40 * 86400000, smsId: 'sms-old', preOnboarding: true });

S().addTransaction({ amount: 900, type: 'debit', merchant: 'Dinner', categoryId: 'food', accountId: 'acc1',
  isSplit: true, myShareAmount: 300,
  splitOthers: [{ contactId: 'c-rahul', name: 'Rahul', shareAmount: 300 },
                { contactId: 'c-priya', name: 'Priya', shareAmount: 300 }] });
const gid = S().createGroup({ name: 'Goa Trip', type: 'shared',
  members: [{ memberId: 'm1', name: 'Rahul', contactId: 'c-rahul' }] });
S().addGroupExpense(gid, { amount: 2000, merchant: 'Hotel', categoryId: 'travel', paidByMemberId: 'me',
  accountId: 'acc1', shares: [{ memberId: 'me', name: 'You', shareAmount: 1000 },
                               { memberId: 'm1', name: 'Rahul', shareAmount: 1000 }] });
S().addLentBorrowed({ kind: 'lent', person: 'Neha', contactId: 'c-neha', amount: 750, date: new Date().toISOString() });

// The group is LIVE (shared-group sync): its key, server history, member map and an outbox
// with one sent-but-unconfirmed and one unsent change all have to come back, or a restored
// phone can't read the group or resends/loses changes (docs/SHARED_GROUP_SYNC.md §5).
const LIVE = {
  remoteId: '11111111-0000-4000-8000-000000000001',
  keys: { 1: 'q83vEjRWeJBzcqkTN5kJKqcO1yyCC2kXqv9AzS8hKlE=' },
  keyEpoch: 1,
  myMemberId: '11111111-0000-4000-8000-000000000002',
  memberMap: { me: '11111111-0000-4000-8000-000000000002', m1: '11111111-0000-4000-8000-000000000003' },
  fold: { seq: 12, meta: { name: 'Goa Trip', emoji: null, color: null }, activeUsers: ['u1', 'u2'], deletedUsers: [],
    members: {}, memberOrder: [], entries: {}, balances: { a: 100, b: -100 }, debts: { 'a|b': 100 },
    historyFrom: 0, lastCheckpoint: 9, checkpointMismatch: null, lastAt: '2026-10-14T10:00:00.000Z' },
  status: 'active',
  outbox: [
    { eventId: 'e-sent', at: '2026-10-14T10:00:00.000Z', event: { type: 'expense.delete', entityId: 'x1' }, seq: 13 },
    { eventId: 'e-unsent', at: '2026-10-14T10:01:00.000Z', event: { type: 'expense.delete', entityId: 'x2' } },
  ],
  syncedAt: '2026-10-14T10:00:00.000Z',
};
S().setSharedGroupState(gid, LIVE, {});
useStore.setState({
  syncAccount: { userId: 'u1' },
  transactions: S().transactions.map((t) => (t.groupId === gid ? { ...t, syncId: 'x3', syncRejected: 'k' } : t)),
  lentBorrowed: [{ id: 'lb_sync_s1', kind: 'lent_settled', person: 'Rahul', contactId: 'c-rahul', amount: 200,
    date: new Date().toISOString(), groupId: gid, memberId: 'm1', syncId: 's1', syncOrigin: 'remote' }, ...S().lentBorrowed],
});
useStore.setState({ budget: { perCategory: { food: 8000, shopping: 5000 } } });
S().addCustomParent?.({ label: 'Pets', emoji: '🐶', color: '#F59E0B' });
useStore.setState({ excludedExpenseParents: ['shopping'], userName: 'Praveen', themeId: 'ocean' });

// An outstanding CC bill — a FUTURE obligation, so losing it in a restore means the
// new device silently stops warning about a payment that's still due. Nothing reads
// it in a selector, so the fidelity assertions below can't catch its absence; it
// gets an explicit round-trip check instead.
useStore.setState({ ccBills: { 4021: {
  amount: 16748.65, cardLast4: '4021', bankName: 'HDFC', dueDate: '07-Jun-26',
  seenAt: '2026-05-21T00:00:00.000Z',
} } });

check('seed: the store actually has data', S().transactions.length >= 5, `${S().transactions.length} txns`);

// ── Snapshot every selector BEFORE the backup ───────────────────────────────
const snapshot = () => ({
  spend:      S().getMonthlySpend(),
  income:     S().getMonthlyIncome(),
  breakdown:  S().getCategoryBreakdown(),
  budget:     S().getBudgetUsage(),
  people:     S().getPersonBalances().map((p) => ({ person: p.person, net: p.net, lent: p.lent, borrowed: p.borrowed })),
  balances:   S().accounts.map((a) => ({ id: a.id, balance: a.balance })),
  txnIds:     S().transactions.map((t) => t.id).sort(),
  groups:     S().groups.map((g) => ({ id: g.id, name: g.name, totalSpend: g.totalSpend })),
  lb:         S().lentBorrowed.map((l) => `${l.kind}:${l.person}:${l.amount}`).sort(),
  aggregates: S().monthlyAggregates,
});
const before = snapshot();

// ── Build the payload, then seal it ─────────────────────────────────────────
// The REAL reward store — a hand-made shape here once hid that REWARD_KEYS named
// fields the store doesn't have, so every real backup carried no rewards at all.
useRewardStore.setState({ totalRP: 1200, epcBalance: 340, awareStreak: 7,
  inventory: R().inventory.map((i, n) => (n === 0 ? { ...i, isUnlocked: true, isActive: true } : i)) });
const rewardsBefore = { rp: R().totalRP, epc: R().epcBalance, streak: R().awareStreak,
  unlocked: R().inventory.filter((i) => i.isUnlocked).map((i) => i.id) };
const payload = buildBackupPayload(S(), R());
const envelope = sealBackup(payload, 'a-good-password', {
  storeVersion: 23, appVersion: '1.5.0', createdAt: new Date().toISOString(), device: 'Pixel 8',
}, FAST);

// ── 1. THE LEAK TEST ────────────────────────────────────────────────────────
{
  const wire = J(payload);
  check('leak: no `smsText` field survives into the payload', !wire.includes('smsText'));
  check('leak: no `rawSms` / `rawSender` field survives', !wire.includes('rawSms') && !wire.includes('rawSender'));
  // The literal message body of the CC-bill SMS — the path that once stored it whole.
  check('leak: the original SMS body is absent',
    !wire.includes('paid towards HDFC Credit Card') && !wire.includes('Avl bal'));
  check('leak: no SMS body from ANY ingested message',
    !wire.includes('debited from A/c') && !wire.includes('is credited with'));
  // But the PARSED result must be there — that's the whole point.
  check('kept: the parsed merchant IS backed up', wire.includes('SWIGGY'));
  check('kept: smsId (an opaque id, needed for dedup) IS backed up', wire.includes('sms-1'));

  check('the device itself keeps no SMS body either (parsed values only)',
    S().transactions.every((t) => t.smsText === undefined));
}

// ── 2. THE COMPLETENESS ALARM ───────────────────────────────────────────────
// Any transaction field NOT in the allow-list is either deliberately excluded
// (raw SMS) or a field someone added without deciding. Fail loudly on the latter.
{
  const DELIBERATE = new Set(['smsText', 'rawSms', 'rawSender']);
  const stray = new Set();
  for (const t of [...S().transactions, ...S().archivedTransactions]) for (const f of unknownTxnFields(t)) if (!DELIBERATE.has(f)) stray.add(f);
  check('completeness: no transaction field is silently unaccounted for',
    stray.size === 0,
    `unlisted: ${[...stray].join(', ')} — add to TXN_FIELDS, or to the deliberate-exclusion list`);

  const missingStoreKeys = Object.keys(S())
    .filter((k) => ['transactions', 'archivedTransactions'].includes(k) === false)
    .filter((k) => STORE_KEYS.includes(k) === false)
    .filter((k) => typeof S()[k] !== 'function' && S()[k] !== undefined);
  // Informational: many are ephemeral by design. Printed, not asserted.
  console.log(`      (store keys not backed up: ${missingStoreKeys.length} — ephemeral/UI state)`);

  // What IS asserted: every PERSISTED key is either backed up or a declared exclusion.
  const persisted = Object.keys(useStore.persist.getOptions().partialize(S()));
  const declared = new Set([...STORE_KEYS, ...STORE_KEYS_EXCLUDED, 'transactions', 'archivedTransactions']);
  const undeclared = persisted.filter((k) => !declared.has(k));
  check('completeness: every persisted store key is backed up or deliberately excluded',
    undeclared.length === 0, `undeclared: ${undeclared.join(', ')}`);
  const ghost = STORE_KEYS.filter((k) => !persisted.includes(k));
  check('completeness: STORE_KEYS names no key the store does not persist',
    ghost.length === 0, `not persisted: ${ghost.join(', ')}`);

  const rewardPersisted = Object.keys(useRewardStore.persist.getOptions().partialize(R()));
  const rewardMissing = rewardPersisted.filter((k) => !REWARD_KEYS.includes(k));
  const rewardGhost = REWARD_KEYS.filter((k) => !rewardPersisted.includes(k));
  check('completeness: REWARD_KEYS matches the reward store\'s persisted keys',
    rewardMissing.length === 0 && rewardGhost.length === 0,
    `missing: ${rewardMissing.join(', ')} | not persisted: ${rewardGhost.join(', ')}`);
}

// ── 3. THE FIDELITY TEST — restore into a WIPED store ───────────────────────
{
  const { payload: decrypted } = openBackup(envelope, 'a-good-password');
  const { epurse, rewards } = readBackupPayload(decrypted);

  useStore.setState({ ...BLANK, accounts: [] });                 // wipe, as a new device would be
  check('wipe: store really is empty before restore', S().transactions.length === 0 && S().accounts.length === 0);

  useStore.setState(epurse);                                     // the restore
  const after = snapshot();

  check('restore: monthly SPEND is identical', after.spend === before.spend, `${after.spend} vs ${before.spend}`);
  check('restore: monthly INCOME is identical', after.income === before.income, `${after.income} vs ${before.income}`);
  check('restore: category BREAKDOWN is identical', J(after.breakdown) === J(before.breakdown));
  check('restore: BUDGET usage is identical', J(after.budget) === J(before.budget));
  check('restore: per-person LB BALANCES are identical', J(after.people) === J(before.people), J(after.people));
  check('restore: ACCOUNT balances are identical', J(after.balances) === J(before.balances));
  check('restore: every transaction is present', J(after.txnIds) === J(before.txnIds));
  check('restore: pre-onboarding history keeps its muted flag',
    S().archivedTransactions.length > 0 && S().archivedTransactions.every((t) => t.preOnboarding === true),
    J(S().archivedTransactions.map((t) => t.preOnboarding)));
  check('restore: GROUPS and their totals are identical', J(after.groups) === J(before.groups));
  check('restore: the LB ledger is identical', J(after.lb) === J(before.lb));
  // Not covered by any selector snapshot above — asserted directly, because a
  // dropped STORE_KEYS entry fails silently (the informational list in §2 prints
  // it but nothing enforces it).
  check('restore: an outstanding CC BILL survives (amount + due date)',
    S().ccBills?.['4021']?.dueDate === '07-Jun-26'
    && Math.round((S().ccBills?.['4021']?.amount ?? 0) * 100) === 1674865,
    J(S().ccBills));
  check('restore: historical AGGREGATES are identical', J(after.aggregates) === J(before.aggregates));
  const liveAfter = S().groups.find((g) => g.id === gid)?.shared;
  check('restore: a LIVE shared group comes back whole — key, history, member map, outbox (sent + unsent)',
    J(liveAfter) === J(LIVE), J(liveAfter));
  const groupTxn = S().transactions.find((t) => t.groupId === gid);
  check('restore: its transactions keep their server id and NOT SYNCED flag',
    groupTxn?.syncId === 'x3' && groupTxn?.syncRejected === 'k');
  const settleRow = S().lentBorrowed.find((l) => l.id === 'lb_sync_s1');
  check('restore: its settle rows keep server id, origin and member',
    settleRow?.syncId === 's1' && settleRow?.syncOrigin === 'remote' && settleRow?.memberId === 'm1');
  check('restore: the shared-group account record comes back (Delete Account can still find it)',
    S().syncAccount?.userId === 'u1');
  check('restore: spend-rule exclusions survive', J(S().excludedExpenseParents) === J(['shopping']));
  check('restore: profile + theme survive', S().userName === 'Praveen' && S().themeId === 'ocean');
  check('restore: dedup ids survive (a re-scan will not duplicate)',
    S().transactions.some((t) => t.smsId === 'sms-1'));
  useRewardStore.setState({ totalRP: 0, epcBalance: 0, awareStreak: 0,
    inventory: R().inventory.map((i) => ({ ...i, isUnlocked: false, isActive: false })) });
  useRewardStore.setState(rewards);
  check('restore: reward economy survives (RP, EPC, Aware Run, unlocked widgets)',
    J({ rp: R().totalRP, epc: R().epcBalance, streak: R().awareStreak,
        unlocked: R().inventory.filter((i) => i.isUnlocked).map((i) => i.id) }) === J(rewardsBefore)
    && rewardsBefore.unlocked.length === 1,
    J(rewards));

  // And the leak guarantee holds on the RESTORED device too.
  check('restore: the restored device carries NO original SMS text',
    S().transactions.every((t) => !t.smsText && !t.rawSms && !t.rawSender));
}

// ── 4. Version guard ────────────────────────────────────────────────────────
{
  let threw = false;
  try { readBackupPayload({ payloadVersion: 99, epurse: {}, rewards: {} }); } catch { threw = true; }
  check('a payload from a NEWER app version is refused, not half-applied', threw);
}

// ── 5. An OLDER backup is migrated before it is applied ──────────────────────
{
  const { migrate, version } = useStore.persist.getOptions();
  const old = {
    accounts: [{ id: 'a1', name: 'HDFC', type: 'Bank', mask: '1111', balance: 100 }],
    transactions: [{ id: 't1', amount: 50, type: 'debit', createdAt: Date.now(), source: 'manual',
      isIgnored: true, isHidden: true }],
    userName: 'Old',
  };
  const out = migrateRestoredState(old, 38, version, migrate);
  check('migrate: a v38 backup gains later account fields (v39 colorKey)', out.accounts?.[0]?.colorKey === null, J(out.accounts));
  check('migrate: a v38 backup gets later txn fixes (v40 ignored ⇒ not private)', out.transactions?.[0]?.isHidden === false);
  check('migrate: user data is carried through', out.userName === 'Old');
  const leaked = Object.keys(out).filter((k) => !STORE_KEYS.includes(k) && !['transactions', 'archivedTransactions'].includes(k));
  check('migrate: no device-local key is introduced by migration defaults', leaked.length === 0, leaked.join(', '));
  check('migrate: a current-version backup is passed through untouched', migrateRestoredState(old, version, version, migrate) === old);
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
