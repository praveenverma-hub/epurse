import { PROJECT_ROOT } from './paths.mjs';
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
register(`${PROJECT_ROOT}/src/utils/__tests__/_store-hook.mjs`, import.meta.url);

const mod = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);
const useStore = mod.useEPurseStore || mod.default;
const beh = await import(`${PROJECT_ROOT}/src/analytics/behavioralSelectors.js`);
const { isGroupExcluded, isMemoTxn, splitLbChipKind, isPayerLockedToMe, defaultGroupSplit } =
  await import(`${PROJECT_ROOT}/src/utils/split.js`);

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

// ── setAccountAnchor must store a CREDIT CARD's balance as NEGATIVE ───────────
// The anchor modal only ever collects a non-negative "how much is outstanding"
// figure (same shape for a bank account or a card) — `setAccountAnchor` used to
// apply it verbatim, so anchoring a card to "5000" stored balance: 5000 (an
// ASSET) instead of -5000 (the LIABILITY every other CC code path assumes:
// AccountDetailsScreen's Math.abs(rawBalance), selectEPurseNetWorth's
// Math.min(bal, 0)). Reported directly: "when we update the balance for cc it
// adds as balance not a outstanding amount."
reset();
useStore.setState({ accounts: [
  { id: 'cc-anchor', type: 'Credit Card', bankName: 'HDFC', mask: '1234', balance: 0, aliasMasks: [] },
] });
useStore.getState().setAccountAnchor('cc-anchor', 8000);
check('setAccountAnchor: a CC anchored to 8000 stores balance -8000, not +8000',
  accts().find((a) => a.id === 'cc-anchor').balance === -8000,
  `bal ${accts().find((a) => a.id === 'cc-anchor').balance}`);

// A plain bank/debit account is untouched by the CC-only negation.
useStore.setState({ accounts: [
  { id: 'bank-anchor', type: 'Bank', bankName: 'HDFC', mask: '4321', balance: 0, aliasMasks: [] },
] });
useStore.getState().setAccountAnchor('bank-anchor', 12000);
check('setAccountAnchor: a bank account anchored to 12000 stays +12000',
  accts().find((a) => a.id === 'bank-anchor').balance === 12000,
  `bal ${accts().find((a) => a.id === 'bank-anchor').balance}`);

// Setting a card's outstanding below its unpaid bill: the bill can't owe more
// than the whole card, so ₹0 = paid (the carousel said FULLY PAID while the
// Accounts row / Home card still said "due").
{
  const bill = { cardLast4: '5555', bankName: 'HDFC', amount: 9000, dueDate: '20-Oct-26' };
  useStore.setState({
    accounts: [{ id: 'cc-bill', type: 'Credit Card', bankName: 'HDFC', mask: '5555', balance: -12000, statementBalance: 9000, remainingDue: 9000, aliasMasks: [] }],
    ccBills: { 'cc-key': bill },
    ccDueReminderIds: { '5555:20-Oct-26': 'n1' },
  });
  useStore.getState().setAccountAnchor('cc-bill', 4000);
  const c = () => accts().find((a) => a.id === 'cc-bill');
  check('anchor below the bill caps remainingDue at the new outstanding', c().remainingDue === 4000, `${c().remainingDue}`);
  check('…and the Home bill shows what\'s left', useStore.getState().ccBills['cc-key']?.remaining === 4000, JSON.stringify(useStore.getState().ccBills));
  useStore.getState().setAccountAnchor('cc-bill', 0);
  check('anchor to ₹0 → statement paid', c().remainingDue === 0, `${c().remainingDue}`);
  check('…bill + due reminder cleared', !useStore.getState().ccBills['cc-key'] && !useStore.getState().ccDueReminderIds['5555:20-Oct-26'],
    JSON.stringify([useStore.getState().ccBills, useStore.getState().ccDueReminderIds]));
  useStore.setState({ accounts: [{ id: 'cc-bill', type: 'Credit Card', mask: '5555', balance: -3000, statementBalance: 9000, remainingDue: 2000, aliasMasks: [] }] });
  useStore.getState().setAccountAnchor('cc-bill', 15000);
  check('anchor ABOVE the bill leaves remainingDue alone', c().remainingDue === 2000, `${c().remainingDue}`);
  useStore.setState({ ccBills: {}, ccDueReminderIds: {} });
}

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

    const tlOn = mod.selectMonthlyReport(prevMk, { includePrivate: true, includeTxnList: true })(useStore.getState());
    check('includeTxnList on: list built', Array.isArray(tlOn.txnList) && tlOn.txnList.length === 2);
    const tlOff = mod.selectMonthlyReport(prevMk, { includeTxnList: false })(useStore.getState());
    check('includeTxnList off: null', tlOff.txnList === null);
  }

  // Extra sections: Goals / Lent & Borrowed / Accounts — each behind its own switch.
  {
    const nowIso = new Date().toISOString();
    const curMk = nowIso.slice(0, 7);
    useStore.setState({
      accounts: [{ id: 'acc1', bankName: 'HDFC', mask: '4021', type: 'Bank Account', balance: 5000 }],
      transactions: [],
      goals: [{ id: 'g1', name: 'Trip', kind: 'saving', duration: 'recurring', lifetimeTarget: null, autoRule: null, archivedAt: null }],
      goalPlan: { monthKey: curMk, salary: 50000, allocations: { g1: 3000 } },
      goalContributions: [{ id: 'c1', goalId: 'g1', amount: 1500, date: nowIso, source: 'manual' }],
      lentBorrowed: [{ id: 'l1', kind: 'lent', person: 'Ravi', amount: 700, date: nowIso, phone: '9999999999' }],
    });
    // Accounts + Income are OFF by default (sensitive) — assert that, then opt in.
    const dflt = mod.selectMonthlyReport(curMk)(useStore.getState());
    check('accounts + income sections are off by default', dflt.accounts === null && dflt.incomeSources === null);
    const on = mod.selectMonthlyReport(curMk, { includeAccounts: true })(useStore.getState());
    check('goals section: planned vs funded', on.goals.length === 1 && on.goals[0].planned === 3000 && on.goals[0].funded === 1500, JSON.stringify(on.goals));
    check('lb section: this month + outstanding', on.lb?.lent === 700 && on.lb.owedToYou === 700 && on.lb.people[0].name === 'Ravi', JSON.stringify(on.lb));
    check('accounts section: net worth + rows', on.accounts?.netWorth === 5000 && on.accounts.rows.length === 1, JSON.stringify(on.accounts));
    const off = mod.selectMonthlyReport(curMk, { includeGoals: false, includeLb: false, includeAccounts: false })(useStore.getState());
    // Income sources + Not counted as spend (need raw rows this month).
    useStore.setState({
      transactions: [
        { id: 'i1', amount: 50000, type: 'credit', categoryId: 'salary', merchant: 'ACME', accountId: 'acc1', createdAt: nowIso },
        { id: 'i2', amount: 2000, type: 'credit', categoryId: 'other', merchant: 'Friend', accountId: 'acc1', createdAt: nowIso },
        { id: 'e1', amount: 300, type: 'debit', categoryId: 'food', merchant: 'Cafe', accountId: 'acc1', createdAt: nowIso },
        { id: 's1', amount: 4000, type: 'debit', categoryId: 'self', merchant: 'Own', accountId: 'acc1', createdAt: nowIso },
        { id: 'c1b', amount: 9000, type: 'debit', categoryId: 'cc_bill', merchant: 'HDFC CC', accountId: 'acc1', createdAt: nowIso },
      ],
    });
    const inc2 = mod.selectMonthlyReport(curMk, { includeIncome: true })(useStore.getState());
    check('income sources add up to the income total',
      inc2.incomeSources && Math.round(inc2.incomeSources.reduce((t, r) => t + r.total, 0)) === Math.round(inc2.cashflow.income)
        && inc2.cashflow.income === 52000, JSON.stringify(inc2.incomeSources));
    check('not-counted lists own transfers + card bills, never normal spend',
      inc2.notCounted?.totalOut === 13000 && inc2.notCounted.rows.length === 2
        && inc2.cashflow.spent === 300, JSON.stringify(inc2.notCounted));
    const off2 = mod.selectMonthlyReport(curMk, { includeIncome: false, includeNotCounted: false })(useStore.getState());
    check('income + not-counted drop with their switches', off2.incomeSources === null && off2.notCounted === null);
    check('each new section drops when its switch is off', off.goals.length === 0 && off.lb === null && off.accounts === null);
    check('a saved object missing the new keys still resolves to the defaults (on)',
      mod.selectMonthlyReport(curMk, { includePrivate: false, includeGroups: true, includeTxnList: false })(useStore.getState()).goals.length === 1);
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
  const loc = await import(`${PROJECT_ROOT}/src/utils/location.js`);
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
  // Oct-9-26: an amount edit KEEPS the split and rescales it (it used to drop it).
  const tr = useStore.getState().transactions[0];
  check('split edit: updateTransaction alone keeps the split, rescaled to the new total',
    tr.isSplit === true && useStore.getState().lentBorrowed.length === 2 &&
    Math.abs(tr.myShareAmount + tr.splitWith.reduce((s, o) => s + o.shareAmount, 0) - 1200) < 0.01,
    `${tr.isSplit} ${tr.myShareAmount} ${JSON.stringify(tr.splitWith.map((o) => o.shareAmount))}`);

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

  // ── An amount edit on a memo keeps it Rahul's money (Oct-9-26). It used to drop the
  //    split and debit the whole new amount from MY account although Rahul paid.
  addSplit({ splitPaidBy: { contactId: 'c1', name: 'Rahul' } });
  const memoId = txn0().id;
  useStore.getState().updateTransaction(memoId, {
    amount: 1200, type: 'debit', accountId: 'a1', merchant: 'Dinner',
    categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Restaurants',
    note: '', createdAt: txn0().createdAt,
  });
  check('split payer: an amount edit on a memo moves no balance', bal() === 10000, `bal ${bal()}`);
  check('split payer: …it stays Rahul\'s memo, parked on the same account',
    txn0().isSplitMemo && txn0().splitPaidBy?.name === 'Rahul' && !txn0().accountId && txn0().memoAccountId === 'a1');
  check('split payer: …I now owe Rahul half the new total, and it stays out of spend',
    lbRows().length === 1 && Number(lbRows()[0].amount) === 600 && useStore.getState().getMonthlySpend() === 0,
    `${JSON.stringify(lbRows().map((l) => l.amount))} spend ${useStore.getState().getMonthlySpend()}`);

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
  const { computeLedgerTotals } = await import(`${PROJECT_ROOT}/src/utils/ledgerTotals.js`);
  const { spendExcluded } = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);

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
    const { buildPDFHTML } = await import(`${PROJECT_ROOT}/src/services/exportService.ts`);

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
  const { selectMonthlyReport } = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);
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

  // This fixture's dates are in the PAST (they're hardcoded), so no reminder is
  // mirrored for it — correct, and asserted with a future-dated bill further down.

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
  const { monthKey } = await import(`${PROJECT_ROOT}/src/utils/format.js`);
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
    await import(`${PROJECT_ROOT}/src/utils/accountMatch.js`);
  const { countsForSpend, spendContribution } =
    await import(`${PROJECT_ROOT}/src/utils/split.js`);
  const { NON_SPEND_CATEGORY_IDS } =
    await import(`${PROJECT_ROOT}/src/constants/categories.js`);
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
    await import(`${PROJECT_ROOT}/src/utils/accountMatch.js`);
  const { countsForSpend, spendContribution } =
    await import(`${PROJECT_ROOT}/src/utils/split.js`);
  const { NON_SPEND_CATEGORY_IDS, ACCOUNT_TYPES } =
    await import(`${PROJECT_ROOT}/src/constants/categories.js`);
  const { isSameMonth } = await import(`${PROJECT_ROOT}/src/utils/format.js`);
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
    await import(`${PROJECT_ROOT}/src/utils/accountMatch.js`);

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
  const { monthKey } = await import(`${PROJECT_ROOT}/src/utils/format.js`);
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
// ThemePickerSheet (opened from Settings → Appearance) renders `Object.values(THEMES)`
// and compares each against the stored id, so a Gold user would open it and find a
// themed app with no swatch selected and no way to tell why. Exactly the 'sky' bug v24 fixed, which
// is why v24's generic line doesn't help here: it only runs below version 24.
{
  const migrate = useStore.persist.getOptions().migrate;
  const { THEMES, DEFAULT_THEME_ID } =
    await import(`${PROJECT_ROOT}/src/constants/themes.js`);

  check('the Gold accent is really gone', !THEMES.amber);
  check('…and Carbon took its slot', !!THEMES.carbon && THEMES.carbon.label === 'Carbon');

  // `migrate` runs the WHOLE chain from the given version, so since v35 every
  // pre-35 store ends on violet (see the v35 block below). What v26 still owes:
  // a Gold user never lands on a dangling id the picker can't select.
  const gold = migrate({ themeId: 'amber' }, 25);
  check('a Gold user ends on a real theme the picker can select',
    !!THEMES[gold.themeId] && gold.themeId !== 'amber', `${gold.themeId}`);
  const fresh = migrate({ themeId: DEFAULT_THEME_ID }, 25);
  check('the default survives the migration', fresh.themeId === DEFAULT_THEME_ID);
}

// ── v35: violet is THE brand theme — one-time move of every saved theme ─────
{
  const migrate = useStore.persist.getOptions().migrate;
  const { THEMES, DEFAULT_THEME_ID } =
    await import(`${PROJECT_ROOT}/src/constants/themes.js`);
  check('violet is the default theme', DEFAULT_THEME_ID === 'violet');
  for (const id of Object.keys(THEMES)) {
    const moved = migrate({ themeId: id }, 34);
    check(`a saved '${id}' moves onto violet`, moved.themeId === 'violet', `${moved.themeId}`);
  }
  // A theme picked AFTER the move is the user's choice — it must stick.
  for (const id of Object.keys(THEMES)) {
    const kept = migrate({ themeId: id }, 35);
    check(`'${id}' chosen after v35 is left alone`, kept.themeId === id, `${kept.themeId}`);
  }
}

// ── v27: 'repayment' category MERGED into 'borrow_repaid' (Sep-2026) ────────
// User request: "remove repayment globally, we already have lent settled and
// borrow repaid" — but repayment wasn't a pure duplicate: it was the only
// SPEND-counting category the settle-with-account flow used, while
// borrow_repaid was blanket non-spend. Real fix: borrow_repaid stops being
// blanket non-spend (paying off a debt is a real expense — see the comment
// on NON_SPEND_CATEGORY_IDS in constants/categories.js), and `repayment` is
// deleted. Existing persisted transactions must be rewritten, not orphaned.
{
  const migrate = useStore.persist.getOptions().migrate;
  const { NON_SPEND_CATEGORY_IDS } =
    await import(`${PROJECT_ROOT}/src/constants/categories.js`);

  check('borrow_repaid is no longer blanket non-spend',
    !NON_SPEND_CATEGORY_IDS.has('borrow_repaid'));
  check('lent_settled stays non-spend (your own money coming back, not income)',
    NON_SPEND_CATEGORY_IDS.has('lent_settled'));

  const legacy = {
    transactions: [
      { id: 'r1', amount: 450, type: 'debit', categoryId: 'repayment',
        parentCategory: 'Transfers', childCategory: 'Repayment', accountId: 'acc1' },
      { id: 'r2', amount: 100, type: 'debit', categoryId: 'food' },
    ],
    categories: [
      { id: 'repayment', name: 'Repayment', color: '#6B7280', emoji: '💸' },
      { id: 'food', name: 'Food', color: '#f00', emoji: '🍔' },
    ],
  };
  const migrated = migrate(legacy, 26);
  const r1 = migrated.transactions.find((t) => t.id === 'r1');
  const r2 = migrated.transactions.find((t) => t.id === 'r2');

  check('an old repayment transaction is retagged to borrow_repaid',
    r1.categoryId === 'borrow_repaid', r1.categoryId);
  check('…and loses its stale two-tier labels (borrow_repaid is an alias, not a tree child)',
    r1.parentCategory === undefined && r1.childCategory === undefined,
    `${r1.parentCategory}/${r1.childCategory}`);
  check('…other fields (account, amount) are untouched',
    r1.accountId === 'acc1' && r1.amount === 450);
  check('an unrelated transaction is left completely alone',
    r2.categoryId === 'food' && r2.parentCategory === undefined);
  check('the stale repayment category entry is dropped from the categories list',
    !migrated.categories.some((c) => c.id === 'repayment'));
  check('…other categories survive',
    migrated.categories.some((c) => c.id === 'food'));

  // Idempotent: a store already at 27 must not be touched again.
  const twice = migrate(migrate(legacy, 26), 27);
  check('running it twice is a no-op', twice.transactions.find((t) => t.id === 'r1').categoryId === 'borrow_repaid');
}

// ── v28: backfill accountType/accountMask/bankName on manual transactions (Sep-2026) ──
// User report: "when adding a normal transaction manually, the selected bank does not
// reflect on card ui" — TransactionItem's card reads txn.accountType/accountMask
// directly (never a live account lookup), but addTransaction/addGroupExpense/
// updateTransaction/updateGroupExpense only ever set accountId, so every manual entry
// showed no account at all. Forward-fix is stampAccountMeta; this repairs already-
// persisted rows by looking up each transaction's accountId in the accounts list.
{
  const migrate = useStore.persist.getOptions().migrate;
  const legacy = {
    accounts: [
      { id: 'acc1', type: 'bank', mask: '1234', bankName: 'HDFC' },
      { id: 'acc2', type: 'credit_card', mask: '9876', bankName: 'ICICI' },
    ],
    transactions: [
      // manual entry, missing accountType/accountMask/bankName — the bug.
      { id: 'm1', amount: 200, type: 'debit', categoryId: 'food', accountId: 'acc1', source: 'manual' },
      // SMS-parsed txn, already carries the fields — must be left untouched.
      { id: 's1', amount: 300, type: 'debit', categoryId: 'food', accountId: 'acc2',
        accountType: 'credit_card', accountMask: '9876', bankName: 'ICICI', source: 'sms' },
      // a memo / no accountId at all — nothing to backfill, must stay absent.
      { id: 'x1', amount: 50, type: 'debit', categoryId: 'food', isSplitMemo: true, memoAccountId: 'acc1' },
      // dangling accountId (account since deleted) — must be left alone, not crash.
      { id: 'd1', amount: 75, type: 'debit', categoryId: 'food', accountId: 'gone' },
    ],
  };
  const migrated = migrate(legacy, 27);
  const m1 = migrated.transactions.find((t) => t.id === 'm1');
  const s1 = migrated.transactions.find((t) => t.id === 's1');
  const x1 = migrated.transactions.find((t) => t.id === 'x1');
  const d1 = migrated.transactions.find((t) => t.id === 'd1');

  check('a manual transaction is backfilled with its account type/mask/bank',
    m1.accountType === 'bank' && m1.accountMask === '1234' && m1.bankName === 'HDFC',
    `${m1.accountType}/${m1.accountMask}/${m1.bankName}`);
  check('an already-correct SMS transaction is untouched',
    s1.accountType === 'credit_card' && s1.accountMask === '9876');
  check('a memo with no accountId gets no account fields',
    x1.accountType === undefined && x1.accountMask === undefined);
  check('a dangling accountId (deleted account) does not crash and is left alone',
    d1.accountType === undefined && d1.accountId === 'gone');

  // Idempotent: a store already at 28 (or missing accounts entirely) must not crash/touch.
  const twice = migrate(migrated, 28);
  check('running it twice is a no-op',
    twice.transactions.find((t) => t.id === 'm1').accountMask === '1234');
  const noAccounts = migrate({ transactions: [{ id: 'z', accountId: 'acc1' }] }, 27);
  check('missing accounts array does not crash', noAccounts.transactions[0].id === 'z');
}

// ── Forward fix: every live write path stamps accountType/accountMask/bankName ──
// The migration above only repairs already-persisted rows; this exercises the real
// addTransaction/addGroupExpense/updateTransaction/updateGroupExpense actions so a
// future regression in the forward path (not just the migration) goes red too.
{
  reset();
  useStore.getState().addAccount({ name: 'HDFC Bank', type: 'Bank', mask: '1234', bankName: 'HDFC' });
  const acc1 = accts()[0].id;

  useStore.getState().addTransaction({
    amount: 200, type: 'debit', categoryId: 'food', merchant: 'Cafe', accountId: acc1,
  });
  const manual = txns().find((t) => t.merchant === 'Cafe');
  check('addTransaction stamps accountType/accountMask/bankName',
    manual.accountType === 'Bank' && manual.accountMask === '1234' && manual.bankName === 'HDFC',
    `${manual.accountType}/${manual.accountMask}/${manual.bankName}`);

  useStore.getState().addAccount({ name: 'ICICI Bank', type: 'Bank', mask: '5678', bankName: 'ICICI' });
  const acc2 = accts().find((a) => a.mask === '5678').id;
  useStore.getState().updateTransaction(manual.id, {
    amount: 200, accountId: acc2, merchant: 'Cafe', categoryId: 'food',
  });
  const edited = useStore.getState().transactions.find((t) => t.id === manual.id);
  check('updateTransaction re-stamps meta for the NEWLY chosen account, not the old one',
    edited.accountMask === '5678' && edited.bankName === 'ICICI',
    `${edited.accountMask}/${edited.bankName}`);

  const groupId = useStore.getState().createGroup({ name: 'Trip', type: 'shared', members: [{ memberId: 'c1', name: 'Rahul' }] });
  const geId = useStore.getState().addGroupExpense(groupId, {
    amount: 500, merchant: 'Dinner', categoryId: 'food', paidByMemberId: 'me', accountId: acc1,
    shares: [{ memberId: 'me', shareAmount: 250 }, { memberId: 'c1', shareAmount: 250 }],
  });
  const groupTxn = useStore.getState().transactions.find((t) => t.id === geId);
  check('addGroupExpense stamps accountType/accountMask/bankName',
    groupTxn.accountMask === '1234' && groupTxn.bankName === 'HDFC',
    `${groupTxn.accountMask}/${groupTxn.bankName}`);

  useStore.getState().updateGroupExpense(geId, {
    amount: 500, merchant: 'Dinner', categoryId: 'food', paidByMemberId: 'me', accountId: acc2,
    shares: [{ memberId: 'me', shareAmount: 250 }, { memberId: 'c1', shareAmount: 250 }],
  });
  const groupEdited = useStore.getState().transactions.find((t) => t.id === geId);
  check('updateGroupExpense re-stamps meta for the NEWLY chosen account',
    groupEdited.accountMask === '5678' && groupEdited.bankName === 'ICICI',
    `${groupEdited.accountMask}/${groupEdited.bankName}`);

  // A group memo (someone else paid) never had accountId — must stay meta-free.
  const memoId = useStore.getState().addGroupExpense(groupId, {
    amount: 300, merchant: 'Snacks', categoryId: 'food', paidByMemberId: 'c1', paidByName: 'Rahul',
    shares: [{ memberId: 'me', shareAmount: 150 }, { memberId: 'c1', shareAmount: 150 }],
  });
  const memoTxn = useStore.getState().transactions.find((t) => t.id === memoId);
  check('a group memo (not me) gets no account meta',
    memoTxn.accountType === undefined && memoTxn.accountMask === undefined);

  reset();
}

// ── GOALS (Sep-2026) ─────────────────────────────────────────────────────────
// The forward-looking half of planning. Budget caps what leaves; Goals commits
// what stays. Same monthly rhythm on purpose — a new month starts with no plan
// and the user confirms one from a prefill, exactly like `budget`.
{
  const st = () => useStore.getState();
  const { monthKey: monthKeyOf } =
    await import(`${PROJECT_ROOT}/src/utils/format.js`);
  reset();
  useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });

  // ── definitions ──────────────────────────────────────────────────────────
  const efId  = st().addGoal({ name: 'Emergency Fund', emoji: '🛟', kind: 'saving', lifetimeTarget: 300000 });
  const sipId = st().addGoal({ name: 'MF SIP', emoji: '📈', kind: 'investment', autoParentId: 'investments' });

  check('addGoal returns an id and stores the goal', st().goals.length === 2 && !!efId);
  check('a goal keeps its lifetime target',
    st().goals.find((g) => g.id === efId).lifetimeTarget === 300000);
  check('a goal with no emoji still gets one',
    !!st().addGoal({ name: 'Bare' }) && st().goals.find((g) => g.name === 'Bare').emoji.length > 0);
  check('an unnamed goal is refused rather than created as a blank row',
    st().addGoal({ name: '   ' }) === null && st().goals.length === 3);

  st().deleteGoal(st().goals.find((g) => g.name === 'Bare').id);
  check('deleteGoal removes it', st().goals.length === 2);

  // ── the plan ─────────────────────────────────────────────────────────────
  st().setGoalPlan({ salary: 85000, allocations: { [efId]: 15000, [sipId]: 10240, dead: 0 } });
  const plan = st().goalPlan;
  check('the plan is stamped with the current month', plan.monthKey === monthKeyOf(new Date()));
  check('allocations snap to the ₹500 step', plan.allocations[sipId] === 10000, `${plan.allocations[sipId]}`);
  check('a zero allocation is dropped rather than stored', !('dead' in plan.allocations));
  check('confirming a plan also arms next month\'s prefill',
    st().lastGoalPlan && st().lastGoalPlan.allocations[efId] === 15000);

  st().updateGoalAllocation(efId, 20000);
  check('a stepper can raise an allocation into free space',
    st().goalPlan.allocations[efId] === 20000);
  // 85,000 salary − 10,000 already on the SIP leaves 75,000 of room.
  st().updateGoalAllocation(efId, 90000);
  check('a stepper cannot push the plan past the salary',
    st().goalPlan.allocations[efId] === 75000, `${st().goalPlan.allocations[efId]}`);
  st().updateGoalAllocation(efId, 15000);

  // `updateGoalAllocation` is the goal FORM's write path now (Sep-12-26) — the
  // monthly amount moved out of this screen's bar/steppers into the goal's own
  // form. Its clamp used to ignore the locked spending cap entirely (it read
  // `s.goalPlan.salary` raw), which the bar's local `setOne` never did — this
  // is the fix, isolated so it doesn't disturb the totalCap-less checks above
  // or below.
  {
    const originalBudget = st().budget;
    useStore.setState({ budget: { monthKey: monthKeyOf(new Date()), totalCap: 20000, perCategory: {} } });
    // 85,000 salary − 20,000 spending − 10,000 already on the SIP leaves
    // 55,000 of room, not 75,000 (salary − SIP alone).
    st().updateGoalAllocation(efId, 90000);
    check("a goal's monthly amount is clamped against room AFTER the spending cap, not raw salary",
      st().goalPlan.allocations[efId] === 55000, `${st().goalPlan.allocations[efId]}`);
    st().updateGoalAllocation(efId, 15000);
    useStore.setState({ budget: originalBudget });
  }

  // ── funding: manual ──────────────────────────────────────────────────────
  st().addGoalContribution(efId, 6000);
  st().addGoalContribution(efId, 3000);
  check('manual contributions add up for the month', st().getGoalFunded(efId) === 9000);
  check('a zero contribution is refused', st().addGoalContribution(efId, 0) === null);

  // A contribution CAN carry the transaction it came from — nothing writes
  // this yet, but the guard it enables (below) has to hold from day one.
  // Isolated on a SCRATCH goal, deleted right after — these must not touch
  // efId's or sipId's totals, which later assertions pin to exact numbers.
  {
    const scratchId = st().addGoal({ name: 'Scratch' });
    check('a contribution with no source txn is untouched by the dedup guard',
      !!st().addGoalContribution(scratchId, 500));
    const firstFromTxn = st().addGoalContribution(scratchId, 1200, undefined, 'txn_abc');
    check('a sourced contribution is created and remembers its source',
      !!firstFromTxn && st().goalContributions.find((c) => c.id === firstFromTxn).sourceTxnId === 'txn_abc');
    check('the SAME transaction cannot fund the SAME goal twice',
      st().addGoalContribution(scratchId, 1200, undefined, 'txn_abc') === null);
    check('…but the same transaction funding a DIFFERENT goal is a different pair',
      !!st().addGoalContribution(efId, 1200, undefined, 'txn_abc'));
    // Clean up: delete the scratch goal AND the cross-goal contribution this
    // just proved is allowed, so nothing here leaks into efId's later totals.
    st().deleteGoal(scratchId);
    useStore.setState({
      goalContributions: st().goalContributions.filter(
        (c) => !(c.goalId === efId && c.sourceTxnId === 'txn_abc'),
      ),
    });
  }

  // ── funding: automatic, from real spend ──────────────────────────────────
  // The point of an auto goal: a SIP debit the user already made funds it with
  // no second act of logging. This is what stops investment goals going stale.
  useStore.getState().addAccount({ name: 'HDFC', type: 'Bank', mask: '1111', balance: 100000 });
  const acc = st().accounts[0].id;
  st().addTransaction({ amount: 4000, type: 'debit', categoryId: 'investments', merchant: 'Groww SIP', accountId: acc });
  check('an investment goal is funded by spend in its category, with nothing logged',
    st().getGoalFunded(sipId) === 4000, `${st().getGoalFunded(sipId)}`);

  // The two-tier LABEL path resolves too — parentCatIdForTxn reads the label
  // before the legacy id, so a txn tagged through the category sheet counts
  // even when its flat categoryId says nothing useful.
  st().addTransaction({
    amount: 1000, type: 'debit', categoryId: 'other', merchant: 'Zerodha',
    parentCategory: 'Investments', childCategory: 'Mutual Funds', accountId: acc,
  });
  check('…including one tagged only by its two-tier label',
    st().getGoalFunded(sipId) === 5000, `${st().getGoalFunded(sipId)}`);

  // An auto goal STILL takes typed money (Sep-11-26). Phase 1 refused it to
  // stop a double count; the user's call was the opposite — bank SMS is not
  // guaranteed to arrive, so a goal that cannot be corrected by hand quietly
  // under-reports for ever. The two sources add, and the UI names each part.
  st().addGoalContribution(sipId, 5000);
  check('an auto goal ALSO takes money logged by hand, for the SMS that never came',
    st().getGoalFunded(sipId) === 10000, `${st().getGoalFunded(sipId)}`);
  const split = st().getGoalFunding(sipId);
  check('…and the two sources stay separately reportable',
    split.auto === 5000 && split.manual === 5000, JSON.stringify(split));

  // ── auto rules beyond a single parent ───────────────────────────────────
  // A goal names the spend it is made of: parents, ONE sub-category, or a
  // merchant keyword. All three are ORed, so filing a row under any of them
  // funds the goal.
  const gymId = st().addGoal({
    name: 'Gym fund', emoji: '🏋️',
    autoRule: { parentIds: [], categoryIds: ['groceries'], merchants: ['cult fit'] },
  });
  st().addTransaction({ amount: 700, type: 'debit', categoryId: 'groceries', merchant: 'DMart', accountId: acc });
  check('a sub-category rule funds the goal', st().getGoalFunded(gymId) === 700, `${st().getGoalFunded(gymId)}`);

  st().addTransaction({ amount: 1500, type: 'debit', categoryId: 'other', merchant: 'UPI-CULT.FIT*MEMBERSHIP', accountId: acc });
  check('…and a merchant keyword matches through punctuation and case',
    st().getGoalFunded(gymId) === 2200, `${st().getGoalFunded(gymId)}`);

  st().addTransaction({ amount: 900, type: 'debit', categoryId: 'food', merchant: 'Swiggy', accountId: acc });
  check('…while spend matching nothing in the rule is left alone',
    st().getGoalFunded(gymId) === 2200, `${st().getGoalFunded(gymId)}`);

  // A memo is someone else's money — it can never be money YOU set aside, so
  // it must not fund a goal however it is categorised.
  // Flagged directly: `addTransaction` builds its own row and doesn't take the
  // memo flag, which is set by the split flow.
  st().addTransaction({
    id: 'memo_row', amount: 2000, type: 'debit', categoryId: 'groceries',
    merchant: 'DMart', accountId: acc,
  });
  useStore.setState({
    transactions: st().transactions.map((t) => (t.id === 'memo_row' ? { ...t, isSplitMemo: true } : t)),
  });
  check('…and a memo (someone else paid) never funds a goal',
    st().getGoalFunded(gymId) === 2200, `${st().getGoalFunded(gymId)}`);

  // A goal's funding rule is FIXED AT CREATION (Sep-13-26). Progress IS the sum
  // of what the rule matched, so editing it later silently rewrites what the goal
  // has always been worth — and it is what makes re-deriving a closed month safe
  // for one-time goals (see getGoalLifetimeSaved). To fund a goal differently you
  // create a new one.
  const beforeEdit = st().getGoalFunded(gymId);
  const originalCats = [...st().goals.find((g) => g.id === gymId).autoRule.categoryIds];
  // A rule edit is ADD-ONLY: the patch drops the original categories and adds a
  // parent. The originals must survive it — they are what the goal's progress
  // was measured with — and the addition must not reach back over spend that
  // already happened.
  st().updateGoal(gymId, { autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] } });
  const editedRule = st().goals.find((g) => g.id === gymId).autoRule;
  check('a rule edit cannot REMOVE what a goal was already measured with',
    originalCats.every((c) => editedRule.categoryIds.includes(c)),
    editedRule.categoryIds.join(','));
  check('…an addition is accepted and stamped with the day it was added',
    editedRule.parentIds.includes('investments') && !!editedRule.addedAt?.investments);
  // (The "doesn't backdate" half is proved with explicit dates below, not by
  //  wall-clock ordering inside one fast test run.)
  // Everything that is NOT the rule stays editable.
  st().updateGoal(gymId, { name: 'Gym renamed' });
  check('…while the rest of the goal is still editable',
    st().goals.find((g) => g.id === gymId).name === 'Gym renamed');
  // `autoParentId` must not survive as a second place the matcher reads a parent.
  st().updateGoal(gymId, { autoParentId: 'travel' });
  check('…and a legacy autoParentId goes through the same add-only path',
    st().goals.find((g) => g.id === gymId).autoParentId === undefined
    && !!st().goals.find((g) => g.id === gymId).autoRule.addedAt?.travel);
  st().deleteGoal(gymId);

  // ── the usage selector ───────────────────────────────────────────────────
  const usage = st().getGoalPlanUsage();
  check('usage totals the plan', usage.planned === 25000, `${usage.planned}`);
  check('usage totals what actually landed', usage.funded === 19000, `${usage.funded}`);
  check('…and a row names where its money came from',
    usage.perGoal.find((r) => r.goalId === sipId).autoFunded === 5000 &&
    usage.perGoal.find((r) => r.goalId === sipId).manualFunded === 5000);
  check('usage reports the free remainder', usage.free === 60000, `${usage.free}`);
  check('usage carries a row per funded goal', usage.perGoal.length === 2);
  check('…and marks which rows track themselves',
    usage.perGoal.find((r) => r.goalId === sipId).auto === true &&
    usage.perGoal.find((r) => r.goalId === efId).auto === false);

  // ── the auto-fund LINK, surfaced from both sides (Sep-12) ─────────────────
  // The total and the drill-down must never disagree — one is a sum over the
  // other's exact list, not two independent scans that could drift apart.
  {
    const sipTxns = st().getGoalTransactions(sipId);
    check('the drill-down lists exactly what the total summed',
      sipTxns.length === 2 && sipTxns.reduce((s, t) => s + t.amount, 0) === 5000);
    check('…and nothing outside its rule leaks in',
      sipTxns.every((t) => ['Groww SIP', 'Zerodha'].includes(t.merchant)));
    check('a goal with no auto rule has nothing to drill into',
      st().getGoalTransactions(efId).length === 0);

    const growwTxn = st().transactions.find((t) => t.merchant === 'Groww SIP');
    const matches = st().getGoalsForTxn(growwTxn);
    check('the transaction side finds the SAME goal back',
      matches.length === 1 && matches[0].id === sipId);
    check('an unrelated transaction matches nothing',
      st().getGoalsForTxn({ type: 'debit', categoryId: 'food', merchant: 'Swiggy' }).length === 0);
    check('an ignored transaction never counts as linked, whatever it matches',
      st().getGoalsForTxn({ ...growwTxn, isIgnored: true }).length === 0);
    check('a memo (someone else paid) is never linked either',
      st().getGoalsForTxn({ ...growwTxn, isSplitMemo: true }).length === 0);
  }

  // ── real money on an UNPLANNED goal must still show up (Sep-12) ──────────
  // `getGoalPlanUsage` used to skip any goal with no plan allocation this
  // month — `if (p <= 0) return` — even when it had real funded money (a
  // manual top-up, or auto-matched spend). Most commonly hit by a One-Time
  // goal, which isn't required to carry a monthly figure the way a Recurring
  // one effectively always does: "This month" on its `GoalCard` silently read
  // ₹0 until a plan slot existed, then jumped to the true figure the moment
  // one was set — reading as though SETTING the allocation had added the
  // money. Isolated on a scratch goal, never given an allocation.
  {
    const unplannedId = st().addGoal({ name: 'UnplannedScratch', emoji: '🎯' });
    st().addGoalContribution(unplannedId, 7000);
    check('no allocation was ever set for it', !(unplannedId in st().goalPlan.allocations));
    const row = st().getGoalPlanUsage().perGoal.find((r) => r.goalId === unplannedId);
    check('…yet its real funded money still gets a usage row', !!row, JSON.stringify(row));
    check('…planned is honestly zero', row.planned === 0);
    check('…and funded is the real contribution, not masked to zero',
      row.funded === 7000, `${row?.funded}`);
    st().deleteGoal(unplannedId);
  }

  // ── a manual top-up is a REAL transaction now, not a bare number (Sep-12) ──
  // `goalContributions` used to be written directly from a typed amount, with
  // no account, no trace in Activity, and no effect on any balance — money
  // that supposedly left an account with nothing to show which one. The
  // screen now runs it through `addTransaction` like any other manual spend
  // and links `sourceTxnId` back to it, so deleting (or ignoring) that
  // transaction must also drop the credit it gave the goal — same cleanup
  // `lentBorrowed` already gets via its own `sourceTxnId`.
  {
    const accBalanceBefore = st().accounts.find((a) => a.id === acc).balance;
    const tripId = st().addGoal({ name: 'TripScratch', emoji: '🗾' });
    const txnId = 'txn_goal_scratch_1';
    st().addTransaction({
      id: txnId, amount: 4000, type: 'debit', accountId: acc,
      categoryId: 'other', merchant: 'TripScratch',
    });
    st().addGoalContribution(tripId, 4000, new Date().toISOString(), txnId);
    check('the top-up left the account like any other spend',
      st().accounts.find((a) => a.id === acc).balance === accBalanceBefore - 4000);
    check('…and the goal counts it', st().getGoalLifetimeSaved(tripId) === 4000);

    st().deleteTransaction(txnId);
    check('deleting the linked transaction restores the balance',
      st().accounts.find((a) => a.id === acc).balance === accBalanceBefore);
    check('…and un-credits the goal — no phantom money left behind',
      st().getGoalLifetimeSaved(tripId) === 0);
    check('…the contribution row itself is gone, not just outweighed',
      !st().goalContributions.some((c) => c.sourceTxnId === txnId));
    st().deleteGoal(tripId);
  }

  // ── the drill-down shows a manually-linked top-up too ────────────────────
  // `getGoalTransactions` used to be ONLY auto-matched spend — a manual
  // top-up wasn't a real transaction, so there was nothing of it to show.
  // Now that one exists (linked via `sourceTxnId`), it belongs in the same
  // "what is this total made of" list the auto-matched ones already appear
  // in — otherwise the drill-down would silently under-list its own total.
  {
    const jarId = st().addGoal({ name: 'JarScratch', emoji: '🫙' });
    const linkedTxnId = 'txn_goal_scratch_2';
    st().addTransaction({
      id: linkedTxnId, amount: 1200, type: 'debit', accountId: acc,
      categoryId: 'other', merchant: 'JarScratch',
    });
    st().addGoalContribution(jarId, 1200, new Date().toISOString(), linkedTxnId);
    const jarTxns = st().getGoalTransactions(jarId);
    check('the linked transaction shows up in the drill-down',
      jarTxns.length === 1 && jarTxns[0].id === linkedTxnId);
    // An OLDER-style contribution with no sourceTxnId has nothing to show —
    // unchanged from before this feature (covered above by sipId's own
    // no-sourceTxnId contribution still summing to exactly 2 auto txns).
    st().addGoalContribution(jarId, 300); // no sourceTxnId
    check('…and a contribution with nothing to link stays invisible here, not double-listed',
      st().getGoalTransactions(jarId).length === 1);
    st().deleteGoal(jarId);
  }

  // ── rollover ─────────────────────────────────────────────────────────────
  // Snapshot BEFORE clearing: raw transactions age out at RAW_RETENTION_MS, so
  // a lifetime total recomputed from them later would quietly shrink.
  //
  // A goal with NO plan allocation that month — pure auto-fund, never given a
  // monthly figure — used to get NO row in this snapshot at all (the loop
  // only walked `goalPlan.allocations`), so its real funded money for the
  // month was gone the instant it rolled over: not aged out, never recorded.
  // Isolated on scratch goals so their transactions/rule don't touch efId's
  // or sipId's pinned totals above.
  // Dated INTO '2020-01' up front — the plan's monthKey is about to be forced
  // to that same month below, and `goalFundedForMonth` matches a transaction
  // by ITS OWN month, not the plan's, so a today-dated transaction would
  // silently compute as 0 funded for the forced-past month and this test
  // would prove nothing.
  const autoOnlyId = st().addGoal({ name: 'AutoOnlyScratch', autoRule: { merchants: ['RolloverAutoTest'] } });
  st().addTransaction({
    amount: 777, type: 'debit', categoryId: 'other', merchant: 'RolloverAutoTest',
    createdAt: '2020-01-15T00:00:00Z',
  });
  const idleScratchId = st().addGoal({ name: 'IdleScratch' });
  check('a goal with no plan can still be funded by its auto rule',
    st().getGoalFunded(autoOnlyId, new Date('2020-01-15')) === 777,
    `${st().getGoalFunded(autoOnlyId, new Date('2020-01-15'))}`);
  check('…and is NOT in this month\'s plan allocations', !(autoOnlyId in (st().goalPlan.allocations || {})));

  // efId has a lifetime target → inferred ONE-TIME; sipId has none → inferred
  // RECURRING (Sep-12-26 DURATION feature — see constants/goals.ts).
  check('duration was inferred correctly for both pre-existing goals',
    st().goals.find((g) => g.id === efId).duration === 'oneTime' &&
    st().goals.find((g) => g.id === sipId).duration === 'recurring');

  useStore.setState({ goalPlan: { ...st().goalPlan, monthKey: '2020-01' } });
  st().rolloverGoalPlanIfNeeded();
  check('…keeps it as the prefill', st().lastGoalPlan.allocations[efId] === 15000);
  check('…and snapshots the closed month', !!st().goalHistory['2020-01']);
  check('the snapshot records what was planned',
    st().goalHistory['2020-01'].perGoal[efId].planned === 15000);
  check('a PLAN-LESS but auto-funded goal is ALSO snapshotted now',
    st().goalHistory['2020-01'].perGoal[autoOnlyId]?.funded === 777,
    JSON.stringify(st().goalHistory['2020-01'].perGoal[autoOnlyId]));
  check('…with a planned figure of 0, not missing/undefined',
    st().goalHistory['2020-01'].perGoal[autoOnlyId]?.planned === 0);
  check('a goal that did NOTHING this month (no plan, no funding) gets no row — no bloat',
    !(idleScratchId in st().goalHistory['2020-01'].perGoal));

  // A goal's monthly amount re-applies AUTOMATICALLY at rollover — no "Keep
  // Last Month's Plan" tap needed, unlike everything else in Goals. This
  // applies on EITHER duration now (revised same day: a one-time goal funded
  // monthly toward its target gets the same treatment as a recurring one) —
  // BOTH sipId (recurring) and efId (one-time, but WAS given a monthly
  // allocation earlier in this test) carry forward untouched.
  check('a goal with a monthly amount auto-carries — the plan is NOT cleared', st().goalPlan !== null);
  check('…stamped with the CURRENT month, not the forced-past one',
    st().goalPlan.monthKey === monthKeyOf(new Date()));
  check("…carrying the recurring goal's amount forward untouched",
    st().goalPlan.allocations[sipId] === 10000, `${st().goalPlan.allocations[sipId]}`);
  check("…and the one-time goal's too — duration no longer gates auto-carry",
    st().goalPlan.allocations[efId] === 15000, `${st().goalPlan.allocations[efId]}`);

  st().deleteGoal(autoOnlyId);
  st().deleteGoal(idleScratchId);

  const carriedPlan = st().goalPlan;
  st().rolloverGoalPlanIfNeeded();
  check('rollover is a no-op once the plan is already the current month',
    st().goalPlan === carriedPlan);

  // ── lifetime ─────────────────────────────────────────────────────────────
  useStore.setState({
    goalHistory: { '2026-01': { perGoal: { [efId]: { planned: 15000, funded: 12000 } } },
                   '2026-02': { perGoal: { [efId]: { planned: 15000, funded: 15000 } } } },
  });
  check('lifetime saved sums closed months plus the live one',
    st().getGoalLifetimeSaved(efId) === 36000, `${st().getGoalLifetimeSaved(efId)}`);
  check('an unknown goal has no lifetime', st().getGoalLifetimeSaved('nope') === 0);

  // ── achievement ──────────────────────────────────────────────────────────
  // The congratulation fires on a LIFETIME target crossed, once. Everything
  // here guards the "once": a goal that is already marked, or has no finish
  // line, must never surface again.
  // Scoped to THIS goal, not a global length: a recurring goal meeting its
  // monthly commitment is now also reported (see the recurring block below), so
  // "nothing at all is reported" stopped being what this check meant.
  check('a goal still short of its target is NOT reported',
    !st().getNewlyAchievedGoals().some((a) => a.goalId === efId));

  st().updateGoal(efId, { lifetimeTarget: 30000 });   // 36,000 already saved
  check('a goal past its lifetime target is reported as newly achieved',
    st().getNewlyAchievedGoals().some((a) => a.goalId === efId));
  check('…carrying what the modal needs to render',
    st().getNewlyAchievedGoals().find((a) => a.goalId === efId).saved === 36000);

  const openEnded = st().addGoal({ name: 'Open ended', emoji: '🛟' });
  st().addGoalContribution(openEnded, 99999);
  check('a goal with NO target is never "achieved" — there is no line to cross',
    !st().getNewlyAchievedGoals().some((a) => a.goalId === openEnded));
  st().deleteGoal(openEnded);

  st().markGoalAchieved(efId, { bonusAwarded: true });
  check('marking it records when', !!st().goals.find((g) => g.id === efId).achievedAt);
  check('…and that the bonus was paid', !!st().goals.find((g) => g.id === efId).bonusAwardedAt);
  // Being MARKED no longer ends the offer — only the user seeing it does (see the
  // claim-on-dismiss block below). What still holds is that the money is paid
  // once: the goal comes back flagged as already awarded.
  check('an achieved-but-uncelebrated goal is still offered…',
    st().getNewlyAchievedGoals().some((a) => a.goalId === efId));
  check('…flagged so the bonus can only ever pay once',
    st().getNewlyAchievedGoals().find((a) => a.goalId === efId).bonusAlreadyAwarded === true);
  check('…and celebrating it is what ends the offer',
    (() => { st().markGoalCelebrated(efId); return !st().getNewlyAchievedGoals().some((a) => a.goalId === efId); })());

  const firstMark = st().goals.find((g) => g.id === efId).achievedAt;
  st().markGoalAchieved(efId);
  check('marking twice keeps the FIRST timestamp',
    st().goals.find((g) => g.id === efId).achievedAt === firstMark);
  check('…and does not un-pay the bonus', !!st().goals.find((g) => g.id === efId).bonusAwardedAt);

  // ── reference cleanup ────────────────────────────────────────────────────
  // An allocation left behind after its goal is gone would count toward the
  // total with nothing on screen to explain why the plan won't balance.
  st().setGoalPlan({ salary: 85000, allocations: { [efId]: 15000, [sipId]: 10000 } });
  st().deleteGoal(efId);
  check('deleting a goal strips it from the live plan', !(efId in st().goalPlan.allocations));
  check('…and from the prefill', !(efId in st().lastGoalPlan.allocations));
  check('…and drops its contributions', !st().goalContributions.some((c) => c.goalId === efId));
  check('…leaving the other goal untouched', st().goalPlan.allocations[sipId] === 10000);

  reset();
  useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });
}

// ── v29: Goals keys seeded on upgrade ────────────────────────────────────────
{
  const migrate = useStore.persist.getOptions().migrate;
  const out = migrate({ transactions: [], accounts: [] }, 28);
  check('v29 seeds goals as a list', Array.isArray(out.goals) && out.goals.length === 0);
  check('v29 seeds the contribution log', Array.isArray(out.goalContributions));
  check('v29 seeds the history map', out.goalHistory && typeof out.goalHistory === 'object');
  // Null, not an invented plan: a plan is always something the user confirmed.
  check('v29 leaves the plan unset so the user confirms one', out.goalPlan === null);

  const existing = migrate({ goals: [{ id: 'g1' }], goalPlan: { monthKey: '2026-09' } }, 28);
  check('an existing goals list survives the migration', existing.goals.length === 1);
  check('an existing plan survives the migration', existing.goalPlan.monthKey === '2026-09');

  // ── v30: one auto-funding rule, not a loose parent field ──────────────────
  const v30 = migrate({
    goals: [
      { id: 'g1', name: 'SIP', autoParentId: 'investments' },
      { id: 'g2', name: 'Fund' },
    ],
  }, 29);
  check('v30 folds the old single parent into the rule',
    v30.goals[0].autoRule.parentIds[0] === 'investments');
  check('…and removes the loose field, so the matcher reads ONE place',
    !('autoParentId' in v30.goals[0]));
  check('…leaving a hand-funded goal with no rule at all', v30.goals[1].autoRule === null);
  check('v30 seeds the achievement fields',
    v30.goals[0].achievedAt === null && v30.goals[0].bonusAwardedAt === null);

  // ── v31: goals gain a DURATION (One-Time vs Recurring) ────────────────────
  // Inferred from what a goal already had, since nothing restored from before
  // this existed was ever asked which it was: a lifetime target → one-time
  // (that's the field its form shows now); no target → recurring.
  const v31 = migrate({
    goals: [
      { id: 'oneTime1', name: 'Laptop', lifetimeTarget: 80000 },
      { id: 'recurring1', name: 'SIP', autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] } },
    ],
    goalPlan: { monthKey: '2026-09', salary: 50000, allocations: { oneTime1: 5000, recurring1: 3000 } },
    lastGoalPlan: { monthKey: '2026-08', salary: 50000, allocations: { oneTime1: 5000, recurring1: 3000 } },
  }, 30);
  check('v31 infers ONE-TIME for a goal with a lifetime target',
    v31.goals.find((g) => g.id === 'oneTime1').duration === 'oneTime');
  check('v31 infers RECURRING for a goal with none',
    v31.goals.find((g) => g.id === 'recurring1').duration === 'recurring');
  // A one-time goal can ALSO carry a monthly allocation (revised same day as
  // this shipped — see the Goals memory file) — nothing about an existing
  // allocation is stripped on migration, on EITHER duration.
  check("v31 leaves a one-time goal's existing allocation untouched",
    v31.goalPlan.allocations.oneTime1 === 5000);
  check('…and its recurring sibling too',
    v31.goalPlan.allocations.recurring1 === 3000);
  check('lastGoalPlan is untouched by this migration entirely',
    v31.lastGoalPlan.allocations.oneTime1 === 5000 && v31.lastGoalPlan.allocations.recurring1 === 3000);
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
  const rw = await import(`${PROJECT_ROOT}/src/store/useRewardStore.ts`);
  const useReward = rw.useRewardStore || rw.default;
  const { readFileSync } = await import('node:fs');
  const SRC = `${PROJECT_ROOT}/src`;

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

  // A brand-new user: never checked in, no transactions. The gap is Infinity and
  // the gap count 0, which used to read as a forgiven gap → streak started at 2.
  reset();
  useStore.setState({ transactions: [] });
  armReward();
  useReward.setState({ awareStreak: 1, lastCheckedInDate: null });
  const firstEver = doCheckIn();
  check('first-ever check-in starts the Aware Run at Day 1, not 2',
    firstEver.newStreak === 1 && useReward.getState().awareStreak === 1,
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
    await import(`${PROJECT_ROOT}/src/constants/categories.js`);
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

// ── Reminders: the registry the Reminders screen renders ────────────────────
// Repeats are expanded into absolute one-off dates by the store (SDK 50 has no
// cross-platform monthly trigger — see utils/reminderSchedule), so the thing to
// pin here is that the OS queue and the records stay in agreement: N occurrences
// armed for a repeat, nothing recorded when nothing could be armed, and a
// reconcile that both drops spent one-offs and re-arms exhausted repeats.
{
  const { REPEAT, QUEUE_DEPTH } =
    await import(`${PROJECT_ROOT}/src/utils/reminderSchedule.js`);

  const st = () => useStore.getState();
  const HOUR = 60 * 60 * 1000;
  const resetReminders = () => {
    reset();
    useStore.setState({ reminders: [], reminderNotifIds: {}, notificationPrefs: {} });
  };

  // ── one-off ──
  resetReminders();
  const oneOff = await st().scheduleReminder({
    title: 'Pay rent', body: 'To the landlord',
    repeat: REPEAT.ONCE, anchorAt: Date.now() + 24 * HOUR,
  });
  check('one-off: a record is created', !!oneOff && st().reminders.length === 1);
  check('…carrying the anchor and repeat it was given',
    oneOff.repeat === REPEAT.ONCE && oneOff.anchorAt > Date.now());
  check('…and exactly ONE occurrence is armed with the OS',
    (st().reminderNotifIds[oneOff.id] || []).length === 1,
    JSON.stringify(st().reminderNotifIds));

  // ── repeating ──
  resetReminders();
  const weekly = await st().scheduleReminder({
    title: 'Weekly review', repeat: REPEAT.WEEKLY, anchorAt: Date.now() + 2 * HOUR,
  });
  check(`weekly: QUEUE_DEPTH (${QUEUE_DEPTH}) occurrences armed at once`,
    (st().reminderNotifIds[weekly.id] || []).length === QUEUE_DEPTH,
    `${(st().reminderNotifIds[weekly.id] || []).length}`);
  check('…as ONE record, not one per occurrence', st().reminders.length === 1);

  // A reminder the OS can't accept must not be listed as pending — that would be
  // the app confidently showing a reminder nothing will ever deliver.
  resetReminders();
  const past = await st().scheduleReminder({
    title: 'Already gone', repeat: REPEAT.ONCE, anchorAt: Date.now() - HOUR,
  });
  check('a past one-off schedules nothing AND records nothing',
    past === null && st().reminders.length === 0);

  // ── cancel ──
  resetReminders();
  const doomed = await st().scheduleReminder({
    title: 'Cancel me', repeat: REPEAT.MONTHLY, anchorAt: Date.now() + 3 * HOUR,
  });
  await st().cancelReminder(doomed.id);
  check('cancel drops the record and its armed ids',
    st().reminders.length === 0 && !st().reminderNotifIds[doomed.id]);

  // ── edit (replaceId) ──
  resetReminders();
  const first = await st().scheduleReminder({
    title: 'v1', repeat: REPEAT.ONCE, anchorAt: Date.now() + 4 * HOUR,
  });
  const edited = await st().scheduleReminder({
    title: 'v2', repeat: REPEAT.ONCE, anchorAt: Date.now() + 5 * HOUR, replaceId: first.id,
  });
  check('editing keeps ONE record under the same id, with the new values',
    st().reminders.length === 1 && edited.id === first.id && st().reminders[0].title === 'v2',
    `${st().reminders.length} record(s)`);

  // ── reconcile ──
  // Spent one-off + a repeat whose armed ids are gone (what a restore looks like:
  // records come back from the backup, notification ids deliberately don't).
  resetReminders();
  useStore.setState({
    reminders: [
      { id: 'r_spent',  kind: 'custom', title: 'Spent',  repeat: REPEAT.ONCE,    anchorAt: Date.now() - HOUR, createdAt: 0 },
      { id: 'r_live',   kind: 'custom', title: 'Live',   repeat: REPEAT.ONCE,    anchorAt: Date.now() + HOUR, createdAt: 0 },
      { id: 'r_repeat', kind: 'custom', title: 'Repeat', repeat: REPEAT.MONTHLY, anchorAt: Date.now() + 2 * HOUR, createdAt: 0 },
    ],
    reminderNotifIds: { r_live: ['notif_keep'] },
  });
  await st().reconcileReminders();

  const ids = st().reminders.map((r) => r.id).sort();
  check('reconcile drops the spent one-off', !ids.includes('r_spent'), ids.join(','));
  check('…keeps the pending one-off and the repeat',
    ids.includes('r_live') && ids.includes('r_repeat'), ids.join(','));
  check('…re-arms the repeat whose ids were lost (restore path)',
    (st().reminderNotifIds.r_repeat || []).length === QUEUE_DEPTH,
    JSON.stringify(st().reminderNotifIds.r_repeat));
  check('…and leaves an already-armed reminder alone',
    (st().reminderNotifIds.r_live || []).length === 1);
  check('…while clearing the dropped record\'s id entry', !st().reminderNotifIds.r_spent);

  // Nothing to do must stay cheap and side-effect free.
  resetReminders();
  await st().reconcileReminders();
  check('reconcile on an empty registry is a no-op', st().reminders.length === 0);

  // ── person-scoped reminders keep the balance they are ABOUT ──
  // The form emphasises the amount and the name ("Remind yourself to pay ₹1,200
  // to Rahul") and composes the notification body from the same two values, so
  // both have to survive on the record — losing them is what turned the form
  // into a blank alarm the first time round.
  resetReminders();
  const lb = await st().scheduleReminder({
    kind: 'lb_borrow', title: 'Pay Rahul', body: 'You owe ₹1,200 to Rahul',
    repeat: REPEAT.ONCE, anchorAt: Date.now() + 6 * HOUR,
    sourceKey: 'rahul:9876543210', amount: 1200, person: 'Rahul',
  });
  check('a person-scoped reminder stores the amount and the person',
    lb.amount === 1200 && lb.person === 'Rahul', JSON.stringify(lb));
  check('…and the personKey, so the LB bell can tell one is already set',
    lb.sourceKey === 'rahul:9876543210');

  // Re-arming must carry them through, or an edit after a restore would show a
  // reminder with no idea what it was about.
  useStore.setState({ reminderNotifIds: {} });
  await st().reconcileReminders();
  const rearmed = st().reminders.find((r) => r.kind === 'lb_borrow');
  check('reconcile re-arms it WITHOUT dropping amount/person',
    rearmed?.amount === 1200 && rearmed?.person === 'Rahul', JSON.stringify(rearmed));

  // A custom reminder carries neither — the fields are absent, not null, so the
  // record stays clean for the common case.
  resetReminders();
  const plain = await st().scheduleReminder({
    title: 'Water the plants', repeat: REPEAT.ONCE, anchorAt: Date.now() + HOUR,
  });
  check('a custom reminder carries no balance fields at all',
    !('amount' in plain) && !('person' in plain), JSON.stringify(plain));

  // ── the OS refusing must never EAT an existing reminder ──
  // Found by cross-checking, not by a failure: `scheduleReminder` used to cancel
  // the record it was replacing BEFORE it knew the new occurrences had been
  // accepted. Since `reconcileReminders` re-arms repeats on every launch, that
  // meant revoking notification permission silently deleted every repeating
  // reminder the user had. New occurrences are armed first now.
  resetReminders();
  const keeper = await st().scheduleReminder({
    title: 'Rent', repeat: REPEAT.MONTHLY, anchorAt: Date.now() + 5 * HOUR,
  });
  check('(setup) the reminder exists and is armed', !!keeper && st().reminders.length === 1);

  globalThis.__notifDenied = true;                 // permission revoked
  useStore.setState({ reminderNotifIds: {} });     // …and its ids are gone
  await st().reconcileReminders();
  check('permission revoked: the reminder RECORD survives reconcile',
    st().reminders.length === 1 && st().reminders[0].id === keeper.id,
    `${st().reminders.length} left`);
  check('…and is simply left unarmed, not half-written',
    (st().reminderNotifIds[keeper.id] || []).length === 0);

  // …and it re-arms itself once permission comes back, with no user action.
  globalThis.__notifDenied = false;
  await st().reconcileReminders();
  check('permission restored: it re-arms on the next launch',
    (st().reminderNotifIds[keeper.id] || []).length === QUEUE_DEPTH,
    JSON.stringify(st().reminderNotifIds[keeper.id]));

  // Same guarantee on the EDIT path: a refused edit leaves the original intact.
  globalThis.__notifDenied = true;
  const refused = await st().scheduleReminder({
    title: 'Rent (edited)', repeat: REPEAT.MONTHLY,
    anchorAt: Date.now() + 9 * HOUR, replaceId: keeper.id,
  });
  globalThis.__notifDenied = false;
  check('a refused EDIT returns null and keeps the original reminder',
    refused === null && st().reminders.length === 1 && st().reminders[0].title === 'Rent',
    JSON.stringify(st().reminders.map((r) => r.title)));
  check('…still armed from before, not stripped by the failed edit',
    (st().reminderNotifIds[keeper.id] || []).length === QUEUE_DEPTH);
}

// ── A card bill is MIRRORED onto the Reminders screen ───────────────────────
// The write happens in a `.then()` on the scheduler whose `.catch(() => {})`
// SWALLOWS whatever throws inside it, so this feature could be completely dead
// and silent. It was: `formatCurrency` wasn't imported in the store, that line
// threw, and no test noticed because none asserted the record existed.
//
// The due date is computed from real "now" rather than hardcoded, because
// `ccReminderFireAt` correctly returns null for a bill that is already due — the
// other CC-bill fixtures in this file use past dates and legitimately mirror
// nothing.
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ reminders: [], reminderNotifIds: {}, ccBills: {}, ccDueReminderIds: {} });
  useStore.getState().addAccount({ name: 'Axis Card', type: 'Credit Card', mask: '4321', bankName: 'Axis', balance: -2000 });

  const due = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  const dueStr = `${p2(due.getDate())}-${p2(due.getMonth() + 1)}-${due.getFullYear()}`; // DD-MM-YYYY
  ingest('AXISBK', `Total Amount Due on your Axis Credit Card ending 4321 for statement dt 20-08-2026 is Rs.7,500.00. Payment due date: ${dueStr}.`,
    { smsId: 'bill-future-1' });
  await new Promise((r) => setTimeout(r, 0));   // the mirror lands in a .then()

  const ccRem = (st().reminders || []).filter((r) => r.kind === 'cc_bill');
  check('a future card bill is mirrored into the reminder registry',
    ccRem.length === 1, JSON.stringify(st().reminders));
  check('…with the amount in its body',
    /7,500|7500/.test(ccRem[0]?.body || ''), JSON.stringify(ccRem[0]));
  check('…and a fire time BEFORE the due date (it warns the day before)',
    ccRem[0]?.anchorAt > Date.now() && ccRem[0]?.anchorAt < due.getTime(),
    `${ccRem[0]?.anchorAt} vs due ${due.getTime()}`);
  check('…carrying its OS id, so cancelling from the screen really cancels it',
    ((st().reminderNotifIds || {})[ccRem[0]?.id] || []).length === 1,
    JSON.stringify(st().reminderNotifIds));

  // Cancelling from the Reminders screen must also release the ingest dedupe
  // index, or the next bill for this card would be silently skipped.
  const ccKey = ccRem[0].sourceKey;
  check('(setup) the bill is indexed in ccDueReminderIds', !!(st().ccDueReminderIds || {})[ccKey],
    JSON.stringify(st().ccDueReminderIds));
  await st().cancelReminder(ccRem[0].id);
  check('cancelling a card-bill reminder clears that index too',
    !(st().ccDueReminderIds || {})[ccKey], JSON.stringify(st().ccDueReminderIds));

  // Silenced by the switch → no reminder, and nothing half-written either.
  reset();
  useStore.setState({
    reminders: [], reminderNotifIds: {}, ccBills: {}, ccDueReminderIds: {},
    notificationPrefs: { ccBillDue: false },
  });
  useStore.getState().addAccount({ name: 'Axis Card', type: 'Credit Card', mask: '4321', bankName: 'Axis', balance: -2000 });
  ingest('AXISBK', `Total Amount Due on your Axis Credit Card ending 4321 for statement dt 20-08-2026 is Rs.7,500.00. Payment due date: ${dueStr}.`,
    { smsId: 'bill-future-2' });
  await new Promise((r) => setTimeout(r, 0));
  check('with the bill-due nudge OFF, no reminder is scheduled or listed',
    (st().reminders || []).filter((r) => r.kind === 'cc_bill').length === 0
    && Object.keys(st().ccDueReminderIds || {}).length === 0,
    JSON.stringify(st().reminders));
  // …but the bill itself is still tracked: the switch silences the nudge, it does
  // not stop the app knowing you owe money.
  check('…yet the bill is still recorded in ccBills', Object.keys(st().ccBills || {}).length === 1,
    JSON.stringify(st().ccBills));
  useStore.setState({ notificationPrefs: {} });
}

// ── Per-nudge on/off switches actually gate the OS notification ──────────────
// The switch suppresses the PUSH only, never the in-app feed entry — the bell is
// a log you open on purpose. Both halves are asserted, because "it went quiet"
// is exactly as easy to achieve by accidentally deleting the feed entry too.
{
  const st = () => useStore.getState();
  const notifCalls = () => (globalThis.__notifCalls || []);
  const armNudge = (prefs) => {
    reset();
    useStore.setState({ notificationPrefs: prefs, budgetBreachNotified: {} });
    globalThis.__notifCalls = [];
  };

  // A budget breach is the easiest gate to drive end-to-end: set a ₹100 cap and
  // spend ₹500 on it.
  const breach = () => {
    useStore.setState({
      budget: { totalCap: 100, perCategory: { food: 100 }, createdAt: new Date().toISOString() },
    });
    useStore.getState().addTransaction({
      amount: 500, type: 'debit', merchant: 'Swiggy', categoryId: 'food',
      createdAt: new Date(T0).toISOString(),
    });
    useStore.getState().checkBudgetBreach?.();
  };

  armNudge({ budgetBreach: true });
  breach();
  check('breach nudge ON: the OS notification fires',
    notifCalls().includes('budgetBreach'), notifCalls().join(','));

  armNudge({ budgetBreach: false });
  breach();
  check('breach nudge OFF: no OS notification',
    !notifCalls().includes('budgetBreach'), notifCalls().join(','));

  // An unknown/absent pref must never silence a nudge — that's the upgrade path
  // for every existing user, whose persisted prefs predate these keys.
  armNudge({});
  breach();
  check('a pref that was never written defaults to ON',
    notifCalls().includes('budgetBreach'), notifCalls().join(','));
}

// ─────────────────────────────────────────────────────────────────────────────
// GOAL AUTO-FUNDING FROM A SUB-CATEGORY (Sep-13-26)
// -----------------------------------------------------------------------------
// The user's framing, and the reason this works at all: "we never always be able
// to categorise transaction correctly, that's why we have this categorisation
// modal". An SMS gets a row only as far as `food`; the review queue is where the
// user files it under Restaurants. A goal mapped to Restaurants must then read
// THAT — the user's own correction — not the parser's coarser guess.
//
// Asserted through the real store (not just the pure matcher) because the funding
// path also filters on countsForSpend / memo / month before it ever matches.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });

  const diningOut = st().addGoal({
    name: 'Eat Out Less', emoji: '🍽️', kind: 'saving',
    autoRule: { parentIds: [], categoryIds: ['restaurants'], merchants: [] },
  });

  // Exactly what the queue produces: flat `food` from the parser, plus the child
  // the user picked. Three rows, only ONE of them filed as Restaurants.
  st().addTransaction({ amount: 1200, type: 'debit', merchant: 'Some Diner',
    categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Restaurants' });
  st().addTransaction({ amount: 800, type: 'debit', merchant: 'Swiggy',
    categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Food Delivery' });
  st().addTransaction({ amount: 500, type: 'debit', merchant: 'Unknown UPI',
    categoryId: 'food' });

  const funded = st().getGoalPlanUsage?.()?.perGoal?.[diningOut]?.funded
    ?? st().getGoalTransactions(diningOut).reduce((n, t) => n + t.amount, 0);
  check('a goal mapped to Restaurants funds from the row the USER filed there',
    funded === 1200, `got ${funded}`);

  const rows = st().getGoalTransactions(diningOut);
  check('…and takes only that row — a sibling child must not leak in',
    rows.length === 1 && rows[0].amount === 1200,
    rows.map((r) => `${r.merchant}:${r.amount}`).join(','));
  check('…so an unfiled Food row is left for a parent-level goal to claim',
    !rows.some((r) => r.merchant === 'Unknown UPI'));

  // The parent rule is unchanged by any of this: it still sweeps everything.
  reset();
  useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });
  const allFood = st().addGoal({
    name: 'Food budget', emoji: '🍔', kind: 'saving',
    autoRule: { parentIds: ['food'], categoryIds: [], merchants: [] },
  });
  st().addTransaction({ amount: 1200, type: 'debit', merchant: 'Some Diner',
    categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Restaurants' });
  st().addTransaction({ amount: 500, type: 'debit', merchant: 'Unknown UPI', categoryId: 'food' });
  check('a parent-level goal still takes filed AND unfiled rows alike',
    st().getGoalTransactions(allFood).length === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// WIDENING A LIVE GOAL COUNTS FROM THE DAY IT WAS WIDENED (Sep-13-26)
// -----------------------------------------------------------------------------
// "yes we can have it like this, specifing to user that these counts now on."
// A rule edit is ADD-ONLY and each addition is stamped, so a goal's number can
// only grow FORWARDS from the edit — never restate what it was already worth.
//
// Dated explicitly rather than leaning on wall-clock ordering: both the stamp and
// a transaction added moments earlier land in the same millisecond in a fast run.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });

  const id = st().addGoal({
    name: 'Wheels', emoji: '🚗', kind: 'saving', duration: 'oneTime', lifetimeTarget: 200000,
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  const goalCreatedAt = st().goals.find((g) => g.id === id).createdAt;
  st().updateGoal(id, { autoRule: { parentIds: ['fuel'], categoryIds: [], merchants: [] } });
  const stamp = st().goals.find((g) => g.id === id).autoRule.addedAt.fuel;
  check('widening a live goal keeps the original entry and stamps the new one',
    st().goals.find((g) => g.id === id).autoRule.parentIds.join(',') === 'investments,fuel' && !!stamp);

  // One fuel row BEFORE the widening, one AFTER — same category, same month.
  const before = new Date(Date.parse(stamp) - 60 * 60 * 1000).toISOString();
  const after  = new Date(Date.parse(stamp) + 60 * 60 * 1000).toISOString();
  useStore.setState({
    transactions: [
      { id: 'fuel_before', amount: 3000, type: 'debit', merchant: 'HP', categoryId: 'fuel', createdAt: before },
      { id: 'fuel_after',  amount: 2000, type: 'debit', merchant: 'HP', categoryId: 'fuel', createdAt: after  },
    ],
  });
  check('an added category counts spend from the day it was added…',
    st().getGoalFunded(id) === 2000, `${st().getGoalFunded(id)}`);
  check('…and never reaches back over spend from before it',
    !st().getGoalTransactions(id).some((t) => t.id === 'fuel_before'));

  // The entry the goal was CREATED with is stamped with the GOAL's own
  // createdAt (Sep-16-26) — so it counts everything from THEN on, unaffected
  // by the later widening, but not from before the goal itself existed.
  const afterGoalCreated = new Date(Date.parse(goalCreatedAt) + 1000).toISOString();
  const beforeGoalCreated = new Date(Date.parse(goalCreatedAt) - 60 * 60 * 1000).toISOString();
  useStore.setState({
    transactions: [{
      id: 'sip_new', amount: 7000, type: 'debit', merchant: 'Groww', categoryId: 'investments',
      createdAt: afterGoalCreated,
    }],
  });
  check('…the original entry keeps counting everything from the GOAL\'s own creation on',
    st().getGoalFunded(id) === 7000, `${st().getGoalFunded(id)}`);

  useStore.setState({
    transactions: [{
      id: 'sip_old', amount: 7000, type: 'debit', merchant: 'Groww', categoryId: 'investments',
      createdAt: beforeGoalCreated,
    }],
  });
  check('…but not from before the goal itself existed',
    st().getGoalFunded(id) === 0, `${st().getGoalFunded(id)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME GOALS RE-DERIVE A CLOSED MONTH (Sep-13-26)
// -----------------------------------------------------------------------------
// "for a one time goals person might change in previous transactions, should we
// not consider it?" — yes. A recurring goal's month is a closed unit ("I put
// ₹5,000 in during August"), but a one-time goal's number is a LIFETIME total
// against a target, so a category corrected in the review queue afterwards has
// to move it.
//
// Bounded by compaction, which drops transactions individually at
// `now - RAW_RETENTION_MS` (90 days): only a month still ENTIRELY inside that
// window can be re-derived, or the rescan silently undercounts a half-compacted
// month — the very failure the snapshot exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  const mkOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const now = new Date();
  // Previous month: closed, but well inside the 90-day raw window.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const prevMk = mkOf(prev);

  const seed = (duration) => {
    reset();
    useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });
    const id = st().addGoal({
      name: 'New laptop', emoji: '💻', kind: 'saving', duration,
      lifetimeTarget: 100000,
      autoRule: { parentIds: [], categoryIds: ['electronics'], merchants: [] },
    });
    // Backdated so the goal genuinely existed before `prev` — a ONE-TIME
    // goal's rule is gated by its own createdAt (Sep-16-26), so re-deriving
    // a month from before the goal existed would otherwise correctly read 0,
    // which is a different case than what this test means to check.
    const longAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
    useStore.setState({
      goals: st().goals.map((g) => (g.id === id
        ? { ...g, createdAt: longAgo, autoRule: { ...g.autoRule, addedAt: { electronics: longAgo } } }
        : g)),
    });
    // The snapshot says the month closed at 0 — nothing was filed under
    // Electronics at the time.
    useStore.setState({
      goalHistory: { [prevMk]: { salary: 0, perGoal: { [id]: { planned: 0, funded: 0 } }, closedAt: prev.toISOString() } },
      // …but the raw row is still there, and the user has since corrected it in
      // the review queue: parser said `shopping`, they filed it as Electronics.
      transactions: [{
        id: 'late_fix', amount: 42000, type: 'debit', merchant: 'Croma',
        categoryId: 'shopping', parentCategory: 'Shopping', childCategory: 'Electronics',
        createdAt: prev.toISOString(), source: 'sms', isReviewed: true,
      }],
    });
    return id;
  };

  const oneTime = seed('oneTime');
  check('a ONE-TIME goal re-derives a closed month, so a late correction counts',
    st().getGoalLifetimeSaved(oneTime) === 42000, `${st().getGoalLifetimeSaved(oneTime)}`);

  const recurring = seed('recurring');
  check('…while a RECURRING goal keeps its closed month frozen at the snapshot',
    st().getGoalLifetimeSaved(recurring) === 0, `${st().getGoalLifetimeSaved(recurring)}`);

  // Past the raw window the snapshot is the only record left, so even a one-time
  // goal must trust it — re-deriving a half-compacted month undercounts.
  const old = new Date(now.getFullYear(), now.getMonth() - 6, 15);
  const oldMk = mkOf(old);
  const stale = seed('oneTime');
  useStore.setState({
    goalHistory: { [oldMk]: { salary: 0, perGoal: { [stale]: { planned: 0, funded: 9000 } }, closedAt: old.toISOString() } },
    transactions: [],
  });
  check('…and a month past the raw window still trusts its snapshot',
    st().getGoalLifetimeSaved(stale) === 9000, `${st().getGoalLifetimeSaved(stale)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE GOAL CONGRATULATION IS CLAIMED ON DISMISS, NOT ON RENDER (Sep-13-26)
// -----------------------------------------------------------------------------
// Reported twice: "not seeing the congratulations banner when goal value
// reached", then "again when i added from goals screen, did not see the
// celebration modal". Two different causes (an unfocused screen; another modal
// animating over it) with ONE shape — showing the modal was what consumed it, so
// anything that stopped it reaching the screen destroyed it permanently.
//
// Split in two: `achievedAt` is a fact about the money (and drives the badge),
// `celebratedAt` records that the user was actually TOLD, and only that gates the
// modal. A congratulation that never arrives simply comes back.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });
  const id = st().addGoal({
    name: 'Laptop', emoji: '💻', kind: 'saving', duration: 'oneTime', lifetimeTarget: 50000,
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().addGoalContribution(id, 60000, new Date().toISOString());

  check('a goal past its target is offered for celebration',
    st().getNewlyAchievedGoals().some((g) => g.goalId === id));

  // What the OLD code did on render. It must NOT consume the celebration.
  st().markGoalAchieved(id, { bonusAwarded: true });
  check('marking it achieved does NOT use up the congratulation',
    st().getNewlyAchievedGoals().some((g) => g.goalId === id));
  check('…and it reports the bonus as already paid, so a re-show cannot pay twice',
    st().getNewlyAchievedGoals().find((g) => g.goalId === id).bonusAlreadyAwarded === true);
  check('…while the goal still counts as achieved for the badge',
    !!st().goals.find((g) => g.id === id).achievedAt);

  // Only the user actually seeing it ends the offer.
  st().markGoalCelebrated(id);
  check('dismissing the modal is what ends it',
    !st().getNewlyAchievedGoals().some((g) => g.goalId === id));
  check('…and that is one-directional, so it cannot re-fire later',
    (() => {
      st().markGoalCelebrated(id);
      return st().getNewlyAchievedGoals().length === 0;
    })());

  // A goal STRANDED by the old behaviour — achieved and paid, never celebrated —
  // heals itself rather than staying silent forever.
  useStore.setState({
    goals: st().goals.map((g) => (g.id === id ? { ...g, celebratedAt: null } : g)),
  });
  check('a goal stranded by the old mark-on-render behaviour is offered again',
    st().getNewlyAchievedGoals().some((g) => g.goalId === id));
}

// ─────────────────────────────────────────────────────────────────────────────
// A RECURRING GOAL CELEBRATES ITS MONTHLY AMOUNT (Sep-14-26)
// -----------------------------------------------------------------------------
// "i still dont see the congrats goal banner" — reported four times, and none of
// the modal-plumbing fixes could ever have helped, because the goal was
// RECURRING. `GoalFormScreen` force-clears `lifetimeTarget` on a recurring goal,
// and `getNewlyAchievedGoals` required `lifetimeTarget > 0`: there was no finish
// line to cross, so the banner was unreachable BY CONSTRUCTION.
//
// A recurring goal's finish line is THIS MONTH's committed amount
// (`goalPlan.allocations[goalId]`), celebrated once a month.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  const thisMk = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });

  const id = st().addGoal({
    name: 'Rainy day', emoji: '☔', kind: 'saving', duration: 'recurring',
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  check('a recurring goal genuinely has no lifetime target',
    !st().goals.find((g) => g.id === id).lifetimeTarget);

  st().setGoalPlan({ salary: 100000, allocations: { [id]: 5000 } });
  check('…so before this it could never be congratulated at all',
    !!st().goalPlan && st().getNewlyAchievedGoals().length === 0);

  st().addGoalContribution(id, 5000, new Date().toISOString());
  const hit = st().getNewlyAchievedGoals().find((g) => g.goalId === id);
  check('meeting the month\'s committed amount IS its finish line',
    !!hit && hit.kind === 'monthly' && hit.target === 5000, JSON.stringify(hit));
  // Recurring goals genuinely PAY now (Sep-14-26 reward rework) — a fresh
  // monthly completion is eligible, same as a lifetime one freshly reached.
  check('…and a fresh monthly completion is eligible for its own bonus',
    hit.bonusAlreadyAwarded === false);

  st().markGoalMonthlyBonusAwarded(id, hit.monthKey);
  check('…paying it stamps bonusAwardedMonth for THIS month',
    st().goals.find((g) => g.id === id).bonusAwardedMonth === hit.monthKey);
  check('…so re-showing the SAME month never re-pays it',
    st().getNewlyAchievedGoals().find((g) => g.goalId === id).bonusAlreadyAwarded === true);
  check('…while the goal still counts as met for the badge/modal',
    st().getNewlyAchievedGoals().some((g) => g.goalId === id));

  st().markGoalCelebrated(id, { monthKey: hit.monthKey });
  check('…celebrated once for the month, not once per render',
    !st().getNewlyAchievedGoals().some((g) => g.goalId === id));
  check('…and the stamp records WHICH month, so next month is a fresh one',
    st().goals.find((g) => g.id === id).celebratedMonth === thisMk);

  // Next month's commitment is its own finish line.
  useStore.setState({ goals: st().goals.map((g) => (g.id === id ? { ...g, celebratedMonth: '2000-01' } : g)) });
  check('a new month can be celebrated again',
    st().getNewlyAchievedGoals().some((g) => g.goalId === id));
  // A goal STRANDED the same way `achievedAt`/`bonusAwardedAt` can be (paid,
  // never seen) still must not re-pay — `bonusAwardedMonth` is untouched by
  // faking `celebratedMonth` alone, so the re-offered congratulation still
  // reports itself as already paid for THIS real month.
  check('…but a re-offered (unseen) congratulation for the SAME real month still reports itself paid',
    st().getNewlyAchievedGoals().find((g) => g.goalId === id).bonusAlreadyAwarded === true);
  // A genuinely NEW month resets eligibility on both counts.
  useStore.setState({ goals: st().goals.map((g) => (g.id === id ? { ...g, bonusAwardedMonth: '2000-01' } : g)) });
  check('…while a genuinely new month is eligible for its own bonus again',
    st().getNewlyAchievedGoals().find((g) => g.goalId === id).bonusAlreadyAwarded === false);

  // Under the commitment it is not done, and no plan means no commitment at all.
  useStore.setState({ goalPlan: { ...st().goalPlan, allocations: { [id]: 9000 } } });
  check('short of the month\'s amount is not a finish line',
    !st().getNewlyAchievedGoals().some((g) => g.goalId === id));
  useStore.setState({ goalPlan: { ...st().goalPlan, allocations: { [id]: 0 } } });
  check('…and a goal with no monthly amount has nothing to reach',
    !st().getNewlyAchievedGoals().some((g) => g.goalId === id));
}

// ─────────────────────────────────────────────────────────────────────────────
// RAISING A RECURRING GOAL'S MONTHLY AMOUNT RESETS THIS MONTH'S CELEBRATION
// (Sep-14-26)
// -----------------------------------------------------------------------------
// A recurring goal's finish line is `goalPlan.allocations[goalId]` — raise it
// after the OLD amount was already celebrated this month and the stamp would
// keep blocking the modal even though the goal is no longer actually funded
// up to its (now higher) commitment. Lowering it needs no reset: the goal
// already cleared a bar at least as high as the new one.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  const thisMk = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });

  const id = st().addGoal({
    name: 'Rainy day', emoji: '☔', kind: 'saving', duration: 'recurring',
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 5000 } });
  st().markGoalCelebrated(id, { monthKey: thisMk });
  check('a celebrated month starts out blocking the modal',
    !st().getNewlyAchievedGoals().some((g) => g.goalId === id));

  st().updateGoalAllocation(id, 8000);
  check('raising the monthly figure clears this month\'s celebration…',
    st().goals.find((g) => g.id === id).celebratedMonth == null);
  check('…so a goal short of the NEW amount is correctly not-yet-done',
    !st().getNewlyAchievedGoals().some((g) => g.goalId === id));

  st().markGoalCelebrated(id, { monthKey: thisMk });
  st().updateGoalAllocation(id, 3000);
  check('lowering it does NOT reset the celebration — already cleared a higher bar',
    st().goals.find((g) => g.id === id).celebratedMonth === thisMk);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ALLOCATION BAR'S OWN COMMIT PATH GETS THE SAME RESET (Sep-14-26)
// -----------------------------------------------------------------------------
// The stepper/drag bar on GoalsScreen never calls `updateGoalAllocation` — it
// edits a LOCAL draft and commits the whole allocations map in one
// `setGoalPlan` on Save. The celebratedMonth reset added there for the form's
// path does nothing here unless `setGoalPlan` does its own version.
//
// One-time goals need no special case: their completion reads lifetime
// contributions, never `goalPlan.allocations`, so `celebratedMonth` is never
// set on one and this whole reset is a no-op for them by construction.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  const thisMk = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });

  const id = st().addGoal({
    name: 'Rainy day', emoji: '☔', kind: 'saving', duration: 'recurring',
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  const oneTimeId = st().addGoal({
    name: 'Laptop', emoji: '💻', kind: 'saving', duration: 'oneTime', lifetimeTarget: 50000,
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 5000, [oneTimeId]: 2000 } });
  st().markGoalCelebrated(id, { monthKey: thisMk });

  // The bar raises it in ONE commit (a whole new allocations map), not the
  // single-goal call `updateGoalAllocation` gets.
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 9000, [oneTimeId]: 2000 } });
  check('the bar\'s own commit clears a stale celebration on a raise',
    st().goals.find((g) => g.id === id).celebratedMonth == null);

  st().markGoalCelebrated(id, { monthKey: thisMk });
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 4000, [oneTimeId]: 2000 } });
  check('…but not on a lower amount — already cleared a higher bar',
    st().goals.find((g) => g.id === id).celebratedMonth === thisMk);

  check('a one-time goal is untouched by any of this — it has no celebratedMonth to begin with',
    st().goals.find((g) => g.id === oneTimeId).celebratedMonth == null);
}

// ─────────────────────────────────────────────────────────────────────────────
// A GOAL'S MONTHLY FIGURE CAN'T READ LESS THAN MONEY ALREADY IN — OR MOVE AT
// ALL ONCE COMPLETE (Sep-14-26)
// -----------------------------------------------------------------------------
// "am able to edit the monthly goal when goal achieved, it should be not
// allowed to lower its value below whats already contributed or if already
// completed". Enforced in the STORE (not just the screens that call it) —
// the same reason `autoRule` is add-only enforced in `updateGoal` rather than
// only in the form: a caller that skips a screen's validation must still
// land on a valid number, from EITHER write path onto this data
// (`updateGoalAllocation`, the form's single-goal call, and `setGoalPlan`,
// the bar's whole-draft commit).
//
// Revised TWICE the same day. First: a completed ONE-TIME goal was PINNED
// outright (no direction could move it) — reverted after "only allow to
// increase value for goal as in form" and a report that a full lock, applied
// only via a post-commit correction, was flaky in the BAR's live drag
// ("sometimes it comes back sometimes it's able to decrease": nothing
// floored the gesture WHILE it was live). Second: replaced with a RATCHET
// (floor = its own current value, raise-only) — reverted AGAIN after "what
// we can have is one time confirmation... or any better?": `rolloverGoalPlanIfNeeded`
// carries a goal's figure forward verbatim, so that ratchet's floor became
// PERMANENT across every future month, not just the one it was raised in,
// with no way back short of deleting the goal.
//
// Landed on ONE rule for every goal, achieved or not: the floor is simply
// what's actually been funded THIS month. That resets to 0 every new month
// on its own, so the permanence problem disappears with no new confirmation
// UI needed — and there was never an integrity reason for a stricter rule on
// an achieved goal anyway: `achievedAt` is fully decoupled from this number
// already (editing it can't un-achieve or fake-achieve a goal).
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });

  const id = st().addGoal({
    name: 'Rainy day', emoji: '☔', kind: 'saving', duration: 'recurring',
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 5000 } });
  st().addGoalContribution(id, 4000, new Date().toISOString());

  // updateGoalAllocation — the form's write path
  st().updateGoalAllocation(id, 1000);
  check('updateGoalAllocation refuses to read below what\'s already funded this month',
    st().goalPlan.allocations[id] === 4000, String(st().goalPlan.allocations[id]));
  st().updateGoalAllocation(id, 9000);
  check('…but rising above it is unaffected',
    st().goalPlan.allocations[id] === 9000);

  // setGoalPlan — the bar's whole-draft commit path
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 500 } });
  check('setGoalPlan enforces the same floor on a wholesale commit',
    st().goalPlan.allocations[id] === 4000, String(st().goalPlan.allocations[id]));
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 7000 } });
  check('…and does not interfere with a raise',
    st().goalPlan.allocations[id] === 7000);

  // A completed ONE-TIME goal gets the SAME rule — no special case, no
  // ratchet on its own value, just what's funded this month (0 here, since
  // nothing has been contributed toward it yet in THIS month).
  const oneTimeId = st().addGoal({
    name: 'Laptop', emoji: '💻', kind: 'saving', duration: 'oneTime', lifetimeTarget: 50000,
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 7000, [oneTimeId]: 3000 } });
  st().markGoalAchieved(oneTimeId, { bonusAwarded: true });

  st().updateGoalAllocation(oneTimeId, 0);
  check('a completed one-time goal CAN be lowered — no ratchet on its own value',
    (st().goalPlan.allocations[oneTimeId] ?? 0) === 0, String(st().goalPlan.allocations[oneTimeId]));
  st().updateGoalAllocation(oneTimeId, 9000);
  check('…and can still be raised, same as any goal',
    (st().goalPlan.allocations[oneTimeId] ?? 0) === 9000, String(st().goalPlan.allocations[oneTimeId]));

  // Fund it for real THIS month — now even a completed goal has an actual
  // floor, same as any goal would from real money moved.
  st().addGoalContribution(oneTimeId, 4000, new Date().toISOString());
  st().updateGoalAllocation(oneTimeId, 1000);
  check('once real money has moved this month, THAT is the floor — same as any goal',
    (st().goalPlan.allocations[oneTimeId] ?? 0) === 4000, String(st().goalPlan.allocations[oneTimeId]));

  st().setGoalPlan({ salary: 100000, allocations: { [id]: 7000, [oneTimeId]: 500 } });
  check('setGoalPlan enforces the identical floor on a wholesale commit',
    (st().goalPlan.allocations[oneTimeId] ?? 0) === 4000, String(st().goalPlan.allocations[oneTimeId]));

  // The permanence bug this whole revision fixes: rolling into a NEW month
  // must not carry the old figure forward as a floor — the point of dropping
  // the ratchet was that a completed goal's number is free to move in either
  // direction once the month itself is fresh, with zero funded so far.
  useStore.setState({
    goalPlan: { monthKey: '2099-01', salary: 100000, allocations: { [oneTimeId]: 9000 }, createdAt: new Date().toISOString(), lastEditedAt: new Date().toISOString() },
  });
  st().updateGoalAllocation(oneTimeId, 0);
  check('a NEW month starts with NO carried-over floor for a completed goal — the permanence bug is gone',
    (st().goalPlan.allocations[oneTimeId] ?? 0) === 0, String(st().goalPlan.allocations[oneTimeId]));
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCONTINUING A RECURRING GOAL (Sep-14-26)
// -----------------------------------------------------------------------------
// "what if a recurring monthly goal user now wants to discontinue, we don't
// give option for that". Unlike `deleteGoal`, this keeps the goal and its
// whole history — it just stops it from active planning: the current
// month's allocation is cleared, and AUTOMATIC matching stops (a manual
// top-up, a separate explicit path, is unaffected). `resumeGoal` undoes it.
//
// Scoped to RECURRING goals only — a one-time goal has `achievedAt` for
// "genuinely done," and giving up on one before that is what Delete is
// already for.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });

  const id = st().addGoal({
    name: 'SIP', emoji: '📈', kind: 'investment', duration: 'recurring',
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().setGoalPlan({ salary: 100000, allocations: { [id]: 5000 } });
  check('(setup) the goal starts with an allocation this month',
    st().goalPlan.allocations[id] === 5000);

  st().discontinueGoal(id);
  check('discontinuing clears its CURRENT allocation — no longer competing for room',
    !(id in st().goalPlan.allocations));
  check('…and stamps discontinuedAt',
    !!st().goals.find((g) => g.id === id).discontinuedAt);

  st().addTransaction({ amount: 4000, type: 'debit', categoryId: 'investments', merchant: 'Groww SIP' });
  check('automatic matching STOPS once discontinued — real spend no longer funds it',
    st().getGoalLifetimeSaved(id) === 0);

  const before = st().goalContributions.length;
  st().addGoalContribution(id, 2000, new Date().toISOString());
  check('a MANUAL top-up still works — an explicit action always wins over an implicit one',
    st().goalContributions.length === before + 1 && st().getGoalLifetimeSaved(id) === 2000);

  st().resumeGoal(id);
  check('resuming clears discontinuedAt — the goal is active again',
    !st().goals.find((g) => g.id === id).discontinuedAt);

  st().addTransaction({ amount: 1000, type: 'debit', categoryId: 'investments', merchant: 'Groww SIP' });
  // `discontinuedAt` gates LIVE, off the goal's CURRENT state — not a
  // recorded window excluding transactions from the paused period. Once
  // resumed, the EARLIER 4000 transaction (which happened while paused)
  // counts again too, same as the new 1000 one: 2000 manual + 4000 + 1000
  // auto. The alternative — permanently excluding anything that happened
  // during a pause — would need tracking discontinued PERIODS, not just a
  // timestamp, for a distinction a user would find confusing to explain
  // ("why doesn't Tuesday's SIP count just because I re-enabled this
  // Wednesday?").
  check('…and automatic matching resumes too, INCLUDING spend from the paused window',
    st().getGoalLifetimeSaved(id) === 7000, String(st().getGoalLifetimeSaved(id)));

  // A double-discontinue, or discontinuing a one-time goal, is a safe no-op.
  const oneTimeId = st().addGoal({
    name: 'Laptop', emoji: '💻', kind: 'saving', duration: 'oneTime', lifetimeTarget: 50000,
    autoRule: { parentIds: ['investments'], categoryIds: [], merchants: [] },
  });
  st().discontinueGoal(oneTimeId);
  check('discontinuing a ONE-TIME goal is a no-op — that duration never gets this field',
    !st().goals.find((g) => g.id === oneTimeId).discontinuedAt);

  st().discontinueGoal(id);
  st().discontinueGoal(id);
  check('discontinuing an already-discontinued goal does not error or double-stamp',
    !!st().goals.find((g) => g.id === id).discontinuedAt);
}

// ─────────────────────────────────────────────────────────────────────────────
// A GOAL'S OWN RP/EPC LEDGER (Sep-16-26)
// -----------------------------------------------------------------------------
// `creditGoalReward` is what lets GoalCard show what THIS goal has earned,
// separate from useRewardStore's global wallet. Additive-only, never negative.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, goalContributions: [], goalHistory: {}, transactions: [] });
  const id = st().addGoal({ name: 'SIP', emoji: '📈', kind: 'investment', duration: 'recurring' });

  check('a new goal starts with nothing earned',
    st().goals.find((g) => g.id === id).rpEarned === 0
    && st().goals.find((g) => g.id === id).epcEarned === 0);

  st().creditGoalReward(id, 20, 2);
  check('crediting adds to the goal\'s own ledger',
    st().goals.find((g) => g.id === id).rpEarned === 20
    && st().goals.find((g) => g.id === id).epcEarned === 2);

  st().creditGoalReward(id, 24, 2);
  check('…and a SECOND credit ADDS, it does not replace — this is a lifetime running total',
    st().goals.find((g) => g.id === id).rpEarned === 44
    && st().goals.find((g) => g.id === id).epcEarned === 4);

  st().creditGoalReward(id, -50, -50);
  check('a negative amount cannot claw back what was already earned',
    st().goals.find((g) => g.id === id).rpEarned === 44
    && st().goals.find((g) => g.id === id).epcEarned === 4);

  const otherId = st().addGoal({ name: 'Emergency Fund', emoji: '🛟', kind: 'saving', duration: 'recurring' });
  st().creditGoalReward(otherId, 12, 1);
  check('crediting one goal never touches another\'s ledger',
    st().goals.find((g) => g.id === id).rpEarned === 44
    && st().goals.find((g) => g.id === otherId).rpEarned === 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// A NEW GOAL DOES NOT SWEEP UP SPEND FROM BEFORE IT EXISTED (Sep-16-26)
// -----------------------------------------------------------------------------
// "new goal, category already has transactions, small target — real gap
// found". A ONE-TIME goal's rule is now gated by its own createdAt, same
// mechanism widening already used — otherwise a small target could be born
// already achieved from old category history. RECURRING is deliberately left
// ungated: its number is "this calendar month," and month-to-date spend from
// before the tracker was created is still genuinely that month's spend.
// ─────────────────────────────────────────────────────────────────────────────
{
  const st = () => useStore.getState();
  reset();
  useStore.setState({ goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {} });

  useStore.setState({
    transactions: [{
      id: 'old_electronics', amount: 8000, type: 'debit', merchant: 'Croma', categoryId: 'electronics',
      createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }],
  });

  const oneTime = st().addGoal({
    name: 'New Phone', emoji: '📱', kind: 'saving', duration: 'oneTime', lifetimeTarget: 5000,
    autoRule: { parentIds: [], categoryIds: ['electronics'], merchants: [] },
  });
  check('a ONE-TIME goal is NOT born already funded from spend that predates it',
    st().getGoalLifetimeSaved(oneTime) === 0);
  check('…so a small target is NOT born already achieved',
    !st().getNewlyAchievedGoals().some((a) => a.goalId === oneTime));

  st().setGoalPlan({ salary: 50000, allocations: { [oneTime]: 0 } });
  useStore.setState({
    transactions: [
      ...st().transactions,
      { id: 'new_electronics', amount: 6000, type: 'debit', merchant: 'Croma', categoryId: 'electronics',
        createdAt: new Date(Date.now() + 1000).toISOString() },
    ],
  });
  check('…but spend from AFTER the goal was created still counts, and can achieve it',
    st().getGoalLifetimeSaved(oneTime) === 6000
    && st().getNewlyAchievedGoals().some((a) => a.goalId === oneTime));

  const recurring = st().addGoal({
    name: 'Gadgets', emoji: '🎧', kind: 'saving', duration: 'recurring',
    autoRule: { parentIds: [], categoryIds: ['electronics'], merchants: [] },
  });
  check('a RECURRING goal DOES count this month\'s spend from before it was created',
    st().getGoalFunded(recurring) === 6000 + 8000);
}

// ── deleteAllUserData wipes EVERY partialize-persisted field ───────────────
// "Delete Account & Data" (docs/ANDROID_RELEASE.md §0.3/§7 item 10) — this is
// the test that makes the doc comment's claim ("modeled off partialize
// FIELD-FOR-FIELD") checkable rather than asserted. Written data-driven, not
// as 60 individual checks, specifically so `resetAll`'s own drift (missing
// goals/groups/googleAccount/hasOnboarded and a dozen more, found while
// building this) can't quietly happen again here — a field added to
// `partialize` without a matching default here fails LOUD, not silently.
{
  reset();
  // Dirty every persisted field with a non-default, distinguishable value.
  // hasOnboarded is DELIBERATELY dirtied too, to prove the action leaves it
  // alone — see deleteAllUserData's own doc comment for why that's required,
  // not incidental.
  useStore.setState({
    accounts: [{ id: 'a1' }],
    transactions: [{ id: 't1' }],
    archivedTransactions: [{ id: 'at1' }],
    monthlyAggregates: { '2026-01': {} },
    categories: [{ id: 'custom' }],
    customParents: [{ id: 'cp1' }],
    customChildren: [{ id: 'cc1' }],
    userCustomRules: { r1: {} },
    lentBorrowed: [{ id: 'lb1' }],
    groups: [{ id: 'g1' }],
    activeGroupZoneId: 'zone1',
    declinedAccountLinks: ['1111:2222'],
    excludedExpenseParents: ['bills'],
    goals: [{ id: 'goal1' }],
    goalPlan: { salary: 99999 },
    lastGoalPlan: { salary: 88888 },
    goalContributions: [{ id: 'gc1' }],
    goalHistory: { goal1: {} },
    userName: 'Dirty Name',
    userPhones: ['9999999999'],
    userOnboardedAt: 12345,
    smsAutoImport: true,
    lastSmsSync: 12345,
    lastSmsDate: 12345,
    lastCompactedAt: 12345,
    suppressedSmsIds: ['id1'],
    ccHandledSmsIds: ['id2'],
    ccBills: { '1111': {} },
    ccDueReminderIds: { '1111:x': 'notif' },
    ccCycleHeadsUpNotified: { a1: '2026-01' },
    pendingCCPayment: { fake: true },
    pendingCCPaymentQueue: [{ id: 'q1' }],
    manualTxnSeq: 42,
    smsPermissionGranted: true,
    contactsPermissionGranted: true,
    isLoggedIn: true,
    googleAccount: { email: 'dirty@example.com', name: 'Dirty', picture: null },
    sessionExpired: true,
    justDeletedAccount: false,
    themeId: 'carbon',
    darkMode: true,
    appLockEnabled: true,
    showWeeklySummary: false,
    weeklyRecapHandled: 'w1',
    pendingWeeklyRecap: { id: 'pw1' },
    showMonthlyRecap: false,
    recapMonthHandled: '2026-01',
    monthlyRecapCardDismissed: '2026-01',
    pendingMonthlyRecap: { id: 'pm1' },
    recapOptions: { includePrivate: false, includeGroups: false, includeTxnList: true },
    reminders: [{ id: 'r1' }],
    reminderNotifIds: { r1: 'n1' },
    notificationPrefs: {
      ccBillDue: false, ccCycleHeadsUp: false, ccPayment: false,
      subscriptionHike: false, budgetBreach: false, midmonthNudge: false,
      monthlyRecap: false,
    },
    subscriptionHikesNotified: ['sub1'],
    budget: { total: 50000 },
    budgetHistory: { '2026-01': {} },
    lastBudgetPlan: { total: 40000 },
    budgetStreak: { current: 5, best: 10, lastResetMonth: '2026-01' },
    budgetBreachNotified: { '2026-01': true },
    pendingCelebration: { id: 'pc1' },
    lastMidmonthNudgeMonth: '2026-01',
    xp: 999,
    welcomeReviewSeen: true,
    planBannerDismissed: true,
    reviewStreak: { current: 3, best: 7, lastReviewDate: '2026-01-01' },
    // The one field the action must NOT touch.
    hasOnboarded: true,
  });

  useStore.getState().deleteAllUserData();
  const s = useStore.getState();

  const expectedDefaults = {
    accounts: [], transactions: [], archivedTransactions: [], monthlyAggregates: {},
    customParents: [], customChildren: [], userCustomRules: {}, lentBorrowed: [],
    groups: [], activeGroupZoneId: null, declinedAccountLinks: [], excludedExpenseParents: [],
    goals: [], goalPlan: null, lastGoalPlan: null, goalContributions: [], goalHistory: {},
    userName: '', userPhones: [], userOnboardedAt: null, smsAutoImport: false,
    lastSmsSync: null, lastSmsDate: null, lastCompactedAt: null,
    suppressedSmsIds: [], ccHandledSmsIds: [], ccBills: {}, ccDueReminderIds: {},
    ccCycleHeadsUpNotified: {}, pendingCCPayment: null, pendingCCPaymentQueue: [],
    manualTxnSeq: 0, smsPermissionGranted: false, contactsPermissionGranted: false,
    isLoggedIn: false, googleAccount: null, sessionExpired: false, justDeletedAccount: true,
    darkMode: false, appLockEnabled: false,
    showWeeklySummary: true, weeklyRecapHandled: null, pendingWeeklyRecap: null,
    showMonthlyRecap: true, recapMonthHandled: null, monthlyRecapCardDismissed: null,
    pendingMonthlyRecap: null, reminders: [], reminderNotifIds: {},
    subscriptionHikesNotified: [], budget: null, budgetHistory: {}, lastBudgetPlan: null,
    budgetBreachNotified: {}, pendingCelebration: null, lastMidmonthNudgeMonth: null,
    xp: 0, welcomeReviewSeen: false, planBannerDismissed: false,
  };
  const mismatches = Object.entries(expectedDefaults)
    .filter(([k, v]) => JSON.stringify(s[k]) !== JSON.stringify(v))
    .map(([k]) => k);
  check('every simple-default field returns to its create()-time value',
    mismatches.length === 0, `still dirty: ${mismatches.join(', ')}`);

  check('categories reset to DEFAULT_CATEGORIES, not the dirtied list',
    Array.isArray(s.categories) && !s.categories.some((c) => c.id === 'custom') && s.categories.length > 1);
  check('themeId resets to the default theme, not the dirtied one',
    s.themeId !== 'carbon' && typeof s.themeId === 'string');
  check('recapOptions resets to its true default object',
    s.recapOptions.includePrivate === false && s.recapOptions.includeGroups === true && s.recapOptions.includeTxnList === false);
  check('notificationPrefs resets to all-on',
    Object.values(s.notificationPrefs).every((v) => v === true));
  check('budgetStreak resets to zeroed',
    s.budgetStreak.current === 0 && s.budgetStreak.best === 0 && s.budgetStreak.lastResetMonth === null);
  check('reviewStreak resets to zeroed',
    s.reviewStreak.current === 0 && s.reviewStreak.best === 0 && s.reviewStreak.lastReviewDate === null);

  check('hasOnboarded is left UNTOUCHED (still true) — LoginGate depends on this, not reset to false',
    s.hasOnboarded === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCOUNT REVAMP (Sep-26-26) — primary / includeInNetWorth / archived, and
// Credit Card creditLimit / statementBalance / minimumDue / paymentHistory.
// ═══════════════════════════════════════════════════════════════════════════

// ── v36 migration: backfill defaults, recover statementBalance from ccBills ──
{
  const migrate = useStore.persist.getOptions().migrate;
  const legacy = {
    accounts: [
      { id: 'a1', type: 'Bank', name: 'HDFC', mask: '1111', balance: 5000 },
      {
        id: 'a2', type: 'Credit Card', name: 'SBI Card', mask: '2222',
        bankName: 'SBI', balance: -1500,
      },
    ],
    ccBills: {
      2222: { amount: 1500, cardLast4: '2222', bankName: 'SBI' },
    },
  };
  const migrated = migrate(legacy, 35);
  const bank = migrated.accounts.find((a) => a.id === 'a1');
  const card = migrated.accounts.find((a) => a.id === 'a2');

  // v36 itself backfills `primary: false` for a plain account with no opinion
  // either way — but this migrate() call also runs every LATER version block up
  // to current, including v38's `ensurePrimary` invariant (never zero primary
  // while an active account exists), which promotes the first active account
  // (`a1`, the bank) since neither of these two had one set. That's the correct
  // end-to-end result, not a conflict between the two migrations.
  check('a plain account gets primary/includeInNetWorth/archived defaults (then v38 picks it as THE primary)',
    bank.primary === true && bank.includeInNetWorth === true && bank.archived === false && bank.archivedAt === null,
    JSON.stringify(bank));
  check('a Credit Card additionally gets creditLimit/minimumDue/paymentHistory defaults',
    card.creditLimit === null && card.minimumDue === null && Array.isArray(card.paymentHistory) && card.paymentHistory.length === 0,
    JSON.stringify(card));
  check('a Credit Card\'s statementBalance is backfilled from its existing ccBills entry',
    card.statementBalance === 1500, JSON.stringify(card));

  // A field already present (e.g. re-running the migration, or a value some
  // other path already wrote) must survive untouched, not get clobbered back.
  const already = migrate({
    accounts: [{ id: 'a3', type: 'Bank', name: 'ICICI', primary: true, includeInNetWorth: false, archived: true, archivedAt: 123 }],
  }, 35).accounts[0];
  check('an already-set field is left alone, not reset to the default',
    already.primary === true && already.includeInNetWorth === false && already.archived === true && already.archivedAt === 123,
    JSON.stringify(already));
}

// ── setPrimaryAccount — exclusive, null clears it entirely ──────────────────
{
  reset();
  const idA = useStore.getState().addAccount({ type: 'Bank', name: 'A', mask: '0001' });
  const idB = useStore.getState().addAccount({ type: 'Bank', name: 'B', mask: '0002' });

  useStore.getState().setPrimaryAccount(idA);
  let acc = useStore.getState().accounts;
  check('setPrimaryAccount marks the chosen account primary',
    acc.find((a) => a.id === idA).primary === true, JSON.stringify(acc));

  useStore.getState().setPrimaryAccount(idB);
  acc = useStore.getState().accounts;
  check('setting a new primary unsets the old one — only ONE is ever primary',
    acc.find((a) => a.id === idA).primary === false && acc.find((a) => a.id === idB).primary === true,
    JSON.stringify(acc));

  // `ensurePrimary` (the "never zero primary while an active account exists"
  // invariant) immediately re-picks a default here — the FIRST active account
  // (idA) — rather than leaving the app with none.
  useStore.getState().setPrimaryAccount(null);
  acc = useStore.getState().accounts;
  check('passing null reassigns primary to the first active account, never leaves none',
    acc.find((a) => a.id === idA).primary === true && acc.find((a) => a.id === idB).primary === false,
    JSON.stringify(acc));
}

// ── ensurePrimary invariant — never zero primary while an active account exists ──
{
  reset();
  const idA = useStore.getState().addAccount({ type: 'Bank', name: 'A', mask: '0001' });
  check('the FIRST account ever added is auto-promoted to primary',
    useStore.getState().accounts.find((a) => a.id === idA).primary === true,
    JSON.stringify(useStore.getState().accounts));

  const idB = useStore.getState().addAccount({ type: 'Bank', name: 'B', mask: '0002' });
  check('a SECOND account added does not steal primary from the first',
    useStore.getState().accounts.find((a) => a.id === idA).primary === true
      && useStore.getState().accounts.find((a) => a.id === idB).primary === false,
    JSON.stringify(useStore.getState().accounts));

  // Oct-10-26 user rule: the primary can't be archived — pick a new primary first.
  useStore.getState().archiveAccount(idA);
  let acc2 = useStore.getState().accounts;
  check('archiving the PRIMARY account is refused (pick another primary first)',
    acc2.find((a) => a.id === idA).archived !== true && acc2.find((a) => a.id === idA).primary === true,
    JSON.stringify(acc2));
  useStore.getState().setPrimaryAccount(idB);
  useStore.getState().archiveAccount(idA);
  acc2 = useStore.getState().accounts;
  check('…once another account is primary, it archives (and the new primary stays)',
    acc2.find((a) => a.id === idA).archived === true && acc2.find((a) => a.id === idB).primary === true,
    JSON.stringify(acc2));

  useStore.getState().unarchiveAccount(idA);
  useStore.getState().setPrimaryAccount(idA);
  useStore.getState().deleteAccount(idA);
  acc2 = useStore.getState().accounts;
  check('deleting the primary account promotes another active one automatically',
    acc2.length === 1 && acc2[0].id === idB && acc2[0].primary === true,
    JSON.stringify(acc2));
}

// ── setAccountColorKey — manual "Card Color" pick ────────────────────────────
{
  reset();
  const id = useStore.getState().addAccount({ type: 'Bank', name: 'A', mask: '0001' });
  check('a new account starts with no colorKey', useStore.getState().accounts[0].colorKey === null);

  useStore.getState().setAccountColorKey(id, 'HDFC');
  check('setAccountColorKey stores the picked key',
    useStore.getState().accounts.find((a) => a.id === id).colorKey === 'HDFC');

  useStore.getState().setAccountColorKey(id, null);
  check('passing null clears it back to automatic',
    useStore.getState().accounts.find((a) => a.id === id).colorKey === null);
}

// ── v39 migration: colorKey backfilled to null ───────────────────────────────
{
  const migrate = useStore.persist.getOptions().migrate;
  const legacy = { accounts: [{ id: 'a1', type: 'Bank', name: 'HDFC', mask: '1111', balance: 5000 }] };
  const migrated = migrate(legacy, 38);
  check('v39: an existing account without colorKey gets null, not undefined',
    migrated.accounts[0].colorKey === null, JSON.stringify(migrated.accounts[0]));

  const already = migrate({ accounts: [{ id: 'a2', type: 'Bank', name: 'X', colorKey: 'SBI' }] }, 38).accounts[0];
  check('v39: an already-set colorKey survives untouched', already.colorKey === 'SBI');
}

// ── setTransactionNote (Manage sheet's Note) ─────────────────────────────────
{
  reset();
  const id = 'note-1';
  useStore.setState({ transactions: [{ id, type: 'debit', amount: 100, source: 'sms', groupId: 'g1', createdAt: new Date().toISOString() }] });
  useStore.getState().setTransactionNote(id, '  team lunch  ');
  check('note is trimmed and saved, even on a group txn', useStore.getState().transactions[0].note === 'team lunch');
  useStore.getState().setTransactionNote(id, 'x'.repeat(500));
  check('note is capped at NOTE_MAX (140)', useStore.getState().transactions[0].note.length === 140);
  useStore.getState().setTransactionNote(id, '   ');
  check('a blank note removes the field', !('note' in useStore.getState().transactions[0]));
  check('…and leaves the rest of the txn alone', useStore.getState().transactions[0].groupId === 'g1');
}

// ── Ignore and Private are exclusive (v40) ───────────────────────────────────
{
  reset();
  const id = 'excl-1';
  useStore.setState({ transactions: [{ id, type: 'debit', amount: 100, source: 'manual', isHidden: true, createdAt: new Date().toISOString() }] });
  useStore.getState().ignoreTransaction(id);
  const t1 = useStore.getState().transactions.find((t) => t.id === id);
  check('ignoring a Private txn clears Private', t1.isIgnored && !t1.isHidden, JSON.stringify(t1));
  useStore.getState().setTransactionHidden(id, true);
  check('Private is refused on an ignored txn', !useStore.getState().transactions.find((t) => t.id === id).isHidden);
  useStore.getState().unignoreTransaction(id);
  useStore.getState().setTransactionHidden(id, true);
  check('…and allowed again once restored', useStore.getState().transactions.find((t) => t.id === id).isHidden === true);

  const migrate = useStore.persist.getOptions().migrate;
  const m = migrate({ transactions: [
    { id: 'b', isIgnored: true, isHidden: true },
    { id: 'h', isIgnored: false, isHidden: true },
  ], archivedTransactions: [{ id: 'ab', isIgnored: true, isHidden: true }] }, 39);
  check('v40: a txn that was both ignored + Private keeps Ignore, loses Private',
    m.transactions[0].isIgnored && !m.transactions[0].isHidden && !m.archivedTransactions[0].isHidden);
  check('v40: a plain Private txn is untouched', m.transactions[1].isHidden === true);
  const m2 = migrate({ groups: [{ id: 'g1', type: 'shared' }], transactions: [
    { id: 's', isIgnored: true, isSplit: true, splitWith: [{ name: 'Rohit' }] },
    { id: 'g', isIgnored: true, groupId: 'g1', groupSplit: { shares: [] } },
    { id: 'live', isIgnored: false, isSplit: true, splitWith: [{ name: 'Aman' }] },
  ] }, 39);
  check('v40: an already-ignored split / shared-group txn is cleaned for Restore',
    !m2.transactions[0].isSplit && !m2.transactions[1].groupId && !m2.transactions[1].groupSplit);
  check('v40: a live (not ignored) split is untouched', m2.transactions[2].isSplit === true);
}

// ── Ignore → Restore is CLEAN; groups take money OUT only ────────────────────
{
  reset();
  const S = () => useStore.getState();
  const acc = S().addAccount({ type: 'Bank', name: 'HDFC', mask: '1111', balance: 10000 });
  S().addTransaction({ type: 'debit', amount: 900, merchant: 'Dinner', categoryId: 'food', accountId: acc, skipGroupZone: true });
  const id = S().transactions[0].id;
  S().setTransactionSplit(id, [{ name: 'Rohit' }, { name: 'Aman' }], { mode: 'equal' });
  const lbFor = (tid) => S().lentBorrowed.filter((l) => l.sourceTxnId === tid).length;
  const tx = (tid) => S().transactions.find((t) => t.id === tid);
  check('split creates 2 Lent rows', lbFor(id) === 2);
  S().ignoreTransaction(id);
  check('ignoring a split drops its Lent rows AND the split itself', lbFor(id) === 0 && !tx(id).isSplit && tx(id).splitWith.length === 0);
  S().unignoreTransaction(id);
  check('restore brings back a clean full expense (no phantom split)', !tx(id).isSplit && lbFor(id) === 0 && S().accounts[0].balance === 9100,
    JSON.stringify({ isSplit: tx(id).isSplit, bal: S().accounts[0].balance }));

  const shared = S().createGroup({ name: 'Goa', type: 'shared', members: [{ memberId: 'c1', name: 'Rahul' }] });
  S().addTransaction({ type: 'debit', amount: 600, merchant: 'Hotel', categoryId: 'travel', accountId: acc, skipGroupZone: true });
  const gid = S().transactions.find((t) => t.merchant === 'Hotel').id;
  S().tagTransactionToGroup(gid, shared, { paidByMemberId: 'me', paidByName: 'You',
    shares: [{ memberId: 'me', shareAmount: 300 }, { memberId: 'c1', shareAmount: 300 }] });
  const total = () => S().groups.find((g) => g.id === shared).totalSpend;
  check('shared-group split books a Lent row + group spend', lbFor(gid) === 1 && total() === 600, `${lbFor(gid)} / ${total()}`);
  S().ignoreTransaction(gid);
  check('ignoring it leaves the shared group (tag + split) and its spend', !tx(gid).groupId && !tx(gid).groupSplit && total() === 0);
  S().unignoreTransaction(gid);
  check('restore does not re-add it to the group', !tx(gid).groupId && total() === 0 && lbFor(gid) === 0);

  const personal = S().createGroup({ name: 'Office', type: 'personal' });
  S().addTransaction({ type: 'debit', amount: 200, merchant: 'Lunch', categoryId: 'food', accountId: acc, skipGroupZone: true });
  const pid = S().transactions.find((t) => t.merchant === 'Lunch').id;
  S().tagTransactionToGroup(pid, personal);
  S().ignoreTransaction(pid);
  S().unignoreTransaction(pid);
  check('a PERSONAL group tag survives ignore → restore (no split to drop)', tx(pid).groupId === personal);

  S().addTransaction({ type: 'credit', amount: 500, merchant: 'Refund', categoryId: 'other', accountId: acc, skipGroupZone: true });
  const cid = S().transactions.find((t) => t.merchant === 'Refund').id;
  const before = total();
  S().tagTransactionToGroup(cid, shared);
  check('money IN never joins a group (no inflated group spend)', !tx(cid).groupId && total() === before);
}

// ── setIncludeInNetWorth + selectEPurseNetWorth skips archived/excluded ──────
{
  reset();
  const bankId = useStore.getState().addAccount({ type: 'Bank', name: 'Bank', mask: '1234', balance: 10000 });
  const cashId = useStore.getState().addAccount({ type: 'Cash', name: 'Cash', balance: 500 });

  check('both accounts count toward net worth by default',
    useStore.getState().getTotalBalance() === 10500, `${useStore.getState().getTotalBalance()}`);

  useStore.getState().setIncludeInNetWorth(cashId, false);
  check('excluding an account drops it from net worth',
    useStore.getState().getTotalBalance() === 10000, `${useStore.getState().getTotalBalance()}`);

  useStore.getState().setIncludeInNetWorth(cashId, true);
  useStore.getState().archiveAccount(cashId); // bank is the primary — can't be archived
  check('archiving an account ALSO drops it from net worth',
    useStore.getState().getTotalBalance() === 10000, `${useStore.getState().getTotalBalance()}`);
}

// ── selectAssetsAndLiabilities — always sums back to selectEPurseNetWorth ───
{
  reset();
  useStore.getState().addAccount({ type: 'Bank', name: 'Bank', mask: '1234', balance: 10000 });
  useStore.getState().addAccount({ type: 'Cash', name: 'Cash', balance: 500 });
  const cardId = useStore.getState().addAccount({ type: 'Credit Card', name: 'Card', mask: '9999', bankName: 'HDFC', balance: -3000 });

  let { assets, liabilities } = mod.selectAssetsAndLiabilities(useStore.getState());
  check('assets sum every non-CC balance', assets === 10500, `${assets}`);
  check('liabilities sum the CC\'s outstanding (owed) balance', liabilities === 3000, `${liabilities}`);
  check('assets − liabilities equals selectEPurseNetWorth\'s own total',
    assets - liabilities === mod.selectEPurseNetWorth(useStore.getState()),
    `${assets - liabilities} vs ${mod.selectEPurseNetWorth(useStore.getState())}`);

  // A Credit Card IN CREDIT (overpaid) must not read as an asset — net worth
  // itself already zeroes it out via Math.min(bal, 0); showing it as an
  // asset here would disagree with the headline Net Worth figure.
  useStore.setState({
    accounts: useStore.getState().accounts.map((a) => (a.id === cardId ? { ...a, balance: 500 } : a)),
  });
  ({ assets, liabilities } = mod.selectAssetsAndLiabilities(useStore.getState()));
  check('a Credit Card in credit contributes to NEITHER bucket',
    assets === 10500 && liabilities === 0, JSON.stringify({ assets, liabilities }));
  check('…still agrees with selectEPurseNetWorth',
    assets - liabilities === mod.selectEPurseNetWorth(useStore.getState()));
}

// ── archiveAccount / unarchiveAccount ────────────────────────────────────────
{
  reset();
  const cardId = useStore.getState().addAccount({
    type: 'Credit Card', name: 'Card', mask: '3333', bankName: 'SBI', balance: -2000,
  });
  useStore.getState().setPrimaryAccount(cardId);
  useStore.setState({
    ccDueReminderIds: { '3333:2026-09-07': 'notif-1' },
    ccBills: { 3333: { amount: 2000, cardLast4: '3333', bankName: 'SBI' } },
  });

  useStore.getState().archiveAccount(cardId);
  check('the primary card can\'t be archived', useStore.getState().accounts.find((a) => a.id === cardId).archived !== true);
  const otherId = useStore.getState().addAccount({ type: 'Bank', name: 'Bank', mask: '9999' });
  useStore.getState().setPrimaryAccount(otherId);
  useStore.getState().archiveAccount(cardId);
  const archived = useStore.getState().accounts.find((a) => a.id === cardId);
  check('archiveAccount sets archived + archivedAt', archived.archived === true && !!archived.archivedAt, JSON.stringify(archived));
  check('an archived account is never the primary',
    archived.primary === false, JSON.stringify(archived));
  check('archiving cancels this card\'s scheduled due reminders',
    Object.keys(useStore.getState().ccDueReminderIds).length === 0, JSON.stringify(useStore.getState().ccDueReminderIds));
  check('archiving does NOT touch ccBills — history survives',
    Object.keys(useStore.getState().ccBills).length === 1, JSON.stringify(useStore.getState().ccBills));

  useStore.getState().unarchiveAccount(cardId);
  const restored = useStore.getState().accounts.find((a) => a.id === cardId);
  check('unarchiveAccount clears archived/archivedAt',
    restored.archived === false && restored.archivedAt === null, JSON.stringify(restored));
}

// ── setCreditLimit / setMinimumDue / setAccountCycleDates ───────────────────
{
  reset();
  const cardId = useStore.getState().addAccount({ type: 'Credit Card', name: 'Card', mask: '4444', bankName: 'HDFC' });

  useStore.getState().setCreditLimit(cardId, 100000);
  useStore.getState().setMinimumDue(cardId, 2500);
  useStore.getState().setAccountCycleDates(cardId, { statementDay: 12, dueDay: 28 });

  const card = useStore.getState().accounts.find((a) => a.id === cardId);
  check('setCreditLimit sets creditLimit', card.creditLimit === 100000, JSON.stringify(card));
  check('setMinimumDue sets minimumDue', card.minimumDue === 2500, JSON.stringify(card));
  check('setAccountCycleDates sets both cycle days',
    card.statementDay === 12 && card.dueDay === 28, JSON.stringify(card));
}

// ── Statement payments: partial vs full (billing spec §4/§8) ───────────────
// Covers all three balance-adjusting reconcile paths: confirmCCTrueUp,
// settleCCPayment (both via the pending-payment queue), and
// markAsCCBillPayment (the manual "I paid this from my bank" flow). A payment
// smaller than what's left leaves the statement PARTIALLY paid — never "paid"
// on the first payment — and True-up always means the whole bill is cleared.
{
  reset();
  const cardId = useStore.getState().addAccount({
    type: 'Credit Card', name: 'Card', mask: '5555', bankName: 'ICICI',
    balance: -3000, statementBalance: 3000, minimumDue: 150, dueDay: 15,
  });
  const cardNow = () => useStore.getState().accounts.find((a) => a.id === cardId);
  // A real NEW bill resets remainingDue with it — arm both, like ingest does.
  const arm = (bal, min) => useStore.setState({
    accounts: useStore.getState().accounts.map((a) => (a.id === cardId
      ? { ...a, statementBalance: bal, remainingDue: bal, minimumDue: min } : a)),
  });
  const queuePay = (amount, smsId) => useStore.setState({
    pendingCCPaymentQueue: [{ amount, accountId: cardId, accountMask: '5555', bankName: 'ICICI', smsId }],
  });

  check('addAccount starts remainingDue at the statement balance', cardNow().remainingDue === 3000, JSON.stringify(cardNow()));

  queuePay(3000, 'pay-x');
  useStore.getState().confirmCCTrueUp();
  let card = cardNow();
  check('confirmCCTrueUp logs a paymentHistory entry',
    card.paymentHistory.length === 1 && card.paymentHistory[0].mode === 'trueup' && card.paymentHistory[0].amount === 3000,
    JSON.stringify(card.paymentHistory));
  check('confirmCCTrueUp marks the statement PAID (remainingDue 0), keeping the billed amount on file',
    card.remainingDue === 0 && card.statementBalance === 3000, JSON.stringify(card));

  // Partial: ₹400 against a ₹1,000 statement.
  arm(1000, 50);
  queuePay(400, 'pay-y');
  useStore.getState().settleCCPayment();
  card = cardNow();
  check('settleCCPayment logs a paymentHistory entry with what is left',
    card.paymentHistory.length === 2 && card.paymentHistory[1].mode === 'settle'
      && card.paymentHistory[1].amount === 400 && card.paymentHistory[1].remainingAfter === 600,
    JSON.stringify(card.paymentHistory));
  check('a smaller Settle leaves the statement PARTIALLY paid, not paid',
    card.remainingDue === 600 && card.statementBalance === 1000 && card.minimumDue === 50, JSON.stringify(card));

  queuePay(600, 'pay-z');
  useStore.getState().settleCCPayment();
  check('a second Settle covering the rest pays the statement off', cardNow().remainingDue === 0, `${cardNow().remainingDue}`);

  // Overpayment is allowed — recorded, remaining floors at 0.
  arm(200, null);
  queuePay(500, 'pay-o');
  useStore.getState().settleCCPayment();
  card = cardNow();
  check('an overpayment floors remaining at 0 and records the excess',
    card.remainingDue === 0 && card.paymentHistory[card.paymentHistory.length - 1].overpaid === 300,
    JSON.stringify(card.paymentHistory[card.paymentHistory.length - 1]));

  // markAsCCBillPayment — 'none' must NOT log or touch the statement (the
  // automatic path already did); 'settle'/'trueup' follow the same rule.
  arm(800, 40);
  useStore.getState().addTransaction({
    id: 'bill-txn-1', amount: 500, type: 'debit', categoryId: 'other',
    merchant: 'ICICI Bill Pay', createdAt: new Date().toISOString(), source: 'manual',
  });
  const before = cardNow().paymentHistory.length;
  useStore.getState().markAsCCBillPayment('bill-txn-1', cardId, 'none');
  check('markAsCCBillPayment mode "none" logs nothing and leaves the statement alone',
    cardNow().paymentHistory.length === before && cardNow().remainingDue === 800, JSON.stringify(cardNow()));

  useStore.getState().addTransaction({
    id: 'bill-txn-2', amount: 300, type: 'debit', categoryId: 'other',
    merchant: 'ICICI Bill Pay', createdAt: new Date().toISOString(), source: 'manual',
  });
  useStore.getState().markAsCCBillPayment('bill-txn-2', cardId, 'settle');
  check('markAsCCBillPayment "settle" applies a partial payment', cardNow().remainingDue === 500, `${cardNow().remainingDue}`);

  useStore.getState().addTransaction({
    id: 'bill-txn-3', amount: 100, type: 'debit', categoryId: 'other',
    merchant: 'ICICI Bill Pay', createdAt: new Date().toISOString(), source: 'manual',
  });
  useStore.getState().markAsCCBillPayment('bill-txn-3', cardId, 'trueup');
  card = cardNow();
  check('markAsCCBillPayment "trueup" pays the statement off regardless of amount',
    card.remainingDue === 0 && card.paymentHistory[card.paymentHistory.length - 1].mode === 'trueup', JSON.stringify(card));
}

// ── Bill SMS → partial payment → repeat reminder → new statement ───────────
// The end-to-end path: what the bill SMS stamps, that a partial payment keeps
// the Home "bill due" entry (money is still owed), that a REPEAT reminder for
// the same statement can't wipe a partial payment, and that a NEW statement
// resets the cycle.
{
  reset();
  useStore.setState({ ccBills: {}, ccDueReminderIds: {} });
  const cardId = useStore.getState().addAccount({ type: 'Credit Card', name: 'HDFC Card', mask: '7777', bankName: 'HDFC', balance: -10000 });
  const cardNow = () => useStore.getState().accounts.find((a) => a.id === cardId);
  const billFor = () => Object.values(useStore.getState().ccBills || {}).find((b) => b.cardLast4 === '7777');

  ingest('HDFCBK', 'Total Amount Due on your HDFC Credit Card ending 7777 for statement dt 18-Sep-26 is Rs.10,000.00. Min Amount Due: Rs.500.00. Payment due date: 08-Oct-26.',
    { smsId: 'h-bill-1' });
  let card = cardNow();
  check('a bill SMS stamps statementBalance + remainingDue', card.statementBalance === 10000 && card.remainingDue === 10000, JSON.stringify(card));
  check('…and the parsed Min Amount Due', card.minimumDue === 500, `${card.minimumDue}`);
  // The actual dates STAGE, pending confirmation — never auto-saved to
  // lastStatementDate/lastDueDate (billing spec correction: confirm at settle time).
  check('the actual dates are NOT auto-saved', card.lastStatementDate === null && card.lastDueDate === null, JSON.stringify(card));
  const pend = card.pendingCycleDate;
  const stmt = new Date(pend?.statementDate);
  const due = new Date(pend?.dueDate);
  check('…they stage as a pending confirmation instead', !!pend, JSON.stringify(pend));
  check('…with the ACTUAL statement date', stmt.getDate() === 18 && stmt.getMonth() === 8, pend?.statementDate);
  check('…and the ACTUAL due date', due.getDate() === 8 && due.getMonth() === 9, pend?.dueDate);

  useStore.getState().confirmPendingCycleDate(cardId, false);
  check('dismissing the pending date clears it without applying', cardNow().pendingCycleDate === null && cardNow().lastStatementDate === null, JSON.stringify(cardNow()));

  // Re-arrive at the same reminder and this time confirm it.
  ingest('HDFCBK', 'Total Amount Due on your HDFC Credit Card ending 7777 for statement dt 18-Sep-26 is Rs.10,000.00. Min Amount Due: Rs.500.00. Payment due date: 08-Oct-26.',
    { smsId: 'h-bill-1-again' });
  useStore.getState().confirmPendingCycleDate(cardId, true);
  card = cardNow();
  check('confirming applies the actual dates', !!card.lastStatementDate && !!card.lastDueDate, JSON.stringify(card));
  check('…and syncs statementDay/dueDay to match', card.statementDay === 18 && card.dueDay === 8, JSON.stringify(card));
  check('…and clears the pending slot', card.pendingCycleDate === null);

  ingest('HDFCBK', 'Payment of Rs.4,000.00 received towards your HDFC Credit Card ending 7777. Thank you.',
    { smsId: 'h-pay-1', receivedAt: Date.now() });
  check('a PARTIAL payment SMS keeps the bill standing (still owed)', !!billFor(), JSON.stringify(useStore.getState().ccBills));
  useStore.getState().settleCCPayment();
  card = cardNow();
  check('Settle on the prompt leaves ₹6,000 remaining', card.remainingDue === 6000, `${card.remainingDue}`);
  check('…and stamps that on the bill for the Home card', billFor()?.remaining === 6000, JSON.stringify(billFor()));

  ingest('HDFCBK', 'Total Amount Due on your HDFC Credit Card ending 7777 for statement dt 18-Sep-26 is Rs.10,000.00. Min Amount Due: Rs.500.00. Payment due date: 08-Oct-26.',
    { smsId: 'h-bill-1-repeat' });
  check('a REPEAT reminder for the same statement does NOT wipe the partial payment',
    cardNow().remainingDue === 6000 && cardNow().statementBalance === 10000, JSON.stringify(cardNow()));

  ingest('HDFCBK', 'Total Amount Due on your HDFC Credit Card ending 7777 for statement dt 18-Sep-26 is Rs.5,000.00. Payment due date: 08-Oct-26.',
    { smsId: 'h-bill-1-lower' });
  check('…but a LOWER amount for the same statement lowers remaining (a payment we never saw)',
    cardNow().remainingDue === 5000 && cardNow().statementBalance === 10000, JSON.stringify(cardNow()));

  ingest('HDFCBK', 'Total Amount Due on your HDFC Credit Card ending 7777 for statement dt 18-Oct-26 is Rs.7,000.00. Payment due date: 07-Nov-26.',
    { smsId: 'h-bill-2' });
  card = cardNow();
  check('a NEW statement resets the cycle to its full amount',
    card.statementBalance === 7000 && card.remainingDue === 7000, JSON.stringify(card));
  check('…and drops the old statement\'s minimum due rather than carrying it', card.minimumDue === null, `${card.minimumDue}`);

  ingest('HDFCBK', 'Payment of Rs.7,000.00 received towards your HDFC Credit Card ending 7777. Thank you.',
    { smsId: 'h-pay-2', receivedAt: Date.now() });
  check('a payment covering the whole statement clears the bill at once', !billFor(), JSON.stringify(useStore.getState().ccBills));
}

// ── A bill SMS with ONLY a due date still drives the due status ─────────────
// Its date waits unconfirmed (pendingCycleDate) and there's no statement date,
// so the status used to stay "Upcoming" with no countdown or colour change.
{
  reset();
  useStore.setState({ ccBills: {}, ccDueReminderIds: {} });
  const { ccPaymentStatus } = await import(`${PROJECT_ROOT}/src/utils/ccStatement.js`);
  const cardId = useStore.getState().addAccount({ type: 'Credit Card', name: 'HDFC Card', mask: '8888', bankName: 'HDFC', balance: -12000 });
  const cardNow = () => useStore.getState().accounts.find((a) => a.id === cardId);
  const inDays = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return `${String(d.getDate()).padStart(2, '0')}-${mon}-${String(d.getFullYear()).slice(2)}`;
  };
  ingest('HDFCBK', `Total Amount Due on your HDFC Credit Card ending 8888 is Rs.12,000.00. Payment due date: ${inDays(3)}.`, { smsId: 'h-due-only' });
  const card = cardNow();
  check('due-date-only bill: no statement date known', card.statementBalance === 12000 && !card.statementDay && !card.lastStatementDate, JSON.stringify(card));
  check('…yet the status counts down (due_soon, not upcoming)', ccPaymentStatus(card) === 'due_soon', ccPaymentStatus(card));
  const past = { ...card, pendingCycleDate: { ...card.pendingCycleDate, dueDate: new Date(Date.now() - 2 * 86400000).toISOString() } };
  check('…and turns to due_date_passed once the date goes by', ccPaymentStatus(past) === 'due_date_passed', ccPaymentStatus(past));
}

// ── v37 migration: remainingDue + actual dates ──────────────────────────────
{
  const migrate = useStore.persist.getOptions().migrate;
  const out = migrate({
    accounts: [
      { id: 'c1', type: 'Credit Card', name: 'C', statementBalance: 2500 },
      { id: 'c2', type: 'Credit Card', name: 'D', statementBalance: null },
      { id: 'b1', type: 'Bank', name: 'B' },
    ],
  }, 36);
  const c1 = out.accounts.find((a) => a.id === 'c1');
  const c2 = out.accounts.find((a) => a.id === 'c2');
  const b1 = out.accounts.find((a) => a.id === 'b1');
  check('v37: a statement on file starts fully unpaid (remainingDue = the bill)', c1.remainingDue === 2500, JSON.stringify(c1));
  check('v37: no statement → remainingDue null', c2.remainingDue === null, JSON.stringify(c2));
  check('v37: actual dates start unknown', c1.lastStatementDate === null && c1.lastDueDate === null, JSON.stringify(c1));
  check('v37: non-card accounts are untouched', !('remainingDue' in b1), JSON.stringify(b1));
  check('v37: cycleDaysManual defaults false, pendingCycleDate null', c1.cycleDaysManual === false && c1.pendingCycleDate === null, JSON.stringify(c1));
}

// ── Manual billing/due day edit takes priority over SMS, forever ───────────
{
  reset();
  useStore.setState({ ccBills: {}, ccDueReminderIds: {} });
  const cardId = useStore.getState().addAccount({ type: 'Credit Card', name: 'SBI Card', mask: '2468', bankName: 'SBI' });
  const cardNow = () => useStore.getState().accounts.find((a) => a.id === cardId);

  useStore.getState().setAccountCycleDates(cardId, { statementDay: 10, dueDay: 25 });
  check('a manual edit sets cycleDaysManual', cardNow().cycleDaysManual === true, JSON.stringify(cardNow()));

  ingest('SBICRD', 'Total Amount Due on your SBI Credit Card ending 2468 for statement dt 18-Sep-26 is Rs.7,500.00. Payment due date: 08-Oct-26.',
    { smsId: 's-manual-1' });
  let card = cardNow();
  check('SMS no longer overwrites the manually-set days', card.statementDay === 10 && card.dueDay === 25, JSON.stringify(card));
  check('…and never stages a pending actual-date confirmation either', card.pendingCycleDate === null, JSON.stringify(card));
  check('…but the BILL AMOUNT still applies — money keeps tracking', card.statementBalance === 7500 && card.remainingDue === 7500, JSON.stringify(card));

  // A pending date from BEFORE the manual edit is discarded by the edit itself.
  useStore.setState({ accounts: useStore.getState().accounts.map((a) => (a.id === cardId ? { ...a, cycleDaysManual: false, pendingCycleDate: { statementDate: new Date().toISOString(), dueDate: null } } : a)) });
  useStore.getState().setAccountCycleDates(cardId, { statementDay: 11 });
  check('a fresh manual edit drops any pending confirmation', cardNow().pendingCycleDate === null, JSON.stringify(cardNow()));
}

// ── paymentHistory caps at 24 entries, dropping the oldest ──────────────────
{
  reset();
  const cardId = useStore.getState().addAccount({ type: 'Credit Card', name: 'Card', mask: '6666', bankName: 'Axis' });
  for (let i = 0; i < 26; i++) {
    useStore.setState({
      accounts: useStore.getState().accounts.map((a) => (a.id === cardId ? { ...a, statementBalance: 100 } : a)),
      pendingCCPaymentQueue: [{ amount: 100 + i, accountId: cardId, accountMask: '6666', bankName: 'Axis', smsId: `pay-${i}` }],
    });
    useStore.getState().settleCCPayment();
  }
  const card = useStore.getState().accounts.find((a) => a.id === cardId);
  check('paymentHistory caps at 24 entries', card.paymentHistory.length === 24, `${card.paymentHistory.length}`);
  check('the cap drops the OLDEST entries, keeping the newest',
    card.paymentHistory[0].amount === 102 && card.paymentHistory[23].amount === 125,
    JSON.stringify(card.paymentHistory.map((h) => h.amount)));
}

// ── Group edge cases (Oct-6-26, user-reported) ────────────────────────────────
console.log('\n— group edge cases —');
{
  const G = () => useStore.getState();
  const lbFor = (txnId) => G().lentBorrowed.filter((l) => l.sourceTxnId === txnId);
  const freshTrip = () => {
    reset();
    useStore.setState({ accounts: [{ id: 'aE', type: 'bank', name: 'HDFC ••2222', balance: 10000, primary: true }] });
    return G().createGroup({ name: 'Trip', type: 'shared',
      members: [{ memberId: 'm1', name: 'Rohit', contactId: 'c1' }, { memberId: 'm2', name: 'Pooja', contactId: 'c2' }] });
  };

  // 1. Zone on a SHARED group: a plain add used to land tagged but UNSPLIT.
  let gid = freshTrip();
  useStore.setState({ activeGroupZoneId: gid });
  G().addTransaction({ amount: 300, type: 'debit', merchant: 'Hotel', categoryId: 'travel', accountId: 'aE' });
  let t = G().transactions[0];
  check('zone/shared: auto-tagged expense gets the equal split', t.groupSplit?.shares?.length === 3 &&
    t.groupSplit.shares.every((x) => x.shareAmount === 100), JSON.stringify(t.groupSplit));
  check('zone/shared: …and each member owes their share', lbFor(t.id).length === 2 &&
    lbFor(t.id).every((l) => Number(l.amount) === 100), JSON.stringify(lbFor(t.id).map((l) => l.amount)));

  // 1b. Same for an SMS that lands while the zone is on.
  ingest('HDFCBK', 'Rs.600 debited from A/c XX2222 at RESORT on 22-07-26.', { receivedAt: T0, smsId: 'zone-sms' });
  t = G().transactions.find((x) => x.smsId === 'zone-sms' || /RESORT/i.test(x.merchant || ''));
  check('zone/shared SMS: auto-tagged SMS expense is split too', t?.groupId === gid && t?.groupSplit?.shares?.length === 3,
    JSON.stringify({ g: t?.groupId, s: t?.groupSplit }));

  // 2. Plain split with contacts who are ALSO group members, then added to the group.
  gid = freshTrip();
  G().addTransaction({ amount: 300, type: 'debit', merchant: 'Dinner', categoryId: 'food', accountId: 'aE', isSplit: true,
    myPercent: 34, splitOthers: [{ contactId: 'c1', name: 'Rohit', percent: 33 }, { contactId: 'c2', name: 'Pooja', percent: 33 }] });
  t = G().transactions[0];
  check('contacts-in-group: plain split books one LB row per contact', lbFor(t.id).length === 2 && lbFor(t.id).every((l) => !l.groupId));
  G().tagTransactionToGroup(t.id, gid, defaultGroupSplit(G().groups[0], 300));
  t = G().transactions[0];
  check('contacts-in-group: adding to the group swaps the plain split for the group one',
    !t.isSplit && t.groupSplit && lbFor(t.id).length === 2 && lbFor(t.id).every((l) => l.groupId === gid));
  check('contacts-in-group: no double debit', G().accounts[0].balance === 9700, `${G().accounts[0].balance}`);

  // 3. A plain-split MEMO (Rohit paid) added to the group with ME as payer.
  gid = freshTrip();
  G().addTransaction({ amount: 200, type: 'debit', merchant: 'Cab', categoryId: 'travel', accountId: 'aE', isSplit: true,
    myPercent: 50, splitPaidBy: { contactId: 'c1', name: 'Rohit' }, splitOthers: [{ contactId: 'c1', name: 'Rohit', percent: 50 }] });
  t = G().transactions[0];
  check('memo→group: starts as a memo with no debit', t.isSplitMemo && G().accounts[0].balance === 10000);
  G().tagTransactionToGroup(t.id, gid, { paidByMemberId: 'me', paidByName: 'You',
    shares: [{ memberId: 'me', name: 'You', shareAmount: 100 }, { memberId: 'm1', name: 'Rohit', shareAmount: 100 }] });
  t = G().transactions[0];
  check('memo→group (I paid): no longer a memo', !t.isSplitMemo && !t.isGroupMemo, JSON.stringify({ s: t.isSplitMemo, g: t.isGroupMemo }));
  check('memo→group (I paid): the debit the memo never made is booked', t.accountId === 'aE' && G().accounts[0].balance === 9800,
    `${t.accountId} ${G().accounts[0].balance}`);

  // 3b. Same memo added with ROHIT still the payer — stays someone else's money.
  gid = freshTrip();
  G().addTransaction({ amount: 200, type: 'debit', merchant: 'Cab', categoryId: 'travel', accountId: 'aE', isSplit: true,
    myPercent: 50, splitPaidBy: { contactId: 'c1', name: 'Rohit' }, splitOthers: [{ contactId: 'c1', name: 'Rohit', percent: 50 }] });
  t = G().transactions[0];
  G().tagTransactionToGroup(t.id, gid, { paidByMemberId: 'm1', paidByName: 'Rohit',
    shares: [{ memberId: 'me', name: 'You', shareAmount: 100 }, { memberId: 'm1', name: 'Rohit', shareAmount: 100 }] });
  t = G().transactions[0];
  check('memo→group (Rohit paid): becomes a GROUP memo, still no debit', t.isGroupMemo && !t.isSplitMemo && !t.accountId &&
    G().accounts[0].balance === 10000, JSON.stringify({ g: t.isGroupMemo, a: t.accountId, b: G().accounts[0].balance }));

  // 4. The payer-lock rule every group sheet now shares.
  check('payer lock: a real account debit is locked to You', isPayerLockedToMe({ accountId: 'aE' }));
  check('payer lock: a memo is not', !isPayerLockedToMe({ isSplitMemo: true, memoAccountId: 'aE' }) && !isPayerLockedToMe({ isGroupMemo: true }));
  check('defaultGroupSplit: personal group → no split', defaultGroupSplit({ type: 'personal' }, 100) === null);
}

// ── Home form ↔ Group Zone (Oct-6-26) ──────────────────────────────────────────
// The Add Transaction form now offers the zone group in its own Group row. When the
// user picks "No Group" it sends `skipGroupZone`, and the store must respect that
// instead of re-tagging the expense behind their back.
console.log('\n— home form vs group zone —');
{
  reset();
  const G = () => useStore.getState();
  useStore.setState({ accounts: [{ id: 'accZ', type: 'bank', name: 'HDFC ••1111', balance: 5000, primary: true }] });
  const zid = G().createGroup({ name: 'Zone Trip', type: 'personal' });
  useStore.setState({ activeGroupZoneId: zid });

  G().addTransaction({ amount: 100, type: 'debit', merchant: 'Chai', categoryId: 'food', accountId: 'accZ' });
  const tagged = G().transactions.find((t) => t.merchant === 'Chai');
  check('zone: a plain add with no opt-out is still auto-tagged (unchanged behaviour)', tagged?.groupId === zid, `${tagged?.groupId}`);

  G().addTransaction({ amount: 200, type: 'debit', merchant: 'Snacks', categoryId: 'food', accountId: 'accZ', skipGroupZone: true });
  const opted = G().transactions.find((t) => t.merchant === 'Snacks');
  check('zone: skipGroupZone keeps a "No Group" choice untagged', !opted?.groupId, `${opted?.groupId}`);
  check('zone: skipGroupZone is not persisted on the transaction', !('skipGroupZone' in (opted || {})));
  check('zone: the opted-out expense still debits the account', G().accounts.find((a) => a.id === 'accZ').balance === 4700,
    `${G().accounts.find((a) => a.id === 'accZ').balance}`);

  // Home form → personal group: books through addGroupExpense with no shares.
  const before = G().groups.find((g) => g.id === zid).totalSpend || 0;
  G().addGroupExpense(zid, { amount: 300, merchant: 'Lunch', paidByMemberId: 'me', paidByName: 'You', shares: [], accountId: 'accZ' });
  const lunch = G().transactions.find((t) => t.merchant === 'Lunch');
  check('home→personal group: tagged, no groupSplit', lunch?.groupId === zid && !lunch?.groupSplit, JSON.stringify(lunch?.groupSplit));
  check('home→personal group: group total grows by the amount', (G().groups.find((g) => g.id === zid).totalSpend || 0) === before + 300);
  check('home→personal group: uncategorised falls back to "other"', lunch?.categoryId === 'other', lunch?.categoryId);
}

// ── Edit form ↔ groups (Oct-9-26) ─────────────────────────────────────────────
// AddTransactionScreen is now the ONE edit form for plain and group txns. These
// replay its commitEdit call ORDER for each transition — the ordering is the logic.
console.log('\n— edit form: group transitions —');
{
  const G = () => useStore.getState();
  const lbFor = (id) => G().lentBorrowed.filter((l) => l.sourceTxnId === id);
  const bal = () => G().accounts.find((a) => a.id === 'aX').balance;
  const tx = (id) => G().transactions.find((t) => t.id === id);
  const total = (gid) => G().groups.find((g) => g.id === gid).totalSpend || 0;
  const setup = () => {
    reset();
    useStore.setState({ accounts: [{ id: 'aX', type: 'bank', name: 'HDFC ••3333', balance: 10000, primary: true }] });
    const shared = G().createGroup({ name: 'Flat', type: 'shared', members: [{ memberId: 'm1', name: 'Rohit', contactId: 'c1' }] });
    const solo = G().createGroup({ name: 'House', type: 'personal' });
    const other = G().createGroup({ name: 'Goa', type: 'shared', members: [{ memberId: 'm9', name: 'Asha', contactId: 'c9' }] });
    return { shared, solo, other };
  };
  const meHalf = (amt, mid, name) => ({ paidByMemberId: 'me', paidByName: 'You',
    shares: [{ memberId: 'me', name: 'You', shareAmount: amt / 2 }, { memberId: mid, name, shareAmount: amt / 2 }] });

  // 1. The bug: editing a PERSONAL-group txn used to silently no-op (updateTransaction refuses groupId).
  let g = setup();
  let id = G().addGroupExpense(g.solo, { amount: 400, merchant: 'Cement', paidByMemberId: 'me', paidByName: 'You', shares: [], accountId: 'aX' });
  G().updateGroupExpense(id, { amount: 500, merchant: 'Cement bags', paidByMemberId: 'me', paidByName: 'You', shares: [], accountId: 'aX' });
  check('edit personal-group txn: the change actually saves', tx(id).merchant === 'Cement bags' && tx(id).amount === 500);
  check('…balance and group total follow the new amount', bal() === 9500 && total(g.solo) === 500, `${bal()} ${total(g.solo)}`);

  // 2. Plain → shared group (I paid): tag, then updateGroupExpense with the split.
  g = setup();
  G().addTransaction({ amount: 600, type: 'debit', merchant: 'Groceries', categoryId: 'food', accountId: 'aX' });
  id = G().transactions[0].id;
  G().tagTransactionToGroup(id, g.shared, null);
  G().updateGroupExpense(id, { amount: 600, merchant: 'Groceries', categoryId: 'food', ...meHalf(600, 'm1', 'Rohit'), accountId: 'aX' });
  check('plain→shared: tagged with the split', tx(id).groupId === g.shared && tx(id).groupSplit?.shares?.length === 2);
  check('plain→shared: Rohit owes his half', lbFor(id).length === 1 && Number(lbFor(id)[0].amount) === 300 && lbFor(id)[0].groupId === g.shared);
  check('plain→shared: debited once, not twice', bal() === 9400, `${bal()}`);
  check('plain→shared: group total = the bill', total(g.shared) === 600);

  // 3. Shared → another shared group: old total drops, LB rows rebuilt for the new members.
  G().tagTransactionToGroup(id, g.other, null);
  G().updateGroupExpense(id, { amount: 600, merchant: 'Groceries', categoryId: 'food', ...meHalf(600, 'm9', 'Asha'), accountId: 'aX' });
  check('shared→other group: totals move', total(g.shared) === 0 && total(g.other) === 600, `${total(g.shared)} ${total(g.other)}`);
  check('shared→other group: only the new group\'s debt remains', lbFor(id).length === 1 && lbFor(id)[0].groupId === g.other
    && /Asha/.test(lbFor(id)[0].person || lbFor(id)[0].name || ''), JSON.stringify(lbFor(id)));
  check('shared→other group: balance untouched by the move', bal() === 9400, `${bal()}`);

  // 4. Group → none (I paid): leaving the group keeps who owes whom (Oct-9-26). Form order:
  //    untag → updateTransaction → then the Split row's choice.
  G().untagTransactionFromGroup(id);
  G().updateTransaction(id, { amount: 600, type: 'debit', accountId: 'aX', merchant: 'Groceries', categoryId: 'food' });
  check('group→none: out of the group, now a plain split', !tx(id).groupId && !tx(id).groupSplit && tx(id).isSplit
    && tx(id).myShareAmount === 300 && tx(id).splitWith?.[0]?.name === 'Asha', JSON.stringify(tx(id).splitWith));
  check('group→none: Asha still owes 300 — no longer group-scoped', lbFor(id).length === 1 && Number(lbFor(id)[0].amount) === 300
    && lbFor(id)[0].kind === 'lent' && !lbFor(id)[0].groupId, JSON.stringify(lbFor(id)));
  check('group→none: total released, balance unchanged', total(g.other) === 0 && bal() === 9400, `${total(g.other)} ${bal()}`);
  // 4b. …then the user removes the split in the Split row: the debt goes, the money doesn't move.
  G().setTransactionSplit(id, [], {});
  check('group→none, split removed: nothing owed, balance unchanged', !tx(id).isSplit && lbFor(id).length === 0 && bal() === 9400);

  // 5. Group MEMO (Rohit paid) → none: stays Rohit's money — no debit, I still owe my share.
  g = setup();
  id = G().addGroupExpense(g.shared, { amount: 200, merchant: 'Cab', paidByMemberId: 'm1', paidByName: 'Rohit',
    shares: [{ memberId: 'me', name: 'You', shareAmount: 100 }, { memberId: 'm1', name: 'Rohit', shareAmount: 100 }] });
  G().untagTransactionFromGroup(id);
  G().updateTransaction(id, { amount: 200, type: 'debit', accountId: 'aX', merchant: 'Cab', categoryId: 'travel' });
  check('group memo→none: still Rohit\'s money (no debit)', bal() === 10000 && tx(id).isSplitMemo && tx(id).splitPaidBy?.name === 'Rohit',
    `${bal()} ${tx(id).isSplitMemo}`);
  check('group memo→none: I still owe Rohit 100', lbFor(id).length === 1 && Number(lbFor(id)[0].amount) === 100 && !lbFor(id)[0].groupId);
  // 5b. …then the user removes the split: it becomes MY expense, debited once from the form's account — no phantom.
  G().setTransactionSplit(id, [], {});
  check('group memo→none, split removed: debited once on the chosen account', !tx(id).isSplitMemo && tx(id).accountId === 'aX'
    && bal() === 9800 && lbFor(id).length === 0, `${tx(id).accountId} ${bal()} ${lbFor(id).length}`);

  // 7. Amount edit on a "Rohit paid" split (Oct-9-26): keeps the payer, rescales the shares.
  g = setup();
  G().addTransaction({ amount: 200, type: 'debit', merchant: 'Cab', categoryId: 'travel', accountId: 'aX', isSplit: true, source: 'manual',
    myPercent: 50, splitPaidBy: { contactId: 'c1', name: 'Rohit' }, splitOthers: [{ contactId: 'c1', name: 'Rohit', percent: 50 }] });
  let mid = G().transactions[0].id;
  G().updateTransaction(mid, { amount: 250, type: 'debit', accountId: 'aX', merchant: 'Cab', categoryId: 'travel' });
  check('memo amount edit: still Rohit\'s money — no debit', tx(mid).isSplitMemo && bal() === 10000, `${tx(mid).isSplitMemo} ${bal()}`);
  check('memo amount edit: I now owe Rohit 125', lbFor(mid).length === 1 && Number(lbFor(mid)[0].amount) === 125 && lbFor(mid)[0].kind === 'borrowed',
    JSON.stringify(lbFor(mid).map((l) => [l.kind, l.amount])));
  check('memo amount edit: shares sum to the new total', Math.abs(tx(mid).myShareAmount + tx(mid).splitWith[0].shareAmount - 250) < 0.01);

  // 7b. Same on a split I paid: Lent rows rescale, balance moves by the difference only.
  g = setup();
  G().addTransaction({ amount: 300, type: 'debit', merchant: 'Dinner', categoryId: 'food', accountId: 'aX', isSplit: true, source: 'manual',
    myPercent: 34, splitOthers: [{ contactId: 'c1', name: 'Rohit', percent: 33 }, { contactId: 'c2', name: 'Pooja', percent: 33 }] });
  mid = G().transactions[0].id;
  G().updateTransaction(mid, { amount: 600, type: 'debit', accountId: 'aX', merchant: 'Dinner', categoryId: 'food' });
  check('paid split amount edit: split kept, Lent rows doubled', tx(mid).isSplit && lbFor(mid).length === 2 &&
    lbFor(mid).every((l) => l.kind === 'lent' && Number(l.amount) === 198), JSON.stringify(lbFor(mid).map((l) => l.amount)));
  check('paid split amount edit: balance = 10000 − 600', bal() === 9400, `${bal()}`);

  // 6. Plain-split MEMO → shared group with me paying: clear split first (restores the parked account), then tag+update.
  g = setup();
  G().addTransaction({ amount: 300, type: 'debit', merchant: 'Dinner', categoryId: 'food', accountId: 'aX', isSplit: true,
    myPercent: 50, splitPaidBy: { contactId: 'c1', name: 'Rohit' }, splitOthers: [{ contactId: 'c1', name: 'Rohit', percent: 50 }] });
  id = G().transactions[0].id;
  check('split memo→group: starts with no debit', bal() === 10000);
  G().setTransactionSplit(id, [], {});
  G().tagTransactionToGroup(id, g.shared, null);
  G().updateGroupExpense(id, { amount: 300, merchant: 'Dinner', categoryId: 'food', ...meHalf(300, 'm1', 'Rohit'), accountId: 'aX' });
  check('split memo→group (I paid): debited exactly once', bal() === 9700, `${bal()}`);
  check('split memo→group: only the group\'s debt row remains', lbFor(id).length === 1 && lbFor(id)[0].groupId === g.shared,
    JSON.stringify(lbFor(id)));
}

// ── Edit: flipping a manual txn's type (Oct-9-26) ─────────────────────────────
console.log('\n— edit form: type flip —');
{
  reset();
  const G = () => useStore.getState();
  useStore.setState({ accounts: [{ id: 'aT', type: 'bank', name: 'HDFC ••4444', balance: 1000, primary: true }] });
  G().addTransaction({ amount: 200, type: 'debit', merchant: 'Oops', categoryId: 'food', accountId: 'aT', source: 'manual' });
  const id = G().transactions[0].id;
  G().updateTransaction(id, { amount: 200, type: 'credit', accountId: 'aT', merchant: 'Oops', categoryId: 'income' });
  check('debit→credit: balance swings by 2× (−200 undone, +200 applied)', G().accounts[0].balance === 1200, `${G().accounts[0].balance}`);
  G().setTransactionRefund(id, true);
  check('credit can be flagged refund', G().transactions[0].isRefund === true);
  G().updateTransaction(id, { amount: 200, type: 'debit', accountId: 'aT', merchant: 'Oops', categoryId: 'food' });
  G().setTransactionRefund(id, false);
  check('credit→debit: balance back to 800 and the stale refund flag is cleared',
    G().accounts[0].balance === 800 && G().transactions[0].isRefund === false, `${G().accounts[0].balance} ${G().transactions[0].isRefund}`);
}


console.log('\n— LB booked Repayment: edits/deletes move its expense too (Oct-10-26) —');
{
  reset();
  const G = () => useStore.getState();
  useStore.setState({ accounts: [
    { id: 'a1', name: 'HDFC', bankName: 'HDFC', mask: '1111', type: 'Bank Account', balance: 10000 },
    { id: 'a2', name: 'ICICI', bankName: 'ICICI', mask: '2222', type: 'Bank Account', balance: 5000 },
  ] });
  G().addLentBorrowed({ kind: 'borrowed', person: 'Rohit', phone: '9876543210', amount: 1000 });
  G().addAlreadySettledLentBorrowed({ kind: 'borrowed', person: 'Rohit', phone: '9876543210', amount: 400 }, { accountId: 'a1' });
  const row = () => G().lentBorrowed.find((l) => l.kind === 'borrow_repaid');
  const txn = () => G().transactions.find((t) => t.id === row()?.sourceTxnId);
  const bal = (id) => G().accounts.find((a) => a.id === id).balance;
  const net = () => G().getPersonBalances()[0]?.net;
  check('booked repaid row is editable', G().isLentBorrowedEditable(row()) === true);
  check('…and reports its account', G().lentBorrowedAccountId(row()) === 'a1');
  check('plain row has no account', G().lentBorrowedAccountId(G().lentBorrowed.find((l) => l.kind === 'borrowed')) === null);
  check('setup: HDFC debited 400, net −600', bal('a1') === 9600 && net() === -600, `${bal('a1')} ${net()}`);

  check('edit amount → ok', G().updateLentBorrowedEntry(row().id, { amount: 700, note: 'Cash' }) === true);
  check('…row + expense both 700, HDFC re-debited', row().amount === 700 && txn().amount === 700 && bal('a1') === 9300, `${row().amount} ${txn().amount} ${bal('a1')}`);
  check('…net follows (−300), note kept', net() === -300 && row().note === 'Cash', `${net()} ${row().note}`);

  G().updateLentBorrowedEntry(row().id, { accountId: 'a2' });
  check('move account → HDFC restored, ICICI debited', bal('a1') === 10000 && bal('a2') === 4300 && txn().accountId === 'a2', `${bal('a1')} ${bal('a2')}`);

  check('a booked txn is locked to its ledger row — Activity can\'t edit it', G().updateTransaction(txn().id, { amount: 500, accountId: 'a2', categoryId: 'borrow_repaid' }) === null && row().amount === 700);

  check('delete → ok', G().deleteLentBorrowedEntry(row().id) === true);
  check('…expense gone, ICICI restored, debt back to 1000', !G().transactions.length && bal('a2') === 5000 && net() === -1000 && !row(), `${G().transactions.length} ${bal('a2')} ${net()}`);

  // Pre-Oct-10 data: a Repaid booking that was neither locked nor flagged.
  G().addAlreadySettledLentBorrowed({ kind: 'borrowed', person: 'Rohit', phone: '9876543210', amount: 200 }, { accountId: 'a1' });
  useStore.setState((st) => ({ transactions: st.transactions.map((t) => { const { lbLocked, lbBooked, ...rest } = t; return rest; }) }));
  check('legacy repayment: still editable from its row', G().isLentBorrowedEditable(row()) === true);
  G().updateTransaction(txn().id, { amount: 300, accountId: 'a1', categoryId: 'borrow_repaid' });
  check('legacy repayment: editing the EXPENSE (Activity) syncs the ledger row', row().amount === 300 && net() === -700, `${row().amount} ${net()}`);
  G().updateTransaction(txn().id, { amount: 300, accountId: 'a1', categoryId: 'food' });
  check('legacy repayment: recategorised off Repayment drops its row', !row() && net() === -1000, `${net()}`);
}

console.log('\n— recordLbEntry: every LB entry moves an account, or links the SMS (Oct-10-26) —');
{
  reset();
  const G = () => useStore.getState();
  const now = new Date().toISOString();
  useStore.setState({ accounts: [
    { id: 'a1', name: 'HDFC', bankName: 'HDFC', mask: '1111', type: 'Bank Account', balance: 10000, primary: true },
    { id: 'a2', name: 'ICICI', bankName: 'ICICI', mask: '2222', type: 'Bank Account', balance: 5000 },
  ] });
  const bal = (id) => G().accounts.find((a) => a.id === id).balance;
  const P = { person: 'Asha', phone: '9000000001' };
  const net = () => G().getPersonBalances().find((p) => p.phone === P.phone)?.net;
  const spend = () => G().getMonthlySpend(new Date());
  const income = () => G().getMonthlyIncome(new Date());

  let r = G().recordLbEntry({ ...P, kind: 'lent', amount: 500, date: now }, { accountId: 'a1' });
  const lentTxn = G().transactions.find((t) => t.id === G().lentBorrowed.find((l) => l.id === r.entryId).sourceTxnId);
  check('lent → books a DEBIT on the account', bal('a1') === 9500 && lentTxn?.type === 'debit' && lentTxn.categoryId === 'lent' && lentTxn.merchant === 'Lent to Asha', `${bal('a1')} ${JSON.stringify(lentTxn)}`);
  check('…locked + owned by its row (editable from the ledger)', lentTxn.lbLocked && lentTxn.lbBooked && G().isLentBorrowedEditable(G().lentBorrowed[0]));
  check('…not spend', spend() === 0, `${spend()}`);
  G().recordLbEntry({ ...P, kind: 'borrowed', amount: 300, date: now }, { accountId: 'a1' });
  check('borrowed → CREDIT, not income', bal('a1') === 9800 && income() === 0, `${bal('a1')} ${income()}`);
  G().recordLbEntry({ ...P, kind: 'lent_settled', amount: 100, date: now }, { accountId: 'a2' });
  check('received back → CREDIT on its account, not income', bal('a2') === 5100 && income() === 0 && net() === 100, `${bal('a2')} ${income()} ${net()}`);
  r = G().recordLbEntry({ ...P, kind: 'lent', amount: 50, date: '2025-01-01T00:00:00.000Z' }, {});
  check('"Not From an Account" → ledger-only, no balance move', !G().lentBorrowed.find((l) => l.id === r.entryId).sourceTxnId && bal('a1') === 9800 && net() === 150);

  // Settle: either direction now moves the chosen account.
  const key = G().getPersonBalances().find((p) => p.phone === P.phone).personKey;
  G().settlePersonBalance(key, { accountId: 'a2' });
  check('settle what THEY owe → received-back CREDIT on the account', net() === 0 && bal('a2') === 5250, `${net()} ${bal('a2')}`);

  // Matching: the UPI SMS already moved the balance → link it, don't book a second one.
  G().addTransaction({ id: 'sms-upi', accountId: 'a1', type: 'debit', amount: 700, merchant: 'UPI-RAVI', categoryId: 'transfer', source: 'sms', createdAt: now });
  G().addTransaction({ id: 'sms-food', accountId: 'a1', type: 'debit', amount: 700, merchant: 'Swiggy', categoryId: 'food', source: 'sms', createdAt: now });
  const before = bal('a1');
  const txnCount = G().transactions.length;
  r = G().recordLbEntry({ person: 'Ravi', phone: '9000000002', kind: 'lent', amount: 700, date: now, note: 'Rent share' }, { accountId: 'a1' });
  const linkedRow = G().lentBorrowed.find((l) => l.id === r.entryId);
  check('matching UPI transfer is LINKED (no new txn, balance moved once)', r.linkedTxn?.id === 'sms-upi' && linkedRow.sourceTxnId === 'sms-upi' && G().transactions.length === txnCount && bal('a1') === before, `${r.linkedTxn?.id} ${G().transactions.length}/${txnCount} ${bal('a1')}/${before}`);
  check('…and it leaves the review queue (recording it was the review)', G().transactions.find((t) => t.id === 'sms-upi').isReviewed === true);
  check('…the SMS is now Lent + locked; the Swiggy order untouched', G().transactions.find((t) => t.id === 'sms-upi').categoryId === 'lent' && G().transactions.find((t) => t.id === 'sms-food').categoryId === 'food');
  check('…linked (SMS) row is view-only; the note is kept', !G().isLentBorrowedEditable(linkedRow) && linkedRow.note === 'Rent share');
  r = G().recordLbEntry({ person: 'Ravi', phone: '9000000002', kind: 'lent', amount: 700, date: now }, { accountId: 'a1' });
  check('a second identical entry does not re-link a used txn → books', !r.linkedTxn && bal('a1') === before - 700, `${bal('a1')}`);
  r = G().recordLbEntry({ person: 'Ravi', phone: '9000000002', kind: 'lent', amount: 700, date: '2025-01-01T00:00:00.000Z' }, { accountId: 'a1' });
  check('outside ±3 days → no match (books)', !r.linkedTxn);

  // Editing the account on a row.
  const plain = G().recordLbEntry({ person: 'Meera', phone: '9000000003', kind: 'borrowed', amount: 400, date: now }, {});
  const a2Before = bal('a2');
  G().updateLentBorrowedEntry(plain.entryId, { accountId: 'a2' });
  const meera = () => G().lentBorrowed.find((l) => l.id === plain.entryId);
  check('ledger-only → put on an account: books it now', !!meera().sourceTxnId && bal('a2') === a2Before + 400, `${bal('a2')}`);
  G().updateLentBorrowedEntry(plain.entryId, { accountId: null, note: 'cash' });
  check('…and back to "Not From an Account": txn removed, balance restored, row kept', !meera().sourceTxnId && bal('a2') === a2Before && meera().note === 'cash' && G().transactions.every((t) => !t.merchant.includes('Meera')), `${bal('a2')}`);
  check('delete a booked lent → its txn + balance go too', (() => { const id = G().lentBorrowed.find((l) => l.kind === 'lent' && l.sourceTxnId?.startsWith('txn_lb_')).id; const b = bal('a1'); G().deleteLentBorrowedEntry(id); return bal('a1') === b + 500 || bal('a1') === b + 700; })());
}

console.log('\n— OLD-INSTALL data under the Oct-10-26 LB changes —');
{
  reset();
  const G = () => useStore.getState();
  const old = '2026-05-01T10:00:00.000Z';
  // Shapes an install from before Oct-10-26 really has: no lbBooked anywhere, settle
  // rows with the "Manual settlement" placeholder, a Repaid booking that was neither
  // locked nor flagged, an SMS tagged Lent (lbLocked), and a split whose transaction
  // was summarised away (its Lent row kept — the debt stands).
  useStore.setState({
    accounts: [{ id: 'a1', name: 'HDFC', bankName: 'HDFC', mask: '1111', type: 'Bank Account', balance: 5000 }],
    transactions: [
      { id: 'txn_repay_old', amount: 300, type: 'debit', categoryId: 'borrow_repaid', accountId: 'a1', merchant: 'Repaid Kiran', createdAt: old, source: 'manual', isReviewed: true, userEditedCategory: true },
      { id: 'sms_lent', amount: 800, type: 'debit', categoryId: 'lent', accountId: 'a1', merchant: 'UPI KIRAN', createdAt: old, source: 'sms', lbLocked: true },
    ],
    lentBorrowed: [
      { id: 'o1', kind: 'borrowed', person: 'Kiran', phone: '9111111111', amount: 1000, date: old },
      { id: 'o2', kind: 'borrow_repaid', person: 'Kiran', phone: '9111111111', amount: 300, date: old, note: 'Manual settlement', sourceTxnId: 'txn_repay_old' },
      { id: 'o3', kind: 'lent', person: 'Kiran', phone: '9111111111', amount: 800, date: old, note: 'From txn: UPI KIRAN', sourceTxnId: 'sms_lent' },
      { id: 'o4', kind: 'lent', person: 'Kiran', phone: '9111111111', amount: 250, date: old, note: 'Split · Dinner', sourceTxnId: 'gone_split' },
      { id: 'o5', kind: 'lent_settled', person: 'Kiran', phone: '9111111111', amount: 100, date: old, note: 'Manual settlement' },
    ],
  });
  const row = (id) => G().lentBorrowed.find((l) => l.id === id);
  const net = () => G().getPersonBalances()[0]?.net;
  check('old data: balances unchanged by the new code (−1000+300+800+250−100 = 250)', net() === 250, `${net()}`);
  check('old plain + placeholder-settle rows stay editable', G().isLentBorrowedEditable(row('o1')) && G().isLentBorrowedEditable(row('o5')));
  check('old unflagged Repaid booking is editable (legacy path)…', G().isLentBorrowedEditable(row('o2')) && G().lentBorrowedAccountId(row('o2')) === 'a1');
  G().updateLentBorrowedEntry('o2', { amount: 400 });
  check('…and an edit moves its expense + balance', row('o2').amount === 400 && G().transactions.find((t) => t.id === 'txn_repay_old').amount === 400 && G().accounts[0].balance === 4900, `${G().accounts[0].balance}`);
  check('old SMS-tagged Lent stays view-only', !G().isLentBorrowedEditable(row('o3')) && G().updateLentBorrowedEntry('o3', { amount: 1 }) === false && row('o3').amount === 800);
  check('orphaned split row (txn summarised away): view-only, no crash, still counted', !G().isLentBorrowedEditable(row('o4')) && G().lentBorrowedAccountId(row('o4')) === null && G().deleteLentBorrowedEntry('o4') === false && !!row('o4'));
  const r = G().recordLbEntry({ person: 'Kiran', phone: '9111111111', kind: 'lent', amount: 50 }, { accountId: 'a1' });
  check('new entries work on top of old data (books, joins the same person)', !!r && G().getPersonBalances().length === 1 && G().accounts[0].balance === 4850, `${G().getPersonBalances().length} ${G().accounts[0].balance}`);
}

console.log('\n— Ignore → Restore keeps a person-tagged txn\'s ledger row (Oct-10-26) —');
{
  reset();
  const G = () => useStore.getState();
  const now = new Date().toISOString();
  useStore.setState({ accounts: [{ id: 'a1', name: 'HDFC', type: 'Bank Account', balance: 5000 }] });
  const P = { person: 'Neha', phone: '9222222222' };
  const net = () => G().getPersonBalances().find((p) => p.phone === P.phone)?.net ?? 0;
  const r = G().recordLbEntry({ ...P, kind: 'lent', amount: 400, date: now }, { accountId: 'a1' });
  const txnId = G().lentBorrowed.find((l) => l.id === r.entryId).sourceTxnId;
  G().ignoreTransaction(txnId);
  check('ignore: the debt leaves the ledger, the balance is reversed', net() === 0 && G().accounts[0].balance === 5000, `${net()} ${G().accounts[0].balance}`);
  G().unignoreTransaction(txnId);
  check('restore: the SAME ledger row is back, balance re-applied', net() === 400 && G().lentBorrowed.some((l) => l.id === r.entryId) && G().accounts[0].balance === 4600, `${net()} ${G().accounts[0].balance}`);
  check('…and nothing is left parked on the txn', !G().transactions.find((t) => t.id === txnId).ignoredLbRows);
  G().unignoreTransaction(txnId);
  check('a second restore is a no-op (no duplicate row)', G().lentBorrowed.filter((l) => l.id === r.entryId).length === 1);
  // SMS tagged to a person (the pre-existing path) gets the same treatment.
  G().addTransaction({ id: 'sms-x', accountId: 'a1', type: 'debit', amount: 150, merchant: 'UPI', categoryId: 'transfer', source: 'sms', createdAt: now });
  G().updateTransactionCategoryWithContact('sms-x', 'lent', { person: P.person, phone: P.phone });
  G().ignoreTransaction('sms-x');
  G().unignoreTransaction('sms-x');
  check('SMS tagged Lent: ignore → restore brings its row back too', net() === 550, `${net()}`);
  // A split stays deliberately clean on restore (its rows are NOT parked).
  G().addTransaction({ id: 'split-x', accountId: 'a1', type: 'debit', amount: 600, merchant: 'Dinner', categoryId: 'food', createdAt: now });
  G().setTransactionSplit('split-x', [{ name: 'Neha', contactId: null, shareAmount: 300 }], { mode: 'amount', myAmount: 300 });
  G().ignoreTransaction('split-x');
  G().unignoreTransaction('split-x');
  const sx = G().transactions.find((t) => t.id === 'split-x');
  check('a split still restores clean (no split, no rows)', !sx.isSplit && !G().lentBorrowed.some((l) => l.sourceTxnId === 'split-x'));
}

console.log('\n— Card limits from SMS, combined limits, debit-card unlink (Oct-10-26) —');
{
  reset();
  const G = () => useStore.getState();
  const now = Date.now();
  const at = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
  const send = (body, minsAgo, id) => G().ingestMessage(body, { sender: 'HDFCBK', receivedAt: at(minsAgo), smsId: id });
  send('Rs.1,250.00 spent on HDFC Bank Credit Card x1234 at AMAZON. Avl Limit: INR 1,23,456.78', 30, 'l1');
  const card = () => G().accounts.find((a) => a.mask === '1234');
  check('spend SMS → the bank\'s available limit lands on the card', card()?.reportedAvailable?.amount === 123456.78, JSON.stringify(card()?.reportedAvailable));
  check('…and is NOT left on the stored transaction', !('availableLimit' in G().transactions[0]) && !('reportedCreditLimit' in G().transactions[0]));
  send('Your available limit is Rs 1,20,000 on HDFC Credit Card xx1234', 10, 'l2');
  check('a limit NOTICE updates it (no transaction booked)', card().reportedAvailable.amount === 120000 && G().transactions.length === 1, JSON.stringify(card().reportedAvailable));
  send('Rs 50 spent on HDFC Bank Credit Card x1234 at CAFE. Avl Limit: INR 1,30,000', 60, 'l3');
  check('an OLDER SMS never overwrites a newer figure', card().reportedAvailable.amount === 120000);
  send('Rs 2,000 spent on HDFC Credit Card xx1234 at MYNTRA. Total Credit Limit: Rs 2,00,000 Available Credit Limit: Rs 1,18,000', 5, 'l4');
  check('a reported TOTAL limit becomes the card\'s credit limit', card().creditLimit === 200000 && card().reportedAvailable.amount === 118000);

  // Combined limit: a second HDFC card, linked.
  send('Rs.700.00 spent on HDFC Bank Credit Card x5678 at UBER. Avl Limit: INR 1,17,300', 2, 'l5');
  const card2 = () => G().accounts.find((a) => a.mask === '5678');
  G().setCreditLimit(card2().id, 150000);
  G().linkCardLimits(card().id, card2().id);
  check('link: one group, the FIRST card\'s limit shared', !!card().limitGroupId && card().limitGroupId === card2().limitGroupId && card2().creditLimit === 200000);
  G().setCreditLimit(card2().id, 250000);
  check('setting the limit on either card updates both', card().creditLimit === 250000 && card2().creditLimit === 250000);
  send('Your HDFC Credit Card xx5678 Total Credit Limit: Rs 3,00,000 Available limit is Rs 1,17,000', 1, 'l6');
  check('a reported total on one card reaches the whole group', card().creditLimit === 300000 && card2().creditLimit === 300000);
  G().dismissLimitLinkSuggestion(card2().id, card().id);
  check('declines are remembered order-independently', (G().declinedLimitLinks || []).length === 1);
  G().unlinkCardLimit(card().id);
  check('unlink → both standalone, each back to ITS OWN pre-link limit', !card().limitGroupId && !card2().limitGroupId && card().creditLimit === 200000 && card2().creditLimit === 150000, `${card().creditLimit} ${card2().creditLimit}`);
  check('…no leftover bookkeeping, own bank figure kept', !('limitBeforeLink' in card()) && !('limitBeforeLink' in card2()) && card2().reportedAvailable?.amount === 117000);
  // A card with NO limit before linking goes back to none.
  useStore.setState((st) => ({ accounts: st.accounts.map((a) => (a.id === card2().id ? { ...a, creditLimit: null } : a)) }));
  G().linkCardLimits(card().id, card2().id);
  check('…(setup) linked, the no-limit card now shows the shared limit', card2().creditLimit === 200000);
  G().unlinkCardLimit(card2().id);
  check('unlink a card that had no limit → no limit again', card2().creditLimit === null && card().creditLimit === 200000 && !card().limitGroupId, `${card2().creditLimit} ${card().creditLimit}`);

  // Debit card ↔ bank: link, then the new unlink.
  reset();
  useStore.setState({ accounts: [
    { id: 'bank', type: 'Bank', name: 'HDFC', bankName: 'HDFC', mask: '9999', balance: 10000, aliasMasks: [] },
    { id: 'dc', type: 'Debit Card', name: 'HDFC DC', bankName: 'HDFC', mask: '4444', balance: -300 },
  ], transactions: [
    { id: 't1', accountId: 'dc', accountMask: '4444', type: 'debit', amount: 300, createdAt: at(50), categoryId: 'food' },
    { id: 't2', accountId: 'bank', accountMask: '9999', type: 'debit', amount: 1000, createdAt: at(40), categoryId: 'bills' },
  ] });
  G().linkDebitCardToBank('dc', 'bank');
  // After the link, a card SMS lands on the bank (aliasMasks) but keeps the card's mask.
  G().ingestMessage('Rs 200.00 spent on HDFC Bank Debit Card xx4444 at CAFE COFFEE', { sender: 'HDFCBK', receivedAt: at(5), smsId: 'dc-after-link' });
  const t3 = G().transactions.find((t) => t.smsId === 'dc-after-link');
  check('setup: the post-link card spend landed on the bank', t3?.accountId === 'bank' && t3?.accountMask === '4444', JSON.stringify(t3 && { a: t3.accountId, m: t3.accountMask }));
  const bankBal = () => G().accounts.find((a) => a.id === 'bank').balance;
  const before = bankBal();
  const newCard = G().unlinkDebitCardFromBank('bank', '4444');
  const dc = G().accounts.find((a) => a.id === newCard);
  check('unlink re-creates the debit card with the card\'s mask', dc?.type === 'Debit Card' && dc.mask === '4444');
  check('…moves ONLY the card\'s txns back (bank\'s own stays)', G().transactions.find((t) => t.id === 't1').accountId === newCard && G().transactions.find((t) => t.smsId === 'dc-after-link').accountId === newCard && G().transactions.find((t) => t.id === 't2').accountId === 'bank');
  check('…and its money movement: bank +500, card −500', bankBal() === before + 500 && dc.balance === -500, `${bankBal()} ${before} ${dc.balance}`);
  check('…the alias is gone, the pair stays declined', !G().accounts.find((a) => a.id === 'bank').aliasMasks.includes('4444') && (G().declinedAccountLinks || []).length === 1);
}

console.log('\n— Existing-user safety for the card-limit change (Oct-10-26) —');
{
  // v41: phantom "available credit limit is Rs X" spends get IGNORED (reversible).
  const migrate = useStore.persist.getOptions().migrate;
  const legacy = {
    accounts: [{ id: 'cc', type: 'Credit Card', mask: '7788', balance: -50500 }],
    suppressedSmsIds: [],
    transactions: [
      { id: 'ph', source: 'sms', smsId: 'sms-ph', amount: 50000, type: 'debit', accountId: 'cc', categoryId: 'other', createdAt: '2026-09-01T10:00:00Z',
        smsText: 'Dear Customer, your available credit limit is Rs. 50,000 on SBI Card ending 7788' },
      { id: 'real', source: 'sms', amount: 500, type: 'debit', accountId: 'cc', categoryId: 'shopping', createdAt: '2026-09-02T10:00:00Z',
        smsText: 'Rs 500 spent on SBI Credit Card ending 7788 at AMAZON. Available limit is Rs 45,000' },
      { id: 'touched', source: 'sms', amount: 9000, type: 'debit', accountId: 'cc', categoryId: 'shopping', userEditedCategory: true, createdAt: '2026-09-03T10:00:00Z',
        smsText: 'Your available credit limit is Rs 9,000 on SBI Card ending 7788' },
    ],
  };
  const m = migrate(legacy, 40);
  const byId = (id) => m.transactions.find((t) => t.id === id);
  check('v41: phantom limit "spend" → Ignored, its ₹50,000 given back to the card', byId('ph').isIgnored === true && m.accounts[0].balance === -500, `${m.accounts[0].balance}`);
  check('v41: …and its SMS won\'t be re-imported', (m.suppressedSmsIds || []).includes('sms-ph'));
  check('v41: a REAL spend that mentions the limit is untouched', !byId('real').isIgnored);
  check('v41: a row the user already re-categorised is left alone', !byId('touched').isIgnored);
  check('v41: current data with no phantoms passes through unchanged', migrate({ accounts: [], transactions: [] }, 40).transactions.length === 0);

  // Old cards (no reportedAvailable / limitGroupId) compute exactly as before.
  reset();
  const G = () => useStore.getState();
  useStore.setState({ accounts: [{ id: 'old', type: 'Credit Card', name: 'Old', mask: '1111', balance: -25000, creditLimit: 100000 }] });
  const { cardLimitPosition } = await import(`${PROJECT_ROOT}/src/utils/cardLimit.ts`);
  const pos = cardLimitPosition(G().accounts[0], G().accounts, []);
  check('an existing card (no new fields) → same Available/Utilization as before', pos.available === 75000 && pos.utilization === 0.25 && pos.source === 'limit');
  G().unlinkCardLimit('old');
  check('unlink on a never-linked card is a no-op', G().accounts[0].creditLimit === 100000);

  // Debit unlink respects a balance the user set by hand after linking.
  reset();
  const t = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  useStore.setState({ accounts: [
    { id: 'bank', type: 'Bank', name: 'HDFC', bankName: 'HDFC', mask: '9999', balance: 8000, aliasMasks: ['4444'], anchoredAt: Date.now() - 30 * 60000 },
  ], transactions: [
    { id: 'pre', accountId: 'bank', accountMask: '4444', type: 'debit', amount: 300, createdAt: t(60), categoryId: 'food' },
    { id: 'post', accountId: 'bank', accountMask: '4444', type: 'debit', amount: 200, createdAt: t(10), categoryId: 'food' },
  ] });
  const cid = G().unlinkDebitCardFromBank('bank', '4444');
  check('debit unlink after a hand-set balance: only the LATER card spend leaves the bank', G().accounts.find((a) => a.id === 'bank').balance === 8200 && G().accounts.find((a) => a.id === cid).balance === -500, `${G().accounts.find((a) => a.id === 'bank').balance} ${G().accounts.find((a) => a.id === cid).balance}`);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
