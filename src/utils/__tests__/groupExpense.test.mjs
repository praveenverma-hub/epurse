// =============================================================================
// Group-expense rules — the 5 canonical scenarios
// -----------------------------------------------------------------------------
//     npm run test:group   (or: node … groupExpense.test.mjs)
//
// Imports the REAL group helpers (split.js: buildGroupLbRows / isGroupExcluded /
// debitDisplayAmount) and replays exactly how store.addGroupExpense builds a
// group transaction, then asserts the three things that differentiate every
// scenario:
//   • the Lent/Borrowed legs (who-owes-whom — the single source of truth),
//   • debitDisplayAmount (what the transaction card shows = your share),
//   • isGroupExcluded (whether it counts toward spend totals).
//
// The 5 scenarios (group = You + Rohit + Aman unless noted, bill = ₹600):
//   1/4  You paid, split equally          → account −full, you owe nothing, others owe you.
//   2    Someone else paid, you owe it all → memo, you borrow the full amount.
//   3    Someone else paid, a 3rd party    → memo, your share 0 → "Not involved", no leg.
//        owes it all (you're not involved)
//   5    Someone else paid, split equally  → memo, you borrow your equal share.
// =============================================================================

import { buildGroupLbRows, isGroupExcluded, debitDisplayAmount, groupLbChipKind } from '../split.js';
import { TRANSACTION_TYPES } from '../../constants/categories.js';

const ME    = { memberId: 'me',      name: 'You',   isMe: true };
const ROHIT = { memberId: 'p_rohit', name: 'Rohit' };
const AMAN  = { memberId: 'p_aman',  name: 'Aman'  };
const NEHA  = { memberId: 'p_neha',  name: 'Neha'  };

const sharedGroup = (members, extra = {}) => ({
  id: 'g_trip', name: 'Goa Trip', type: 'shared', members, totalSpend: 0, ...extra,
});
const personalGroup = (extra = {}) => ({
  id: 'g_solo', name: 'My Subs', type: 'personal', members: [], totalSpend: 0, ...extra,
});

// Faithful mirror of store.addGroupExpense's txn construction (the only fields
// the helpers read). paidByMemberId !== 'me' ⇒ memo; shares ⇒ groupSplit.
function makeTxn(group, { amount, paidByMemberId, paidByName, shares, hasSplit = true }) {
  const isGroupMemo = paidByMemberId !== 'me';
  const groupSplit = hasSplit && shares && shares.length
    ? { paidByMemberId, paidByName: paidByName || paidByMemberId, shares }
    : null;
  return {
    id: 'IdM0001',
    createdAt: '2026-06-20T10:00:00.000Z',
    type: TRANSACTION_TYPES.DEBIT,
    amount,
    groupId: group.id,
    ...(groupSplit ? { groupSplit } : {}),
    ...(isGroupMemo ? { isGroupMemo: true } : {}),
  };
}

const share = (m, shareAmount) => ({ memberId: m.memberId, name: m.name, shareAmount });

// UI-layer "Not involved" derivation, mirrored from TransactionItem.js.
function isNotInvolved(txn) {
  const display = debitDisplayAmount(txn);
  const iPaidGroup = txn.groupSplit && txn.groupSplit.paidByMemberId === 'me';
  return !!txn.groupId && txn.type === TRANSACTION_TYPES.DEBIT && !iPaidGroup && (Number(display) || 0) === 0;
}

const cases = [
  {
    name: '1/4 — You paid, split equally (3-way ₹600)',
    group: sharedGroup([ME, ROHIT, AMAN]),
    txn:   { amount: 600, paidByMemberId: 'me', shares: [share(ME, 200), share(ROHIT, 200), share(AMAN, 200)] },
    // I paid but also kept a ₹200 share → primarily my spend, no LENT chip on the card.
    expect: { memo: false, lbKind: 'lent', persons: ['Aman', 'Rohit'], amounts: [200, 200], display: 200, excluded: false, notInvolved: false, chip: null },
  },
  {
    name: '4 — You paid, split equally (4-way ₹600 → ₹150 each)',
    group: sharedGroup([ME, ROHIT, AMAN, NEHA]),
    txn:   { amount: 600, paidByMemberId: 'me', shares: [share(ME, 150), share(ROHIT, 150), share(AMAN, 150), share(NEHA, 150)] },
    expect: { memo: false, lbKind: 'lent', persons: ['Aman', 'Neha', 'Rohit'], amounts: [150, 150, 150], display: 150, excluded: false, notInvolved: false, chip: null },
  },
  {
    name: 'Full-owed — You paid, others owe it ALL (your share 0) → LENT chip',
    group: sharedGroup([ME, ROHIT, AMAN]),
    txn:   { amount: 600, paidByMemberId: 'me', shares: [share(ME, 0), share(ROHIT, 300), share(AMAN, 300)] },
    // debitDisplayAmount is 0 here; the card swaps in the full ₹600 (TransactionItem shownAmount)
    // so the LENT chip and the number agree.
    expect: { memo: false, lbKind: 'lent', persons: ['Aman', 'Rohit'], amounts: [300, 300], display: 0, excluded: false, notInvolved: false, chip: 'lent' },
  },
  {
    name: '2 — Someone else paid, you owe the FULL amount (you + Rohit, ₹600)',
    group: sharedGroup([ME, ROHIT]),
    txn:   { amount: 600, paidByMemberId: 'p_rohit', paidByName: 'Rohit', shares: [share(ROHIT, 0), share(ME, 600)] },
    expect: { memo: true, lbKind: 'borrowed', persons: ['Rohit'], amounts: [600], display: 600, excluded: true, notInvolved: false, chip: 'borrowed' },
  },
  {
    name: '3 — Someone else paid, a 3rd party owes it all, you are NOT involved',
    group: sharedGroup([ME, ROHIT, AMAN]),
    txn:   { amount: 600, paidByMemberId: 'p_rohit', paidByName: 'Rohit', shares: [share(ROHIT, 0), share(AMAN, 600), share(ME, 0)] },
    expect: { memo: true, lbKind: 'none', persons: [], amounts: [], display: 0, excluded: true, notInvolved: true, chip: null },
  },
  {
    name: '5 — Someone else paid, split equally (3-way ₹600)',
    group: sharedGroup([ME, ROHIT, AMAN]),
    txn:   { amount: 600, paidByMemberId: 'p_rohit', paidByName: 'Rohit', shares: [share(ROHIT, 200), share(ME, 200), share(AMAN, 200)] },
    expect: { memo: true, lbKind: 'borrowed', persons: ['Rohit'], amounts: [200], display: 200, excluded: true, notInvolved: false, chip: 'borrowed' },
  },
  // ── Guards: personal groups never post LB legs (the user is the only party) ──
  {
    name: 'Guard — Personal group expense: no LB legs, counts as spend',
    group: personalGroup(),
    txn:   { amount: 500, paidByMemberId: 'me', hasSplit: false },
    expect: { memo: false, lbKind: 'none', persons: [], amounts: [], display: 500, excluded: false, notInvolved: false, chip: null },
  },
  {
    name: 'Guard — Personal group flagged excludeFromTotals: excluded from spend',
    group: personalGroup({ excludeFromTotals: true }),
    txn:   { amount: 500, paidByMemberId: 'me', hasSplit: false },
    expect: { memo: false, lbKind: 'none', persons: [], amounts: [], display: 500, excluded: true, notInvolved: false, chip: null },
  },
];

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };
const sortNums = (a) => [...a].sort((x, y) => x - y);
const eqArr = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

let pass = 0;
const fails = [];

console.log(`\n${C.bold}══════ Group-Expense Rules — 5 Scenarios ══════${C.reset}\n`);
for (const tc of cases) {
  const { group, expect: e } = tc;
  const txn = makeTxn(group, tc.txn);
  const rows = buildGroupLbRows(group, txn);
  const display = debitDisplayAmount(txn);
  const excluded = isGroupExcluded(txn, [group]);
  const notInvolved = isNotInvolved(txn);
  const problems = [];

  // memo flag
  const memo = !!txn.isGroupMemo;
  if (memo !== e.memo) problems.push(`isGroupMemo: expected ${e.memo}, got ${memo}`);

  // LB legs: count, kind, persons, amounts, and the group tagging on each row.
  if (rows.length !== e.persons.length) problems.push(`LB count: expected ${e.persons.length}, got ${rows.length}`);
  if (e.lbKind === 'none') {
    if (rows.length !== 0) problems.push(`expected NO LB legs, got ${rows.length}`);
  } else {
    if (rows.some((r) => r.kind !== e.lbKind)) problems.push(`LB kind: expected all '${e.lbKind}', got [${rows.map((r) => r.kind).join(',')}]`);
    const persons = rows.map((r) => r.person).sort();
    if (!eqArr(persons, [...e.persons].sort())) problems.push(`LB persons: expected [${[...e.persons].sort()}], got [${persons}]`);
    const amounts = sortNums(rows.map((r) => r.amount));
    if (!eqArr(amounts, sortNums(e.amounts))) problems.push(`LB amounts: expected [${sortNums(e.amounts)}], got [${amounts}]`);
    for (const r of rows) {
      if (r.sourceTxnId !== txn.id) problems.push(`row sourceTxnId: expected ${txn.id}, got ${r.sourceTxnId}`);
      if (r.groupId !== group.id) problems.push(`row groupId: expected ${group.id}, got ${r.groupId}`);
      if (r.note !== `Group · ${group.name}`) problems.push(`row note: expected 'Group · ${group.name}', got '${r.note}'`);
    }
  }

  // Card display (your share), totals exclusion, "Not involved", and the LENT/BORROWED chip.
  if (display !== e.display) problems.push(`debitDisplayAmount: expected ${e.display}, got ${display}`);
  if (excluded !== e.excluded) problems.push(`isGroupExcluded: expected ${e.excluded}, got ${excluded}`);
  if (notInvolved !== e.notInvolved) problems.push(`notInvolved: expected ${e.notInvolved}, got ${notInvolved}`);
  const chip = groupLbChipKind(txn);
  if (chip !== e.chip) problems.push(`groupLbChipKind: expected ${e.chip}, got ${chip}`);

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
