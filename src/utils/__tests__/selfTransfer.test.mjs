// =============================================================================
// Self-transfer detection — end-to-end test flow
// -----------------------------------------------------------------------------
//     npm run test:self      (or: node … selfTransfer.test.mjs)
//
// Imports the REAL parser (messageParser.js) and the REAL detection helpers
// (selfTransfer.js), then replays the store's ingest pipeline in miniature:
//   parse → register account mask → tag self → reconcile → ref-linkage.
// This proves both legs of a cross-bank self transfer get tagged 'self',
// regardless of arrival order and regardless of which signal is available
// (counterparty mask / name / shared transfer reference).
// =============================================================================

import { parseMessageDetailed } from '../messageParser.js';
import { isSelfTransfer, propagateSelfByRef, SELF_TXN_FIELDS } from '../selfTransfer.js';

// Mirror of store.ingestMessage's self-transfer-relevant steps. `accounts` is
// the growing set of user masks (one per ingested accountMask, exactly as
// ensureAccountForParsed creates them).
function simulateIngest(messages, { userPhones = [], userName = '' } = {}) {
  let txns = [];
  const masks = new Set();

  for (const { sms, sender } of messages) {
    const r = parseMessageDetailed(sms, { sender });
    if (!r.ok) continue;
    const t = { ...r.transaction };
    if (t.accountMask) masks.add(t.accountMask);              // ensureAccountForParsed
    const userMasks = [...masks];
    if (isSelfTransfer(t, userMasks, userPhones, userName)) Object.assign(t, SELF_TXN_FIELDS);
    txns = [t, ...txns];

    // Reconcile every stored txn against the now-grown mask set.
    const finalMasks = [...masks];
    txns = txns.map((x) => {
      if (!x || x.userEditedCategory || x.lbLocked || x.categoryId === 'self') return x;
      if (!x.selfDualLeg && !x.counterpartyPhone && !x.counterpartyName) return x;
      return isSelfTransfer(x, finalMasks, userPhones, userName) ? { ...x, ...SELF_TXN_FIELDS } : x;
    });
    // Cross-leg linkage via shared transfer reference.
    txns = propagateSelfByRef(txns, finalMasks);
  }
  return txns;
}

const SBI_CREDIT = {
  sender: 'SBIINB',
  sms: 'Dear Customer, Your a/c no. XXXXXXXX0972 is credited by Rs.1.00 on 06-06-26 by a/c linked to mobile 7XXXXXX221-PRAVEEN VE (IMPS Ref# 615722061047)-SBI',
};
const ICICI_DUAL = {
  sender: 'ICICIB',
  sms: 'ICICI Bank Acct XX171 debited with Rs 1.00 on 06-Jun-26 & Acct XX972 credited.IMPS:615722061047. Call 18002662 for dispute or SMS BLOCK 171 to 9215676766',
};

// A genuine INCOMING payment from someone else — must NOT be tagged self.
const REAL_INCOME = {
  sender: 'INDBNK',
  sms: 'Your a/c. XXXX4455 is credited by Rs. 2500.00 on 06-06-26 by a/c linked to mobile 9XXXXXX88888-RAHUL KUMAR (IMPS Ref no. 700000000001). -IndianBank',
};

const cases = [
  {
    name: 'Both legs, SBI→ICICI order, name + ref available',
    msgs: [SBI_CREDIT, ICICI_DUAL],
    opts: { userName: 'Praveen Verma' },
    expect: { allSelf: true, count: 2 },
  },
  {
    name: 'Both legs, ICICI→SBI order (reverse arrival)',
    msgs: [ICICI_DUAL, SBI_CREDIT],
    opts: { userName: 'Praveen Verma' },
    expect: { allSelf: true, count: 2 },
  },
  {
    name: 'SBI credit ALONE, self via name match (no second leg)',
    msgs: [SBI_CREDIT],
    opts: { userName: 'Praveen Verma' },
    expect: { allSelf: true, count: 1 },
  },
  {
    name: 'Both legs, NO username — self via shared transfer ref linkage',
    msgs: [ICICI_DUAL, SBI_CREDIT],
    opts: { userName: '' },
    expect: { allSelf: true, count: 2 },
  },
  {
    name: 'SBI credit ALONE, no username/phone — cannot confirm self (stays income)',
    msgs: [SBI_CREDIT],
    opts: { userName: '' },
    expect: { allSelf: false, count: 1, noneSelf: true },
  },
  {
    name: 'Genuine income from another person — must NOT be self',
    msgs: [REAL_INCOME],
    opts: { userName: 'Praveen Verma' },
    expect: { allSelf: false, count: 1, noneSelf: true },
  },
];

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0;
const fails = [];

console.log(`\n${C.bold}══════ Self-Transfer Detection Test Flow ══════${C.reset}\n`);
for (const tc of cases) {
  const txns = simulateIngest(tc.msgs, tc.opts);
  const selfCount = txns.filter((t) => t.categoryId === 'self').length;
  const problems = [];
  if (txns.length !== tc.expect.count) problems.push(`count: expected ${tc.expect.count}, got ${txns.length}`);
  if (tc.expect.allSelf && selfCount !== txns.length) problems.push(`expected ALL ${txns.length} self, got ${selfCount}`);
  if (tc.expect.noneSelf && selfCount !== 0) problems.push(`expected NONE self, got ${selfCount}`);

  if (problems.length === 0) { pass++; console.log(`  ${C.green}✓${C.reset} ${tc.name}`); }
  else { fails.push({ name: tc.name, problems }); console.log(`  ${C.red}✗ ${tc.name}${C.reset}`); }
}

if (fails.length) {
  console.log(`\n${C.red}${C.bold}FAILURES:${C.reset}`);
  for (const f of fails) { console.log(`  ${C.red}✗ ${f.name}${C.reset}`); for (const p of f.problems) console.log(`      ${C.yellow}${p}${C.reset}`); }
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
const allPass = pass === cases.length;
console.log(`  ${allPass ? C.green : C.red}${C.bold}${pass}/${cases.length} passed${C.reset}\n`);
process.exit(allPass ? 0 : 1);
