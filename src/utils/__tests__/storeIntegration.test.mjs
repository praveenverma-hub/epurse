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
const beh = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/analytics/behavioralSelectors.js');
const { isGroupExcluded, isMemoTxn, splitLbChipKind } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/split.js');

const reset = () =>
  useStore.setState({
    transactions: [], accounts: [], archivedTransactions: [], lentBorrowed: [],
    suppressedSmsIds: [], monthlyAggregates: {}, groups: [], lastSmsDate: null,
    userOnboardedAt: 0, activeGroupZoneId: null,
    pendingCCPaymentQueue: [], ccHandledSmsIds: [], userPhones: [],
    budgetHistory: {}, showMonthlyRecap: true, pendingMonthlyRecap: null,
    recapMonthHandled: null, monthlyRecapCardDismissed: null,
    showWeeklySummary: true, pendingWeeklyRecap: null, weeklyRecapHandled: null,
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

// Anchored to real "now" (not a fixed calendar date) so this suite never goes
// stale — CC true-up tests are dropped by applyCCPayment's 5-day age guard
// (CC_PROMPT_MAX_AGE_MS) once a hardcoded past date falls outside that window.
const T0 = Date.now() - 2 * 24 * 60 * 60 * 1000;

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

// ── CC bill payment: the PAYER side is only ever RE-TAGGED, never invented ─────
// The bank sends its own "Rs.X debited …" for the payment, and that message is what
// moves the balance. Synthesising a debit in the true-up flow on top of it charged the
// account twice. These four cases pin the whole contract down.

// (a) No bank message yet → picking a source must NOT move the balance or add a row.
//     The card's "payment received" SMS frequently lands before the bank's debit.
reset();
useStore.setState({ accounts: [
  { id: 'cc', type: 'Credit Card', bankName: 'SBI', mask: '7890', balance: -5000, aliasMasks: [], ccPaymentsTracked: true },
  { id: 'bank', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 20000, aliasMasks: [] },
] });
useStore.getState().applyCCPayment({ amount: 5000, accountMask: '7890', bankName: 'SBI' }, 'ccp-b', T0);
useStore.getState().confirmCCTrueUp('bank');
{
  const bank = accts().find((a) => a.mask === '4021');
  check('CC pay: no bank SMS yet → payer balance untouched (no invented debit)',
    bank && Math.round(bank.balance) === 20000, `bal ${bank ? bank.balance : '?'}`);
  check('CC pay: no bank SMS yet → no transaction fabricated',
    useStore.getState().transactions.length === 0, `got ${useStore.getState().transactions.length}`);
  check('CC pay: the card is still zeroed regardless of the payer side',
    Math.round(accts().find((a) => a.mask === '7890').balance) === 0);
}

// (b) The bank's own outgoing-payment SMS books ONE cc_bill debit and moves the balance
//     exactly once — and re-sweeping the same message must not move it again. (The
//     launch sweep re-reads the whole inbox; this path had no smsId guard at all, so
//     the balance drifted down by the bill on every single app open.)
reset();
useStore.setState({ accounts: [
  { id: 'bank', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 20000, aliasMasks: [] },
] });
const CC_OUT_SMS = 'Rs.5000.00 debited from A/c XX4021 towards CREDIT CARD PAYMENT on 06-08-26.';
ingest('HDFCBK', CC_OUT_SMS, { receivedAt: T0, smsId: 'cc-out-1' });
check('CC outgoing: bank SMS books a cc_bill debit (20000 → 15000)',
  Math.round(accts()[0].balance) === 15000, `bal ${accts()[0].balance}`);
check('CC outgoing: it is a real transaction, categorised cc_bill',
  useStore.getState().transactions.filter((t) => t.categoryId === 'cc_bill').length === 1,
  `got ${useStore.getState().transactions.length} txns`);
ingest('HDFCBK', CC_OUT_SMS, { receivedAt: T0, smsId: 'cc-out-1' });
ingest('HDFCBK', CC_OUT_SMS, { receivedAt: T0, smsId: 'cc-out-1' });
check('CC outgoing: re-sweeping the same SMS does NOT re-debit the bank',
  Math.round(accts()[0].balance) === 15000, `bal ${accts()[0].balance} after 3 sweeps`);
check('CC outgoing: bill payment is excluded from spend (cc_bill is non-spend)',
  useStore.getState().getMonthlySpend() === 0, `spend ${useStore.getState().getMonthlySpend()}`);

// (c) Bank SMS AND the card's payment-received SMS → the true-up must not add a second
//     debit on top of the one the bank already booked.
reset();
useStore.setState({ accounts: [
  { id: 'cc', type: 'Credit Card', bankName: 'SBI', mask: '7890', balance: -5000, aliasMasks: [], ccPaymentsTracked: true },
  { id: 'bank', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 20000, aliasMasks: [] },
] });
ingest('HDFCBK', CC_OUT_SMS, { receivedAt: T0, smsId: 'cc-out-2' });
useStore.getState().applyCCPayment({ amount: 5000, accountMask: '7890', bankName: 'SBI' }, 'ccp-c', T0);
useStore.getState().confirmCCTrueUp('bank');
{
  const bank = accts().find((a) => a.mask === '4021');
  check('CC pay: both SMS present → payer debited ONCE (15000, not 10000)',
    bank && Math.round(bank.balance) === 15000, `bal ${bank ? bank.balance : '?'}`);
  check('CC pay: both SMS present → exactly one cc_bill row',
    useStore.getState().transactions.filter((t) => t.categoryId === 'cc_bill').length === 1,
    `got ${useStore.getState().transactions.filter((t) => t.categoryId === 'cc_bill').length}`);
}

// (d) A plain bank debit the parser did NOT recognise as a bill payment gets re-tagged
//     to cc_bill by the source pick — the balance already moved, only the label changes,
//     which is what removes it from spend.
reset();
useStore.setState({ accounts: [
  { id: 'cc', type: 'Credit Card', bankName: 'SBI', mask: '7890', balance: -5000, aliasMasks: [], ccPaymentsTracked: true },
  { id: 'bank', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 20000, aliasMasks: [] },
] });
ingest('HDFCBK', 'Rs.5000.00 debited from A/c XX4021 at BILLDESK on 06-08-26.', { receivedAt: T0, smsId: 'plain-1' });
{
  const spendBefore = useStore.getState().getMonthlySpend();
  useStore.getState().applyCCPayment({ amount: 5000, accountMask: '7890', bankName: 'SBI' }, 'ccp-d', T0);
  useStore.getState().confirmCCTrueUp('bank');
  const bank = accts().find((a) => a.mask === '4021');
  check('CC pay: unrecognised bank debit is RE-TAGGED, balance unchanged by the re-tag',
    bank && Math.round(bank.balance) === 15000, `bal ${bank ? bank.balance : '?'}`);
  check('CC pay: re-tag moves it out of spend',
    spendBefore === 5000 && useStore.getState().getMonthlySpend() === 0,
    `before ${spendBefore} after ${useStore.getState().getMonthlySpend()}`);
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

// ── Monthly report / recap ────────────────────────────────────────────────────
// Use the previous calendar month (relative to now) so the assertions are
// time-robust: it's always < current month and the latest month with data.
{
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth(), 0);       // last day, prev month
  const prevMk = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const iso = (d) => new Date(prev.getFullYear(), prev.getMonth(), d, 10, 0, 0).toISOString();

  reset();
  useStore.setState({
    accounts: [{ id: 'acc1', name: 'HDFC ··4021', bankName: 'HDFC', mask: '4021', type: 'Bank Account', balance: 0 }],
    transactions: [
      { id: 'r1', amount: 1000, type: 'debit',  categoryId: 'food',      merchant: 'Swiggy',    accountId: 'acc1', createdAt: iso(10) },
      { id: 'r2', amount: 500,  type: 'debit',  categoryId: 'groceries', merchant: 'BigBasket', accountId: 'acc1', createdAt: iso(12) },
      { id: 'r3', amount: 5000, type: 'credit', categoryId: 'salary',    merchant: 'ACME',      accountId: 'acc1', createdAt: iso(1)  },
    ],
  });

  const rep = mod.selectMonthlyReport(prevMk)(useStore.getState());
  check('Report: spent excludes credits (₹1500)', Math.round(rep.cashflow.spent) === 1500, `got ${rep.cashflow.spent}`);
  check('Report: income from credit (₹5000)', Math.round(rep.cashflow.income) === 5000, `got ${rep.cashflow.income}`);
  check('Report: net saved (₹3500)', Math.round(rep.cashflow.net) === 3500, `got ${rep.cashflow.net}`);
  check('Report: groceries rolls up into Food parent (top cat ₹1500)',
    rep.categories[0] && rep.categories[0].id === 'food' && Math.round(rep.categories[0].total) === 1500,
    rep.categories.map((c) => `${c.id}:${c.total}`).join(','));
  check('Report: hasRaw true for recent month', rep.hasRaw === true);
  check('Report: payment method resolves account label',
    rep.paymentMethods && rep.paymentMethods[0] && Math.round(rep.paymentMethods[0].total) === 1500,
    JSON.stringify(rep.paymentMethods));

  check('selectLatestRecapMonth → previous month', mod.selectLatestRecapMonth(useStore.getState()) === prevMk,
    `got ${mod.selectLatestRecapMonth(useStore.getState())}`);

  // maybeQueueMonthlyRecap: queues once, then is idempotent (guarded).
  useStore.getState().maybeQueueMonthlyRecap();
  check('Recap: queued for previous month', useStore.getState().pendingMonthlyRecap === prevMk,
    `got ${useStore.getState().pendingMonthlyRecap}`);
  check('Recap: month marked handled', useStore.getState().recapMonthHandled === prevMk);
  useStore.getState().clearPendingMonthlyRecap();
  useStore.getState().maybeQueueMonthlyRecap();
  check('Recap: does not re-queue after handled (fires once)', useStore.getState().pendingMonthlyRecap === null,
    `got ${useStore.getState().pendingMonthlyRecap}`);

  // Group block: non-private groups broken out; private (excludeFromTotals) excluded.
  reset();
  useStore.setState({
    accounts: [{ id: 'acc1', name: 'HDFC', bankName: 'HDFC', mask: '4021', type: 'Bank Account', balance: 0 }],
    groups: [
      { id: 'gTrip', name: 'Goa Trip', type: 'trip',     emoji: '🏖️', color: '#3B82F6', excludeFromTotals: false, members: [] },
      { id: 'gPriv', name: 'Secret',   type: 'personal', emoji: '🔒', color: '#999999', excludeFromTotals: true,  members: [] },
    ],
    transactions: [
      { id: 'g1', amount: 2000, type: 'debit', categoryId: 'food',     merchant: 'Beach Shack', accountId: 'acc1', createdAt: iso(5), groupId: 'gTrip' },
      { id: 'g2', amount: 1500, type: 'debit', categoryId: 'travel',   merchant: 'Cab',         accountId: 'acc1', createdAt: iso(6), groupId: 'gTrip' },
      { id: 'g3', amount: 9999, type: 'debit', categoryId: 'shopping', merchant: 'Hidden',      accountId: 'acc1', createdAt: iso(7), groupId: 'gPriv' },
    ],
  });
  {
    const g = mod.selectMonthlyReport(prevMk)(useStore.getState());
    check('Group block: only the non-private group appears',
      g.groupSpend.length === 1 && g.groupSpend[0].id === 'gTrip', g.groupSpend.map((x) => x.id).join(','));
    check('Group block: sums your share (₹3500, 2 expenses)',
      g.groupSpend[0] && Math.round(g.groupSpend[0].total) === 3500 && g.groupSpend[0].count === 2,
      JSON.stringify(g.groupSpend[0]));
    check('Group block: private group excluded from block AND month total',
      !g.groupSpend.some((x) => x.id === 'gPriv') && Math.round(g.cashflow.spent) === 3500, `spent ${g.cashflow.spent}`);
  }

  // Report options: private / groups / transaction list.
  reset();
  useStore.setState({
    accounts: [{ id: 'acc1', bankName: 'HDFC', mask: '4021', type: 'Bank Account', balance: 0 }],
    transactions: [
      { id: 'p1', amount: 1000, type: 'debit', categoryId: 'food',     merchant: 'Cafe',       accountId: 'acc1', createdAt: iso(3) },
      { id: 'p2', amount: 4000, type: 'debit', categoryId: 'shopping', merchant: 'SecretShop', accountId: 'acc1', createdAt: iso(4), isHidden: true },
    ],
  });
  {
    const inc = mod.selectMonthlyReport(prevMk, { includePrivate: true })(useStore.getState());
    check('includePrivate on: spent counts private (₹5000)', Math.round(inc.cashflow.spent) === 5000, `got ${inc.cashflow.spent}`);
    check('includePrivate on: private category present', inc.categories.some((c) => c.id === 'shopping'));
    const exc = mod.selectMonthlyReport(prevMk, { includePrivate: false })(useStore.getState());
    check('includePrivate off: spent drops private (₹1000)', Math.round(exc.cashflow.spent) === 1000, `got ${exc.cashflow.spent}`);
    check('includePrivate off: private category removed', !exc.categories.some((c) => c.id === 'shopping'), exc.categories.map((c) => c.id).join(','));

    const tlOn = mod.selectMonthlyReport(prevMk, { includeTxnList: true })(useStore.getState());
    check('includeTxnList on: list built', Array.isArray(tlOn.txnList) && tlOn.txnList.length === 2);
    const tlOff = mod.selectMonthlyReport(prevMk, { includeTxnList: false })(useStore.getState());
    check('includeTxnList off: null', tlOff.txnList === null);
  }
  reset();
  useStore.setState({
    accounts: [{ id: 'acc1', bankName: 'HDFC', mask: '4021', type: 'Bank Account', balance: 0 }],
    groups: [{ id: 'gA', name: 'Trip', type: 'trip', emoji: '🏖️', color: '#3B82F6', excludeFromTotals: false, members: [] }],
    transactions: [{ id: 'x', amount: 1200, type: 'debit', categoryId: 'food', merchant: 'Y', accountId: 'acc1', createdAt: iso(2), groupId: 'gA' }],
  });
  {
    const goff = mod.selectMonthlyReport(prevMk, { includeGroups: false })(useStore.getState());
    check('includeGroups off: no group block', goff.groupSpend.length === 0, `got ${goff.groupSpend.length}`);
    const gon = mod.selectMonthlyReport(prevMk, { includeGroups: true })(useStore.getState());
    check('includeGroups on: group block present', gon.groupSpend.length === 1);
  }

  // openMonthlyRecap: tapping the notification/bell re-opens the SAME month's
  // recap, independent of recapMonthHandled's dedup (which only guards re-firing
  // the notification, not the user's ability to revisit it).
  useStore.getState().clearPendingMonthlyRecap();
  useStore.getState().openMonthlyRecap(prevMk);
  check('openMonthlyRecap: re-opens the recap for that month', useStore.getState().pendingMonthlyRecap === prevMk,
    `got ${useStore.getState().pendingMonthlyRecap}`);
  useStore.getState().clearPendingMonthlyRecap();

  // Toggle off → never queues.
  reset();
  useStore.setState({ showMonthlyRecap: false, transactions: [
    { id: 'r1', amount: 1000, type: 'debit', categoryId: 'food', merchant: 'X', accountId: 'acc1', createdAt: iso(10) },
  ] });
  useStore.getState().maybeQueueMonthlyRecap();
  check('Recap: disabled toggle → not queued', useStore.getState().pendingMonthlyRecap === null,
    `got ${useStore.getState().pendingMonthlyRecap}`);
}

// ── Refunds: net against spend + own category, excluded from income ───────────
reset();
ingest('HDFCBK', 'Rs.1000 debited from A/c XX4021 at AMAZON on 22-07-26.', { smsId: 're1' });
ingest('HDFCBK', 'Rs.300 refunded to A/c XX4021 by AMAZON on 22-07-26.',   { smsId: 'rr1' });
{
  const refundTxn = txns().find((t) => t.isRefund);
  check('Refund parsed: isRefund flag on the credit', !!refundTxn && refundTxn.type === 'credit', JSON.stringify(refundTxn && { type: refundTxn.type, isRefund: refundTxn.isRefund }));
  check('Refund nets spend: getMonthlySpend = 700 (1000 − 300)', Math.round(useStore.getState().getMonthlySpend()) === 700, `got ${useStore.getState().getMonthlySpend()}`);
  check('Refund not income: getMonthlyIncome = 0', Math.round(useStore.getState().getMonthlyIncome()) === 0, `got ${useStore.getState().getMonthlyIncome()}`);
  const cats = useStore.getState().getCategoryBreakdown();
  const shopping = cats.find((c) => c.id === 'shopping');
  check('Refund nets its own category: shopping = 700', shopping && Math.round(shopping.total) === 700, JSON.stringify(shopping && { id: shopping.id, total: shopping.total }));
  const stats = mod.selectExpenseStats('M')(useStore.getState());
  check('ExpenseStats: spent 700 / refunds 300 / received 0',
    Math.round(stats.spent) === 700 && Math.round(stats.refunds) === 300 && Math.round(stats.received) === 0,
    JSON.stringify({ spent: stats.spent, refunds: stats.refunds, received: stats.received }));
}

// ── Manual mark-as-refund moves a credit from Received → Refund ───────────────
reset();
ingest('HDFCBK', 'Rs.500 credited to A/c XX4021 by JOHN on 22-07-26.', { smsId: 'mc1' });
{
  const s1 = mod.selectExpenseStats('M')(useStore.getState());
  check('P2P credit counts as Received (500)', Math.round(s1.received) === 500, `got ${s1.received}`);
  const cid = txns()[0].id;
  useStore.getState().setTransactionRefund(cid, true);
  const s2 = mod.selectExpenseStats('M')(useStore.getState());
  check('After mark-refund: received 0, refunds 500', Math.round(s2.received) === 0 && Math.round(s2.refunds) === 500, JSON.stringify({ received: s2.received, refunds: s2.refunds }));
  useStore.getState().setTransactionRefund(cid, false);
  const s3 = mod.selectExpenseStats('M')(useStore.getState());
  check('Un-mark refund: back to received 500', Math.round(s3.received) === 500, `got ${s3.received}`);
}

// ── Refund consistency across ALL spend surfaces (single source of truth) ─────
{
  const nowIso = new Date().toISOString();
  const refundSet = [
    { id: 'd1', amount: 1000, type: 'debit',  categoryId: 'shopping', merchant: 'Croma', accountId: 'acc1', createdAt: nowIso },
    { id: 'd2', amount: 300,  type: 'credit', isRefund: true, categoryId: 'shopping', merchant: 'Croma', accountId: 'acc1', createdAt: nowIso },
  ];

  // Weekly summary card
  reset();
  useStore.setState({ transactions: refundSet });
  check('Weekly card nets refunds: total 700', Math.round(mod.selectWeeklySummary(useStore.getState()).total) === 700, `got ${mod.selectWeeklySummary(useStore.getState()).total}`);

  // Analytics: daily cumulative (Pace/Ghost) + group category breakdown
  const dc = beh.getDailyCumulative(refundSet, new Date());
  check('DailyCumulative (Pace) nets refunds: 700', Math.round(dc.current[dc.current.length - 1]) === 700, `got ${dc.current[dc.current.length - 1]}`);
  const bc = beh.buildCategoryBreakdown(refundSet, [{ id: 'shopping', name: 'Shopping', color: '#000', emoji: '🛍️' }]);
  check('buildCategoryBreakdown nets refunds: shopping 700', bc[0] && Math.round(bc[0].total) === 700, JSON.stringify(bc));

  // Budget drill-down + unbudgeted breakdown (with an active plan)
  reset();
  useStore.setState({
    budget: { totalCap: 5000, perCategory: { food: 5000 } },
    transactions: [
      { id: 'b1', amount: 1000, type: 'debit',  categoryId: 'food',      childCategory: 'Dining', accountId: 'acc1', createdAt: nowIso },
      { id: 'b2', amount: 400,  type: 'credit', isRefund: true, categoryId: 'food', childCategory: 'Dining', accountId: 'acc1', createdAt: nowIso },
      { id: 'b3', amount: 700,  type: 'debit',  categoryId: 'shopping',  accountId: 'acc1', createdAt: nowIso },
    ],
  });
  const child = useStore.getState().getBudgetChildBreakdown('food');
  check('Budget child breakdown nets refunds: Dining 600', child[0] && Math.round(child[0].total) === 600, JSON.stringify(child));
  const unbud = useStore.getState().getUnbudgetedBreakdown();
  const shoppingUn = unbud.find((r) => r.label && r.label.toLowerCase().includes('shop'));
  check('Unbudgeted breakdown present (shopping 700)', shoppingUn && Math.round(shoppingUn.total) === 700, JSON.stringify(unbud));
}

// ── Weekly recap: fires once for a completed week, only when it had activity ──
{
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0).getTime();
  const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
  const midLastWeek = new Date(lastWeekStart + 2 * 24 * 60 * 60 * 1000).toISOString();

  // No activity last week → not queued.
  reset();
  useStore.getState().maybeQueueWeeklyRecap();
  check('Weekly recap: no data last week → not queued', useStore.getState().pendingWeeklyRecap === null);

  // Activity last week → queued once, anchored inside that week.
  reset();
  useStore.setState({ transactions: [
    { id: 'w1', amount: 500, type: 'debit', categoryId: 'food', merchant: 'X', accountId: 'acc1', createdAt: midLastWeek },
  ] });
  useStore.getState().maybeQueueWeeklyRecap();
  const anchor = useStore.getState().pendingWeeklyRecap;
  check('Weekly recap: queued with an anchor inside last week',
    anchor !== null && anchor >= lastWeekStart && anchor < thisWeekStart, `got ${anchor}`);

  // selectWeeklySummary(state, anchor) reports the ANCHORED (last) week's total,
  // with no "today"/"future" markers since that week has already ended.
  const summary = mod.selectWeeklySummary(useStore.getState(), anchor);
  check('Anchored weekly summary: totals the completed week (500)', Math.round(summary.total) === 500, `got ${summary.total}`);
  check('Anchored weekly summary: no day marked as today', !summary.perDay.some((d) => d.isToday));
  check('Anchored weekly summary: no day marked as future', !summary.perDay.some((d) => d.isFuture));

  // Idempotent: clearing + re-running the same week doesn't re-queue.
  useStore.getState().clearPendingWeeklyRecap();
  useStore.getState().maybeQueueWeeklyRecap();
  check('Weekly recap: does not re-queue the same week', useStore.getState().pendingWeeklyRecap === null,
    `got ${useStore.getState().pendingWeeklyRecap}`);

  // Toggle off → never queues.
  reset();
  useStore.setState({ showWeeklySummary: false, transactions: [
    { id: 'w2', amount: 500, type: 'debit', categoryId: 'food', merchant: 'X', accountId: 'acc1', createdAt: midLastWeek },
  ] });
  useStore.getState().maybeQueueWeeklyRecap();
  check('Weekly recap: disabled toggle → not queued', useStore.getState().pendingWeeklyRecap === null);
}

// ── Coincidental shared transferRef between UNRELATED txns must not self-link ──
// Real user-reported pair: different amounts, same IMPS ref. Neither leg's
// counterparty (mobile "13245" / Acct XX232) is a registered user account/phone,
// so propagateSelfByRef (ref-only, no amount check) must NOT tag either as self.
reset();
ingest('INDBNK', 'Your a/c. XXXX9452 is credited by Rs. 1500.00 on 27-07-26 by a/c linked to mobile 9XXXXXX13245 (IMPS Ref no. 620812989787). -IndianBank', { smsId: 'sr1' });
ingest('ICICIB', 'ICICI Bank Acct XX341 debited with Rs 15,000.00 on 27-Jul-26 & Acct XX232 credited.IMPS:620812989787. Call 18002662 for dispute or SMS BLOCK 171 to 9215676766', { smsId: 'sr2' });
{
  const both = txns();
  check('Shared-ref pair: both txns booked (not deduped against each other)', both.length === 2, `got ${both.length}`);
  check('Shared-ref pair: neither wrongly tagged self', both.every((t) => t.categoryId !== 'self'), both.map((t) => `${t.amount}:${t.categoryId}`).join(','));
  const credit = both.find((t) => t.type === 'credit');
  const debit  = both.find((t) => t.type === 'debit');
  check('Shared-ref pair: credit leg amount 1500', credit && Math.round(credit.amount) === 1500, `got ${credit && credit.amount}`);
  check('Shared-ref pair: debit leg amount 15000', debit && Math.round(debit.amount) === 15000, `got ${debit && debit.amount}`);
}

// ── getMonthlyRefunds ───────────────────────────────────────────────────────
reset();
ingest('HDFCBK', 'Rs.1000 debited from A/c XX4021 at AMAZON on 22-07-26.', { smsId: 'gr1' });
ingest('HDFCBK', 'Rs.300 refunded to A/c XX4021 by AMAZON on 22-07-26.',   { smsId: 'gr2' });
check('getMonthlyRefunds: 300', Math.round(useStore.getState().getMonthlyRefunds()) === 300, `got ${useStore.getState().getMonthlyRefunds()}`);

// ── Lent/Borrowed person identity: PHONE FIRST, then name ───────────────────
// Phone is authoritative: same number = one person however the name is spelled;
// different numbers = different people even when the names match.
{
  const lb = (entry) => useStore.getState().addLentBorrowed(entry);
  const balances = () => useStore.getState().getPersonBalances();
  const shape = () => balances().map((p) => `"${p.person}"[${p.phone}]=${p.net}`).join(' | ');
  const onlyLb = (rows) => useStore.setState({ lentBorrowed: [], transactions: [], accounts: [] }) || rows;

  // Same phone written three ways + a rename → one person, newest name shown.
  onlyLb();
  lb({ kind: 'lent', person: 'Rohit',        phone: '9999912345',      amount: 500, date: '2026-07-01T10:00:00Z' });
  lb({ kind: 'lent', person: 'Rohit Sharma', phone: '+91 99999 12345', amount: 300, date: '2026-07-20T10:00:00Z' });
  check('LB identity: country-code variant is the SAME person', balances().length === 1, shape());
  check('LB identity: nets pool to 800',                        balances()[0]?.net === 800, shape());
  check('LB identity: shows the most recent name',              balances()[0]?.person === 'Rohit Sharma', shape());
  // A later, SHORTER name must still win (the old rule kept the longest name).
  lb({ kind: 'lent', person: 'Ro', phone: '09999912345', amount: 100, date: '2026-07-29T10:00:00Z' });
  check('LB identity: newer shorter name still wins', balances().length === 1 && balances()[0]?.person === 'Ro', shape());

  // Two unrelated people who share a first name must NOT be pooled.
  onlyLb();
  lb({ kind: 'lent', person: 'Rohit', phone: '1111111111', amount: 500 });
  lb({ kind: 'lent', person: 'Rohit', phone: '2222222222', amount: 300 });
  check('LB identity: different phones stay separate despite same name', balances().length === 2, shape());

  // No phone anywhere → fall back to the name.
  onlyLb();
  lb({ kind: 'lent', person: 'Meera', amount: 100 });
  lb({ kind: 'lent', person: 'meera', amount: 200 });
  check('LB identity: name-only entries group by name', balances().length === 1 && balances()[0].net === 300, shape());

  // A name-only entry attaches when the name points at exactly one phone-person…
  onlyLb();
  lb({ kind: 'lent', person: 'Kabir', amount: 100 });
  lb({ kind: 'lent', person: 'Kabir', phone: '3333333333', amount: 200 });
  check('LB identity: name-only joins its single phone match', balances().length === 1 && balances()[0].net === 300, shape());

  // …but must NOT guess when the name is ambiguous across two phone-people.
  onlyLb();
  lb({ kind: 'lent', person: 'Rohit', phone: '1111111111', amount: 500 });
  lb({ kind: 'lent', person: 'Rohit', phone: '2222222222', amount: 300 });
  lb({ kind: 'lent', person: 'Rohit', amount: 70 });
  check('LB identity: ambiguous name-only is not merged', balances().length === 3, shape());

  // A settlement whose phone is formatted differently must still net the origin
  // to zero — a split here would surface it as the OPPOSITE kind in totals.
  onlyLb();
  lb({ kind: 'lent', person: 'Ana', phone: '+919888812345', amount: 400, date: '2026-07-01T00:00:00Z' });
  useStore.getState().addAlreadySettledLentBorrowed({ kind: 'lent', person: 'Ana K', phone: '9888812345', amount: 400, date: '2026-07-10T00:00:00Z' });
  check('LB identity: settle across phone formats nets to zero', balances().length === 1 && balances()[0].net === 0, shape());

  // contactId is a second authoritative id: an entry carrying only the
  // contactId still finds the group whose phone it once co-occurred with.
  onlyLb();
  lb({ kind: 'lent', person: 'Zoe',   phone: '7777712345', contactId: 'c9', amount: 200 });
  lb({ kind: 'lent', person: 'Zoe Q', contactId: 'c9', amount: 150 });
  check('LB identity: contactId-only joins its phone group', balances().length === 1 && balances()[0].net === 350, shape());
}

// ---------------------------------------------------------------------------
// LB entry edit / delete (LbPersonScreen). A row DERIVED from a group expense
// (groupId) or a real transaction (sourceTxnId) must stay read-only — editing it
// here would desync it from the expense, or contradict the account balance the
// transaction already moved.
// ---------------------------------------------------------------------------
{
  const S = () => useStore.getState();
  const only = () => useStore.setState({ lentBorrowed: [], transactions: [], accounts: [] });
  const rohit = () => S().getPersonBalances().find((p) => p.person === 'Rohit' || p.person === 'Rohan');

  only();
  S().addLentBorrowed({ kind: 'lent', person: 'Rohit', phone: '9876543210', amount: 500, note: 'lunch' });
  let row = S().lentBorrowed[0];
  check('LB edit: manual row is editable', S().isLentBorrowedEditable(row) === true);

  check('LB edit: amount change re-nets the balance',
    S().updateLentBorrowedEntry(row.id, { amount: 800 }) === true && rohit().net === 800,
    `net=${rohit().net}`);

  check('LB edit: rejects amount 0',        S().updateLentBorrowedEntry(row.id, { amount: 0 }) === false);
  check('LB edit: rejects over-max amount', S().updateLentBorrowedEntry(row.id, { amount: 1e12 }) === false);
  check('LB edit: rejects blank person',    S().updateLentBorrowedEntry(row.id, { person: '  ' }) === false);
  check('LB edit: amount survives rejected patches',
    S().lentBorrowed.find((l) => l.id === row.id).amount === 800);

  check('LB edit: backdating keeps the row',
    S().updateLentBorrowedEntry(row.id, { date: '2026-05-01T00:00:00Z' }) === true &&
    S().lentBorrowed.find((l) => l.id === row.id).date.startsWith('2026-05-01'));

  // Derived rows: refused for both update and delete, and left in place.
  useStore.setState({
    lentBorrowed: [
      { id: 'lb_g1', kind: 'lent', person: 'Rohit', phone: '9876543210', amount: 300, groupId: 'grp_1', date: '2026-07-01T00:00:00Z' },
      { id: 'lb_t1', kind: 'lent', person: 'Rohit', phone: '9876543210', amount: 150, sourceTxnId: 'txn_1', date: '2026-07-02T00:00:00Z' },
      ...S().lentBorrowed,
    ],
  });
  check('LB edit: group row is NOT editable',
    S().isLentBorrowedEditable(S().lentBorrowed.find((l) => l.id === 'lb_g1')) === false &&
    S().updateLentBorrowedEntry('lb_g1', { amount: 1 }) === false &&
    S().deleteLentBorrowedEntry('lb_g1') === false &&
    !!S().lentBorrowed.find((l) => l.id === 'lb_g1'));
  check('LB edit: txn-backed row is NOT editable',
    S().isLentBorrowedEditable(S().lentBorrowed.find((l) => l.id === 'lb_t1')) === false &&
    S().updateLentBorrowedEntry('lb_t1', { amount: 1 }) === false &&
    S().deleteLentBorrowedEntry('lb_t1') === false &&
    !!S().lentBorrowed.find((l) => l.id === 'lb_t1'));

  check('LB edit: net includes locked rows', rohit().net === 800 + 300 + 150, `net=${rohit().net}`);

  check('LB edit: deleting a manual row re-nets',
    S().deleteLentBorrowedEntry(row.id) === true && rohit().net === 450, `net=${rohit().net}`);
  check('LB edit: delete of an unknown id is refused', S().deleteLentBorrowedEntry('nope') === false);
}

// ---------------------------------------------------------------------------
// note vs smsText. `note` is the USER's note (rendered as "Note" in the detail
// sheets, prefilled into the edit form); the bank message body lives in `smsText`.
// Before Jul-31 the parser wrote the SMS into `note`, so every auto-imported
// transaction looked like the user had typed the whole SMS.
// ---------------------------------------------------------------------------
{
  const S = () => useStore.getState();
  useStore.setState({ transactions: [], accounts: [], lentBorrowed: [], preOnboarding: false, onboardedAt: null });

  const body = 'Rs.450.00 debited from A/c XX1234 on 31-07-26 to ZOMATO via UPI Ref 1234567890. Avl Bal Rs.5000';
  S().ingestMessage(body, { sender: 'HDFCBK', receivedAt: new Date().toISOString(), smsId: 'sms_note_1' });
  const t = S().transactions[0];
  check('note/smsText: ingested txn leaves `note` empty', !t.note, `note=${JSON.stringify(t.note)}`);
  check('note/smsText: ingested txn carries the body in `smsText`',
    !!t.smsText && t.smsText.includes('ZOMATO'), `smsText=${JSON.stringify(t.smsText)}`);

  S().addTransaction({ amount: 200, type: 'debit', merchant: 'Chai', categoryId: 'food', note: 'team offsite' });
  const m = S().transactions[0];
  check('note/smsText: a manual note is kept in `note`', m.note === 'team offsite' && !m.smsText);
}

// ---------------------------------------------------------------------------
// Location: coarse place labels, and `byLocation` in the monthly aggregates so the
// data outlives RAW_RETENTION_MS (raw txns are dropped at 90 days).
// ---------------------------------------------------------------------------
{
  const loc = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/location.js');
  const pune = { city: 'Pune', district: 'Shivajinagar', region: 'Maharashtra', country: 'India' };
  const mum  = { city: 'Mumbai', district: null, region: 'Maharashtra', country: 'India' };

  check('location: key is the city', loc.locationKey(pune) === 'Pune' && loc.locationKey(mum) === 'Mumbai');
  check('location: no location → null key', loc.locationKey(null) === null);
  check('location: label de-dupes district/city', loc.formatLocation(mum) === 'Mumbai, Maharashtra',
    loc.formatLocation(mum));

  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
  useStore.setState({
    transactions: [
      { id: 'L1', amount: 500, type: 'debit',  categoryId: 'food',   createdAt: old, location: pune },
      { id: 'L2', amount: 300, type: 'debit',  categoryId: 'food',   createdAt: old, location: pune },
      { id: 'L3', amount: 200, type: 'debit',  categoryId: 'travel', createdAt: old, location: mum  },
      { id: 'L4', amount: 900, type: 'credit', categoryId: 'salary', createdAt: old, location: pune },
      { id: 'L5', amount: 400, type: 'debit',  categoryId: 'food',   createdAt: old },
    ],
    accounts: [], monthlyAggregates: {}, groups: [],
  });
  useStore.getState().compactTransactions(true);
  const agg = useStore.getState().monthlyAggregates;
  const byLoc = agg[Object.keys(agg)[0]].byLocation;
  check('location: spend survives compaction in byLocation',
    byLoc.Pune === 800 && byLoc.Mumbai === 200, JSON.stringify(byLoc));
  check('location: income is NOT bucketed by place', !Object.values(byLoc).includes(900), JSON.stringify(byLoc));
}

// ── Editing a split transaction's amount keeps the split, pro-rata ────────────
// `updateTransaction` deliberately CLEARS a split when the amount changes: the stored
// shares were computed against the old total, so leaving them would make the parts stop
// summing to the whole. The edit screen used to stop there — split gone, LB rows gone,
// no warning, and the split wasn't even rendered in edit mode so it couldn't be seen.
// commitEdit now re-applies the picks by PERCENT afterwards, which rebuilds shares and
// LB rows against the new amount. These cases pin that whole sequence.
{
  reset();
  useStore.setState({ accounts: [
    { id: 'a1', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 10000, aliasMasks: [] },
  ] });
  useStore.getState().addTransaction({
    amount: 900, type: 'debit', accountId: 'a1', categoryId: 'food',
    parentCategory: 'Food & Dining', childCategory: 'Restaurants',
    merchant: 'Barbeque Nation', source: 'manual', isReviewed: true,
    isSplit: true, myPercent: 34,
    splitOthers: [
      { contactId: 'c1', name: 'Amit', percent: 33 },
      { contactId: 'c2', name: 'Riya', percent: 33 },
    ],
  });
  const t0 = useStore.getState().transactions[0];
  check('split edit: created with shares summing to the amount',
    t0.myShareAmount + t0.splitWith.reduce((s, o) => s + o.shareAmount, 0) === 900,
    `${t0.myShareAmount} + ${JSON.stringify(t0.splitWith.map((s) => s.shareAmount))}`);
  check('split edit: one lent row per other person',
    useStore.getState().lentBorrowed.length === 2 &&
    useStore.getState().lentBorrowed.every((l) => l.kind === 'lent'));

  // Percent picks, exactly as the edit screen's prefill derives them.
  const amt = t0.amount;
  const myPct = Math.round((t0.myShareAmount / amt) * 100);
  const picks = t0.splitWith.map((o) => ({
    contactId: o.contactId, name: o.name, percent: Math.round((o.shareAmount / amt) * 100),
  }));

  useStore.getState().updateTransaction(t0.id, {
    amount: 1200, type: t0.type, accountId: 'a1', merchant: t0.merchant,
    categoryId: t0.categoryId, parentCategory: t0.parentCategory,
    childCategory: t0.childCategory, note: '', createdAt: t0.createdAt,
  });
  // Documents WHY the re-apply is needed — this is the state the old flow shipped.
  check('split edit: updateTransaction alone still drops the split (by design)',
    useStore.getState().transactions[0].isSplit === false &&
    useStore.getState().lentBorrowed.length === 0);

  useStore.getState().setTransactionSplit(t0.id, picks, { mode: 'percent', myPercent: myPct });
  const t1 = useStore.getState().transactions[0];
  const lb1 = useStore.getState().lentBorrowed;
  check('split edit: re-applying rebuilds shares against the NEW amount',
    t1.myShareAmount + t1.splitWith.reduce((s, o) => s + o.shareAmount, 0) === 1200,
    `${t1.myShareAmount} + ${JSON.stringify(t1.splitWith.map((s) => s.shareAmount))}`);
  check('split edit: proportions are preserved (34/33/33)',
    Math.round((t1.myShareAmount / 1200) * 100) === 34 &&
    t1.splitWith.every((o) => Math.round((o.shareAmount / 1200) * 100) === 33));
  check('split edit: LB rows are rebuilt at the new share amounts',
    lb1.length === 2 && lb1.every((l) => l.kind === 'lent' && l.amount === 396),
    JSON.stringify(lb1.map((l) => [l.person, l.amount])));
  check('split edit: the account reflects the new full amount, not the share',
    Math.round(useStore.getState().accounts[0].balance) === 8800,
    `bal ${useStore.getState().accounts[0].balance}`);

  useStore.getState().setTransactionSplit(t0.id, [], {});
  check('split edit: toggling the split off clears shares AND its LB rows',
    useStore.getState().transactions[0].isSplit === false &&
    useStore.getState().transactions[0].splitWith.length === 0 &&
    useStore.getState().lentBorrowed.length === 0);
}

// ─── SPLIT PAYER (plain split, group parity) ─────────────────────────────────
// A plain split's payer carries the SAME accounting as a shared group's:
//   paidBy me    → my account debits the full amount, others owe me (lent).
//   paidBy other → memo: NO balance moves, excluded from spend, and I owe that
//                  person my own share (borrowed).
// The balance round-trip across payer flips is the part most worth pinning: a
// missed applyDelta there is silent money loss.
{
  reset();
  const bal = () => Math.round(useStore.getState().accounts[0].balance);
  const txn0 = () => useStore.getState().transactions[0];
  const lbRows = () => useStore.getState().lentBorrowed;
  const acct = () => [{ id: 'a1', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 10000, aliasMasks: [] }];
  const addSplit = (extra = {}) => {
    useStore.setState({ accounts: acct(), transactions: [], lentBorrowed: [] });
    useStore.getState().addTransaction({
      amount: 1000, type: 'debit', accountId: 'a1', categoryId: 'food',
      parentCategory: 'Food & Dining', childCategory: 'Restaurants',
      merchant: 'Dinner', source: 'manual', isReviewed: true,
      isSplit: true, myPercent: 50,
      splitOthers: [{ contactId: 'c1', name: 'Rahul', percent: 50 }],
      ...extra,
    });
  };

  // ── Created directly as a memo (someone else paid) ──
  addSplit({ splitPaidBy: { contactId: 'c1', name: 'Rahul' } });
  check('split payer: created memo moves NO balance', bal() === 10000, `bal ${bal()}`);
  check('split payer: memo is flagged and carries its payer',
    txn0().isSplitMemo === true && txn0().splitPaidBy?.name === 'Rahul');
  check('split payer: memo parks the account instead of owning it',
    !txn0().accountId && txn0().memoAccountId === 'a1');
  check('split payer: memo owes MY share as one borrowed row',
    lbRows().length === 1 && lbRows()[0].kind === 'borrowed' &&
    lbRows()[0].amount === 500 && lbRows()[0].person === 'Rahul',
    JSON.stringify(lbRows().map((l) => [l.kind, l.person, l.amount])));
  check('split payer: a memo is excluded from spend everywhere',
    isGroupExcluded(txn0(), []) === true && isMemoTxn(txn0()) === true);
  check('split payer: memo contributes nothing to monthly spend',
    useStore.getState().getMonthlySpend() === 0,
    `spend ${useStore.getState().getMonthlySpend()}`);
  check('split payer: memo reads as BORROWED on the card',
    splitLbChipKind(txn0()) === 'borrowed');

  // ── Created as a normal split (I paid) — the pre-existing behaviour ──
  addSplit();
  check('split payer: I-paid split debits the FULL amount', bal() === 9000, `bal ${bal()}`);
  check('split payer: I-paid split lends out their share',
    lbRows().length === 1 && lbRows()[0].kind === 'lent' && lbRows()[0].amount === 500);
  check('split payer: I-paid split counts only MY share as spend',
    useStore.getState().getMonthlySpend() === 500,
    `spend ${useStore.getState().getMonthlySpend()}`);

  // ── Flip I-paid → memo, then back. The balance must land exactly where it started.
  const picks = [{ contactId: 'c1', name: 'Rahul', percent: 50 }];
  useStore.getState().setTransactionSplit(txn0().id, picks,
    { mode: 'percent', myPercent: 50, paidBy: { contactId: 'c1', name: 'Rahul' } });
  check('split payer: flipping to a memo GIVES THE MONEY BACK', bal() === 10000, `bal ${bal()}`);
  check('split payer: flipping to a memo swaps lent → borrowed',
    lbRows().length === 1 && lbRows()[0].kind === 'borrowed' && lbRows()[0].amount === 500);

  useStore.getState().setTransactionSplit(txn0().id, picks, { mode: 'percent', myPercent: 50, paidBy: null });
  check('split payer: flipping back to me re-applies the debit', bal() === 9000, `bal ${bal()}`);
  check('split payer: flipping back restores the account on the txn',
    txn0().accountId === 'a1' && !txn0().isSplitMemo && !txn0().memoAccountId);
  check('split payer: flipping back swaps borrowed → lent',
    lbRows().length === 1 && lbRows()[0].kind === 'lent');

  // ── Clearing a memo's split entirely must also restore the debit.
  addSplit({ splitPaidBy: { contactId: 'c1', name: 'Rahul' } });
  useStore.getState().setTransactionSplit(txn0().id, [], {});
  check('split payer: clearing a memo split re-applies the debit', bal() === 9000, `bal ${bal()}`);
  check('split payer: clearing a memo leaves no memo flags stranded',
    !txn0().isSplitMemo && !txn0().splitPaidBy && !txn0().memoAccountId &&
    txn0().accountId === 'a1' && txn0().isSplit === false);
  check('split payer: clearing a memo drops its borrowed row', lbRows().length === 0);

  // ── An amount edit drops the split (by design) — a memo must not strand.
  addSplit({ splitPaidBy: { contactId: 'c1', name: 'Rahul' } });
  const memoId = txn0().id;
  useStore.getState().updateTransaction(memoId, {
    amount: 1200, type: 'debit', accountId: 'a1', merchant: 'Dinner',
    categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Restaurants',
    note: '', createdAt: txn0().createdAt,
  });
  check('split payer: an amount edit that drops a memo split re-debits the new amount',
    bal() === 8800, `bal ${bal()}`);
  check('split payer: an amount edit leaves no stranded memo',
    !txn0().isSplitMemo && !txn0().splitPaidBy && txn0().accountId === 'a1');
  check('split payer: a re-debited ex-memo is back in spend',
    useStore.getState().getMonthlySpend() === 1200,
    `spend ${useStore.getState().getMonthlySpend()}`);

  // ── Editing a memo WITHOUT changing the amount keeps it a memo and moves nothing.
  addSplit({ splitPaidBy: { contactId: 'c1', name: 'Rahul' } });
  useStore.getState().updateTransaction(txn0().id, {
    amount: 1000, type: 'debit', accountId: 'a1', merchant: 'Dinner (edited)',
    categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Restaurants',
    note: '', createdAt: txn0().createdAt,
  });
  check('split payer: editing a memo in place still moves no money', bal() === 10000, `bal ${bal()}`);
  check('split payer: editing a memo in place keeps it a memo',
    txn0().isSplitMemo === true && !txn0().accountId && txn0().memoAccountId === 'a1' &&
    txn0().merchant === 'Dinner (edited)');

  // ── Deleting a memo must not "give back" money that never left.
  addSplit({ splitPaidBy: { contactId: 'c1', name: 'Rahul' } });
  useStore.getState().deleteTransaction(txn0().id);
  check('split payer: deleting a memo leaves the balance untouched', bal() === 10000, `bal ${bal()}`);
  check('split payer: deleting a memo drops its borrowed row', lbRows().length === 0);

  // ── A payer whose share is zero owes nothing → no LB row, still a memo.
  useStore.setState({ accounts: acct(), transactions: [], lentBorrowed: [] });
  useStore.getState().addTransaction({
    amount: 1000, type: 'debit', accountId: 'a1', categoryId: 'food',
    parentCategory: 'Food & Dining', childCategory: 'Restaurants',
    merchant: 'Treat', source: 'manual', isReviewed: true,
    isSplit: true, myPercent: 0,
    splitOthers: [{ contactId: 'c1', name: 'Rahul', percent: 100 }],
    splitPaidBy: { contactId: 'c1', name: 'Rahul' },
  });
  check('split payer: Rahul paid and I owe nothing → memo with no debt',
    txn0().isSplitMemo === true && lbRows().length === 0 && bal() === 10000);

  // ── A stray splitPaidBy with no actual split must NOT suppress the debit.
  useStore.setState({ accounts: acct(), transactions: [], lentBorrowed: [] });
  useStore.getState().addTransaction({
    amount: 700, type: 'debit', accountId: 'a1', categoryId: 'food',
    parentCategory: 'Food & Dining', childCategory: 'Restaurants',
    merchant: 'Solo', source: 'manual', isReviewed: true,
    isSplit: false, splitPaidBy: { contactId: 'c1', name: 'Rahul' },
  });
  check('split payer: a payer without a split is ignored (money still moves)',
    bal() === 9300 && !txn0().isSplitMemo && !txn0().splitPaidBy && txn0().accountId === 'a1',
    `bal ${bal()}`);
}

// ─── LB SETTLED RETENTION runs from createdAt, not the (backdatable) date ─────
// Regression: a borrow_repaid the user entered against an OLD date was deleted by
// the next launch's compaction, because retention was measured from `date`. They
// typed an entry, saw it, restarted, and it was gone. Retention must run from when
// the row was RECORDED; `date` is the event date and is user-editable.
{
  const DAY = 86400000;
  const ago = (d) => new Date(Date.now() - d * DAY).toISOString();
  const survives = (row) => {
    useStore.setState({
      transactions: [], accounts: [], groups: [], monthlyAggregates: {},
      lastCompactedAt: 0, lentBorrowed: [{ id: 'x', kind: 'borrow_repaid', person: 'Rahul', amount: 500, ...row }],
    });
    useStore.getState().compactTransactions(true);
    return useStore.getState().lentBorrowed.length === 1;
  };

  check('lb retention: a settlement backdated years but recorded TODAY survives compaction',
    survives({ date: ago(900), createdAt: ago(0) }) === true);
  check('lb retention: a settlement actually recorded >2yr ago is still pruned',
    survives({ date: ago(900), createdAt: ago(900) }) === false);
  // Window is 730 days (LB_SETTLED_RETENTION_MS) — raised from 365.
  check('lb retention: the 2-year boundary holds (729d kept, 731d pruned)',
    survives({ date: ago(729), createdAt: ago(729) }) === true &&
    survives({ date: ago(731), createdAt: ago(731) }) === false);
  check('lb retention: a row inside the OLD 1-year window is now comfortably kept',
    survives({ date: ago(400), createdAt: ago(400) }) === true);
  check('lb retention: legacy rows with no createdAt fall back to date',
    survives({ date: ago(10) }) === true && survives({ date: ago(900) }) === false);
  // NaN comparisons are all false, so the old `>= cutoff` form dropped these.
  check('lb retention: a row with an unparseable date is KEPT, not silently deleted',
    survives({ date: undefined }) === true && survives({ date: 'not-a-date' }) === true);
  check('lb retention: outstanding rows are never pruned however old',
    survives({ kind: 'borrowed', date: ago(1200), createdAt: ago(1200) }) === true);

  // The writers must actually stamp it, or every guard above silently falls back.
  useStore.setState({ transactions: [], accounts: [], lentBorrowed: [], groups: [] });
  useStore.getState().addAlreadySettledLentBorrowed({
    person: 'Rahul', amount: 500, kind: 'borrowed', date: ago(900), note: '', contactId: 'c1', phone: '9876543210',
  });
  const stamped = useStore.getState().lentBorrowed[0];
  check('lb retention: addAlreadySettledLentBorrowed stamps createdAt and keeps the backdated date',
    !!stamped.createdAt &&
    Date.now() - new Date(stamped.createdAt).getTime() < 60_000 &&
    stamped.date === ago(900).slice(0, 10) + stamped.date.slice(10),
    `createdAt=${stamped.createdAt} date=${stamped.date}`);
  useStore.getState().compactTransactions(true);
  check('lb retention: …and it survives the very next compaction',
    useStore.getState().lentBorrowed.length === 1);
}

// ─── SPEND RULES — user-chosen "counts as expense" per PARENT category ────────
// Parent-level by necessity: most sub-categories share their parent's legacyId, txns
// don't always carry childCategory, and compacted history is legacy-keyed. The rule
// must reach every spend surface (spendExcluded), must NOT touch balances, and must
// not leak into income.
{
  const acct = () => [{ id: 'a1', type: 'Bank', bankName: 'HDFC Bank', mask: '4021', balance: 100000, aliasMasks: [] }];
  const seed = () => {
    useStore.setState({
      transactions: [], accounts: acct(), lentBorrowed: [], groups: [],
      monthlyAggregates: {}, excludedExpenseParents: [], budget: null, lastCompactedAt: 0,
    });
    const add = (amount, parent, child, type = 'debit') => useStore.getState().addTransaction({
      amount, type, accountId: 'a1', merchant: 'M', source: 'manual', isReviewed: true,
      parentCategory: parent, childCategory: child,
    });
    add(1000, 'Food & Dining', 'Restaurants');
    add(2000, 'Shopping', 'Clothing');
    add(500,  'Bills & Utilities', 'Electricity');
    add(5000, 'Income', 'Salary', 'credit');
  };
  const spend  = () => useStore.getState().getMonthlySpend();
  const income = () => useStore.getState().getMonthlyIncome();
  const bal    = () => Math.round(useStore.getState().accounts[0].balance);

  seed();
  check('spend rules: everything counts by default', spend() === 3500, `spend ${spend()}`);
  const baseBal = bal();

  useStore.getState().setExpenseParentCounted('shopping', false);
  check('spend rules: excluding a parent drops exactly its spend',
    spend() === 1500, `spend ${spend()}`);
  check('spend rules: an excluded parent leaves the account balance untouched',
    bal() === baseBal, `bal ${bal()} vs ${baseBal}`);
  check('spend rules: the category breakdown drops it too',
    !useStore.getState().getCategoryBreakdown().some((b) => (b.categoryId || b.id) === 'shopping'),
    JSON.stringify(useStore.getState().getCategoryBreakdown().map((b) => b.categoryId || b.id)));

  useStore.getState().setExpenseParentCounted('shopping', true);
  check('spend rules: re-including restores it', spend() === 3500, `spend ${spend()}`);

  // An EXPENSE rule must not touch income — they're separate totals.
  useStore.getState().setExpenseParentCounted('food', false);
  check('spend rules: an expense rule leaves income alone',
    income() === 5000 && spend() === 2500, `income ${income()} spend ${spend()}`);

  // The setter REFUSES non-budgetable parents. Without that guard this would zero the
  // user's income, because spendExcluded gates getMonthlyIncome as well as spend.
  useStore.getState().setExpenseParentCounted('income', false);
  check('spend rules: the setter refuses Income/Transfers (would otherwise zero income)',
    income() === 5000 && !useStore.getState().excludedExpenseParents.includes('income'),
    `income ${income()} excluded ${JSON.stringify(useStore.getState().excludedExpenseParents)}`);
  useStore.getState().setExpenseParentCounted('transfers', false);
  check('spend rules: …transfers too',
    !useStore.getState().excludedExpenseParents.includes('transfers'));

  useStore.getState().resetSpendRules();
  check('spend rules: reset counts everything again',
    spend() === 3500 && useStore.getState().excludedExpenseParents.length === 0);

  // The predicate reads STATE, not a cached mirror — so a direct setState applies.
  // A module-level mirror refreshed only by the setters would silently ignore this.
  useStore.setState({ excludedExpenseParents: ['shopping'] });
  check('spend rules: state is the single source (a direct setState takes effect)',
    spend() === 1500, `spend ${spend()}`);

  // Persisted rules must survive a cold start with no setter call at all.
  seed();
  useStore.setState({ excludedExpenseParents: ['bills'] });
  check('spend rules: rules apply straight from rehydrated state',
    spend() === 3000, `spend ${spend()}`);
}

// ─── SPEND RULES reach COMPACTED history, not just the live month ─────────────
// Aggregates are materialised at compaction, so getMonthlySpend returns a stored
// number for old months. Without excludedSpendInAggregate a rule set today would
// leave last year's totals counting the category — the chart contradicting the rule.
{
  const DAY = 86400000;
  const old = new Date(Date.now() - 200 * DAY);
  const mk = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}`;
  useStore.setState({
    transactions: [], accounts: [{ id: 'a1', type: 'Bank', bankName: 'H', mask: '1', balance: 99999, aliasMasks: [] }],
    lentBorrowed: [], groups: [], monthlyAggregates: {}, excludedExpenseParents: [], lastCompactedAt: 0,
  });
  const addOld = (amount, legacy, parent) => useStore.getState().addTransaction({
    amount, type: 'debit', accountId: 'a1', merchant: 'M', source: 'manual', isReviewed: true,
    categoryId: legacy, parentCategory: parent, createdAt: old.toISOString(),
  });
  addOld(3000, 'shopping', 'Shopping');
  addOld(1000, 'food', 'Food & Dining');
  useStore.getState().compactTransactions(true);

  const agg = useStore.getState().monthlyAggregates[mk];
  check('history rules: the month really did compact to an aggregate',
    useStore.getState().transactions.length === 0 && agg?.totalSpend === 4000,
    `raw ${useStore.getState().transactions.length} agg ${JSON.stringify(agg?.byCategory)}`);

  const spendOld = () => useStore.getState().getMonthlySpend(old);
  check('history rules: aggregate total is intact with no rules', spendOld() === 4000, `${spendOld()}`);

  useStore.getState().setExpenseParentCounted('shopping', false);
  check('history rules: a rule set TODAY applies to a compacted month',
    spendOld() === 1000, `spend ${spendOld()} (expected 1000)`);
  const brk = useStore.getState().getCategoryBreakdown(mk);
  check('history rules: the historical breakdown drops the excluded category',
    !brk.some((b) => (b.id || b.categoryId) === 'shopping'),
    JSON.stringify(brk.map((b) => b.id || b.categoryId)));
  check('history rules: remaining slices are rebased to 100%, not left at 25%',
    Math.round(brk.find((b) => (b.id || b.categoryId) === 'food')?.percent ?? 0) === 100,
    JSON.stringify(brk.map((b) => [b.id || b.categoryId, Math.round(b.percent)])));
  check('history rules: an excluded parent averages 0 over history',
    useStore.getState().getParentCategoryAverage('shopping', 6) === 0);

  useStore.getState().setExpenseParentCounted('shopping', true);
  check('history rules: re-including restores the historical total', spendOld() === 4000, `${spendOld()}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
