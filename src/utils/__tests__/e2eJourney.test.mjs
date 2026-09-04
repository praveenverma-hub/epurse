// =============================================================================
// END-TO-END USER JOURNEY — MVP acceptance pass
// -----------------------------------------------------------------------------
//   node --import ./src/utils/__tests__/_store-hook.mjs \
//        src/utils/__tests__/e2eJourney.test.mjs
//   npm run test:e2e
//
// This is deliberately NOT a bag of isolated unit checks. It drives the REAL
// store (getState().ingestMessage / addTransaction / tagTransactionToGroup /
// settlePersonBalance / setBudget …) through one continuous, realistic month —
// accounts → expenses → balance upkeep → lending & splitting → groups →
// budget — and asserts the INVARIANTS a real user would notice breaking at
// each step. Isolated unit tests miss exactly the bugs this catches: two
// features that are each individually correct but disagree once combined
// (e.g. a split's LB leg surviving a delete, or a group exclusion the budget
// selector forgot to apply).
//
// Every `check()` failure below is either a real defect (reported at the
// bottom of the run) or a place this test's own understanding of the store's
// contract was wrong — both are useful, which is why this exists.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_store-hook.mjs', import.meta.url);

const mod = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js');
const useStore = mod.useEPurseStore || mod.default;
const { isGroupExcluded } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/split.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m', yellow: '\x1b[33m' };
let pass = 0, fail = 0;
const findings = []; // { severity, phase, name, detail }
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
/** A finding is a check that failed AND represents a real user-facing defect
 *  (as opposed to this test getting the contract wrong) — collected separately
 *  so the final report reads as feedback, not just a pass count. */
const finding = (severity, phase, name, cond, detail = '') => {
  check(name, cond, detail);
  if (!cond) findings.push({ severity, phase, name, detail });
};
const phase = (title) => console.log(`\n${C.bold}══════ ${title} ══════${C.reset}\n`);

const reset = () =>
  useStore.setState({
    transactions: [], accounts: [], archivedTransactions: [], lentBorrowed: [],
    suppressedSmsIds: [], monthlyAggregates: {}, groups: [], lastSmsDate: null,
    userOnboardedAt: 0, activeGroupZoneId: null, manualTxnSeq: 0,
    pendingCCPaymentQueue: [], ccHandledSmsIds: [], userPhones: [],
    budget: null, budgetHistory: {}, budgetBreachNotified: {},
    excludedExpenseParents: [],
    showMonthlyRecap: true, pendingMonthlyRecap: null, recapMonthHandled: null,
    monthlyRecapCardDismissed: null, showWeeklySummary: true,
    pendingWeeklyRecap: null, weeklyRecapHandled: null,
  });

const ingest = (sender, body, opts = {}) =>
  useStore.getState().ingestMessage(body, { sender, receivedAt: Date.now(), ...opts });
const accts = () => useStore.getState().accounts;
const acct = (mask) => accts().find((a) => a.mask === mask);
const txns = () => useStore.getState().transactions.filter((t) => !t.isIgnored);
const allTxns = () => useStore.getState().transactions;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Anchored to real "now", clamped inside the current calendar month (see
// storeIntegration.test.mjs for why a flat "N days ago" is calendar-unsafe on
// the 1st/2nd of a month — getMonthlySpend() only counts the CURRENT month).
const MONTH_START = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const NOW = Math.min(Date.now() - 60_000, Math.max(Date.now() - 5 * 86_400_000, MONTH_START + 3_600_000));

console.log(`${C.bold}\nE2E JOURNEY — MVP acceptance pass${C.reset}`);
console.log(`Anchor date: ${new Date(NOW).toISOString()}\n`);

// =============================================================================
// PHASE 1 — ACCOUNTS: manual creation + SMS auto-create
// =============================================================================
phase('PHASE 1 — Accounts');
reset();

// 1a. Manual account (the AddAccountModal path) — a Cash wallet with an
// opening balance the user typed in themselves.
useStore.getState().addAccount({
  id: 'cash1', type: 'Cash', bankName: 'Cash', mask: null,
  balance: 5000, aliasMasks: [],
});
check('manual account appears in the list', accts().some((a) => a.id === 'cash1'));
check('manual account keeps the balance the user entered',
  acct('cash1')?.balance === undefined && accts().find((a) => a.id === 'cash1')?.balance === 5000);

// 1b. SMS auto-create (the real onboarding path: the FIRST SMS from a bank
// the user has never seen creates the account, not a form).
ingest('HDFCBK', 'Rs.50000.00 credited to A/c XX4021 towards Salary on 01-08-26.',
  { smsId: 'sal-open', receivedAt: NOW });
const bank = acct('4021');
finding('critical', 'Accounts', 'a first-time bank SMS auto-creates the account',
  !!bank, 'no account was created — the whole SMS ingestion path is broken for new users');
finding('critical', 'Accounts', 'the auto-created account is typed as a Bank account',
  bank?.type === 'Bank', `type=${bank?.type}`);
finding('critical', 'Accounts', 'opening balance comes from the credit amount',
  bank?.balance === 50000, `balance=${bank?.balance}`);

// 1c. A second, unrelated bank SMS auto-creates a SECOND distinct account
// (masks differ) — the #1 way a merge bug shows up is two real accounts
// silently collapsing into one.
ingest('ICICIB', 'Rs.20000.00 debited from A/c XX7788 for NEFT to LANDLORD on 01-08-26.',
  { smsId: 'rent-open', receivedAt: NOW + 1000 });
finding('critical', 'Accounts', 'a different bank+mask creates a SEPARATE account, not a merge',
  accts().length === 3 && !!acct('7788'),
  `accounts: ${accts().map((a) => `${a.bankName}/${a.mask}`).join(', ')}`);

console.log(`\n  ${accts().length} accounts on the books: ` +
  accts().map((a) => `${a.bankName || a.type} ${a.mask || ''} ₹${a.balance}`).join(' · '));

// =============================================================================
// PHASE 2 — EXPENSES: SMS + manual, and balance deduction on both paths
// =============================================================================
phase('PHASE 2 — Adding expenses & balance deduction');

const hdfcBefore = acct('4021').balance;
ingest('HDFCBK', 'Rs.850.00 debited from A/c XX4021 at SWIGGY on 03-08-26.',
  { smsId: 'sw-1', receivedAt: NOW + 2000 });
const swiggyTxn = txns().find((t) => t.merchant?.toUpperCase().includes('SWIGGY'));
finding('critical', 'Expenses', 'an SMS debit is parsed into a transaction',
  !!swiggyTxn, 'the parser rejected or dropped a plainly-valid debit SMS');
finding('critical', 'Expenses', 'the account balance is debited by EXACTLY the SMS amount',
  round2(acct('4021').balance) === round2(hdfcBefore - 850),
  `before ${hdfcBefore}, after ${acct('4021').balance}, expected ${hdfcBefore - 850}`);
finding('major', 'Expenses', 'a known food-delivery merchant is auto-categorised',
  swiggyTxn?.categoryId === 'food' || swiggyTxn?.parentCategory === 'Food & Dining',
  `categoryId=${swiggyTxn?.categoryId} parentCategory=${swiggyTxn?.parentCategory}`);

// Manual expense — the OTHER way money leaves an account (AddTransactionScreen,
// no SMS involved: cash, or a bank that doesn't send SMS).
const cashBefore = accts().find((a) => a.id === 'cash1').balance;
useStore.getState().addTransaction({
  amount: 300, type: 'debit', accountId: 'cash1', merchant: 'Street food',
  categoryId: 'food', createdAt: new Date(NOW + 3000).toISOString(),
});
finding('critical', 'Expenses', 'a MANUAL expense also deducts the account balance',
  round2(accts().find((a) => a.id === 'cash1').balance) === round2(cashBefore - 300),
  `before ${cashBefore}, after ${accts().find((a) => a.id === 'cash1').balance}`);

// Income — the balance must go the OTHER way, and it must not show up as spend.
// ("towards Reversal", not "towards Cashback" — see PHASE 8 below for why that
// second, equally realistic phrasing silently vanishes instead of crediting.)
const hdfcBeforeCredit = acct('4021').balance;
const spendBeforeIncome = useStore.getState().getMonthlySpend();
ingest('HDFCBK', 'Rs.2000.00 credited to A/c XX4021 towards Interest on 04-08-26.',
  { smsId: 'cb-1', receivedAt: NOW + 4000 });
finding('critical', 'Expenses', 'a credit increases the balance by the credited amount',
  round2(acct('4021').balance) === round2(hdfcBeforeCredit + 2000),
  `before ${hdfcBeforeCredit}, after ${acct('4021').balance}`);
finding('minor', 'Expenses', 'a plain credit does not inflate monthly SPEND',
  useStore.getState().getMonthlySpend() === spendBeforeIncome,
  `spend before ${spendBeforeIncome}, after ${useStore.getState().getMonthlySpend()}`);

// =============================================================================
// PHASE 3 — BALANCE MAINTENANCE: self-transfer, ignore, delete
// =============================================================================
phase('PHASE 3 — Balance maintenance under edits');

// 3a. A dual-leg self-transfer between the user's OWN two accounts, both legs
// named in ONE SMS (the case the parser can actually resolve — see PHASE 8 for
// the equally-real case it can't: two SEPARATE bank SMS linked only by a
// shared NEFT reference). Balances on BOTH accounts must still move (real
// money moved), but it must NOT count as spend or income (it isn't income or
// an expense — it's the same money, one hop sideways).
const hdfcBeforeXfer = acct('4021').balance;
const iciciBeforeXfer = acct('7788').balance;
const spendBeforeXfer = useStore.getState().getMonthlySpend();
const incomeBeforeXfer = useStore.getState().getMonthlyIncome();
// "A/c X debited... A/c Y credited" — mask BEFORE verb. See PHASE 8c: the
// equally natural "debited from A/c X and credited to A/c Y" phrasing (verb
// BEFORE mask) silently reverses which account is debited vs credited.
ingest('HDFCBK', 'A/c XX4021 debited with Rs.5000.00 and A/c XX7788 credited on 05-08-26.',
  { smsId: 'xfer-1', receivedAt: NOW + 5000 });
finding('critical', 'Balance upkeep', 'a same-SMS self-transfer moves BOTH account balances',
  round2(acct('4021').balance) === round2(hdfcBeforeXfer - 5000)
  && round2(acct('7788').balance) === round2(iciciBeforeXfer + 5000),
  `HDFC ${hdfcBeforeXfer}→${acct('4021').balance}, ICICI ${iciciBeforeXfer}→${acct('7788').balance}`);
finding('critical', 'Balance upkeep', 'a same-SMS self-transfer is excluded from monthly spend',
  useStore.getState().getMonthlySpend() === spendBeforeXfer,
  `spend before ${spendBeforeXfer}, after ${useStore.getState().getMonthlySpend()}`);
finding('major', 'Balance upkeep', '…and from monthly income too (the receiving leg is not a windfall)',
  useStore.getState().getMonthlyIncome() === incomeBeforeXfer,
  `income before ${incomeBeforeXfer}, after ${useStore.getState().getMonthlyIncome()}`);

// 3b. Ignoring a transaction. Per the app's OWN confirm-dialog copy
// ("Removes it from all balances, totals, and charts... treated as if it
// never happened" — DashboardScreen.js / DailyQueueStack.js / TransactionsScreen.js),
// "Ignore" is a REVERSIBLE version of delete, not a "hide but keep the real-world
// balance effect" toggle. So the contract to verify is the opposite of my first
// instinct: the balance MUST bounce back on ignore, and MUST be re-applied on
// un-ignore — matching what the UI promises the user.
const hdfcBeforeIgnore = acct('4021').balance;
const spendBeforeIgnore = useStore.getState().getMonthlySpend();
useStore.getState().ignoreTransaction(swiggyTxn.id);
finding('critical', 'Balance upkeep', 'ignoring a transaction refunds the balance (matches the "never happened" promise)',
  round2(acct('4021').balance) === round2(hdfcBeforeIgnore + 850),
  `before ${hdfcBeforeIgnore}, after ${acct('4021').balance}`);
finding('major', 'Balance upkeep', 'ignoring a transaction removes it from monthly spend',
  round2(useStore.getState().getMonthlySpend()) === round2(spendBeforeIgnore - 850),
  `before ${spendBeforeIgnore}, after ${useStore.getState().getMonthlySpend()}`);
useStore.getState().unignoreTransaction(swiggyTxn.id);
finding('minor', 'Balance upkeep', 'un-ignoring restores both the spend line and the balance debit',
  round2(useStore.getState().getMonthlySpend()) === round2(spendBeforeIgnore)
  && round2(acct('4021').balance) === round2(hdfcBeforeIgnore),
  `spend ${useStore.getState().getMonthlySpend()}, balance ${acct('4021').balance}`);

// 3c. Deleting a transaction outright — the opposite of ignore: the user is
// saying "this never happened" (e.g. a duplicate/mis-parsed SMS), so the
// balance MUST be put back.
const cashBeforeDelete = accts().find((a) => a.id === 'cash1').balance;
const manualTxn = allTxns().find((t) => t.merchant === 'Street food');
useStore.getState().deleteTransaction(manualTxn.id);
finding('critical', 'Balance upkeep', 'deleting a transaction DOES refund the balance',
  round2(accts().find((a) => a.id === 'cash1').balance) === round2(cashBeforeDelete + 300),
  `before ${cashBeforeDelete}, after ${accts().find((a) => a.id === 'cash1').balance}`);

// =============================================================================
// PHASE 4 — LENT & BORROWED (direct tagging) + settle-up
// =============================================================================
phase('PHASE 4 — Lent & Borrowed');

// 4a. Tag an existing bank-SMS expense as money LENT to a friend (the "I paid
// for both of us, no split needed, they'll pay me back in full" case — direct
// LB tagging, not the split flow).
ingest('HDFCBK', 'Rs.1200.00 debited from A/c XX4021 at PVR CINEMAS on 06-08-26.',
  { smsId: 'pvr-1', receivedAt: NOW + 6000 });
const pvrTxn = txns().find((t) => t.merchant?.toUpperCase().includes('PVR'));
const spendBeforeLend = useStore.getState().getMonthlySpend();
useStore.getState().updateTransactionCategoryWithContact(pvrTxn.id, 'lent',
  { person: 'Rohit', phone: '9876543210' });
const rohit = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Rohit');
finding('critical', 'Lent/Borrowed', 'tagging an expense as "lent" creates a person balance',
  !!rohit() && rohit().net === 1200, `net=${rohit()?.net}`);
finding('critical', 'Lent/Borrowed', 'a "lent" tag does NOT double-count as spend (money already left, but it is a loan, not an expense)',
  round2(useStore.getState().getMonthlySpend()) === round2(spendBeforeLend - 1200),
  `before ${spendBeforeLend}, after ${useStore.getState().getMonthlySpend()}`);
finding('major', 'Lent/Borrowed', 'the underlying transaction locks against re-categorisation',
  !!allTxns().find((t) => t.id === pvrTxn.id)?.lbLocked);

// 4b. The reverse — a friend paid for ME (I owe them). Modelled as a manual
// "borrowed" ledger entry (LentBorrowedScreen's "+ Add" flow, no transaction).
useStore.getState().addLentBorrowed({ kind: 'borrowed', person: 'Priya', phone: '9123456780', amount: 400, note: 'Coffee' });
const priya = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Priya');
finding('major', 'Lent/Borrowed', 'a manual "borrowed" entry nets negative (I owe them)',
  priya()?.net === -400, `net=${priya()?.net}`);

// 4c. Settle up with Rohit (he pays ME back — a "lent" settle should NOT touch
// any account balance; it's outside the banking system until it shows up as
// its own SMS).
const hdfcBeforeSettle = acct('4021').balance;
useStore.getState().settlePersonBalance(rohit().personKey);
finding('critical', 'Lent/Borrowed', 'settling a LENT balance nets it to zero',
  rohit()?.net === 0 || rohit() === undefined, `net=${rohit()?.net}`);
finding('major', 'Lent/Borrowed', 'settling a lend the friend paid IN CASH does not touch a bank balance',
  round2(acct('4021').balance) === round2(hdfcBeforeSettle),
  `before ${hdfcBeforeSettle}, after ${acct('4021').balance}`);

// 4d. Settle up a BORROW (I owe Priya) by paying her FROM my bank account —
// this is the one settle path that SHOULD move a real balance, because the
// user picked an account to pay from (opts.accountId).
const hdfcBeforeRepay = acct('4021').balance;
useStore.getState().settlePersonBalance(priya().personKey, { accountId: acct('4021').id });
finding('critical', 'Lent/Borrowed', 'settling a BORROW with an account books a real expense that debits it',
  round2(acct('4021').balance) === round2(hdfcBeforeRepay - 400),
  `before ${hdfcBeforeRepay}, after ${acct('4021').balance}`);
finding('major', 'Lent/Borrowed', '…and the borrow balance clears to zero',
  priya()?.net === 0 || priya() === undefined, `net=${priya()?.net}`);

// =============================================================================
// PHASE 5 — SPLIT EXPENSES (direct, non-group)
// =============================================================================
phase('PHASE 5 — Split expenses');

// 5a. I pay for a group dinner, split 3 ways (me + 2 friends, equal split).
// The FULL amount must leave MY account (I fronted it); only MY share should
// count as MY spend; the other two legs become "lent" rows.
ingest('HDFCBK', 'Rs.3000.00 debited from A/c XX4021 at BARBEQUE NATION on 07-08-26.',
  { smsId: 'bbq-1', receivedAt: NOW + 7000 });
const bbqTxn = txns().find((t) => t.merchant?.toUpperCase().includes('BARBEQUE'));
const hdfcBeforeSplit = acct('4021').balance;
const spendBeforeSplit = useStore.getState().getMonthlySpend();
useStore.getState().setTransactionSplit(bbqTxn.id, [
  { name: 'Amit' }, { name: 'Sunil' },
], { mode: 'percent' });
const split = allTxns().find((t) => t.id === bbqTxn.id);
finding('critical', 'Splits', 'splitting an expense debits the FULL amount up front (I fronted the money)',
  round2(acct('4021').balance) === round2(hdfcBeforeSplit),
  `the split itself should not re-touch the balance — before ${hdfcBeforeSplit}, after ${acct('4021').balance}`);
finding('critical', 'Splits', 'a 3-way equal split gives me ~1/3 of the spend, not the full ₹3000',
  Math.abs((split?.myShareAmount ?? 0) - 1000) < 1,
  `myShareAmount=${split?.myShareAmount}`);
finding('major', 'Splits', 'monthly spend reflects only MY share of a split expense',
  Math.abs(useStore.getState().getMonthlySpend() - (spendBeforeSplit - 3000 + (split?.myShareAmount ?? 0))) < 1,
  `spend before ${spendBeforeSplit}, after ${useStore.getState().getMonthlySpend()}, my share ${split?.myShareAmount}`);
const amit = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Amit');
const sunil = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Sunil');
finding('critical', 'Splits', 'each friend owes their own share as a "lent" balance',
  Math.abs((amit()?.net ?? 0) - 1000) < 1 && Math.abs((sunil()?.net ?? 0) - 1000) < 1,
  `Amit net=${amit()?.net}, Sunil net=${sunil()?.net}`);

// 5b. Someone ELSE paid, and I owe just my share — the split-memo path. No
// balance should move (I didn't pay), and it must NOT count as my spend.
ingest('HDFCBK', 'Rs.900.00 debited from A/c XX4021 at DOMINOS on 08-08-26.',
  { smsId: 'dom-1', receivedAt: NOW + 8000 });
// This SMS is a stand-in for "the group ordered and Neha actually paid" —
// in the real app this would be a manual add with no matching SMS at all, or
// the user re-tags an SMS that was actually a REFUND from Neha. To isolate the
// memo mechanic itself (rather than re-deriving a whole scenario), delete the
// SMS-driven leg and add the memo split as a manual entry instead, which is
// the actual UI path (AddTransactionScreen → "who paid?" → not me).
const domTxn = txns().find((t) => t.merchant?.toUpperCase().includes('DOMINO'));
useStore.getState().deleteTransaction(domTxn.id); // undo the stand-in SMS's balance effect
const hdfcBeforeMemo = acct('4021').balance;
const spendBeforeMemo = useStore.getState().getMonthlySpend();
useStore.getState().addTransaction({
  amount: 900, type: 'debit', accountId: '4021', merchant: 'Dominos (Neha paid)',
  categoryId: 'food', isSplit: true, myShareAmount: 300,
  splitOthers: [{ name: 'Kabir', shareAmount: 600 }],
  splitPaidBy: { name: 'Neha' },
  createdAt: new Date(NOW + 8500).toISOString(),
});
finding('critical', 'Splits', 'a memo split (someone else paid) does NOT touch my account balance',
  round2(acct('4021').balance) === round2(hdfcBeforeMemo),
  `before ${hdfcBeforeMemo}, after ${acct('4021').balance}`);
finding('critical', 'Splits', 'a memo split does NOT count as my spend',
  round2(useStore.getState().getMonthlySpend()) === round2(spendBeforeMemo),
  `before ${spendBeforeMemo}, after ${useStore.getState().getMonthlySpend()}`);
const neha = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Neha');
finding('critical', 'Splits', 'I owe the PAYER (Neha) my own share only — not the full bill',
  Math.abs((neha()?.net ?? 0) - (-300)) < 1, `Neha net=${neha()?.net} (expect -300, meaning I owe her ₹300)`);

// =============================================================================
// PHASE 6 — GROUPS: personal exclusion + shared group split
// =============================================================================
phase('PHASE 6 — Groups');

// 6a. A PERSONAL group with "exclude from totals" — spend inside it must
// vanish from every top-level total, but the transaction itself still lists.
useStore.getState().createGroup({ name: 'House Renovation', type: 'personal', excludeFromTotals: true });
const houseGroup = useStore.getState().groups.find((g) => g.name === 'House Renovation');
ingest('HDFCBK', 'Rs.15000.00 debited from A/c XX4021 at TILE WORLD on 09-08-26.',
  { smsId: 'tile-1', receivedAt: NOW + 9000 });
const tileTxn = txns().find((t) => t.merchant?.toUpperCase().includes('TILE'));
const spendBeforeGroupTag = useStore.getState().getMonthlySpend();
useStore.getState().tagTransactionToGroup(tileTxn.id, houseGroup.id);
finding('major', 'Groups', 'tagging into an EXCLUDED personal group removes it from monthly spend',
  round2(useStore.getState().getMonthlySpend()) === round2(spendBeforeGroupTag - 15000),
  `before ${spendBeforeGroupTag}, after ${useStore.getState().getMonthlySpend()}`);
finding('minor', 'Groups', '…but the transaction itself is untouched (still lists, balance already moved)',
  !!allTxns().find((t) => t.id === tileTxn.id && t.groupId === houseGroup.id));

// 6b. A SHARED group trip: I pay, split 2 ways with a group member. Same
// balance/spend/LB contract as a direct split (§5a), but via the group path —
// worth re-proving because groups and direct splits are two DIFFERENT code
// paths (buildGroupLbRows vs setTransactionSplit) that must agree.
useStore.getState().createGroup({ name: 'Goa Trip', type: 'shared', members: [{ memberId: 'c_vikram', name: 'Vikram' }] });
const goaGroup = useStore.getState().groups.find((g) => g.name === 'Goa Trip');
const hdfcBeforeGroupExpense = acct('4021').balance;
const spendBeforeGroupExpense = useStore.getState().getMonthlySpend();
useStore.getState().addGroupExpense(goaGroup.id, {
  amount: 4000, merchant: 'Beach Resort', categoryId: 'travel',
  paidByMemberId: 'me', paidByName: 'You',
  shares: [{ memberId: 'me', name: 'You', shareAmount: 2000 }, { memberId: 'c_vikram', name: 'Vikram', shareAmount: 2000 }],
  accountId: acct('4021').id,
});
finding('critical', 'Groups', 'a shared-group expense debits the FULL amount from the payer account',
  round2(acct('4021').balance) === round2(hdfcBeforeGroupExpense - 4000),
  `before ${hdfcBeforeGroupExpense}, after ${acct('4021').balance}`);
finding('major', 'Groups', "monthly spend rises by only MY share (₹2000) of the ₹4000 group expense",
  Math.abs(useStore.getState().getMonthlySpend() - (spendBeforeGroupExpense + 2000)) < 1,
  `spend before ${spendBeforeGroupExpense}, after ${useStore.getState().getMonthlySpend()} (expected +2000, not +4000)`);
const vikram = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Vikram');
finding('critical', 'Groups', 'the group member owes their share via the SAME LB ledger as a direct split',
  Math.abs((vikram()?.net ?? 0) - 2000) < 1, `Vikram net=${vikram()?.net}`);

// 6c. Settle the group member — must be GROUP-SCOPED (only zeroes what they
// owe from THIS group), not their whole cross-app balance.
useStore.getState().addLentBorrowed({ kind: 'lent', person: 'Vikram', contactId: 'c_vikram', amount: 500, note: 'Unrelated IOU' });
finding('minor', 'Groups', 'a group member can also carry a balance OUTSIDE the group (setup check)',
  Math.abs((vikram()?.net ?? 0) - 2500) < 1, `Vikram net=${vikram()?.net} (expect 2500 = 2000 group + 500 outside)`);
useStore.getState().settleGroupPersonBalance(goaGroup.id, vikram().personKey);
finding('critical', 'Groups', 'a GROUP settle only clears the GROUP portion, not the whole person',
  Math.abs((vikram()?.net ?? 0) - 500) < 1,
  `Vikram net=${vikram()?.net} (expect 500 — the unrelated IOU must survive)`);

// =============================================================================
// PHASE 7 — BUDGET MONITORING
// =============================================================================
phase('PHASE 7 — Budget monitoring');
reset(); // clean month: budget math reads THIS calendar month, and phases 1-6
         // deliberately spanned several days of it — start clean to reason about it.

// Re-open one bank account for this phase.
ingest('HDFCBK', 'Rs.100000.00 credited to A/c XX4021 towards Salary on 01-08-26.',
  { smsId: 'sal-2', receivedAt: MONTH_START + 3_600_000 });

useStore.getState().updateBudgetCategory('food', 3000);
useStore.getState().updateBudgetCategory('shopping', 2000);
let usage = useStore.getState().getBudgetUsage();
finding('critical', 'Budget', 'setting category caps produces a DERIVED total (never edited directly)',
  usage?.total?.cap === 5000, `total.cap=${usage?.total?.cap}`);
finding('major', 'Budget', 'usage starts at zero before any spend this month',
  usage?.total?.actual === 0, `total.actual=${usage?.total?.actual}`);

// Spend under the cap.
ingest('HDFCBK', 'Rs.1500.00 debited from A/c XX4021 at SWIGGY on 02-08-26.',
  { smsId: 'bud-sw-1', receivedAt: MONTH_START + 2 * 3_600_000 });
usage = useStore.getState().getBudgetUsage();
finding('critical', 'Budget', 'a categorised expense counts toward its budget line',
  usage?.perCategory?.food?.actual === 1500, `food.actual=${usage?.perCategory?.food?.actual}`);
finding('minor', 'Budget', 'still reads as UNDER cap',
  usage?.perCategory?.food?.over === false, `over=${usage?.perCategory?.food?.over}`);

// Spend that pushes it OVER the cap.
ingest('HDFCBK', 'Rs.2000.00 debited from A/c XX4021 at ZOMATO on 03-08-26.',
  { smsId: 'bud-sw-2', receivedAt: MONTH_START + 3 * 3_600_000 });
usage = useStore.getState().getBudgetUsage();
finding('critical', 'Budget', 'crossing the cap flips `over` true and reports the right overshoot',
  usage?.perCategory?.food?.over === true && round2(usage?.perCategory?.food?.overshoot) === 500,
  `actual=${usage?.perCategory?.food?.actual} cap=${usage?.perCategory?.food?.cap} overshoot=${usage?.perCategory?.food?.overshoot}`);

// A refund AGAINST that category should reduce usage (a returned purchase
// lowers what the category has actually cost this month).
ingest('HDFCBK', 'Rs.500.00 credited to A/c XX4021 as refund from ZOMATO on 04-08-26.',
  { smsId: 'bud-refund', receivedAt: MONTH_START + 4 * 3_600_000 });
const refundTxn = allTxns().find((t) => t.merchant?.toUpperCase().includes('ZOMATO') && t.type !== 'debit');
if (refundTxn && !refundTxn.isRefund) useStore.getState().setTransactionRefund(refundTxn.id, true);
usage = useStore.getState().getBudgetUsage();
finding('major', 'Budget', 'a refund lowers the category\'s budget usage',
  round2(usage?.perCategory?.food?.actual) === 3000,
  `food.actual=${usage?.perCategory?.food?.actual} (expect 1500+2000-500=3000)`);

// Spend-rules exclusion: a parent the user excluded must vanish from BOTH the
// unbudgeted total AND (if it were budgeted) its own budget line. This is the
// cross-feature seam most likely to rot, since it has to be re-checked at
// every summing site (see the spend-rules skill/memory).
ingest('HDFCBK', 'Rs.1000.00 debited from A/c XX4021 at LIC PREMIUM on 05-08-26.',
  { smsId: 'lic-1', receivedAt: MONTH_START + 5 * 3_600_000 });
const licTxn = txns().find((t) => t.merchant?.toUpperCase().includes('LIC'));
const unbudgetedBefore = useStore.getState().getBudgetUsage()?.unbudgeted;
finding('minor', 'Budget', 'an unbudgeted-category expense shows up in the unbudgeted bucket',
  unbudgetedBefore >= 999, `unbudgeted=${unbudgetedBefore} (txn categoryId=${licTxn?.categoryId})`);
if (licTxn?.categoryId) {
  const parentId = licTxn.parentCategory ? licTxn.categoryId : licTxn.categoryId;
  useStore.getState().setExpenseParentCounted(parentId, false);
  const usageAfterExclusion = useStore.getState().getBudgetUsage();
  finding('major', 'Budget', 'a spend-rules-excluded category leaves the unbudgeted bucket too',
    usageAfterExclusion?.unbudgeted < unbudgetedBefore,
    `unbudgeted before ${unbudgetedBefore}, after ${usageAfterExclusion?.unbudgeted}`);
}

// LB tagging must never leak into budget usage — it already left food/shopping
// once as a real expense; tagging it "lent" would double-remove it, or worse,
// leaving it categorised would double-COUNT it as both a budget line and a debt.
ingest('HDFCBK', 'Rs.800.00 debited from A/c XX4021 at SWIGGY on 06-08-26.',
  { smsId: 'bud-lend', receivedAt: MONTH_START + 6 * 3_600_000 });
const lendTxn = txns().find((t) => t.merchant?.toUpperCase().includes('SWIGGY') && t.amount === 800);
const foodBeforeLend = useStore.getState().getBudgetUsage()?.perCategory?.food?.actual;
useStore.getState().updateTransactionCategoryWithContact(lendTxn.id, 'lent', { person: 'Dev' });
const foodAfterLend = useStore.getState().getBudgetUsage()?.perCategory?.food?.actual;
finding('critical', 'Budget', 'tagging a food expense as "lent" removes it from the food budget line',
  round2(foodAfterLend) === round2(foodBeforeLend - 800),
  `food.actual before ${foodBeforeLend}, after ${foodAfterLend}`);

console.log(`\n  Final budget snapshot: cap ₹${usage?.total?.cap}, actual ₹${useStore.getState().getBudgetUsage()?.total?.actual}, ` +
  `unbudgeted ₹${useStore.getState().getBudgetUsage()?.unbudgeted}`);

// =============================================================================
// PHASE 8 — Isolated defect reproductions
// -----------------------------------------------------------------------------
// Two bugs found while writing the phases above, each minimal and self-
// contained (own reset()) so they don't depend on — or disturb — the running
// balances the main journey built up.
// =============================================================================
phase('PHASE 8 — Isolated defect reproductions');

// 8a. A REAL bank cashback-credit SMS is rejected outright as promotional spam.
//
// messageParser.js's PROMOTIONAL_OFFER_REGEX includes the alternative
// `\bcashback\s+on\b` — meant to catch marketing copy like "10% cashback on
// your next order". But Indian bank SMS commonly phrase a REAL, already-
// happened credit as "credited to A/c XXNNNN towards <reason> on <date>", and
// when <reason> is "Cashback", the literal word "on" immediately follows it —
// from the DATE clause, not a purchase. The promo guard
// (`!COMPLETED_TRANSACTION_REGEX.test(text)`) only exempts passive-perfect
// phrasing ("has been credited" / "was credited"), which this common present-
// tense phrasing ("credited to...") does not match — so the promo filter wins
// and the message is dropped before the amount/account is ever looked at.
//
// Net effect: a real cashback credit — money that genuinely arrived — never
// becomes a transaction. The account balance in ePurse permanently understates
// the user's real bank balance by that amount, with no error surfaced anywhere.
reset();
{
  const before = useStore.getState().transactions.length;
  const result = ingest('HDFCBK', 'Rs.2000.00 credited to A/c XX4021 towards Cashback on 04-08-26.',
    { smsId: 'cashback-repro' });
  finding('critical', 'Parser', 'a real "...towards Cashback on <date>" credit SMS is recorded as a transaction',
    result !== null && useStore.getState().transactions.length === before + 1,
    'ingestMessage returned null — rejected as `promotional_offer`. Confirmed variants that ALSO fail: ' +
    '"credited...towards Cashback received." Confirmed variants that correctly PASS: "...has been credited... Cashback..." ' +
    '(passive phrasing), "...as Cashback for txn ref...", "cashback credited to your ... balance..." — so the failure is ' +
    'specifically the very common "towards Cashback on <date>" shape, not the word "cashback" in general.');
}

// 8b. Two separate single-leg bank SMS — one from EACH bank, the way a real
// NEFT/IMPS self-transfer between a user's own two accounts actually arrives
// — are never linked into a self-transfer, even when both quote the SAME
// transfer reference number.
//
// `propagateSelfByRef` (src/utils/selfTransfer.js) only PROPAGATES an
// already-established `categoryId === 'self'` tag onto a further leg sharing
// its `transferRef` — it has no path to originate that tag between two legs
// that are BOTH still un-tagged, which is exactly the two-separate-SMS case.
// The only paths that DO originate a self-tag are (confirmed working, see
// PHASE 3): both legs named in one SMS, or a counterparty phone/name matching
// the user's own registered phone. Neither is true of a plain NEFT/IMPS
// between two of the user's own bank accounts, where each bank sends its own
// notification naming only account masks.
//
// Net effect: routine self-transfers between two of the user's own bank
// accounts — arguably the single most common "same money, no expense" action
// in the app — are counted as a full expense on the sending account AND a
// full income on the receiving one, inflating both Spent and Received for the
// month and (per PHASE 7) the unbudgeted-spend bucket.
reset();
{
  ingest('ICICIB', 'Rs.20000.00 debited from A/c XX7788 for NEFT to LANDLORD on 01-08-26.',
    { smsId: 'setup-1' }); // pre-seed the ICICI account so it exists before the transfer's credit leg
  const spendBefore = useStore.getState().getMonthlySpend();
  const incomeBefore = useStore.getState().getMonthlyIncome();
  ingest('HDFCBK', 'Rs.5000.00 debited from A/c XX4021 and transferred to A/c XX7788 via NEFT Ref No 998877665544 on 05-08-26.',
    { smsId: 'nref-out' });
  ingest('ICICIB', 'Rs.5000.00 credited to A/c XX7788 via NEFT Ref No 998877665544 from A/c XX4021 on 05-08-26.',
    { smsId: 'nref-in' });
  const legs = allTxns().filter((t) => t.transferRef === '998877665544');
  finding('critical', 'Parser', 'two same-ref NEFT legs from DIFFERENT banks are recognised as one self-transfer',
    legs.length === 2 && legs.every((t) => t.categoryId === 'self'),
    `legs: ${legs.map((t) => `${t.type}/${t.categoryId}`).join(', ') || '(not even linked by ref)'}`);
  finding('critical', 'Parser', '…so it does not inflate this month\'s Spent figure',
    useStore.getState().getMonthlySpend() === spendBefore,
    `spend before ${spendBefore}, after ${useStore.getState().getMonthlySpend()} (+₹5000 = the transfer counted as a real expense)`);
  finding('major', 'Parser', '…and does not inflate this month\'s Received figure',
    useStore.getState().getMonthlyIncome() === incomeBefore,
    `income before ${incomeBefore}, after ${useStore.getState().getMonthlyIncome()} (+₹5000 = the transfer counted as real income)`);
}

// 8c. A dual-leg self-transfer SMS phrased VERB-before-MASK reverses which
// account is debited and which is credited.
//
// FIRST_ACCOUNT_EVENT_REGEX (messageParser.js) only matches
// "A/c <mask> <verb>" — mask, then verb — which is the phrasing in the app's
// own sample dual-leg message ("Acct XX171 debited... Acct XX532 credited").
// But the DOMINANT phrasing for an ordinary single-leg debit/credit SMS —
// including every fixture already in this very file — is the opposite order,
// "<verb> from/to A/c <mask>" ("debited from A/c XX4021", "credited to A/c
// XX4021"). When that natural phrasing is used for BOTH legs of one combined
// self-transfer SMS, `FIRST_ACCOUNT_EVENT_REGEX` matches neither leg, so
// `firstActionVerb` comes back null and the code falls through to a whole-text
// keyword scan for the overall direction. A self-transfer SMS necessarily
// contains BOTH "debited" and "credited" somewhere, so that fallback always
// resolves to CREDIT — regardless of which account the SMS actually debited.
//
// Net effect: the sending account is recorded as RECEIVING the money and the
// receiving account as LOSING it — the two balances end up swapped relative
// to what really happened, silently (no error, no rejected message — it's
// still accepted and tagged `self` correctly, just backwards).
reset();
{
  ingest('HDFCBK', 'Rs.50000.00 credited to A/c XX4021 towards Salary on 01-08-26.', { smsId: 'setup-2' });
  ingest('ICICIB', 'Rs.20000.00 debited from A/c XX7788 for NEFT to LANDLORD on 01-08-26.', { smsId: 'setup-3' });
  const hdfcBefore = acct('4021').balance;
  const iciciBefore = acct('7788').balance;
  ingest('HDFCBK', 'Rs.5000.00 debited from A/c XX4021 and credited to A/c XX7788 on 05-08-26.',
    { smsId: 'reversed-dir' });
  finding('major', 'Parser', 'a verb-before-mask dual-leg self-transfer debits the account the SMS says was debited',
    round2(acct('4021').balance) === round2(hdfcBefore - 5000)
    && round2(acct('7788').balance) === round2(iciciBefore + 5000),
    `HDFC (should DEBIT) ${hdfcBefore}→${acct('4021').balance}, ICICI (should CREDIT) ${iciciBefore}→${acct('7788').balance} — reversed`);
}

// =============================================================================
// SUMMARY
// =============================================================================
console.log(`\n${C.bold}══════════════════════════════════════${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} checks passed${C.reset}\n`);

if (findings.length) {
  console.log(`${C.bold}${C.yellow}FEEDBACK — ${findings.length} finding(s) needing attention:${C.reset}\n`);
  const order = { critical: 0, major: 1, minor: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  for (const f of findings) {
    const tag = f.severity === 'critical' ? C.red + 'CRITICAL' + C.reset
      : f.severity === 'major' ? C.yellow + 'MAJOR   ' + C.reset : 'minor   ';
    console.log(`  [${tag}] (${f.phase}) ${f.name}`);
    if (f.detail) console.log(`             ${f.detail}`);
  }
  console.log('');
} else {
  console.log(`  ${C.green}No functional loopholes found across accounts / expenses / balance` +
    ` upkeep / lending / splits / groups / budget.${C.reset}\n`);
}

process.exit(fail ? 1 : 0);
