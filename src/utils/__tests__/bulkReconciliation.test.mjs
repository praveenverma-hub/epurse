// =============================================================================
// BULK RECONCILIATION — 30-50 transactions, cross-checked all at once
// -----------------------------------------------------------------------------
//   node --import ./src/utils/__tests__/_store-hook.mjs \
//        src/utils/__tests__/bulkReconciliation.test.mjs
//   npm run test:bulk
//
// e2eJourney.test.mjs checks one thing at a time (before/after a single
// action). This is the complementary test the volume itself asks for: build a
// realistic MONTH of activity — 3 accounts, ~25 plain expenses across 8
// categories, 2 self-transfer pairs, 2 direct splits, 1 memo split, 2 LB tags
// + a manual entry + 2 settles, 1 excluded personal group, 1 shared group with
// 2 expenses — then compute the expected TOTALS independently (a plain JS
// ledger built alongside each action, never by calling the app's own
// selectors) and cross-check every stat ONCE, over the whole batch:
//
//   - account-wise balances (3 accounts)
//   - getMonthlySpend / getMonthlyIncome
//   - getCategoryBreakdown (8 categories)
//   - getBudgetUsage (3 budgeted categories + the unbudgeted bucket)
//   - getPersonBalances (6 people, fed by LB tags, direct splits, a memo
//     split, and a shared-group split — four different code paths landing in
//     ONE ledger)
//   - group totalSpend (both groups)
//
// This is the bug class isolated single-action checks structurally cannot
// catch: a selector that's correct for one transaction but drifts, double-
// counts, or drops something once real volume and overlapping features (a
// split AND a budget cap AND a group exclusion, all in the same month) are
// combined.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_store-hook.mjs', import.meta.url);

const mod = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js');
const useStore = mod.useEPurseStore || mod.default;

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const phase = (title) => console.log(`\n${C.bold}══════ ${title} ══════${C.reset}\n`);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const close = (a, b, eps = 0.5) => Math.abs(a - b) < eps; // paise-level rounding across ~36 lines

useStore.setState({
  transactions: [], accounts: [], archivedTransactions: [], lentBorrowed: [],
  suppressedSmsIds: [], monthlyAggregates: {}, groups: [], lastSmsDate: null,
  userOnboardedAt: 0, activeGroupZoneId: null, manualTxnSeq: 0,
  pendingCCPaymentQueue: [], ccHandledSmsIds: [], userPhones: [],
  budget: null, budgetHistory: {}, budgetBreachNotified: {},
  excludedExpenseParents: [],
});

const ingest = (sender, body, opts = {}) =>
  useStore.getState().ingestMessage(body, { sender, receivedAt: Date.now(), ...opts });
const accts = () => useStore.getState().accounts;
const acct = (mask) => accts().find((a) => a.mask === mask);
const allTxns = () => useStore.getState().transactions;
const txnById = (id) => allTxns().find((t) => t.id === id);

// Every timestamp lands inside THIS calendar month and strictly before "now" —
// getMonthlySpend/getBudgetUsage only look at the current month, and a flat
// "N days ago" can spill into the previous month on the 1st/2nd (see
// storeIntegration.test.mjs). Spread ~40 events evenly across the window.
const MONTH_START = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); })();
const WINDOW_MS = Math.max(Date.now() - MONTH_START - 120_000, 120_000);
let seq = 0;
const nextTs = () => MONTH_START + 60_000 + Math.floor((seq++ / 60) * WINDOW_MS);

console.log(`${C.bold}\nBULK RECONCILIATION — one month, ~36 transactions${C.reset}`);
console.log(`Month start: ${new Date(MONTH_START).toISOString()}\n`);

// ── The independent ledger. Built by hand alongside each action below —
// never by calling a store selector — so comparing it to the selectors'
// output at the end is a genuine cross-check, not a tautology.
const G = {
  balance: { hdfc: 0, icici: 0, cash: 0 },
  spend: 0,
  income: 0,
  categoryBreakdown: {},   // legacy categoryId -> net amount
  budgetActual: { food: 0, travel: 0, shopping: 0 },
  personNet: {},           // name -> net (+ they owe me, − I owe them)
  groupTotalSpend: { officeLunch: 0 },
};
const addCat = (catId, amt) => { G.categoryBreakdown[catId] = round2((G.categoryBreakdown[catId] || 0) + amt); };
const addPerson = (name, amt) => { G.personNet[name] = round2((G.personNet[name] || 0) + amt); };
const PARENT_OF = { food: 'food', groceries: 'food', travel: 'travel', shopping: 'shopping' }; // the 3 budgeted lines; entertainment/bills/health/education/other/repayment are left unbudgeted on purpose

phase('Setup — 3 accounts');

useStore.getState().addAccount({ id: 'cash1', type: 'Cash', bankName: 'Cash', mask: null, balance: 5000, aliasMasks: [] });
G.balance.cash = 5000; // opening balance is not income

ingest('HDFCBK', 'Rs.80000.00 credited to A/c XX4021 towards Salary on 01-08-26.', { smsId: 's-hdfc', receivedAt: nextTs() });
ingest('ICICIB', 'Rs.30000.00 credited to A/c XX7788 towards Salary on 01-08-26.', { smsId: 's-icici', receivedAt: nextTs() });
G.balance.hdfc += 80000; G.income += 80000;
G.balance.icici += 30000; G.income += 30000;
check('3 accounts exist (HDFC, ICICI, Cash)', accts().length === 3 && !!acct('4021') && !!acct('7788'));

phase('~25 plain expenses across 8 categories (HDFC + ICICI + Cash)');

// { mask, amount, merchant, categoryId } — every categoryId verified against
// the REAL store (`ingestMessage`, not just the bare parser — the store's
// merchant-enrichment pass can OVERRIDE the parser's flat category with a
// two-tier dictionary match, e.g. Netflix/Hotstar file under Bills &
// Utilities, not Entertainment — see the session that built this file for
// the verification script).
const PLAIN = [
  { mask: '4021', amount: 450,  merchant: 'SWIGGY',            categoryId: 'food' },
  { mask: '4021', amount: 320,  merchant: 'ZOMATO',            categoryId: 'food' },
  { mask: '4021', amount: 799,  merchant: 'NETFLIX',           categoryId: 'bills' },          // dictionary: Bills & Utilities
  { mask: '4021', amount: 1850, merchant: 'FLIPKART',          categoryId: 'shopping' },
  { mask: '4021', amount: 180,  merchant: 'UBER',              categoryId: 'travel' },
  { mask: '4021', amount: 250,  merchant: 'STARBUCKS',         categoryId: 'food' },
  { mask: '4021', amount: 3200, merchant: 'AMAZON',            categoryId: 'shopping' },
  { mask: '4021', amount: 2200, merchant: 'ELECTRICITY BILL',  categoryId: 'bills',   phrase: 'towards' },
  { mask: '4021', amount: 600,  merchant: 'PVR CINEMAS',       categoryId: 'entertainment' },
  { mask: '4021', amount: 1400, merchant: 'BIGBASKET',         categoryId: 'groceries' },
  { mask: '4021', amount: 320,  merchant: 'PHARMEASY',         categoryId: 'health' },
  { mask: '7788', amount: 350,  merchant: 'UBER',              categoryId: 'travel' },
  { mask: '7788', amount: 280,  merchant: 'ZOMATO',            categoryId: 'food' },
  { mask: '7788', amount: 2100, merchant: 'MYNTRA',            categoryId: 'shopping' },
  { mask: '7788', amount: 499,  merchant: 'JIO RECHARGE',      categoryId: 'bills',   phrase: 'towards' },
  { mask: '7788', amount: 720,  merchant: 'DOMINOS',           categoryId: 'food' },
  { mask: '7788', amount: 210,  merchant: 'OLA CABS',          categoryId: 'travel' },
  { mask: '7788', amount: 299,  merchant: 'HOTSTAR',           categoryId: 'bills' },           // dictionary: Bills & Utilities
  { mask: '7788', amount: 1750, merchant: 'DMART',             categoryId: 'groceries' },
  { mask: '7788', amount: 999,  merchant: 'BYJUS',             categoryId: 'education' },
];
const bank = (mask) => (mask === '4021' ? 'HDFCBK' : 'ICICIB');
// (merchant, mask) uniquely identifies a fixture — UBER appears on both
// accounts, so merchant alone would collide. The dictionary also renames some
// merchants with punctuation the SMS didn't have ("Domino's Pizza", "Byju's"),
// so matching on the resulting transaction's TEXT is fragile; capturing the
// id at creation time (ingest prepends, so it's always transactions()[0]) is
// the only robust way.
const idOf = (merchant, mask) => PLAIN.find((p) => p.merchant === merchant && p.mask === mask)?.id;
PLAIN.forEach((p, i) => {
  const smsId = `plain-${i}`;
  const verb = p.phrase === 'towards' ? 'towards' : 'at';
  ingest(bank(p.mask), `Rs.${p.amount}.00 debited from A/c XX${p.mask} ${verb} ${p.merchant} on 02-08-26.`,
    { smsId, receivedAt: nextTs() });
  p.id = allTxns()[0].id;
  const acctKey = p.mask === '4021' ? 'hdfc' : 'icici';
  G.balance[acctKey] -= p.amount;
  G.spend += p.amount;
  addCat(p.categoryId, p.amount);
  const parent = PARENT_OF[p.categoryId];
  if (parent) G.budgetActual[parent] = round2(G.budgetActual[parent] + p.amount);
});

// Cash expenses (manual entry, not SMS — categoryId assigned directly).
const CASH = [
  { amount: 150, categoryId: 'food',     merchant: 'Street food' },
  { amount: 80,  categoryId: 'travel',   merchant: 'Auto rickshaw' },
  { amount: 500, categoryId: 'shopping', merchant: 'Local market' },
];
CASH.forEach((c) => {
  useStore.getState().addTransaction({
    amount: c.amount, type: 'debit', accountId: 'cash1', merchant: c.merchant,
    categoryId: c.categoryId, createdAt: new Date(nextTs()).toISOString(),
  });
  G.balance.cash -= c.amount;
  G.spend += c.amount;
  addCat(c.categoryId, c.amount);
  const parent = PARENT_OF[c.categoryId];
  if (parent) G.budgetActual[parent] = round2(G.budgetActual[parent] + c.amount);
});

check(`${PLAIN.length + CASH.length} plain expenses booked`, allTxns().length === PLAIN.length + CASH.length + 2,
  `got ${allTxns().length - 2} expenses`);
check('every plain-expense fixture captured a real transaction id (fixture sanity)',
  PLAIN.every((p) => !!p.id));

phase('Interest credit + a refund');

ingest('HDFCBK', 'Rs.150.00 credited to A/c XX4021 towards Interest on 03-08-26.', { smsId: 'interest-1', receivedAt: nextTs() });
G.balance.hdfc += 150; G.income += 150;

ingest('HDFCBK', 'Rs.200.00 credited to A/c XX4021 towards Refund on 03-08-26.', { smsId: 'refund-1', receivedAt: nextTs() });
G.balance.hdfc += 200; G.spend -= 200; addCat('other', -200); // refund nets its category, not income

phase('2 self-transfer pairs (HDFC <-> ICICI), verb-before-mask + shared NEFT ref');

ingest('HDFCBK', 'Rs.5000.00 debited from A/c XX4021 and transferred to A/c XX7788 via NEFT Ref No 100200300400 on 04-08-26.', { smsId: 'xf1-out', receivedAt: nextTs() });
ingest('ICICIB', 'Rs.5000.00 credited to A/c XX7788 via NEFT Ref No 100200300400 from A/c XX4021 on 04-08-26.', { smsId: 'xf1-in', receivedAt: nextTs() });
ingest('ICICIB', 'Rs.3000.00 debited from A/c XX7788 and transferred to A/c XX4021 via NEFT Ref No 500600700800 on 05-08-26.', { smsId: 'xf2-out', receivedAt: nextTs() });
ingest('HDFCBK', 'Rs.3000.00 credited to A/c XX4021 via NEFT Ref No 500600700800 from A/c XX7788 on 05-08-26.', { smsId: 'xf2-in', receivedAt: nextTs() });
G.balance.hdfc += -5000 + 3000;
G.balance.icici += 5000 - 3000;
// self-tagged: no spend/income/category effect at all.

phase('2 direct splits on existing expenses');

const amazonId = idOf('AMAZON', '4021');
useStore.getState().setTransactionSplit(amazonId, [{ name: 'Rahul' }, { name: 'Sara' }], { mode: 'percent' });
{
  const t = txnById(amazonId);
  const myShare = t.myShareAmount;
  const others = t.splitWith.reduce((s, o) => s + o.shareAmount, 0);
  check('AMAZON split myShare + others reconstitutes the original amount',
    close(myShare + others, 3200), `myShare ${myShare} + others ${others}`);
  // Replace this txn's original full-amount contribution with its myShare.
  G.spend += myShare - 3200;
  addCat('shopping', myShare - 3200);
  G.budgetActual.shopping = round2(G.budgetActual.shopping + myShare - 3200);
  t.splitWith.forEach((o) => addPerson(o.name, o.shareAmount));
}

const myntraId = idOf('MYNTRA', '7788');
useStore.getState().setTransactionSplit(myntraId, [{ percent: 40, name: 'Kiran' }], { mode: 'percent', myPercent: 60 });
{
  const t = txnById(myntraId);
  const myShare = t.myShareAmount;
  G.spend += myShare - 2100;
  addCat('shopping', myShare - 2100);
  G.budgetActual.shopping = round2(G.budgetActual.shopping + myShare - 2100);
  t.splitWith.forEach((o) => addPerson(o.name, o.shareAmount));
}

phase('1 memo split (Vivek paid, I owe just my share)');

useStore.getState().addTransaction({
  amount: 900, type: 'debit', accountId: acct('4021').id, merchant: 'Team lunch (Vivek paid)',
  categoryId: 'food', isSplit: true, myShareAmount: 300,
  splitOthers: [{ name: 'Priyanka', shareAmount: 600 }],
  splitPaidBy: { name: 'Vivek' },
  createdAt: new Date(nextTs()).toISOString(),
});
// Memo: no balance, no spend, no category contribution — I owe the payer my share.
addPerson('Vivek', -300);

phase('LB: 1 direct tag, 1 manual entry, 2 settles');

const uberHdfcId = idOf('UBER', '4021'); // the HDFC one, NOT the ICICI one
useStore.getState().updateTransactionCategoryWithContact(uberHdfcId, 'lent', { person: 'Ankit', phone: '9000000001' });
// Removed entirely from spend/category/budget — it WAS travel, +180, now reversed.
G.spend -= 180; addCat('travel', -180); G.budgetActual.travel = round2(G.budgetActual.travel - 180);
addPerson('Ankit', 180);

useStore.getState().addLentBorrowed({ kind: 'borrowed', person: 'Divya', phone: '9000000002', amount: 450, note: 'Movie tickets' });
addPerson('Divya', -450);

const ankitKey = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Ankit')?.personKey;
useStore.getState().settlePersonBalance(ankitKey()); // he pays me in cash, no account
addPerson('Ankit', -180); // nets to 0 in G too

const divyaKey = () => useStore.getState().getPersonBalances().find((p) => p.person === 'Divya')?.personKey;
useStore.getState().settlePersonBalance(divyaKey(), { accountId: 'cash1' }); // I repay her from Cash
G.balance.cash -= 450;
G.spend += 450; addCat('repayment', 450); // 'repayment' is countable (Transfers, not NON_SPEND) — no budget line
addPerson('Divya', 450); // nets to 0

phase('Groups: 1 excluded personal group, 1 shared group with 2 expenses');

useStore.getState().createGroup({ name: 'House Stuff', type: 'personal', excludeFromTotals: true });
const houseGroup = useStore.getState().groups.find((g) => g.name === 'House Stuff');
const flipkartId = idOf('FLIPKART', '4021');
const electricityId = idOf('ELECTRICITY BILL', '4021');
useStore.getState().tagTransactionToGroup(flipkartId, houseGroup.id);
useStore.getState().tagTransactionToGroup(electricityId, houseGroup.id);
// Both fully excluded now — reverse their earlier contributions.
G.spend -= 1850; addCat('shopping', -1850); G.budgetActual.shopping = round2(G.budgetActual.shopping - 1850);
G.spend -= 2200; addCat('bills', -2200); // bills has no budget line

useStore.getState().createGroup({ name: 'Office Lunch Club', type: 'shared', members: [{ memberId: 'c_a', name: 'MemberA' }, { memberId: 'c_b', name: 'MemberB' }] });
const lunchGroup = useStore.getState().groups.find((g) => g.name === 'Office Lunch Club');
useStore.getState().addGroupExpense(lunchGroup.id, {
  amount: 2400, merchant: 'Biryani Blues', categoryId: 'food',
  paidByMemberId: 'me', paidByName: 'You',
  shares: [{ memberId: 'me', name: 'You', shareAmount: 800 }, { memberId: 'c_a', name: 'MemberA', shareAmount: 800 }, { memberId: 'c_b', name: 'MemberB', shareAmount: 800 }],
  accountId: acct('4021').id,
});
G.balance.hdfc -= 2400; G.spend += 800; addCat('food', 800); G.budgetActual.food = round2(G.budgetActual.food + 800);
addPerson('MemberA', 800); addPerson('MemberB', 800);
G.groupTotalSpend.officeLunch += 2400;

useStore.getState().addGroupExpense(lunchGroup.id, {
  amount: 1600, merchant: 'Cafe Bahar', categoryId: 'food',
  paidByMemberId: 'me', paidByName: 'You',
  shares: [{ memberId: 'me', name: 'You', shareAmount: 600 }, { memberId: 'c_a', name: 'MemberA', shareAmount: 1000 }],
  accountId: acct('4021').id,
});
G.balance.hdfc -= 1600; G.spend += 600; addCat('food', 600); G.budgetActual.food = round2(G.budgetActual.food + 600);
addPerson('MemberA', 1000);
G.groupTotalSpend.officeLunch += 1600;

phase('Budget caps');

useStore.getState().updateBudgetCategory('food', 5000);
useStore.getState().updateBudgetCategory('travel', 1000);
useStore.getState().updateBudgetCategory('shopping', 4000);

// =============================================================================
// RECONCILIATION — every stat, checked ONCE against the independent ledger
// =============================================================================
phase('RECONCILIATION');

console.log(`  ${allTxns().length} real transaction records booked this run.\n`);

console.log('── account balances ──');
check(`HDFC balance matches (expected ₹${round2(G.balance.hdfc)})`,
  close(acct('4021').balance, G.balance.hdfc), `got ${acct('4021').balance}`);
check(`ICICI balance matches (expected ₹${round2(G.balance.icici)})`,
  close(acct('7788').balance, G.balance.icici), `got ${acct('7788').balance}`);
check(`Cash balance matches (expected ₹${round2(G.balance.cash)})`,
  close(accts().find((a) => a.id === 'cash1').balance, G.balance.cash),
  `got ${accts().find((a) => a.id === 'cash1').balance}`);

console.log('\n── headline totals ──');
const spend = useStore.getState().getMonthlySpend();
const income = useStore.getState().getMonthlyIncome();
check(`getMonthlySpend matches the independent ledger (expected ₹${round2(G.spend)})`,
  close(spend, G.spend), `got ${spend}`);
check(`getMonthlyIncome matches the independent ledger (expected ₹${round2(G.income)})`,
  close(income, G.income), `got ${income}`);

console.log('\n── category breakdown (8+ categories) ──');
const breakdown = useStore.getState().getCategoryBreakdown();
// The real selector keys by `id` (it maps over `categories`, spreading each
// entry) and amount by `total` — and CLAMPS a net-negative category to 0,
// then filters it out of the array entirely (`c.total > 0`). Our 'other'
// bucket is net -200 (only the isolated refund landed there), so it must be
// ABSENT here, not present at -200 — assert that shape rather than equality.
const byId = Object.fromEntries(breakdown.map((c) => [c.id, c.total]));
for (const [catId, expected] of Object.entries(G.categoryBreakdown)) {
  const got = byId[catId] ?? 0;
  if (expected <= 0) {
    check(`category "${catId}" is absent/zero (net ₹${expected} after refunds — clamped, not negative)`,
      got === 0, `got ${got}`);
  } else {
    check(`category "${catId}" = ₹${expected}`, close(got, expected), `got ${got}, breakdown keys: ${Object.keys(byId).join(',')}`);
  }
}

console.log('\n── budget usage (3 budgeted lines + unbudgeted) ──');
const usage = useStore.getState().getBudgetUsage();
for (const parent of ['food', 'travel', 'shopping']) {
  const got = usage?.perCategory?.[parent]?.actual ?? null;
  check(`budget line "${parent}" actual = ₹${G.budgetActual[parent]}`,
    close(got, G.budgetActual[parent]), `got ${got}`);
}
const expectedTotalCap = 5000 + 1000 + 4000;
check(`total budget cap is the derived sum (₹${expectedTotalCap})`, usage?.total?.cap === expectedTotalCap, `got ${usage?.total?.cap}`);
const expectedTotalActual = round2(G.budgetActual.food + G.budgetActual.travel + G.budgetActual.shopping);
check(`total budget actual = ₹${expectedTotalActual}`, close(usage?.total?.actual, expectedTotalActual), `got ${usage?.total?.actual}`);
// unbudgeted = allExpense - totalActual (entertainment + bills + groceries + health + education + repayment + cash misc, minus excluded/refund/etc — cross-checked as a residual rather than re-summing by hand)
const expectedUnbudgeted = round2(Math.max(0, G.spend - expectedTotalActual));
check(`unbudgeted bucket = ₹${expectedUnbudgeted} (spend outside the 3 capped categories)`,
  close(usage?.unbudgeted, expectedUnbudgeted), `got ${usage?.unbudgeted}`);

console.log('\n── person balances (6 people, 4 different code paths) ──');
const balances = useStore.getState().getPersonBalances();
const netOf = (name) => balances.find((p) => p.person === name)?.net ?? 0;
for (const [name, expected] of Object.entries(G.personNet)) {
  const got = netOf(name);
  check(`${name}'s net balance = ₹${expected}`, close(got, expected), `got ${got}`);
}
check('Ankit is fully settled (not just netted to 0 in the ledger — actually absent or zero)',
  close(netOf('Ankit'), 0));
check('Divya is fully settled', close(netOf('Divya'), 0));

console.log('\n── group totals ──');
check(`Office Lunch Club totalSpend = ₹${G.groupTotalSpend.officeLunch}`,
  close(lunchGroup && useStore.getState().groups.find((g) => g.id === lunchGroup.id)?.totalSpend, G.groupTotalSpend.officeLunch),
  `got ${useStore.getState().groups.find((g) => g.id === lunchGroup.id)?.totalSpend}`);
check('House Stuff (excluded personal group) still lists both tagged transactions',
  txnById(flipkartId)?.groupId === houseGroup.id && txnById(electricityId)?.groupId === houseGroup.id);

console.log(`\n${C.bold}══════════════════════════════════════${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
