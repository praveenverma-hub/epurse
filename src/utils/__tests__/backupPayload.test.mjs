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
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_store-hook.mjs', import.meta.url);

const mod = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js');
const useStore = mod.useEPurseStore || mod.default;
const S = () => useStore.getState();

const { buildBackupPayload, readBackupPayload, unknownTxnFields, TXN_FIELDS, STORE_KEYS } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/payload.ts');
const { sealBackup, openBackup, DEFAULT_KDF } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/envelope.ts');

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
// A CC bill payment — this is the path that ALWAYS writes smsText onto the txn.
ingest('HDFCBK', 'Rs.5,000.00 paid towards HDFC Credit Card XX4321 from A/c XX4021 on 07-Aug-26.', 'sms-4');

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
const payload = buildBackupPayload(S(), { coins: 1200, xp: 340, level: 5, streak: 7 });
const envelope = sealBackup(payload, 'a-good-password', {
  storeVersion: 23, appVersion: '1.5.0', createdAt: new Date().toISOString(), device: 'Pixel 8',
}, FAST);

// ── 1. THE LEAK TEST ────────────────────────────────────────────────────────
{
  const wire = J(payload);
  check('leak: no `smsText` field survives into the payload', !wire.includes('smsText'));
  check('leak: no `rawSms` / `rawSender` field survives', !wire.includes('rawSms') && !wire.includes('rawSender'));
  // The literal message body of the CC-bill SMS — the path that always stores smsText.
  check('leak: the original SMS body is absent',
    !wire.includes('paid towards HDFC Credit Card') && !wire.includes('Avl bal'));
  check('leak: no SMS body from ANY ingested message',
    !wire.includes('debited from A/c') && !wire.includes('is credited with'));
  // But the PARSED result must be there — that's the whole point.
  check('kept: the parsed merchant IS backed up', wire.includes('SWIGGY'));
  check('kept: smsId (an opaque id, needed for dedup) IS backed up', wire.includes('sms-1'));

  const rawStillOnDevice = S().transactions.some((t) => !!t.smsText);
  check('the device itself still has smsText (we strip on EXPORT, not on ingest)', rawStillOnDevice);
}

// ── 2. THE COMPLETENESS ALARM ───────────────────────────────────────────────
// Any transaction field NOT in the allow-list is either deliberately excluded
// (raw SMS) or a field someone added without deciding. Fail loudly on the latter.
{
  const DELIBERATE = new Set(['smsText', 'rawSms', 'rawSender']);
  const stray = new Set();
  for (const t of S().transactions) for (const f of unknownTxnFields(t)) if (!DELIBERATE.has(f)) stray.add(f);
  check('completeness: no transaction field is silently unaccounted for',
    stray.size === 0,
    `unlisted: ${[...stray].join(', ')} — add to TXN_FIELDS, or to the deliberate-exclusion list`);

  const missingStoreKeys = Object.keys(S())
    .filter((k) => ['transactions', 'archivedTransactions'].includes(k) === false)
    .filter((k) => STORE_KEYS.includes(k) === false)
    .filter((k) => typeof S()[k] !== 'function' && S()[k] !== undefined);
  // Informational: many are ephemeral by design. Printed, not asserted.
  console.log(`      (store keys not backed up: ${missingStoreKeys.length} — ephemeral/UI state)`);
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
  check('restore: spend-rule exclusions survive', J(S().excludedExpenseParents) === J(['shopping']));
  check('restore: profile + theme survive', S().userName === 'Praveen' && S().themeId === 'ocean');
  check('restore: dedup ids survive (a re-scan will not duplicate)',
    S().transactions.some((t) => t.smsId === 'sms-1'));
  check('restore: reward economy survives', rewards.coins === 1200 && rewards.streak === 7);

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

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
