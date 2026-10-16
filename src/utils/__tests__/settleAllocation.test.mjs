// =============================================================================
// "Settles: Goa Trip · Direct" — which balances a repayment closes (Oct-17-26)
//     npm run test:settleAllocation
// =============================================================================
import { openSettleParts, preselectSettleParts, allocateSettle, hasGroupParts } from '../settleAllocation.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};
const J = JSON.stringify;

const groups = [
  { id: 'goa', name: 'Goa Trip', members: [{ memberId: 'r' }], shared: { status: 'active' } },
  { id: 'lunch', name: 'Office Lunch', members: [{ memberId: 'r2' }] },
  { id: 'old', name: 'Old Trip', members: [{ memberId: 'r3' }], shared: { status: 'ended' } },
  { id: 'left', name: 'Left Trip', members: [{ memberId: 'r4', archived: true }], shared: { status: 'active' } },
];
// Rohit owes me ₹600 (Goa) + ₹500 (Lunch, newer) + ₹200 direct.
const rohit = [
  { kind: 'lent', amount: 600, groupId: 'goa', memberId: 'r', date: '2026-09-01' },
  { kind: 'lent', amount: 500, groupId: 'lunch', memberId: 'r2', date: '2026-10-01' },
  { kind: 'lent', amount: 200, date: '2026-08-01' },
  { kind: 'lent', amount: 900, groupId: 'old', memberId: 'r3', date: '2026-01-01' },
  { kind: 'lent', amount: 300, groupId: 'left', memberId: 'r4', date: '2026-02-01' },
];

console.log('\n── open parts ──');
let parts = openSettleParts(rohit, 'lent_settled', groups);
check('groups oldest first, then Direct', J(parts.map((p) => p.key)) === J(['goa', 'lunch', 'direct']), J(parts));
check('ended group and past-member group are never offered', !parts.some((p) => p.key === 'old' || p.key === 'left'));
check('memberId carried for the group row', parts[0].memberId === 'r');
check("wrong direction → nothing (I don't owe Rohit)", openSettleParts(rohit, 'borrow_repaid', groups).length === 0);
check('a group already settled is not offered',
  openSettleParts([...rohit, { kind: 'lent_settled', amount: 600, groupId: 'goa', memberId: 'r' }], 'lent_settled', groups)
    .every((p) => p.key !== 'goa'));
check('direct-only person → no group question', !hasGroupParts(openSettleParts([{ kind: 'lent', amount: 50 }], 'lent_settled', groups)));

console.log('\n── preselection ──');
check('exact match picks that balance alone', J(preselectSettleParts(parts, 500)) === J(['lunch']));
check('otherwise fills in order until covered', J(preselectSettleParts(parts, 700)) === J(['goa', 'lunch']));
check('small amount → first part only', J(preselectSettleParts(parts, 100)) === J(['goa']));

console.log('\n── allocation: only the paid amount ──');
let a = allocateSettle(parts, ['goa', 'lunch'], 700);
check('₹700 → Goa ₹600 · Lunch ₹100 (Lunch stays partly open)',
  J(a) === J([{ groupId: 'goa', memberId: 'r', amount: 600 }, { groupId: 'lunch', memberId: 'r2', amount: 100 }]), J(a));
a = allocateSettle(parts, ['goa'], 500);
check('partial stays partial: ₹500 of Goa ₹600', a.length === 1 && a[0].amount === 500, J(a));
a = allocateSettle(parts, ['goa'], 800);
check('overpay beyond the picked parts → the rest Direct', J(a) === J([{ groupId: 'goa', memberId: 'r', amount: 600 }, { groupId: null, memberId: null, amount: 200 }]), J(a));
a = allocateSettle(parts, [], 300);
check('nothing picked → all Direct', J(a) === J([{ groupId: null, memberId: null, amount: 300 }]), J(a));
const sum = allocateSettle(parts, ['goa', 'lunch', 'direct'], 1234.56).reduce((s, x) => s + x.amount, 0);
check('allocations always add up to the paid amount', Math.abs(sum - 1234.56) < 0.001, String(sum));

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass}/${pass + fail} passed\x1b[0m`);
if (fail) process.exit(1);
