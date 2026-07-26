// =============================================================================
// STORE INTEGRATION TESTS — the layer parseMessageDetailed batches can't reach.
// -----------------------------------------------------------------------------
//   node --import ./src/utils/__tests__/_register-store.mjs \
//        src/utils/__tests__/storeIntegration.test.mjs
//
// Loads the REAL ePurseStore via _store-hook.mjs (native leaves stubbed) and
// drives getState().ingestMessage(...) end-to-end, asserting on the resulting
// transactions[] / accounts[]. Covers: dedup (smsId + content fingerprint),
// balance application (applyDelta), same-account mask-length merge (last-4 ↔
// last-6), cross-bank non-merge, and self-transfer categorisation.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_store-hook.mjs', import.meta.url);

const mod = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js');
const useStore = mod.useEPurseStore || mod.default;

const reset = () =>
  useStore.setState({
    transactions: [], accounts: [], archivedTransactions: [], lentBorrowed: [],
    suppressedSmsIds: [], monthlyAggregates: {}, groups: [], lastSmsDate: null,
    userOnboardedAt: 0, activeGroupZoneId: null,
    pendingCCPaymentQueue: [], ccHandledSmsIds: [], userPhones: [],
  });

const ingest = (sender, body, opts = {}) =>
  useStore.getState().ingestMessage(body, { sender, receivedAt: Date.now(), ...opts });
const txns = () => useStore.getState().transactions.filter((t) => !t.isIgnored);
const accts = () => useStore.getState().accounts;

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const T0 = new Date('2026-07-22T10:00:00Z').getTime();

// ── Dedup ────────────────────────────────────────────────────────────────────
reset();
ingest('HDFCBK', 'Rs.500 debited from A/c XX4021 at STORE on 22-07-26.', { receivedAt: T0, smsId: 'sms-1' });
ingest('HDFCBK', 'Rs.500 debited from A/c XX4021 at STORE on 22-07-26.', { receivedAt: T0, smsId: 'sms-1' });
check('Dedup: same smsId ingested twice → 1 txn', txns().length === 1, `got ${txns().length}`);

reset();
ingest('HDFCBK', 'Rs.750 debited from A/c XX4021 at CAFE on 22-07-26.', { receivedAt: T0, smsId: 'a' });
ingest('HDFCBK', 'Rs.750 debited from A/c XX4021 at CAFE on 22-07-26.', { receivedAt: T0 + 60_000, smsId: 'b' });
check('Dedup: same content, diff smsId, within 10min → 1 txn', txns().length === 1, `got ${txns().length}`);

reset();
ingest('HDFCBK', 'Rs.750 debited from A/c XX4021 at CAFE on 22-07-26.', { receivedAt: T0, smsId: 'a' });
ingest('HDFCBK', 'Rs.750 debited from A/c XX4021 at CAFE on 22-07-26.', { receivedAt: T0 + 20 * 60_000, smsId: 'b' });
check('Dedup: same content, >10min apart → 2 txns', txns().length === 2, `got ${txns().length}`);

reset();
ingest('HDFCBK', 'Rs.750 debited from A/c XX4021 at CAFE on 22-07-26.', { receivedAt: T0, smsId: 'a' });
ingest('HDFCBK', 'Rs.751 debited from A/c XX4021 at CAFE on 22-07-26.', { receivedAt: T0, smsId: 'b' });
check('Dedup: different amount, same time → 2 txns', txns().length === 2, `got ${txns().length}`);

// ── Balance application (applyDelta) ──────────────────────────────────────────
reset();
ingest('HDFCBK', 'Rs.500 debited from A/c XX4021 at STORE on 22-07-26.', { receivedAt: T0, smsId: 'd1' });
ingest('HDFCBK', 'Rs.300 credited to A/c XX4021 by REFUND on 22-07-26.', { receivedAt: T0 + 5 * 60_000, smsId: 'c1' });
{
  const a = accts().find((x) => x.mask === '4021' || (x.aliasMasks || []).includes('4021'));
  check('Balance: debit 500 then credit 300 → net -200', a && Math.round(a.balance) === -200, `got ${a ? a.balance : 'no acct'}`);
}

// ── Mask-length merge (last-4 ↔ last-6, same bank) ────────────────────────────
reset();
ingest('HDFCBK', 'Rs.400 debited from HDFC Bank A/c XX9532 at STORE on 22-07-26.', { receivedAt: T0, smsId: 'm1' });
ingest('HDFCBK', 'Rs.600 debited from HDFC Bank A/c XX119532 at SHOP on 22-07-26.', { receivedAt: T0 + 60_000, smsId: 'm2' });
{
  const bankAccts = accts();
  const merged = bankAccts.find((a) => a.mask === '9532' || (a.aliasMasks || []).includes('9532'));
  check('Mask-merge: last-4 XX9532 + last-6 XX119532 (same bank) → 1 account',
    bankAccts.length === 1, `got ${bankAccts.length} accounts`);
  check('Mask-merge: alternate mask recorded on aliasMasks',
    merged && ((merged.aliasMasks || []).includes('119532') || merged.mask === '119532'),
    merged ? `mask=${merged.mask} alias=[${merged.aliasMasks}]` : 'no acct');
  check('Mask-merge: both txns land on the one account, balance -1000',
    merged && Math.round(merged.balance) === -1000, merged ? `bal ${merged.balance}` : 'no acct');
}

// ── Cross-bank same last-4 → must NOT merge ───────────────────────────────────
reset();
ingest('HDFCBK', 'Rs.400 debited from HDFC Bank A/c XX9532 at STORE on 22-07-26.', { receivedAt: T0, smsId: 'x1' });
ingest('ICICIB', 'Rs.600 debited from ICICI Bank A/c XX9532 at SHOP on 22-07-26.', { receivedAt: T0 + 60_000, smsId: 'x2' });
check('Cross-bank: HDFC XX9532 + ICICI XX9532 → 2 separate accounts',
  accts().length === 2, `got ${accts().length}`);

// ── Self-transfer between two OWN accounts → categoryId 'self' ────────────────
reset();
// Seed both accounts so the transfer's counterparty mask is a known user account.
useStore.setState({ accounts: [
  { id: 'acc-a', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 0, aliasMasks: [] },
  { id: 'acc-b', type: 'Bank', bankName: 'HDFC Bank', mask: '9911', balance: 0, aliasMasks: [] },
] });
ingest('HDFCBK', 'Rs.2000 debited from A/c XX4021 and credited to your A/c XX9911 on 22-07-26. Ref SELF9.', { receivedAt: T0, smsId: 's1' });
{
  const all = txns();
  const anySelf = all.some((t) => t.categoryId === 'self');
  check('Self-transfer: own-account transfer tagged categoryId "self"', anySelf,
    `cats: ${all.map((t) => t.categoryId).join(',') || 'none'}`);
}

// ── Anchor guard — a txn OLDER than the account's anchoredAt must not move balance ──
reset();
useStore.setState({ accounts: [
  { id: 'anc', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 1000, anchoredAt: T0, aliasMasks: [] },
] });
ingest('HDFCBK', 'Rs.500 debited from A/c XX4021 at OLD on 20-07-26.', { receivedAt: T0 - 5 * 86_400_000, smsId: 'old1' });
{
  const a = accts().find((x) => x.mask === '4021');
  check('Anchor guard: debit older than anchoredAt leaves balance unchanged',
    a && Math.round(a.balance) === 1000, a ? `bal ${a.balance}` : 'no acct');
}

// ── CC payment received → surfaces true-up flow, does NOT book a spend/income txn ──
reset();
ingest('SBICRD', 'Payment of Rs.12000 received on your SBI Credit Card XX7890. Thank you.', { receivedAt: T0, smsId: 'ccp1' });
check('CC payment received → no phantom spend/income transaction', txns().length === 0, `got ${txns().length}`);

// ── Suppressed smsId → ingest skipped ─────────────────────────────────────────
reset();
useStore.setState({ suppressedSmsIds: ['supp1'] });
ingest('HDFCBK', 'Rs.500 debited from A/c XX4021 at STORE on 22-07-26.', { receivedAt: T0, smsId: 'supp1' });
check('Suppressed smsId → transaction not added', txns().length === 0, `got ${txns().length}`);

// ── Self-transfer via shared IMPS ref across TWO SMS — order independence ──────
const DUAL   = 'ICICI Bank Acct XX171 debited with Rs 1.00 on 06-Jun-26 & Acct XX972 credited.IMPS:615722061047. Call 18002662 for dispute';
const SINGLE = 'Dear Customer, Your a/c no. XXXXXXXX0972 is credited by Rs.1.00 on 06-06-26 by a/c linked to mobile 7XXXXXX221-PRAVEEN VE (IMPS Ref# 615722061047)-SBI';
const seedSelf = () => {
  reset();
  useStore.setState({
    accounts: [
      { id: 'a171', type: 'Bank', bankName: 'ICICI Bank', mask: '171', balance: 0, aliasMasks: [] },
      { id: 'a972', type: 'Bank', bankName: 'ICICI Bank', mask: '0972', balance: 0, aliasMasks: [] },
    ],
    userPhones: ['9876543221'],
  });
};
seedSelf();
ingest('ICICIB', DUAL,   { receivedAt: T0, smsId: 'd1' });
ingest('ICICIB', SINGLE, { receivedAt: T0 + 3000, smsId: 's1' });
check('Self-by-ref (dual→single): both legs categoryId "self"',
  txns().length > 0 && txns().every((t) => t.categoryId === 'self'),
  `cats: ${txns().map((t) => t.categoryId).join(',')}`);

seedSelf();
ingest('ICICIB', SINGLE, { receivedAt: T0, smsId: 's2' });
ingest('ICICIB', DUAL,   { receivedAt: T0 + 3000, smsId: 'd2' });
check('Self-by-ref (single→dual): order-independent, both "self"',
  txns().length > 0 && txns().every((t) => t.categoryId === 'self'),
  `cats: ${txns().map((t) => t.categoryId).join(',')}`);

// ── CC true-up zeroes the card's outstanding balance ──────────────────────────
reset();
useStore.setState({ accounts: [
  { id: 'cc', type: 'Credit Card', bankName: 'SBI', mask: '7890', balance: -5000, aliasMasks: [], ccPaymentsTracked: true },
] });
useStore.getState().applyCCPayment({ amount: 5000, accountMask: '7890', bankName: 'SBI' }, 'ccp-a', T0);
useStore.getState().confirmCCTrueUp(null);
check('CC true-up: confirming zeroes the CC outstanding balance',
  Math.round(accts().find((a) => a.mask === '7890').balance) === 0,
  `bal ${accts().find((a) => a.mask === '7890').balance}`);

// ── CC payment with a source account debits the payer + books a cc_bill txn ────
reset();
useStore.setState({ accounts: [
  { id: 'cc', type: 'Credit Card', bankName: 'SBI', mask: '7890', balance: -5000, aliasMasks: [], ccPaymentsTracked: true },
  { id: 'bank', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 20000, aliasMasks: [] },
] });
useStore.getState().applyCCPayment({ amount: 5000, accountMask: '7890', bankName: 'SBI' }, 'ccp-b', T0);
useStore.getState().confirmCCTrueUp('bank');
{
  const bank = accts().find((a) => a.mask === '4021');
  const ccBillTxns = useStore.getState().transactions.filter((t) => t.categoryId === 'cc_bill');
  check('CC payment: paying account debited (20000 → 15000)', bank && Math.round(bank.balance) === 15000, `bal ${bank ? bank.balance : '?'}`);
  check('CC payment: a cc_bill transaction is booked on the payer', ccBillTxns.length === 1, `got ${ccBillTxns.length}`);
}

// ── Debit-card ↔ bank merge (linkDebitCardToBank) — same money, not two balances ──
reset();
useStore.setState({ accounts: [
  { id: 'dc', type: 'Debit Card', bankName: 'HDFC Bank', mask: '9182', balance: -500, aliasMasks: [] },
  { id: 'bk', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 10000, aliasMasks: [] },
] });
useStore.getState().linkDebitCardToBank('dc', 'bk');
{
  const a = accts();
  const bk = a.find((x) => x.id === 'bk');
  check('DC↔Bank merge: two accounts collapse to one', a.length === 1, `got ${a.length}`);
  check('DC↔Bank merge: card mask folded into bank aliasMasks + balances summed',
    bk && (bk.aliasMasks || []).includes('9182') && Math.round(bk.balance) === 9500,
    bk ? `alias=[${bk.aliasMasks}] bal=${bk.balance}` : 'no bank');
}

// ── Split creates one lent row per friend + nets in getPersonBalances ─────────
reset();
ingest('HDFCBK', 'Rs.900 debited from A/c XX4021 at RESTAURANT on 22-07-26.', { receivedAt: T0, smsId: 'spl1' });
useStore.getState().setTransactionSplit(txns()[0].id, [{ name: 'Rohit' }, { name: 'Aman' }], { mode: 'equal' });
{
  const persons = useStore.getState().getPersonBalances();
  check('Split: creates a lent row per friend (2)', useStore.getState().lentBorrowed.length === 2, `got ${useStore.getState().lentBorrowed.length}`);
  check('Split: each friend owes an equal ₹300 share',
    persons.length === 2 && persons.every((p) => Math.round(p.net) === 300),
    persons.map((p) => `${p.person}:${p.net}`).join(','));
}

// ── Bank SMS with NO account mask → no phantom account, txn still recorded ─────
reset();
ingest('HDFCBK', 'Rs.250 debited for UPI to cafe@ybl on 22-07-26.', { receivedAt: T0, smsId: 'nomask1' });
check('No-mask bank debit: no phantom account created', accts().length === 0, `got ${accts().length} accounts`);
check('No-mask bank debit: transaction still recorded', txns().length === 1, `got ${txns().length}`);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
