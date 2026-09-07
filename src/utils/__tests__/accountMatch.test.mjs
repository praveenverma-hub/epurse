// =============================================================================
// accountMatch test suite
// -----------------------------------------------------------------------------
// ZERO-DEPENDENCY runner — no jest, no install. Just:
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs src/utils/__tests__/accountMatch.test.mjs
//
// Covers the no-mask fallback in accountCandidates — the branch a maskless CC
// payment notification hits (see the transaction-parser skill / messageParser's
// extractCardLast4 comment for why a mask can still legitimately be absent).
// Before this fix that branch picked ANY account of the right type by id/array
// order, ignoring a KNOWN bank name entirely — so a maskless payment could land
// on the wrong card whenever the user held cards from more than one bank. The
// mask branch already preferred a bank-confirmed match; this suite locks in
// that the no-mask branch now does too, and that it still falls back to a
// deterministic id-order tie-break when the bank is unknown on either side.
// =============================================================================

import { accountCandidates, matchAccount } from '../accountMatch.js';

const ACCOUNTS = [
  { id: 'acct_a_hdfc', type: 'Credit Card', bankName: 'HDFC Bank', mask: '1111' },
  { id: 'acct_b_icici', type: 'Credit Card', bankName: 'ICICI Bank', mask: '2222' },
  { id: 'acct_c_bank', type: 'Bank', bankName: 'HDFC Bank', mask: '3333' },
];

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
let total = 0, passed = 0;
const failures = [];

function check(name, actual, expected) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ${C.green}✓${C.reset} ${name}`);
  } else {
    failures.push(name);
    console.log(`  ${C.red}✗ ${name}${C.reset}`);
    console.log(`      ${C.dim}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}${C.reset}`);
  }
}

console.log(`\n${C.bold}══════ accountMatch Test Suite ══════${C.reset}\n`);

// ── No mask, bank KNOWN and matches one candidate → that account wins,
// regardless of id/array order (the real bug: a maskless HDFC payment used to
// resolve to whichever Credit Card account sorted first by id).
check(
  'no mask + known matching bank → bank-confirmed account wins over id order',
  matchAccount(ACCOUNTS, { accountType: 'Credit Card', bankName: 'ICICI Bank' })?.id,
  'acct_b_icici',
);

// Same check with the accounts array reversed — must give the SAME answer,
// proving it is bank-confirmed, not still secretly array-order-dependent.
check(
  'no mask + known matching bank → same answer with array order reversed',
  matchAccount([...ACCOUNTS].reverse(), { accountType: 'Credit Card', bankName: 'ICICI Bank' })?.id,
  'acct_b_icici',
);

// ── No mask, bank UNKNOWN on the parsed side → falls back to the existing
// deterministic id-order tie-break (unaffected regression guard).
check(
  'no mask + no bank on either candidate advantage → deterministic id order',
  matchAccount(ACCOUNTS, { accountType: 'Credit Card', bankName: null })?.id,
  'acct_a_hdfc', // 'acct_a_hdfc' sorts before 'acct_b_icici'
);

// ── No mask, bank KNOWN but disagrees with every candidate of that type →
// no candidate is bank-confirmed, so it's still a tie broken by id order
// (never refuses to match — an unmatched bank name shouldn't strand the txn).
check(
  'no mask + bank matches nothing of this type → falls back to id order, not scoreless',
  matchAccount(ACCOUNTS, { accountType: 'Credit Card', bankName: 'Axis Bank' })?.id,
  'acct_a_hdfc',
);

// ── bankConfirmed flag surfaces correctly on the winning candidate.
{
  const candidates = accountCandidates(ACCOUNTS, { accountType: 'Credit Card', bankName: 'ICICI Bank' });
  check('bankConfirmed is true on the matched candidate', candidates[0]?.bankConfirmed, true);
  check('bankConfirmed is false on the runner-up', candidates[1]?.bankConfirmed, false);
}

// ── Regression guard: the MASK branch (untouched by this fix) still works.
check(
  'mask present → exact match still wins regardless of bank',
  matchAccount(ACCOUNTS, { accountMask: '2222', accountType: 'Credit Card', bankName: null })?.id,
  'acct_b_icici',
);

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
const color = failures.length ? C.red : C.green;
console.log(`  ${color}${C.bold}${passed}/${total} passed${C.reset}\n`);
if (failures.length) process.exit(1);
