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
//
// …but CLAMPED INSIDE THE CURRENT CALENDAR MONTH. A flat "now − 2 days" put
// every fixture in the PREVIOUS month on the 1st and 2nd, and `getMonthlySpend`
// counts this month — so "CC pay: re-tag moves it out of spend" read 0 before
// and 0 after and failed, two days out of every month, for reasons that had
// nothing to do with the code under test. (Found on 2026-09-01, the 1st.)
//
// Both bounds matter: the max keeps it in this month, and the min keeps it in
// the PAST — on the 1st, the month start is later than "two days ago" but must
// still not be a future timestamp.
const MONTH_START = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const T0 = Math.min(Date.now() - 1000, Math.max(Date.now() - 2 * 24 * 60 * 60 * 1000, MONTH_START));

// Guard the anchor itself: every fixture below inherits it, so a T0 that drifts
// out of the month (or into the future) fails dozens of tests for one reason.
{
  const t0 = new Date(T0), now = new Date();
  check('T0 sits inside the current calendar month, in the past',
    t0.getMonth() === now.getMonth() && t0.getFullYear() === now.getFullYear() && T0 < Date.now(),
    `${t0.toISOString()} vs now ${now.toISOString()}`);
}

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

// ═════════════════════════════════════════════════════════════════════════════
// SPLIT FLOWS — the SAME two people reached through every split path (Aug-26).
//
// The invariant under test: one friend = ONE balance, however the debt was
// created (group expense, plain split at add-time, plain split applied later,
// manual IOU). getPersonBalances unions only on STRONG ids (phone/contactId);
// a name-only row attaches only while that name maps to exactly one person, so
// any row that silently loses its contactId is a latent balance split.
//
// Found and fixed here:
//   • addTransaction's lent legs dropped contactId/phone (setTransactionSplit
//     always carried them) → a later phone-only IOU DETACHED the earlier split.
//   • untagging a group MEMO stripped isGroupMemo from a txn that has no
//     accountId → a phantom expense: full amount into spend, no balance moved.
// ═════════════════════════════════════════════════════════════════════════════
{
  const resetSplit = () => {
    useStore.setState({
      transactions: [], accounts: [{ id: 'acc1', name: 'HDFC', type: 'Bank', mask: '4021', balance: 100000 }],
      archivedTransactions: [], lentBorrowed: [], groups: [], monthlyAggregates: {},
      excludedExpenseParents: [], suppressedSmsIds: [], manualTxnSeq: 0,
      userOnboardedAt: 0, activeGroupZoneId: null, budgetHistory: {},
    });
  };
  const G = () => useStore.getState();
  const bal = () => G().accounts.find((a) => a.id === 'acc1').balance;
  const spend = () => G().getMonthlySpend();
  const who = (name) => G().getPersonBalances().filter((p) => p.person === name);
  const net = (name) => who(name).reduce((a, p) => a + p.net, 0);
  const share = (memberId, name, shareAmount) => ({ memberId, name, shareAmount });

  resetSplit();
  const gid = G().createGroup({
    name: 'Goa Trip', type: 'shared',
    members: [{ memberId: 'm1', name: 'Rahul', contactId: 'c-rahul' },
              { memberId: 'm2', name: 'Priya', contactId: 'c-priya' }],
  });

  // ── Group expense, I paid, two entries ──
  G().addGroupExpense(gid, { amount: 3000, merchant: 'Hotel', categoryId: 'travel',
    paidByMemberId: 'me', accountId: 'acc1',
    shares: [share('me', 'You', 1000), share('m1', 'Rahul', 1000), share('m2', 'Priya', 1000)] });
  G().addGroupExpense(gid, { amount: 600, merchant: 'Lunch', categoryId: 'food',
    paidByMemberId: 'me', accountId: 'acc1',
    shares: [share('me', 'You', 200), share('m1', 'Rahul', 200), share('m2', 'Priya', 200)] });
  check('split/group: my spend counts MY SHARE only across 2 expenses', spend() === 1200, `${spend()}`);
  check('split/group: the FULL amount leaves the account', bal() === 96400, `${bal()}`);
  check('split/group: each member owes their share', net('Rahul') === 1200 && net('Priya') === 1200,
    `R=${net('Rahul')} P=${net('Priya')}`);

  // ── Group expense someone else paid → memo ──
  G().addGroupExpense(gid, { amount: 1500, merchant: 'Scooter', categoryId: 'travel',
    paidByMemberId: 'm1', paidByName: 'Rahul', accountId: 'acc1',
    shares: [share('me', 'You', 500), share('m1', 'Rahul', 500), share('m2', 'Priya', 500)] });
  check('split/memo: a group memo adds no spend and moves no balance',
    spend() === 1200 && bal() === 96400, `spend ${spend()} bal ${bal()}`);
  check('split/memo: I owe the payer my share only', net('Rahul') === 700, `${net('Rahul')}`);

  // ── Plain split at ADD time, same two people ──
  G().addTransaction({ amount: 900, type: 'debit', merchant: 'Dinner', categoryId: 'food',
    accountId: 'acc1', isSplit: true, myShareAmount: 300,
    splitOthers: [{ contactId: 'c-rahul', name: 'Rahul', shareAmount: 300 },
                  { contactId: 'c-priya', name: 'Priya', shareAmount: 300 }] });
  check('split/plain: plain split adds only my share to spend', spend() === 1500, `${spend()}`);
  check('split/plain: full amount leaves the account', bal() === 95500, `${bal()}`);
  check('split/plain: group + plain debts NET into one person',
    who('Rahul').length === 1 && net('Rahul') === 1000, `${who('Rahul').length} rows, net ${net('Rahul')}`);

  // ── Plain split applied LATER, someone else paid ──
  G().addTransaction({ id: 'TX-CAB', amount: 1200, type: 'debit', merchant: 'Cab',
    categoryId: 'travel', accountId: 'acc1' });
  G().setTransactionSplit('TX-CAB', [{ contactId: 'c-priya', name: 'Priya', shareAmount: 400 }],
    { mode: 'amount', myAmount: 400, paidBy: { contactId: 'c-rahul', name: 'Rahul' } });
  check('split/plain-memo: flipping to someone-else-paid gives the money back',
    bal() === 95500 && spend() === 1500, `bal ${bal()} spend ${spend()}`);
  check('split/plain-memo: my share becomes a debt to the payer', net('Rahul') === 600, `${net('Rahul')}`);

  // ── Manual IOU, same contactId ──
  G().addLentBorrowed({ kind: 'lent', person: 'Rahul', contactId: 'c-rahul', phone: null,
    amount: 250, date: new Date().toISOString() });
  check('split/manual: a manual IOU with the same contactId merges',
    who('Rahul').length === 1 && net('Rahul') === 850, `${who('Rahul').length} rows, net ${net('Rahul')}`);

  // ── REGRESSION: a phone-only IOU must not detach the earlier split legs ──
  G().addLentBorrowed({ kind: 'lent', person: 'Rahul', contactId: null, phone: '9821034512',
    amount: 100, date: new Date().toISOString() });
  const cid = who('Rahul').find((p) => String(p.personKey).startsWith('cid:'));
  check('split/identity: a phone-only IOU does NOT fragment the contactId person',
    cid && cid.net === 850, `cid net ${cid && cid.net} (expected 850 — 300 plain-split leg must stay attached)`);
  check('split/identity: total across the phone-only row is still right', net('Rahul') === 950, `${net('Rahul')}`);

  // ── Group-scoped settle touches only the group legs ──
  G().settleGroupPersonBalance(gid, cid.personKey);
  check('split/settle: group settle clears only the group portion (700 of 850)',
    who('Rahul').find((p) => p.personKey === cid.personKey)?.net === 150,
    `${JSON.stringify(who('Rahul').map((p) => [String(p.personKey), p.net]))}`);

  // ── REGRESSION: untagging a MEMO must not conjure a phantom expense ──
  const spendBefore = spend(), balBefore = bal();
  const scooter = G().transactions.find((t) => t.merchant === 'Scooter');
  G().untagTransactionFromGroup(scooter.id);
  check('split/untag-memo: untagging a memo does NOT add its amount to spend',
    spend() === spendBefore && bal() === balBefore, `spend ${spend()}/${spendBefore} bal ${bal()}/${balBefore}`);
  const scooterAfter = G().transactions.find((t) => t.id === scooter.id);
  check('split/untag-memo: it becomes a plain split memo, not a personal expense',
    scooterAfter.isSplitMemo === true && !scooterAfter.groupId && scooterAfter.myShareAmount === 500,
    JSON.stringify({ memo: scooterAfter.isSplitMemo, gid: scooterAfter.groupId, mine: scooterAfter.myShareAmount }));
  check('split/untag-memo: the debt to the payer survives, un-scoped from the group',
    G().lentBorrowed.some((l) => l.sourceTxnId === scooter.id && l.kind === 'borrowed'
      && l.amount === 500 && !l.groupId));

  // ── Clearing a plain split restores the full amount to spend ──
  const dinner = G().transactions.find((t) => t.merchant === 'Dinner');
  const preClear = spend();
  G().setTransactionSplit(dinner.id, []);
  check('split/clear: clearing a split returns the other shares to my spend',
    spend() === preClear + 600, `${spend()} vs ${preClear + 600}`);
  check('split/clear: its lent legs are gone',
    !G().lentBorrowed.some((l) => l.sourceTxnId === dinner.id));

  // ── Deleting a group expense removes its legs ──
  const hotel = G().transactions.find((t) => t.merchant === 'Hotel');
  G().deleteTransaction(hotel.id);
  check('split/delete: deleting a group expense drops its LB legs',
    !G().lentBorrowed.some((l) => l.sourceTxnId === hotel.id));
  check('split/delete: and refunds the account', bal() === 98500, `${bal()}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Activity footer totals — must EQUAL the store selectors for the same data
// -----------------------------------------------------------------------------
// The footer once applied only `spendExcluded`, so a self-transfer counted as
// money out AND in, lent/repaid read as spend + income, refunds counted as
// income, and rows surfaced by the Ignored chip were summed. It contradicted
// Home for the very same transactions. These tests pin them together: any future
// divergence between computeLedgerTotals and getMonthlySpend fails here.
// ═════════════════════════════════════════════════════════════════════════════
{
  reset();
  const { computeLedgerTotals } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/ledgerTotals.js');
  const { spendExcluded } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js');

  useStore.getState().addAccount({ name: 'HDFC', type: 'Bank', mask: '1111', balance: 100000 });
  const acc = useStore.getState().accounts[0].id;
  const add = (o) => useStore.getState().addTransaction({
    accountId: acc, createdAt: new Date().toISOString(), ...o,
  });

  add({ amount: 2000,  type: 'debit',  merchant: 'Swiggy',      categoryId: 'food' });
  add({ amount: 50000, type: 'credit', merchant: 'Salary',      categoryId: 'income' });
  add({ amount: 9000,  type: 'debit',  merchant: 'To my ICICI', categoryId: 'self' });
  add({ amount: 9000,  type: 'credit', merchant: 'From HDFC',   categoryId: 'self' });
  add({ amount: 1500,  type: 'debit',  merchant: 'Rahul',       categoryId: 'lent' });
  add({ amount: 1500,  type: 'credit', merchant: 'Rahul',       categoryId: 'lent_settled' });
  add({ amount: 300,   type: 'credit', merchant: 'Amazon',      categoryId: 'shopping', isRefund: true });

  const G2 = () => useStore.getState();
  const visible = () => G2().transactions.filter((t) => !t.isIgnored);
  const totals  = (list) => computeLedgerTotals(list, G2().groups, spendExcluded);

  const t1 = totals(visible());
  check('footer: "out" equals getMonthlySpend',   t1.debit  === G2().getMonthlySpend(),   `${t1.debit} vs ${G2().getMonthlySpend()}`);
  check('footer: "in" equals getMonthlyIncome',   t1.credit === G2().getMonthlyIncome(),  `${t1.credit} vs ${G2().getMonthlyIncome()}`);
  check('footer: refunds equal getMonthlyRefunds', t1.refund === G2().getMonthlyRefunds(), `${t1.refund} vs ${G2().getMonthlyRefunds()}`);

  // The specific bugs, named so a regression says WHICH one came back.
  check('footer: a self-transfer is not counted as spend', t1.debit === 1700, `${t1.debit}`);
  check('footer: a self-transfer is not counted as income', t1.credit === 50000, `${t1.credit}`);
  check('footer: lending money is not spend',   !(t1.debit  > 1700));
  check('footer: being repaid is not income',   !(t1.credit > 50000));
  check('footer: a refund is not income',       t1.credit === 50000);
  check('footer: a refund nets DOWN spend (2000 - 300)', t1.debit === 1700, `${t1.debit}`);
  check('footer: excluded movement is reported, not dropped silently', t1.excluded === 21000, `${t1.excluded}`);
  check('footer: reasons name the categories', t1.reasons.includes('self-transfers') && t1.reasons.includes('lent'),
    t1.reasons.join(','));

  // The Ignored chip surfaces ignored rows into the list — they must still not count.
  const junk = add({ amount: 777, type: 'debit', merchant: 'Junk', categoryId: 'other' });
  useStore.getState().ignoreTransaction(G2().transactions.find((t) => t.merchant === 'Junk').id);
  const t2 = totals(G2().transactions);   // as if the Ignored chip were selected
  check('footer: an ignored row surfaced by its chip does not change spend', t2.debit === t1.debit, `${t2.debit}`);
  check('footer: but it IS reported as not counted', t2.excluded === t1.excluded + 777, `${t2.excluded}`);
  check('footer: and says so', t2.reasons.includes('ignored'));

  // ── Export: the sheet's card and the PDF use the SAME totals as the footer ──
  // The export path was worse than the footer — it applied NO exclusions at all
  // while the PDF labelled the result "Total Spent" / "Total Income".
  {
    const { buildPDFHTML } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/services/exportService.ts');

    // A split you paid (your share is a fraction of the bill) and a group expense
    // someone ELSE paid (a memo — never your money).
    // Via the real API — hand-setting isSplit/myShareAmount on addTransaction does
    // NOT stick (the store derives the shares), which would have made this test
    // assert against a shape the app never produces.
    add({ amount: 4000, type: 'debit', merchant: 'Dinner', categoryId: 'food' });
    const dinner = G2().transactions.find((t) => t.merchant === 'Dinner');
    G2().setTransactionSplit(dinner.id, [{ name: 'Neha' }, { name: 'Amit' }], { mode: 'equal' });
    const gid = G2().createGroup({ name: 'Goa', type: 'shared', emoji: 'G',
      members: [{ memberId: 'm2', name: 'Neha' }] });
    G2().addGroupExpense(gid, { amount: 6000, merchant: 'Hotel', categoryId: 'travel',
      accountId: acc, paidByMemberId: 'm2',
      shares: [{ memberId: 'me', name: 'You', shareAmount: 3000 },
               { memberId: 'm2', name: 'Neha', shareAmount: 3000 }] });

    const list = visible();
    const t3 = totals(list);
    check('export: totals still equal getMonthlySpend with a split + a memo present',
      t3.debit === G2().getMonthlySpend(), `${t3.debit} vs ${G2().getMonthlySpend()}`);
    // ₹4,000 split three ways → your share ₹1,333.33, not the ₹4,000 the old
    // export summed. Base spend before this block is ₹1,700.
    const myDinnerShare = G2().transactions.find((t) => t.merchant === 'Dinner').myShareAmount;
    check('export: a split counts YOUR share, not the whole bill',
      Math.round(t3.debit) === Math.round(1700 + myDinnerShare) && myDinnerShare < 4000,
      `${t3.debit} (share ${myDinnerShare})`);
    check('export: a memo (someone else paid) is excluded and named as such',
      t3.reasons.includes('paid by someone else'), t3.reasons.join(','));

    const ctx = { timeframe: 'month', catIds: [], acctIds: [], showHidden: false,
      showIgnored: false, showSplit: false,
      advanced: { minAmount: '', maxAmount: '', query: '' }, searchQuery: '' };
    const html = buildPDFHTML(list, ctx, G2().categories, G2().accounts, 'Test', t3);
    const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const shown = new Intl.NumberFormat('en-IN',
      { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(t3.debit);
    check('export: the PDF prints the corrected Total Spent (not the raw sum)',
      flat.includes(`Total Spent ${shown}`) && !flat.includes('Total Spent \u20b921,000'),
      flat.slice(flat.indexOf('Total Spent'), flat.indexOf('Total Spent') + 60));
    check('export: the PDF footnotes what it excluded, rather than dropping it silently',
      /Excludes .*of movement that is neither spending nor income/.test(flat));
    check('export: the footnote names the reasons',
      flat.includes('paid by someone else') && flat.includes('self-transfers'));
    check('export: the footnote declares the netted refund',
      /refunds has been netted off/.test(flat));

    // `totals` is a REQUIRED parameter, so a caller that forgets it is a compile
    // error rather than a statement quietly reporting "Total Spent ₹0". tsc is
    // the guard; this asserts the runtime is loud too, since the .mjs runner
    // strips types and would otherwise sail past a missing argument.
    let threw = false;
    try { buildPDFHTML(list, ctx, G2().categories, G2().accounts, 'Test'); }
    catch { threw = true; }
    check('export: building a PDF without totals throws, never prints a fake ₹0', threw);
  }

  // Filtering to only non-spend rows: 0/0 is correct, and the secondary line is
  // what stops that reading as a bug.
  const selfOnly = totals(visible().filter((t) => t.categoryId === 'self'));
  check('footer: filtering to Self Transfer gives 0/0 with the movement explained',
    selfOnly.debit === 0 && selfOnly.credit === 0 && selfOnly.excluded === 18000,
    `${selfOnly.debit}/${selfOnly.credit}/${selfOnly.excluded}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// Month rollover — the budget snapshot must capture the month's REAL spend
// -----------------------------------------------------------------------------
// `rolloverBudgetIfNeeded` read `monthlyAggregates[prevMonth]`, which compaction
// only writes at RAW_RETENTION_MS (90 days). A month that ended yesterday has no
// aggregate, so every `actual` snapshotted as 0 — the recap/export showed caps
// with no spend, status was always 'under', the streak incremented on a blown
// budget, and the celebration claimed the whole cap was saved.
// ═════════════════════════════════════════════════════════════════════════════
{
  const { selectMonthlyReport } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js');
  const MK = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15, 12, 0, 0);
  const PREV = MK(lastMonth);

  const seed = (perCategory, totalCap, streak) => {
    reset();
    useStore.setState({ budgetStreak: streak, budgetHistory: {}, budget: null });
    useStore.getState().addAccount({ name: 'HDFC', type: 'Bank', mask: '1111', balance: 100000 });
    const a = useStore.getState().accounts[0].id;
    return {
      acc: a,
      spend: (amount, categoryId) => useStore.getState().addTransaction({
        accountId: a, createdAt: lastMonth.toISOString(), amount, type: 'debit',
        merchant: 'X', categoryId,
      }),
      plan: () => useStore.setState({ budget: { monthKey: PREV, totalCap, perCategory } }),
    };
  };

  // ── An OVER month ──
  {
    const h = seed({ food: 10000, travel: 5000 }, 15000, { current: 3, best: 3, lastResetMonth: null });
    h.spend(12000, 'groceries');   // child → rolls up to food
    h.spend(6000, 'travel');
    h.plan();
    check('rollover: no aggregate exists for a month that just ended (the trap)',
      !useStore.getState().monthlyAggregates[PREV]);

    useStore.getState().rolloverBudgetIfNeeded();
    const bh = useStore.getState().budgetHistory[PREV];

    check('rollover: snapshots the REAL total spend, not 0', bh.totalActual === 18000, `${bh.totalActual}`);
    check('rollover: a child category rolls up to its budgeted parent',
      bh.perCategory.food.actual === 12000, JSON.stringify(bh.perCategory));
    check('rollover: an over-budget month is recorded as over', bh.status === 'over', `${bh.status}`);
    check('rollover: overshoot is the real amount', bh.overshoot === 3000, `${bh.overshoot}`);
    check('rollover: an over month RESETS the streak', useStore.getState().budgetStreak.current === 0,
      JSON.stringify(useStore.getState().budgetStreak));
    check('rollover: best streak is preserved', useStore.getState().budgetStreak.best === 3);
    check('rollover: the celebration does not claim a saving that never happened',
      useStore.getState().pendingCelebration.savedAmount === 0);

    // What the user actually exports.
    const rep = selectMonthlyReport(PREV)(useStore.getState());
    check('export: the recap prints the month\'s budget, not an empty block',
      rep.budget && rep.budget.totalActual === 18000 && rep.budget.rows.length === 2,
      JSON.stringify(rep.budget && { a: rep.budget.totalActual, n: rep.budget.rows.length }));
    check('export: the recap streak is the SNAPSHOT (0 after an over month), not today\'s',
      rep.budget.streak === 0);
  }

  // ── An UNDER month: the streak must survive into a later export ──
  {
    const h = seed({ food: 10000 }, 10000, { current: 3, best: 4, lastResetMonth: null });
    h.spend(4000, 'groceries');
    h.plan();
    useStore.getState().rolloverBudgetIfNeeded();

    check('rollover: an under month extends the streak', useStore.getState().budgetStreak.current === 4);
    const bh = useStore.getState().budgetHistory[PREV];
    check('rollover: the snapshot records the streak as it stood that month', bh.streakAfter === 4, `${bh.streakAfter}`);
    check('rollover: under-budget saving is real', bh.totalActual === 4000 && bh.status === 'under');

    // Break the streak later — the older month's export must NOT change.
    useStore.setState({ budgetStreak: { current: 0, best: 4, lastResetMonth: 'later' } });
    const rep = selectMonthlyReport(PREV)(useStore.getState());
    check('export: an old recap keeps its own streak after a later month breaks it',
      rep.budget.streak === 4, `${rep.budget.streak}`);
  }

  // ── Refunds and excluded rows behave as they do on the Budget screen ──
  {
    const h = seed({ food: 10000 }, 10000, { current: 0, best: 0, lastResetMonth: null });
    h.spend(5000, 'groceries');
    useStore.getState().addTransaction({ accountId: h.acc, createdAt: lastMonth.toISOString(),
      amount: 1000, type: 'credit', merchant: 'Refund', categoryId: 'groceries', isRefund: true });
    useStore.getState().addTransaction({ accountId: h.acc, createdAt: lastMonth.toISOString(),
      amount: 7000, type: 'debit', merchant: 'To ICICI', categoryId: 'self' });
    h.plan();
    useStore.getState().rolloverBudgetIfNeeded();
    const bh = useStore.getState().budgetHistory[PREV];
    check('rollover: a refund nets down the snapshotted actual', bh.perCategory.food.actual === 4000, `${bh.perCategory.food.actual}`);
    check('rollover: a self-transfer never lands in the budget snapshot', bh.totalActual === 4000, `${bh.totalActual}`);
  }

  // ── The aggregate fallback still works for a genuinely old month ──
  {
    reset();
    useStore.setState({
      budget: { monthKey: PREV, totalCap: 5000, perCategory: { food: 5000 } },
      budgetHistory: {}, budgetStreak: { current: 0, best: 0, lastResetMonth: null },
      monthlyAggregates: { [PREV]: { totalSpend: 3000, totalIncome: 0, byCategory: { groceries: 3000 }, byAccount: {} } },
    });
    useStore.getState().rolloverBudgetIfNeeded();
    check('rollover: falls back to the aggregate when the raw rows are gone (90+ day gap)',
      useStore.getState().budgetHistory[PREV].totalActual === 3000,
      `${useStore.getState().budgetHistory[PREV].totalActual}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Budget cap suggestions — the same 90-day aggregate trap, three more times
// -----------------------------------------------------------------------------
// getParentCategoryAverage / getCategoryAverage / getTopCategoriesByAverage read
// `monthlyAggregates` directly while only ever asking for months 1–3 back. Those
// months are ALWAYS inside the raw window, so the lookup was always undefined and
// every suggestion was 0 — for every user, permanently, not as an edge case.
// They now go through getCategoryBreakdown (raw first, aggregate as fallback).
// ═════════════════════════════════════════════════════════════════════════════
{
  reset();
  useStore.getState().addAccount({ name: 'HDFC', type: 'Bank', mask: '1111', balance: 200000 });
  const a = useStore.getState().accounts[0].id;
  const now = new Date();
  for (const back of [1, 2, 3]) {
    const d = new Date(now.getFullYear(), now.getMonth() - back, 12, 12, 0, 0);
    useStore.getState().addTransaction({ accountId: a, createdAt: d.toISOString(),
      amount: 9000, type: 'debit', merchant: 'Big Bazaar', categoryId: 'groceries' });
    useStore.getState().addTransaction({ accountId: a, createdAt: d.toISOString(),
      amount: 3000, type: 'debit', merchant: 'Uber', categoryId: 'travel' });
  }
  const S = () => useStore.getState();

  check('suggestions: the recent months genuinely have no aggregates (the trap)',
    Object.keys(S().monthlyAggregates).length === 0);
  check('suggestions: parent average rolls children up (groceries → food)',
    S().getParentCategoryAverage('food', 3) === 9000, `${S().getParentCategoryAverage('food', 3)}`);
  check('suggestions: category average reads raw history',
    S().getCategoryAverage('groceries', 3) === 9000, `${S().getCategoryAverage('groceries', 3)}`);
  const top = S().getTopCategoriesByAverage();
  check('suggestions: top categories are ranked, not empty',
    top.length === 2 && top[0].categoryId === 'groceries' && top[0].average === 9000,
    JSON.stringify(top));

  // A month with no spend must not drag the average down — it isn't a ₹0 month,
  // it's a month with no data.
  reset();
  useStore.getState().addAccount({ name: 'HDFC', type: 'Bank', mask: '1111', balance: 200000 });
  const a2 = useStore.getState().accounts[0].id;
  const d1 = new Date(now.getFullYear(), now.getMonth() - 1, 12, 12, 0, 0);
  useStore.getState().addTransaction({ accountId: a2, createdAt: d1.toISOString(),
    amount: 6000, type: 'debit', merchant: 'Big Bazaar', categoryId: 'groceries' });
  check('suggestions: months with no data are not averaged in as zeros',
    S().getParentCategoryAverage('food', 3) === 6000, `${S().getParentCategoryAverage('food', 3)}`);

  // Spend Rules must win over history.
  S().setExpenseParentCounted('food', false);
  check('suggestions: a parent excluded in Spend Rules averages 0',
    S().getParentCategoryAverage('food', 3) === 0, `${S().getParentCategoryAverage('food', 3)}`);
  S().setExpenseParentCounted('food', true);

  // The aggregate path still works for genuinely old months.
  reset();
  const oldKey = (() => { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  useStore.setState({ monthlyAggregates: { [oldKey]: {
    totalSpend: 5000, totalIncome: 0, byCategory: { groceries: 5000 }, byAccount: {} } } });
  check('suggestions: falls back to aggregates when raw is gone',
    S().getParentCategoryAverage('food', 3) === 5000, `${S().getParentCategoryAverage('food', 3)}`);
}

// ─── CC BILL DUE — the parsed bill is now KEPT, not just notified ─────────────
// Before Aug-26 a cc_bill_reminder SMS fired a notification and the amount/date
// were dropped, so nothing in the app could answer "what do I owe and when".
// These cover the store side; the card's own window logic is in homeCards.test.mjs.
{
  reset();
  const bills = () => useStore.getState().ccBills || {};
  useStore.getState().addAccount({ name: 'SBI Card', type: 'Credit Card', mask: '1234', bankName: 'SBI', balance: -5000 });
  const sbiCard = () => useStore.getState().accounts.find((a) => a.mask === '1234');

  ingest('SBICRD', 'Total Amount Due on your SBI Credit Card ending 1234 for statement dt 20-May-26 is Rs.16,748.65. Min Amount Due: Rs.837.00. Payment due date: 07-Jun-26.',
    { smsId: 'bill-1' });
  const keys = Object.keys(bills());
  check('a CC bill reminder is persisted', keys.length === 1, JSON.stringify(bills()));
  const b = bills()[keys[0]];
  check('the bill keeps its amount', b && b.amount > 0, JSON.stringify(b));
  check('the bill keeps its due date', !!(b && b.dueDate), JSON.stringify(b));
  check('the bill keeps its statement date', b && b.statementDate === '20-May-26', JSON.stringify(b));
  check('a bill reminder does NOT become a transaction',
    txns().length === 0, `${txns().length}`);

  // The recurring cycle-day info lands on the CARD ACCOUNT too (Sep-6-26) — not just
  // the one-off bill — so the app "remembers" the cycle across months.
  check('due-day is distilled onto the matching card account',
    sbiCard()?.dueDay === 7, JSON.stringify(sbiCard()));
  check('statement-day is distilled onto the matching card account',
    sbiCard()?.statementDay === 20, JSON.stringify(sbiCard()));

  // A later statement for the SAME card is a new CYCLE — it must replace, not add.
  ingest('SBICRD', 'Total Amount Due on your SBI Credit Card ending 1234 for statement dt 20-Jun-26 is Rs.9,100.00. Min Amount Due: Rs.455.00. Payment due date: 07-Jul-26.',
    { smsId: 'bill-2' });
  check('a new statement for the same card REPLACES the old bill',
    Object.keys(bills()).length === 1, JSON.stringify(bills()));
  check('and it holds the newer amount',
    Math.round(Object.values(bills())[0].amount) === 9100,
    `${Object.values(bills())[0].amount}`);

  // A different card gets its own entry.
  ingest('HDFCBK', 'Total Amount Due on your HDFC Credit Card ending 9876 for statement dt 20-Jun-26 is Rs.4,000.00. Payment due date: 09-Jul-26.',
    { smsId: 'bill-3' });
  check('a different card gets its own bill', Object.keys(bills()).length === 2,
    JSON.stringify(Object.keys(bills())));

  // Paying a card clears THAT card's bill and leaves the other alone. The payment
  // must be recent — applyCCPayment drops anything older than CC_PROMPT_MAX_AGE_MS.
  ingest('SBICRD', 'Payment of Rs.9,100.00 received towards your SBI Credit Card ending 1234. Thank you.',
    { smsId: 'pay-1', receivedAt: Date.now() });
  const after = Object.keys(bills());
  check('paying a card clears that card\'s bill', !after.includes('1234'), JSON.stringify(after));
  check('and leaves the OTHER card\'s bill alone', after.includes('9876'), JSON.stringify(after));
}

// ─── CC CYCLE HEADS-UP — soft nudge from a SAVED statementDay alone (Sep-6-26) ─
// Distinct from the bill-due tests above: this fires with NO fresh SMS that
// cycle, purely from `account.statementDay` learned earlier. `statementDay: 1`
// is used throughout so "today >= statementDay" is trivially true on whatever
// real date this suite happens to run — no date-mocking needed.
{
  const { monthKey } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/format.js');
  const thisMonth = monthKey(new Date());
  // `reset()` doesn't touch ccBills/ccCycleHeadsUpNotified (by design — see the CC
  // BILL DUE block above, which relies on them surviving a reset within ITS own
  // flow), so this block clears them itself between cases.
  const resetCcCycle = () => { reset(); useStore.setState({ ccBills: {}, ccCycleHeadsUpNotified: {} }); };

  resetCcCycle();
  useStore.getState().addAccount({
    name: 'Test Card', type: 'Credit Card', mask: '4321', bankName: 'TestBank',
    balance: -1000, statementDay: 1,
  });
  const cardId = useStore.getState().accounts.find((a) => a.mask === '4321').id;

  useStore.getState().maybeFireCcCycleHeadsUp();
  check('fires once the (learned) statement day has passed this month',
    useStore.getState().ccCycleHeadsUpNotified[cardId] === thisMonth,
    JSON.stringify(useStore.getState().ccCycleHeadsUpNotified));

  const afterFirst = JSON.stringify(useStore.getState().ccCycleHeadsUpNotified);
  useStore.getState().maybeFireCcCycleHeadsUp();
  check('calling it again the same month is a no-op (deduped)',
    JSON.stringify(useStore.getState().ccCycleHeadsUpNotified) === afterFirst, afterFirst);

  // A real bill for this card THIS month must suppress the synthetic nudge —
  // the real cc_bill_reminder already told the user their cycle closed.
  resetCcCycle();
  useStore.getState().addAccount({
    name: 'Test Card 2', type: 'Credit Card', mask: '5555', bankName: 'TestBank',
    balance: -1000, statementDay: 1,
  });
  useStore.setState({
    ccBills: { '5555': { amount: 500, cardLast4: '5555', bankName: 'TestBank', seenAt: new Date().toISOString() } },
  });
  useStore.getState().maybeFireCcCycleHeadsUp();
  check('a REAL bill this cycle suppresses the synthetic heads-up',
    Object.keys(useStore.getState().ccCycleHeadsUpNotified).length === 0,
    JSON.stringify(useStore.getState().ccCycleHeadsUpNotified));

  // A card with no statementDay yet (never seen a parseable statement SMS) never fires.
  resetCcCycle();
  useStore.getState().addAccount({ name: 'Test Card 3', type: 'Credit Card', mask: '6666', bankName: 'TestBank', balance: -1000 });
  useStore.getState().maybeFireCcCycleHeadsUp();
  check('a card with no learned statementDay never fires',
    Object.keys(useStore.getState().ccCycleHeadsUpNotified).length === 0,
    JSON.stringify(useStore.getState().ccCycleHeadsUpNotified));
}

// ── Account bucketing: the two surfaces MUST agree ───────────────────────────
// Reported bug: a card showed ~14k of spend in the analytics "Spend by account"
// bar and ~11k in the account section. Cause: three hand-rolled rules for "which
// account is this transaction on" — the ingest matcher, an exact-mask Map in
// AnalyticsScreen, and an accountId-with-no-fallback + accountType-equality test
// in AccountDetailsScreen. Rows the parser typed differently, or whose account id
// had gone stale, showed in one and not the other.
//
// This asserts the INVARIANT rather than either number: every spend-counting
// transaction lands on exactly the same account in both surfaces, and none is
// stranded in "Unknown" while a real account claims it.
{
  const { resolveTxnAccount, txnBelongsToAccount } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/accountMatch.js');
  const { countsForSpend, spendContribution } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/split.js');
  const { NON_SPEND_CATEGORY_IDS } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/categories.js');
  const { spendExcluded } = mod;

  reset();
  // A normal month on one bank, reported the way real banks actually vary it:
  // last-4 in some messages, last-6 in others, sometimes card-flavoured wording.
  ingest('HDFCBK', 'Rs.4,000 debited from A/c XX4021 at BIGBAZAAR on 02-08-26.', { receivedAt: T0, smsId: 'x1' });
  ingest('HDFCBK', 'Rs.3,000 debited from A/c XX114021 at SWIGGY on 03-08-26.',  { receivedAt: T0, smsId: 'x2' });
  ingest('HDFCBK', 'Rs.2,500 spent on your HDFC Card xx4021 at AMAZON on 04-08-26.', { receivedAt: T0, smsId: 'x3' });
  ingest('ICICIB', 'Rs.1,200 debited from A/c XX7788 at UBER on 05-08-26.', { receivedAt: T0, smsId: 'x4' });

  const state = () => useStore.getState();
  const spendRows = () => state().transactions.filter(
    (t) => countsForSpend(t)
      && !NON_SPEND_CATEGORY_IDS.has(t.categoryId)
      && !spendExcluded(t, state().groups),
  );

  // What "Spend by account" bars, keyed the way AnalyticsScreen keys them.
  const analyticsTotals = () => {
    const out = {};
    spendRows().forEach((t) => {
      const acct = resolveTxnAccount(t, state().accounts);
      const key = acct ? acct.id : (t.accountType || 'Unknown');
      out[key] = (out[key] || 0) + spendContribution(t);
    });
    return out;
  };
  // What each account's own ledger would total, over the same rows.
  const ledgerTotals = () => {
    const out = {};
    state().accounts.forEach((a) => {
      const sum = spendRows()
        .filter((t) => txnBelongsToAccount(t, a, state().accounts))
        .reduce((n, t) => n + spendContribution(t), 0);
      if (sum) out[a.id] = sum;
    });
    return out;
  };

  // Compare as SORTED (key, rounded amount) pairs: bucket insertion order differs
  // between the two surfaces by construction (one walks transactions, the other
  // walks accounts), and a JSON compare would fail on that alone.
  const norm = (o) => Object.entries(o)
    .map(([k, v]) => `${k}=${Math.round(v)}`).sort().join(',');

  const A = analyticsTotals(), L = ledgerTotals();
  check('every account totals the SAME in analytics and in its own ledger',
    norm(A) === norm(L), `analytics ${norm(A)} vs ledger ${norm(L)}`);
  check('no spend is stranded in an "Unknown" bucket',
    !Object.keys(A).some((k) => !state().accounts.some((a) => a.id === k)),
    JSON.stringify(Object.keys(A)));
  check('and the money is all still there',
    Math.round(Object.values(A).reduce((a, b) => a + b, 0)) === 10700,
    `${Object.values(A).reduce((a, b) => a + b, 0)}`);

  // A DANGLING account id — the account was deleted or merged away, but the mask
  // still says where the money moved. The old ledger rule hard-stopped on the id
  // and dropped the row; analytics fell back to the mask and kept it. That single
  // asymmetry is enough to explain a multi-thousand-rupee gap.
  const bank = state().accounts.find((a) => a.mask && a.mask.endsWith('4021'));
  useStore.setState({
    transactions: state().transactions.map((t) =>
      t.smsId === 'x1' ? { ...t, accountId: 'acc_deleted_ages_ago' } : t),
  });
  const A2 = analyticsTotals(), L2 = ledgerTotals();
  check('a dangling accountId still resolves by mask — in BOTH surfaces',
    norm(A2) === norm(L2), `analytics ${norm(A2)} vs ledger ${norm(L2)}`);
  check('…and it lands back on the right account, not in "Unknown"',
    Math.round(A2[bank.id]) === 9500, `${A2[bank.id]}`);
}

// ── The anchor is ground truth in BOTH directions ────────────────────────────
// `ingestMessage` skipped the balance delta for a transaction dated before a
// manual anchor, but delete/ignore/unignore/edit reversed deltas unconditionally
// — backing out money that was never applied. The anchor is stamped Date.now(),
// so every existing transaction is pre-anchor the moment one is set.
{
  const DAY = 86400000;
  for (const [label, act] of [
    ['ignore', (id) => useStore.getState().ignoreTransaction(id)],
    ['delete', (id) => useStore.getState().deleteTransaction(id)],
  ]) {
    reset();
    ingest('HDFCBK', 'Rs.500 debited from A/c XX4021 at STORE on 01-08-26.',
      { receivedAt: T0 - 3 * DAY, smsId: `an-${label}-1` });
    const acct = useStore.getState().accounts[0];
    useStore.setState({
      accounts: useStore.getState().accounts.map((a) =>
        a.id === acct.id ? { ...a, balance: 10000, anchoredAt: Date.now() } : a),
    });
    ingest('HDFCBK', 'Rs.700 debited from A/c XX4021 at CAFE on 02-08-26.',
      { receivedAt: T0 - 2 * DAY, smsId: `an-${label}-2` });
    check(`${label}: a pre-anchor txn does not move the balance on the way IN`,
      useStore.getState().accounts[0].balance === 10000,
      `${useStore.getState().accounts[0].balance}`);
    const t = useStore.getState().transactions.find((x) => x.amount === 700);
    act(t.id);
    check(`${label}: …and does not move it on the way OUT either`,
      useStore.getState().accounts[0].balance === 10000,
      `got ${useStore.getState().accounts[0].balance}, expected 10000 — a delta that was never applied must never be reversed`);
  }

  // The guard must not swallow ordinary post-anchor activity.
  reset();
  ingest('HDFCBK', 'Rs.900 debited from A/c XX4021 at STORE on 01-08-26.', { receivedAt: T0, smsId: 'post-1' });
  const a0 = useStore.getState().accounts[0];
  useStore.setState({
    accounts: useStore.getState().accounts.map((a) =>
      a.id === a0.id ? { ...a, balance: 5000, anchoredAt: Date.now() - 60_000 } : a),
  });
  ingest('HDFCBK', 'Rs.200 debited from A/c XX4021 at CAFE on 09-08-26.',
    { receivedAt: Date.now(), smsId: 'post-2' });
  check('a POST-anchor txn still moves the balance',
    useStore.getState().accounts[0].balance === 4800, `${useStore.getState().accounts[0].balance}`);
  const t2 = useStore.getState().transactions.find((x) => x.amount === 200);
  useStore.getState().ignoreTransaction(t2.id);
  check('…and ignoring it correctly gives the money back',
    useStore.getState().accounts[0].balance === 5000, `${useStore.getState().accounts[0].balance}`);
}

// ── A credit card's OUTSTANDING vs its month spend ───────────────────────────
// Asked directly: "for cc balances they should be same for month I guess". They
// are — but only while the card starts the month at zero and nothing is paid off
// during it. Outstanding answers "what do I still owe", month spend answers "what
// did I spend in this month"; a payment moves the first and not the second, and a
// carried balance moves the first and not the second either.
//
// The identity that DOES always hold is pinned here, because it's the one a
// future change could break silently:
//     outstanding  ==  Σ spend on the card (all months)  −  Σ payments applied
{
  const { resolveTxnAccount } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/accountMatch.js');
  const { countsForSpend, spendContribution } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/split.js');
  const { NON_SPEND_CATEGORY_IDS, ACCOUNT_TYPES } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/categories.js');
  const { isSameMonth } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/format.js');
  const { spendExcluded } = mod;

  const st = () => useStore.getState();
  const card = () => st().accounts.find((a) => a.type === ACCOUNT_TYPES.CREDIT_CARD);
  const outstanding = () => Math.abs(card().balance);
  const spendIn = (when) => st().transactions
    .filter((t) => countsForSpend(t) && isSameMonth(t.createdAt, when)
      && !NON_SPEND_CATEGORY_IDS.has(t.categoryId) && !spendExcluded(t, st().groups)
      && resolveTxnAccount(t, st().accounts)?.id === card().id)
    .reduce((n, t) => n + spendContribution(t), 0);

  // 1. Nothing paid → they match exactly.
  reset();
  ingest('HDFCBK', 'Rs.2,000 spent on your HDFC Credit Card XX1234 at AMAZON on 01-08-26.',
    { smsId: 'cc-a1', receivedAt: Date.now() });
  ingest('HDFCBK', 'Rs.3,000 spent on your HDFC Credit Card XX1234 at SWIGGY on 05-08-26.',
    { smsId: 'cc-a2', receivedAt: Date.now() });
  check('CC: unpaid card — outstanding EQUALS this month\'s spend',
    outstanding() === Math.round(spendIn(new Date())) && outstanding() === 5000,
    `${outstanding()} vs ${Math.round(spendIn(new Date()))}`);

  // 2. A refund nets BOTH sides down — it must not drift them apart.
  ingest('HDFCBK', 'Rs.1,000 credited to your HDFC Credit Card XX1234 as refund from AMAZON on 06-08-26.',
    { smsId: 'cc-a3', receivedAt: Date.now() });
  check('CC: a refund reduces outstanding and spend by the SAME amount',
    outstanding() === Math.round(spendIn(new Date())) && outstanding() === 4000,
    `${outstanding()} vs ${Math.round(spendIn(new Date()))}`);

  // 3. Carry-over: last month unpaid. Outstanding is all-time, spend is per-month,
  //    so they MUST differ — and must reconcile exactly.
  reset();
  const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1);
  ingest('HDFCBK', 'Rs.8,000 spent on your HDFC Credit Card XX1234 at AMAZON on 05-07-26.',
    { smsId: 'cc-b1', receivedAt: lastMonth.getTime() });
  ingest('HDFCBK', 'Rs.2,500 spent on your HDFC Credit Card XX1234 at SWIGGY on 03-08-26.',
    { smsId: 'cc-b2', receivedAt: Date.now() });
  check('CC: a carried balance reconciles as last month + this month',
    outstanding() === Math.round(spendIn(lastMonth)) + Math.round(spendIn(new Date()))
    && outstanding() === 10500,
    `${outstanding()} vs ${Math.round(spendIn(lastMonth))}+${Math.round(spendIn(new Date()))}`);
  check('CC: …and this month alone is only the newer spend',
    Math.round(spendIn(new Date())) === 2500, `${Math.round(spendIn(new Date()))}`);

  // 4. True-up to Zero, then fresh spend. The card is declared paid off, so
  //    outstanding restarts from 0 while the month's spend keeps its history —
  //    they differ by exactly what was paid off, which is correct, not a drift.
  reset();
  ingest('HDFCBK', 'Rs.5,000 spent on your HDFC Credit Card XX1234 at AMAZON on 01-08-26.',
    { smsId: 'cc-c1', receivedAt: Date.now() });
  ingest('HDFCBK', 'Payment of Rs.5,000.00 received towards your HDFC Credit Card ending 1234. Thank you.',
    { smsId: 'cc-c2', receivedAt: Date.now() });
  check('CC: a recent payment queues a prompt', st().pendingCCPaymentQueue.length === 1,
    `${st().pendingCCPaymentQueue.length}`);
  useStore.getState().confirmCCTrueUp(null);
  check('CC: True-up zeroes the outstanding', outstanding() === 0, `${outstanding()}`);
  ingest('HDFCBK', 'Rs.1,500 spent on your HDFC Credit Card XX1234 at UBER on 09-08-26.',
    { smsId: 'cc-c3', receivedAt: Date.now() });
  check('CC: spend AFTER a true-up still moves the outstanding',
    outstanding() === 1500, `${outstanding()} — the true-up anchor must not swallow later spend`);
  check('CC: …and the month still remembers the paid-off spend',
    Math.round(spendIn(new Date())) === 6500, `${Math.round(spendIn(new Date()))}`);
}

// ── Two cards, different banks, SAME last-4 ──────────────────────────────────
// Real and common: an HDFC ··1234 and an ICICI ··1234. The bank name plus the
// ending digits together are the card's identity, and that has to hold at ingest,
// in the ledger, in analytics AND in every filter — a filter that leaks the other
// card's spend is just as wrong as a balance that does.
{
  const { resolveTxnAccount, accountCandidates, isAmbiguousMatch, matchAccount } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/accountMatch.js');

  reset();
  ingest('HDFCBK', 'Rs.1,000 spent on your HDFC Credit Card XX1234 at AMAZON on 01-08-26.', { smsId: 'dup-h1' });
  ingest('ICICIB', 'Rs.2,000 spent on your ICICI Credit Card XX1234 at SWIGGY on 02-08-26.', { smsId: 'dup-i1' });
  ingest('HDFCBK', 'Rs.500 spent on your HDFC Credit Card XX1234 at UBER on 03-08-26.', { smsId: 'dup-h2' });

  const st = () => useStore.getState();
  const hdfc  = st().accounts.find((a) => (a.bankName || '').includes('HDFC'));
  const icici = st().accounts.find((a) => (a.bankName || '').includes('ICICI'));

  check('two same-last-4 cards from different banks stay SEPARATE accounts',
    !!hdfc && !!icici && hdfc.id !== icici.id, JSON.stringify(st().accounts.map((a) => a.name)));
  check('each card carries its own balance',
    Math.abs(hdfc.balance) === 1500 && Math.abs(icici.balance) === 2000,
    `hdfc ${hdfc.balance}, icici ${icici.balance}`);
  check('the account NAME distinguishes them for the user',
    hdfc.name !== icici.name && hdfc.name.includes('1234') && icici.name.includes('1234'),
    `${hdfc.name} / ${icici.name}`);

  // Resolution — the one rule every surface now shares.
  const onHdfc  = st().transactions.filter((t) => resolveTxnAccount(t, st().accounts)?.id === hdfc.id);
  const onIcici = st().transactions.filter((t) => resolveTxnAccount(t, st().accounts)?.id === icici.id);
  check('transactions resolve to the RIGHT card, not the first one listed',
    onHdfc.length === 2 && onIcici.length === 1,
    `hdfc ${onHdfc.map((t) => t.amount)}, icici ${onIcici.map((t) => t.amount)}`);
  check('…and no transaction resolves to both',
    onHdfc.every((t) => !onIcici.includes(t)));

  // The Activity filter (TransactionsScreen) uses exactly this predicate. It used
  // to test a bare Set of masks, so selecting one card returned both cards' rows.
  const activityFilter = (selectedIds) => st().transactions.filter((t) => {
    const acct = resolveTxnAccount(t, st().accounts);
    return !!acct && selectedIds.has(acct.id);
  });
  const justHdfc = activityFilter(new Set([hdfc.id]));
  check('filtering to ONE card does not leak the other bank\'s spend',
    justHdfc.length === 2 && justHdfc.every((t) => t.bankName.includes('HDFC')),
    justHdfc.map((t) => `${t.amount}/${t.bankName}`).join(', '));
  check('filtering to the other card returns only its own',
    activityFilter(new Set([icici.id])).map((t) => t.amount).join() === '2000',
    activityFilter(new Set([icici.id])).map((t) => t.amount).join());
  check('selecting BOTH returns everything exactly once',
    activityFilter(new Set([hdfc.id, icici.id])).length === 3);

  // Ranking, not array order. A bank-confirmed match must beat an unconfirmed one,
  // and an unknown-bank transaction must resolve the SAME way whichever order the
  // accounts happen to sit in — it used to flip with the array.
  const twoCards = [
    { id: 'A_hdfc',  bankName: 'HDFC Bank',  mask: '1234', type: 'Credit Card', aliasMasks: [] },
    { id: 'B_icici', bankName: 'ICICI Bank', mask: '1234', type: 'Credit Card', aliasMasks: [] },
  ];
  const probe = (bank) => ({ accountMask: '1234', accountType: 'Credit Card', bankName: bank });
  check('a named bank picks its OWN card even when listed second',
    matchAccount(twoCards, probe('ICICI Bank')).id === 'B_icici');
  check('…and the reverse', matchAccount(twoCards, probe('HDFC Bank')).id === 'A_hdfc');
  check('an unknown-bank txn resolves identically whichever order the accounts are in',
    matchAccount(twoCards, probe(null))?.id === matchAccount([...twoCards].reverse(), probe(null))?.id,
    `${matchAccount(twoCards, probe(null))?.id} vs ${matchAccount([...twoCards].reverse(), probe(null))?.id}`);
  // The ids are chosen so the ALPHABETICAL tie-break would pick the WRONG one:
  // without the bank-confirmed bonus this silently passes on id order alone, which
  // is exactly how a mutation removing that bonus survived the first version.
  check('a bank-CONFIRMED candidate outranks an unconfirmed one',
    accountCandidates(
      [{ id: 'a_unconfirmed', bankName: null, mask: '1234', type: 'Credit Card', aliasMasks: [] },
       { id: 'z_hdfc',        bankName: 'HDFC Bank', mask: '1234', type: 'Credit Card', aliasMasks: [] }],
      probe('HDFC Bank'),
    )[0].account.id === 'z_hdfc');
  check('…and that holds for a SUFFIX match too',
    accountCandidates(
      [{ id: 'a_unconfirmed', bankName: null, mask: '001234', type: 'Credit Card', aliasMasks: [] },
       { id: 'z_hdfc',        bankName: 'HDFC Bank', mask: '001234', type: 'Credit Card', aliasMasks: [] }],
      probe('HDFC Bank'),
    )[0].account.id === 'z_hdfc');

  // An EXACT mask must beat a suffix one. The suffix candidate is deliberately
  // LONGER here, because the "prefer the most specific mask" tie-break would
  // otherwise hand it the win — which is what let a mutation flattening the two
  // scores survive.
  const exactVsSuffix = [
    { id: 'a_suffix', bankName: 'HDFC Bank', mask: '001234', type: 'Bank', aliasMasks: [] },
    { id: 'z_exact',  bankName: 'HDFC Bank', mask: '1234',   type: 'Bank', aliasMasks: [] },
  ];
  check('an EXACT mask beats a longer suffix match',
    matchAccount(exactVsSuffix, { accountMask: '1234', accountType: 'Bank', bankName: 'HDFC Bank' })?.id === 'z_exact',
    matchAccount(exactVsSuffix, { accountMask: '1234', accountType: 'Bank', bankName: 'HDFC Bank' })?.id);

  // A suffix match must stay TYPE-guarded: a credit card and a bank account that
  // happen to share trailing digits are different money, and merging them would
  // move one's spend onto the other's balance.
  const cardAndBank = [
    { id: 'a_bank', bankName: 'HDFC Bank', mask: '001234', type: 'Bank', aliasMasks: [] },
  ];
  check('a suffix match never crosses account TYPE',
    matchAccount(cardAndBank, { accountMask: '1234', accountType: 'Credit Card', bankName: 'HDFC Bank' }) === null,
    'a Credit Card ··1234 must not land on a Bank ··001234');
  check('…but the same TYPE with a shared suffix still merges',
    matchAccount(cardAndBank, { accountMask: '1234', accountType: 'Bank', bankName: 'HDFC Bank' })?.id === 'a_bank');
  check('an unknown-bank collision is reported as AMBIGUOUS',
    isAmbiguousMatch(twoCards, probe(null)) === true);
  check('…and a named one is not',
    isAmbiguousMatch(twoCards, probe('HDFC Bank')) === false);
  check('one card alone is never ambiguous',
    isAmbiguousMatch([twoCards[0]], probe(null)) === false);

  // The guard must not break the ordinary case it was always meant to allow: the
  // SAME account reported with different mask lengths still merges.
  reset();
  ingest('HDFCBK', 'Rs.4,000 debited from A/c XX4021 at BIGBAZAAR on 02-08-26.', { smsId: 'len-1' });
  ingest('HDFCBK', 'Rs.3,000 debited from A/c XX114021 at SWIGGY on 03-08-26.', { smsId: 'len-2' });
  check('last-4 ↔ last-6 of one account still merges (bank agrees)',
    useStore.getState().accounts.length === 1,
    JSON.stringify(useStore.getState().accounts.map((a) => a.mask)));
}

// ── Repairing budget history that was snapshotted with ZERO spend ────────────
// Until Aug-9-26 the rollover read `monthlyAggregates[prevMonth]`, which does not
// exist for a month that ended yesterday, so every `actual` snapshotted as 0. The
// rollover was fixed — but the entries already written were not, and the snapshot
// is what every later render reads. So last month's summary kept reporting ₹0
// spent, "under", the entire cap saved, and a streak the user had actually broken.
// Migration v25 recomputes them. This drives the REAL migrate function.
{
  const { monthKey } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/format.js');
  const migrate = useStore.persist.getOptions().migrate;
  const version = useStore.persist.getOptions().version;
  // `>=`, not `===`. Pinning the exact number means every future migration has
  // to edit an assertion that isn't about it — and the one thing this block
  // actually needs is that the v25 repair is IN the chain, which later versions
  // don't undo. (It was `=== 25` and failed the moment v26 landed.)
  check(`store version is at least 25 — the repair migration is in the chain (${version})`,
    version >= 25, `${version}`);

  // Build real transactions for last month: 18,000 of Food spend.
  reset();
  const prevDate = new Date();
  prevDate.setMonth(prevDate.getMonth() - 1);
  prevDate.setDate(15);
  const PK = monthKey(prevDate);
  // SWIGGY, not an unrecognised merchant: the enricher has to resolve it to the
  // Food parent or the migration correctly ignores it as unbudgetable, and the
  // test would be asserting nothing. (It caught exactly that on the first run.)
  ingest('HDFCBK', 'Rs.18,000 debited from A/c XX4021 at SWIGGY on 15-07-26.',
    { smsId: 'bh-1', receivedAt: prevDate.getTime() });
  const realTxns = useStore.getState().transactions;
  check('the fixture transaction landed in a BUDGETABLE parent',
    realTxns.length === 1 && realTxns[0].amount === 18000
    && (realTxns[0].parentCategory === 'Food & Dining' || realTxns[0].categoryId === 'food'),
    JSON.stringify(realTxns.map((t) => `${t.amount}/${t.categoryId}/${t.parentCategory}`)));

  // Exactly what the OLD rollover wrote: caps preserved, every actual zeroed,
  // status 'under' because 0 <= cap, and a streak incremented on a blown month.
  const corrupted = {
    transactions: realTxns,
    groups: [],
    monthlyAggregates: {},
    budgetHistory: {
      [PK]: {
        totalCap: 15000,
        perCategory: { food: { cap: 10000, actual: 0 }, shopping: { cap: 5000, actual: 0 } },
        totalActual: 0, status: 'under', overshoot: 0, streakAfter: 4,
      },
    },
    budgetStreak: { current: 4, best: 4, lastResetMonth: null },
  };

  const fixed = migrate(corrupted, 24);
  const e = fixed.budgetHistory[PK];
  check('repair: the month\'s real spend is restored', e.totalActual === 18000, `${e.totalActual}`);
  check('repair: the per-category row carries it', e.perCategory.food.actual === 18000,
    JSON.stringify(e.perCategory));
  check('repair: a category with no spend stays at 0', e.perCategory.shopping.actual === 0);
  check('repair: caps are preserved untouched',
    e.perCategory.food.cap === 10000 && e.totalCap === 15000);
  check('repair: status flips to OVER', e.status === 'over', e.status);
  check('repair: overshoot is the real 3000', e.overshoot === 3000, `${e.overshoot}`);
  check('repair: the streak RESETS — it was incremented on a blown month',
    fixed.budgetStreak.current === 0, `${fixed.budgetStreak.current}`);
  check('repair: streakAfter on the entry matches', e.streakAfter === 0, `${e.streakAfter}`);
  check('repair: a legitimately earned BEST is never demoted',
    fixed.budgetStreak.best === 4, `${fixed.budgetStreak.best}`);
  check('repair: lastResetMonth records the month that broke it',
    fixed.budgetStreak.lastResetMonth === PK, fixed.budgetStreak.lastResetMonth);

  // And the summary the user actually looks at now reads correctly.
  useStore.setState({ ...corrupted, ...fixed });
  const rep = mod.selectMonthlyReport(PK)(useStore.getState());
  check('the monthly summary now shows the real spend, not 0',
    rep.budget.totalActual === 18000 && rep.budget.status === 'over', JSON.stringify(rep.budget?.totalActual));
  check('…and no longer claims the whole cap was saved',
    rep.budget.saved === 0, `${rep.budget.saved}`);
  check('…and reports the broken streak', rep.budget.streak === 0, `${rep.budget.streak}`);

  // Idempotent: running it over ALREADY-correct data must not change anything.
  const twice = migrate({ ...corrupted, ...fixed }, 24);
  check('repair is idempotent', JSON.stringify(twice.budgetHistory) === JSON.stringify(fixed.budgetHistory),
    'a second run must be a no-op');

  // A month with NO evidence left (raw pruned, no aggregate) must be left ALONE,
  // not zeroed — "no evidence" is not "no spend", and overwriting would destroy a
  // correct snapshot the fixed rollover had written.
  const ancient = {
    transactions: [], groups: [], monthlyAggregates: {},
    budgetHistory: { '2024-01': { totalCap: 9000, perCategory: { food: { cap: 9000, actual: 7000 } },
      totalActual: 7000, status: 'under', overshoot: 0, streakAfter: 2 } },
    budgetStreak: { current: 2, best: 5, lastResetMonth: null },
  };
  const kept = migrate(ancient, 24);
  check('a month with no raw rows AND no aggregate is left untouched',
    kept.budgetHistory['2024-01'].totalActual === 7000,
    `${kept.budgetHistory['2024-01'].totalActual}`);

  // The aggregate fallback still works for a genuinely old month.
  const viaAgg = migrate({
    transactions: [], groups: [],
    monthlyAggregates: { '2024-02': { totalSpend: 4000, totalIncome: 0, byCategory: { food: 4000 }, byAccount: {} } },
    budgetHistory: { '2024-02': { totalCap: 3000, perCategory: { food: { cap: 3000, actual: 0 } },
      totalActual: 0, status: 'under', overshoot: 0, streakAfter: 1 } },
    budgetStreak: { current: 1, best: 1, lastResetMonth: null },
  }, 24);
  check('an old month falls back to the aggregate and is repaired too',
    viaAgg.budgetHistory['2024-02'].totalActual === 4000
    && viaAgg.budgetHistory['2024-02'].status === 'over',
    `${viaAgg.budgetHistory['2024-02'].totalActual}`);

  // Multi-month streak replay: under, under, over, under -> current 1, best 2.
  const chain = migrate({
    transactions: [], groups: [],
    monthlyAggregates: {
      '2025-01': { byCategory: { food: 500 } }, '2025-02': { byCategory: { food: 500 } },
      '2025-03': { byCategory: { food: 5000 } }, '2025-04': { byCategory: { food: 500 } },
    },
    budgetHistory: {
      '2025-01': { totalCap: 1000, perCategory: { food: { cap: 1000, actual: 0 } }, totalActual: 0, status: 'under', streakAfter: 1 },
      '2025-02': { totalCap: 1000, perCategory: { food: { cap: 1000, actual: 0 } }, totalActual: 0, status: 'under', streakAfter: 2 },
      '2025-03': { totalCap: 1000, perCategory: { food: { cap: 1000, actual: 0 } }, totalActual: 0, status: 'under', streakAfter: 3 },
      '2025-04': { totalCap: 1000, perCategory: { food: { cap: 1000, actual: 0 } }, totalActual: 0, status: 'under', streakAfter: 4 },
    },
    budgetStreak: { current: 4, best: 4, lastResetMonth: null },
  }, 24);
  check('the streak is REPLAYED month by month, not just reset',
    chain.budgetStreak.current === 1
    && chain.budgetHistory['2025-02'].streakAfter === 2
    && chain.budgetHistory['2025-03'].streakAfter === 0
    && chain.budgetHistory['2025-04'].streakAfter === 1,
    JSON.stringify(Object.entries(chain.budgetHistory).map(([k, v]) => `${k}:${v.status}/${v.streakAfter}`)));
  check('…and lastResetMonth is the month that actually broke it',
    chain.budgetStreak.lastResetMonth === '2025-03', chain.budgetStreak.lastResetMonth);
}

// ── v26: the Gold accent was replaced, not just deleted ─────────────────────
// 'amber' ("Gold", #FFD600) became 'carbon' (deep slate + carbon mint). The
// colours would have fallen back on their own — `buildPalette` handles an
// unknown id — so nothing would have LOOKED broken. What breaks is the picker:
// SettingsScreen renders `Object.values(THEMES)` and compares each against the
// stored id, so a Gold user would open Appearance and find a themed app with no
// swatch selected and no way to tell why. Exactly the 'sky' bug v24 fixed, which
// is why v24's generic line doesn't help here: it only runs below version 24.
{
  const migrate = useStore.persist.getOptions().migrate;
  const { THEMES, DEFAULT_THEME_ID } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/themes.js');

  check('the Gold accent is really gone', !THEMES.amber);
  check('…and Carbon took its slot', !!THEMES.carbon && THEMES.carbon.label === 'Carbon');

  const gold = migrate({ themeId: 'amber' }, 25);
  check('a Gold user is moved onto Carbon, not reset to the default',
    gold.themeId === 'carbon', `${gold.themeId}`);
  check('…which is a real theme the picker can select',
    !!THEMES[gold.themeId], `${gold.themeId}`);

  // Everyone else is untouched — a migration that rewrites a valid choice is a
  // worse bug than the one it fixes.
  for (const id of Object.keys(THEMES)) {
    const kept = migrate({ themeId: id }, 25);
    check(`'${id}' is left alone`, kept.themeId === id, `${kept.themeId}`);
  }
  const fresh = migrate({ themeId: DEFAULT_THEME_ID }, 25);
  check('the default survives the migration', fresh.themeId === DEFAULT_THEME_ID);

  // Idempotent: a store already at 26 must not be touched again.
  const twice = migrate(migrate({ themeId: 'amber' }, 25), 26);
  check('running it twice is a no-op', twice.themeId === 'carbon', `${twice.themeId}`);
}

// ── The Zero-Transaction bonus must not fire on a day you SPENT ──────────────
// Reported: "I made some transactions the previous day, didn't review them, and
// today saw 'no expense yesterday' and the bonus was given."
//
// The selector was never the problem — it counts SMS transactions dated
// yesterday and does not look at `isReviewed` at all. The bug was WHEN it was
// asked. `checkIn` is idempotent per calendar day (gap === 0 → SAME_DAY), so the
// first answer of the day is the final one, and at mount the app can be in two
// states where the honest answer is "I don't know yet" but the code answers "no".
{
  const { selectYesterdayTransactionCount, selectGapTransactionCount } = mod;
  const rw = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/useRewardStore.ts');
  const useReward = rw.useRewardStore || rw.default;
  const { readFileSync } = await import('node:fs');
  const SRC = '/Users/praveenverma/Desktop/pvn/ePurse/src';

  const DAY = 86_400_000;
  const cal = (ms) => {
    const x = new Date(ms);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  };
  const yNoon = new Date(); yNoon.setDate(yNoon.getDate() - 1); yNoon.setHours(12, 0, 0, 0);
  const spentYesterday = {
    id: 'ci1', source: 'sms', amount: 1200, type: 'debit', categoryId: 'food',
    createdAt: yNoon.getTime(), isIgnored: false, isReviewed: false, accountId: 'a1',
  };

  const armReward = () => useReward.setState({
    awareStreak: 5, lastCheckedInDate: cal(Date.now() - DAY), lastClaimedBonusDate: null,
    pendingSavingsReward: null, totalRP: 0, epcBalance: 0, isFirstLaunch: false,
    dailyReviewedCount: 0, lastCapResetDate: cal(Date.now()),
  });
  // Exactly what the screen does.
  const doCheckIn = () => {
    const st2 = useStore.getState();
    return useReward.getState().checkIn(
      selectYesterdayTransactionCount(st2),
      selectGapTransactionCount(st2, useReward.getState().lastCheckedInDate),
    );
  };

  reset();
  useStore.setState({ transactions: [spentYesterday] });
  armReward();
  const spent = doCheckIn();
  check('spent yesterday → NO savings bonus', spent.type === 'NEW_DAY'
    && useReward.getState().pendingSavingsReward === null, spent.type);
  check('…and the Aware Run still advances', useReward.getState().awareStreak === 6,
    String(useReward.getState().awareStreak));

  // An UNREVIEWED transaction still counts — reviewing is a separate reward, and
  // conflating the two is what the report sounded like at first glance.
  reset();
  useStore.setState({ transactions: [{ ...spentYesterday, isReviewed: false }] });
  check('an unreviewed transaction still counts as spend yesterday',
    selectYesterdayTransactionCount(useStore.getState()) === 1);
  useStore.setState({ transactions: [{ ...spentYesterday, isReviewed: true }] });
  check('…and so does a reviewed one — review state is irrelevant here',
    selectYesterdayTransactionCount(useStore.getState()) === 1);
  // An IGNORED one does not: the user said it wasn't real spend.
  useStore.setState({ transactions: [{ ...spentYesterday, isIgnored: true }] });
  check('an ignored transaction does not count',
    selectYesterdayTransactionCount(useStore.getState()) === 0);

  // A genuinely quiet day still earns it — the guard must not kill the feature.
  reset();
  useStore.setState({ transactions: [] });
  armReward();
  const quiet = doCheckIn();
  check('a genuinely zero-spend yesterday DOES award the bonus',
    quiet.type === 'SAVINGS' && useReward.getState().pendingSavingsReward?.rpAmount > 0,
    quiet.type);

  // THE BUG: the finance store hadn't rehydrated yet, so `transactions` was empty
  // while the reward store — a handful of counters, so it lands first — already
  // knew it checked in yesterday. Yesterday's count read 0 and the bonus fired.
  reset();
  useStore.setState({ transactions: [] });   // not hydrated yet
  armReward();                                // rewards already hydrated
  const race = doCheckIn();
  check('an EMPTY (unhydrated) store would award a false bonus — hence the gate',
    race.type === 'SAVINGS',
    'if this ever stops being true the screen gate may no longer be needed');
  check('…which is why DashboardScreen waits for BOTH stores and the first sweep',
    (() => {
      const dash = readFileSync(`${SRC}/screens/DashboardScreen.js`, 'utf8');
      // The AWAIT must come before the store is READ. Checking the position of
      // `yesterdayCount` alone was not enough: moving just the `getState()` call
      // above the await restores the bug (a stale snapshot) while leaving that
      // ordering intact — a mutation did exactly that and survived.
      const awaitAt = dash.indexOf('await whenFirstSweepSettled();');
      const readAt = dash.indexOf('const st = useEPurseStore.getState();', dash.indexOf('const runCheckIn'));
      return /if \(!hydrated \|\| !rewardsHydrated\) return undefined;/.test(dash)
        && awaitAt > 0 && readAt > 0 && awaitAt < readAt
        && awaitAt < dash.indexOf('const yesterdayCount = selectYesterdayTransactionCount');
    })(),
    'the store must be READ after the await, not before');

  // Idempotency is why this cannot self-correct later in the day.
  reset();
  useStore.setState({ transactions: [spentYesterday] });
  armReward();
  doCheckIn();
  const before = JSON.stringify(useReward.getState().pendingSavingsReward);
  const second = doCheckIn();
  check('a second check-in the same day is a no-op', second.type === 'SAME_DAY'
    && JSON.stringify(useReward.getState().pendingSavingsReward) === before, second.type);
}

// ── deleteAccount prunes every stale reference, not just live transactions ──
// Manage Account modal (Sep-2026) surfaces delete fresh from the account list,
// so this extension closes gaps that used to just linger: archivedTransactions
// stayed pointed at the dead id, declinedAccountLinks kept a stale mask-pair,
// and a deleted CC's unpaid bill/reminder/heads-up bookkeeping never cleared.
{
  const { ACCOUNT_TYPES } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/categories.js');
  reset();
  const acctId = 'acct_test_delete_cleanup';
  const mask = '9911';
  useStore.setState((s) => ({
    accounts: [
      ...s.accounts,
      { id: acctId, type: ACCOUNT_TYPES.CREDIT_CARD, name: 'Test CC', bankName: 'TestBank', mask, balance: -500, aliasMasks: [] },
    ],
    transactions: [
      { id: 'live1', accountId: acctId, amount: 10, type: 'debit', createdAt: Date.now(), categoryId: 'other' },
    ],
    archivedTransactions: [
      { id: 'arch1', accountId: acctId, amount: 10, type: 'debit', createdAt: Date.now(), categoryId: 'other' },
    ],
    declinedAccountLinks: [`${mask}:5555`, '1111:2222'],
    ccBills: { [mask]: { cardLast4: mask, bankName: 'TestBank', amount: 500, dueDate: '10-09-26' } },
    ccDueReminderIds: { [`${mask}:someid`]: 'notif-id-123' },
    ccCycleHeadsUpNotified: { [acctId]: '2026-09' },
  }));

  useStore.getState().deleteAccount(acctId);
  const s = useStore.getState();

  check('deleteAccount removes the account', !s.accounts.some((a) => a.id === acctId));
  check('…and still unlinks live transactions',
    s.transactions.find((t) => t.id === 'live1')?.accountId === null);
  check('…now also unlinks archivedTransactions (was left dangling)',
    s.archivedTransactions.find((t) => t.id === 'arch1')?.accountId === null);
  check('…strips declinedAccountLinks naming this account\'s mask, keeps unrelated pairs',
    !s.declinedAccountLinks.includes(`${mask}:5555`) && s.declinedAccountLinks.includes('1111:2222'));
  check('…clears the card\'s outstanding ccBills entry',
    !(mask in s.ccBills));
  check('…cancels ccDueReminderIds for the card',
    !Object.keys(s.ccDueReminderIds).some((k) => k.startsWith(`${mask}:`)));
  check('…clears ccCycleHeadsUpNotified for the account',
    !(acctId in s.ccCycleHeadsUpNotified));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
