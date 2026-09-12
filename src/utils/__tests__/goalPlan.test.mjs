// =============================================================================
// goalPlan test suite
// -----------------------------------------------------------------------------
// ZERO-DEPENDENCY runner:
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs src/utils/__tests__/goalPlan.test.mjs
//
// The maths behind a monthly Goals plan. The invariant every case here defends
// is that a plan cannot lie: allocations never exceed salary, and moving money
// across a divider never changes the pair's total. Those two are what let the
// allocation bar be dragged freely without a reconciliation step afterwards.
// =============================================================================

import {
  ALLOCATION_STEP,
  snapAmount,
  allocatedTotal,
  freeAmount,
  rebalancePair,
  allocationWithinSalary,
  requiredMonthly,
  monthsToTarget,
  paceStatus,
  fundedPct,
  rescaleAllocations,
  merchantKey,
  goalAutoRule,
  hasAutoRule,
  ruleMatchesTxn,
  goalIsAchieved,
  lifetimePct,
} from '../goalPlan.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
let total = 0, passed = 0;
const failures = [];

function check(name, actual, expected) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else {
    failures.push(name);
    console.log(`  ${C.red}✗ ${name}${C.reset}  ${C.dim}got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}${C.reset}`);
  }
}
const ok = (name, cond, detail = '') => check(name + (detail ? ` ${C.dim}${detail}${C.reset}` : ''), !!cond, true);
const section = (t) => console.log(`\n${C.bold}${t}${C.reset}`);

// ── snapping ────────────────────────────────────────────────────────────────
section('Snapping — a plan is made of numbers people say out loud');
check('rounds to the nearest step', snapAmount(5240), 5000);
check('rounds up past the halfway mark', snapAmount(5260), 5500);
check('an exact multiple is untouched', snapAmount(7000), 7000);
check('never goes negative', snapAmount(-900), 0);
check('garbage reads as zero', snapAmount('abc'), 0);
check('the step is the documented ₹500', ALLOCATION_STEP, 500);

// ── totals ──────────────────────────────────────────────────────────────────
section('Totals and free space');
const ALLOC = { a: 15000, b: 10000, c: 5000 };
check('allocatedTotal sums the plan', allocatedTotal(ALLOC), 30000);
check('an empty plan totals zero', allocatedTotal({}), 0);
check('a missing plan totals zero', allocatedTotal(null), 0);
check('free is salary minus allocations', freeAmount(85000, ALLOC), 55000);
check('a fully committed plan has no free space', freeAmount(30000, ALLOC), 0);
// Deliberately NOT clamped: an over-commitment the user can't see is worse than
// a negative number they can.
check('over-allocation reports negative, not zero', freeAmount(25000, ALLOC), -5000);

// ── the drag invariant ──────────────────────────────────────────────────────
section('rebalancePair — the bar cannot invent or destroy money');
check('money moves from right to left', rebalancePair(10000, 5000, 12000), { left: 12000, right: 3000 });
check('…and back again', rebalancePair(10000, 5000, 7000), { left: 7000, right: 8000 });
check('dragging past the right edge stops at the pool', rebalancePair(10000, 5000, 99999), { left: 15000, right: 0 });
check('dragging past the left edge stops at zero', rebalancePair(10000, 5000, -99999), { left: 0, right: 15000 });
check('the result snaps', rebalancePair(10000, 5000, 11240), { left: 11000, right: 4000 });

{
  // The invariant itself, swept across the whole range rather than spot-checked.
  let held = true;
  for (let target = -2000; target <= 20000; target += 250) {
    const { left, right } = rebalancePair(10000, 5000, target);
    if (left + right !== 15000 || left < 0 || right < 0) { held = false; break; }
  }
  ok('across every drag position, the pair total is invariant and neither side goes negative', held);
}

// ── steppers ────────────────────────────────────────────────────────────────
section('allocationWithinSalary — a stepper can never over-commit');
check('room available → takes the asked amount', allocationWithinSalary(85000, ALLOC, 'a', 20000), 20000);
check('asking for more than the salary allows is capped to the room',
  allocationWithinSalary(30000, ALLOC, 'a', 25000), 15000);
check('a goal not yet in the plan still respects the room',
  allocationWithinSalary(32000, ALLOC, 'new', 9000), 2000);
check('negative asks clamp to zero', allocationWithinSalary(85000, ALLOC, 'a', -5000), 0);
check('a zero salary leaves no room at all', allocationWithinSalary(0, ALLOC, 'a', 5000), 0);

// ── projections ─────────────────────────────────────────────────────────────
section('Projections');
check('required monthly splits the gap over the months left', requiredMonthly(300000, 120000, 12), 15000);
check('a met target requires nothing more', requiredMonthly(300000, 300000, 12), 0);
check('an overshot target requires nothing more', requiredMonthly(300000, 320000, 12), 0);
// null, not Infinity: the caller renders "no deadline", which is the truth.
check('no months left → null rather than a fabricated number', requiredMonthly(300000, 120000, 0), null);
check('monthsToTarget rounds up to a whole month', monthsToTarget(100000, 0, 30000), 4);
check('an already-met target needs no months', monthsToTarget(100000, 100000, 5000), 0);
check('contributing nothing never arrives', monthsToTarget(100000, 0, 0), null);

// ── pace ────────────────────────────────────────────────────────────────────
section('paceStatus — judged against how far through the month we are');
check('meeting the allocation is funded, whatever the date', paceStatus(10000, 10000, 2, 30), 'funded');
check('overshooting is still funded', paceStatus(12000, 10000, 2, 30), 'funded');
// The same ₹5,000 read two ways — this is the whole reason pace takes the date.
check('half-funded on the 15th is on track', paceStatus(5000, 10000, 15, 30), 'on_track');
check('half-funded on the 28th is behind', paceStatus(5000, 10000, 28, 30), 'behind');
check('well past the expected line is ahead', paceStatus(9000, 10000, 10, 30), 'ahead');
check('nothing funded early in the month is not yet a failure', paceStatus(0, 10000, 1, 30), 'on_track');
check('a goal planned at zero is trivially funded', paceStatus(0, 0, 15, 30), 'funded');

// ── percentages ─────────────────────────────────────────────────────────────
section('fundedPct');
check('a normal share', fundedPct(2500, 10000), 25);
check('caps at 100 even when overfunded', fundedPct(15000, 10000), 100);
check('never negative', fundedPct(-500, 10000), 0);
check('a zero plan reads complete, not NaN', fundedPct(0, 0), 100);

// ── prefill rescaling ───────────────────────────────────────────────────────
section('rescaleAllocations — next month\'s prefill after a pay change');
// The common case must be an identity, not an approximation: most months the
// salary is unchanged and the user expects their exact figures back.
check('an unchanged salary returns the very same numbers',
  rescaleAllocations(ALLOC, 85000, 85000), { a: 15000, b: 10000, c: 5000 });
check('a raise scales shares up', rescaleAllocations(ALLOC, 85000, 170000), { a: 30000, b: 20000, c: 10000 });
check('a pay cut scales shares down', rescaleAllocations(ALLOC, 85000, 42500), { a: 7500, b: 5000, c: 2500 });
check('results stay on the step', rescaleAllocations({ a: 15000 }, 85000, 90000), { a: 16000 });
check('an unknown previous salary is left alone', rescaleAllocations(ALLOC, 0, 85000), { a: 15000, b: 10000, c: 5000 });

{
  // A pay cut must not silently produce a plan that no longer fits.
  const cut = rescaleAllocations(ALLOC, 85000, 40000);
  ok('a rescaled plan still fits the new salary', allocatedTotal(cut) <= 40000,
    `${allocatedTotal(cut)} of 40000`);
}

// ── auto-funding rules ──────────────────────────────────────────────────────
section('merchantKey — both sides folded before they are compared');
check('punctuation becomes a space', merchantKey('UPI-ZERODHA*BROKING'), 'upi zerodha broking');
check('case is folded', merchantKey('Cult.Fit'), 'cult fit');
check('edges are trimmed', merchantKey('  Groww  '), 'groww');
check('nothing in, nothing out', merchantKey(null), '');

section('goalAutoRule — one shape, whatever it was stored as');
check('the phase-1 single parent is still read',
  goalAutoRule({ autoParentId: 'investments' }).parentIds, ['investments']);
check('…and is not duplicated when the rule already names it',
  goalAutoRule({ autoParentId: 'investments', autoRule: { parentIds: ['investments'] } }).parentIds,
  ['investments']);
check('merchant keywords are normalised at read time',
  goalAutoRule({ autoRule: { merchants: ['Cult.Fit'] } }).merchants, ['cult fit']);
ok('a goal with nothing named has no rule', !hasAutoRule({ name: 'Emergency Fund' }));
ok('a goal naming one merchant has one', hasAutoRule({ autoRule: { merchants: ['lic'] } }));

section('ruleMatchesTxn — the three dimensions are ORed, never ANDed');
{
  const rule = goalAutoRule({ autoRule: {
    parentIds: ['investments'], categoryIds: ['groceries'], merchants: ['cult fit'],
  } });
  ok('a parent match counts', ruleMatchesTxn(rule, { parentId: 'investments', categoryId: 'other' }));
  ok('a sub-category match counts on its own',
    ruleMatchesTxn(rule, { parentId: 'food', categoryId: 'groceries' }));
  ok('a merchant match counts on its own',
    ruleMatchesTxn(rule, { parentId: 'other', merchant: 'UPI-CULT.FIT MEMBERSHIP' }));
  ok('a partial keyword is enough — real merchant strings carry prefixes',
    ruleMatchesTxn(goalAutoRule({ autoRule: { merchants: ['zerodha'] } }),
      { merchant: 'UPI/ZERODHA BROKING LTD/9988' }));
  ok('a row matching none of the three is left alone',
    !ruleMatchesTxn(rule, { parentId: 'food', categoryId: 'food', merchant: 'Swiggy' }));
  // A goal that names nothing must match NOTHING. Matching everything would
  // silently fund every hand-made goal from the whole month's spend.
  ok('an empty rule matches nothing at all',
    !ruleMatchesTxn(goalAutoRule({}), { parentId: 'food', categoryId: 'food', merchant: 'Swiggy' }));
}

section('goalIsAchieved / lifetimePct — only a real finish line counts');
ok('saved past the target is achieved', goalIsAchieved(300000, 300000));
ok('…and beyond it', goalIsAchieved(300000, 412000));
ok('short of it is not', !goalIsAchieved(300000, 299999));
// An open-ended goal has no line to cross, so it can never fire the
// congratulation no matter how much goes in.
ok('no target is never achieved', !goalIsAchieved(null, 999999));
ok('a zero target is never achieved', !goalIsAchieved(0, 999999));
check('lifetime progress is a clamped percentage', lifetimePct(300000, 150000), 50);
check('…capped at 100 when overshot', lifetimePct(300000, 400000), 100);
check('…and 0 with no target, rather than NaN', lifetimePct(0, 5000), 0);

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
if (failures.length) {
  console.log(`  ${C.red}${C.bold}${passed}/${total} passed${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}✗${C.reset} ${f}`));
  process.exit(1);
} else {
  console.log(`  ${C.green}${C.bold}${passed}/${total} passed${C.reset}`);
}
