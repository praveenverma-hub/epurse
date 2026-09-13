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
  projectedMonthLabel,
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
import { readFileSync } from 'node:fs';
import { countsForSpend } from '../split.js';
import { PARENT_CATEGORIES, CREDIT_ONLY_PARENT_IDS, DEFAULT_MAPS } from '../../constants/twoTierCategories.ts';
import { TRANSACTION_TYPES } from '../../constants/categories.js';

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

// projectedMonthLabel — "does not provide much clarity" (Sep-14-26): a bare
// month COUNT makes the reader do the arithmetic; this turns it into the
// actual calendar month, flat-width regardless of distance.
const JAN_2026 = new Date(2026, 0, 15);
check('0 months left projects the SAME month (long form)',
  projectedMonthLabel(0, { from: JAN_2026 }), 'January 2026');
check('6 months from January lands in July (long form)',
  projectedMonthLabel(6, { from: JAN_2026 }), 'July 2026');
check('18 months from January crosses a YEAR boundary (long form)',
  projectedMonthLabel(18, { from: JAN_2026 }), 'July 2027');
check('short form is compact and still names the year',
  projectedMonthLabel(6, { short: true, from: JAN_2026 }), "Jul '26");
check('short form crossing a year boundary shows the NEW year',
  projectedMonthLabel(18, { short: true, from: JAN_2026 }), "Jul '27");
check('a negative count never projects into the past',
  projectedMonthLabel(-3, { from: JAN_2026 }), 'January 2026');

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

// ── What the auto-funding picker is allowed to offer ────────────────────────
// Reported as "in goals add form we show categories, but dont see all sub
// categories under it... for food we have groceries and other 3, i only see
// groceries". Both halves of the answer are pinned here, because both are
// invisible by inspection — a rule that matches nothing looks identical in the
// UI to one that matches everything.
{
  // A goal funds itself from SPEND, and `countsForSpend` is debit-or-refund. So
  // a parent whose rows are credits can never fund anything, and offering it is
  // offering a switch wired to nothing — the goal just quietly never funds.
  for (const p of PARENT_CATEGORIES) {
    const creditOnly = CREDIT_ONLY_PARENT_IDS.has(p.id);
    const txn = { type: creditOnly ? TRANSACTION_TYPES.CREDIT : TRANSACTION_TYPES.DEBIT };
    const rule = goalAutoRule({ autoRule: { parentIds: [p.id] } });
    const canFund = ruleMatchesTxn(rule, { parentId: p.id }) && countsForSpend(txn);
    ok(`${p.label} ${creditOnly ? 'can NEVER fund a goal (its rows are credits)' : 'can fund a goal'}`,
      canFund === !creditOnly);
  }
  ok('Income is the credit-only parent', CREDIT_ONLY_PARENT_IDS.has('income'));
  // Transfers must NOT be lumped in with it: a self-transfer into savings is a
  // debit, and is one of the more sensible things to fund a goal from.
  ok('…and Transfers is NOT, since a self-transfer is a debit that can fund',
    !CREDIT_ONLY_PARENT_IDS.has('transfers'));

  const picker = readFileSync(
    new URL('../../components/GoalCategoryPickerModal.tsx', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the picker filters credit-only parents out of the tree',
    /CREDIT_ONLY_PARENT_IDS\.has\(/.test(picker));

  // ── Sub-category funding ───────────────────────────────────────────────
  // Only 4 of the 29 built-in sub-categories carry their own legacy id
  // (`groceries`, plus self/lent/borrowed), so a rule matched ONLY against the
  // flat category on a row could never tell Restaurants from Food Delivery —
  // both are legacy `food`. That is why a rule now also matches the tree CHILD
  // the row was categorised into: the review queue exists precisely so the user
  // fixes what the parser could not work out, and the goal reads that fix.
  const pickableOf = (p) => p.children.filter((c) => c.legacyId && c.legacyId !== p.legacyId);
  const totalChildren = PARENT_CATEGORIES.reduce((n, p) => n + p.children.length, 0);
  const totalPickable = PARENT_CATEGORIES.reduce((n, p) => n + pickableOf(p).length, 0);
  ok('only 4 of the 29 sub-categories carry their own legacy id…',
    totalPickable === 4 && totalChildren === 29);
  ok('…so matching on the flat id alone could never reach the other 25',
    PARENT_CATEGORIES.find((p) => p.id === 'food').children
      .filter((c) => !c.legacyId).length === 3);

  const childIdOf = (label) => DEFAULT_MAPS.childLabelToId[label];
  check('a stored `childCategory` label resolves back to its tree child id',
    childIdOf('Restaurants'), 'restaurants');

  // The case the whole change is for: the parser can only get this row as far
  // as `food`; the user opens the review queue and files it under Restaurants.
  const restaurantRule = goalAutoRule({ autoRule: { categoryIds: ['restaurants'] } });
  const txnUserFiled = { categoryId: 'food', childCategory: 'Restaurants' };
  ok('a row the USER filed under Restaurants funds a Restaurants goal',
    ruleMatchesTxn(restaurantRule, {
      parentId: 'food',
      categoryId: txnUserFiled.categoryId,
      childId: childIdOf(txnUserFiled.childCategory),
    }));
  // …and must not swallow its siblings, or "Restaurants" would just mean "Food".
  ok('…while a Food Delivery row does NOT',
    !ruleMatchesTxn(restaurantRule, {
      parentId: 'food', categoryId: 'food', childId: childIdOf('Food Delivery'),
    }));
  ok('…nor a row that was never filed past its parent',
    !ruleMatchesTxn(restaurantRule, { parentId: 'food', categoryId: 'food', childId: '' }));
  // A parent rule still takes everything under it, filed or not.
  ok('a Food & Dining rule still takes an unfiled Food row',
    ruleMatchesTxn(goalAutoRule({ autoRule: { parentIds: ['food'] } }),
      { parentId: 'food', categoryId: 'food', childId: '' }));

  // No migration was needed: `groceries` is both a child id AND a legacy id, and
  // means the same thing either way, so a goal saved before this still matches —
  // whether the row was parser-detected or hand-filed.
  const groceryRule = goalAutoRule({ autoRule: { categoryIds: ['groceries'] } });
  ok('a goal saved as `groceries` still matches a parser-detected grocery row',
    ruleMatchesTxn(groceryRule, { parentId: 'food', categoryId: 'groceries', childId: '' }));
  ok('…and now ALSO matches one the user hand-filed as Groceries',
    ruleMatchesTxn(groceryRule, {
      parentId: 'food', categoryId: 'food', childId: childIdOf('Groceries'),
    }));

  ok('the picker offers every sub-category, not just the ones with a legacy id',
    /const pickable = parent\.children;/.test(picker));

  // ── The goal FORM (Sep-13-26) ──────────────────────────────────────────
  const form = readFileSync(
    new URL('../../screens/GoalFormScreen.tsx', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // A category is required. Merchants alone are not enough: a goal exists to
  // track money moving into something and the category is what names it.
  ok('the form requires at least one category before saving',
    /categoryOk\s*=\s*parentIds\.length > 0 \|\| categoryIds\.length > 0/.test(form)
    && /!categoryOk/.test(form));

  // A rule edit is ADD-ONLY: an existing goal can be WIDENED, but an entry it is
  // already funded by cannot be dropped — the store keeps it, so a form that
  // offered to remove one would make Save look like it did nothing.
  ok('the form knows which entries are already in force',
    /lockedKeys/.test(form) && /lockedMerchants/.test(form));
  ok('…and an already-funding merchant chip is not removable',
    /disabled=\{lockedMerchants\.has\(m\)\}/.test(form));
  ok('…while the category row itself stays open, so the goal can be widened',
    !/disabled=\{!!ruleLocked\}/.test(form));
  // The copy has to say what adding one does AND doesn't do — otherwise a user
  // reasonably expects a new category to sweep up the spend already sitting in it.
  ok('…and the form says an addition counts from today onward',
    /count from today onward/.test(form));

  ok('the picker refuses to untick an entry the goal is already funded by',
    /if \(isLocked\(id\)\) return;/.test(picker));

  // The matcher is what actually enforces it.
  const plan = readFileSync(new URL('../goalPlan.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('an added entry is gated by the date it was added',
    /addedAt/.test(plan) && /activeAt/.test(plan));

  // The summary line must read the SAME key the picker writes, or a chosen
  // sub-category without its own legacy id is selected yet invisible.
  ok('the form summary reads the picker\'s key (legacyId ?? id)',
    /categoryIds\.includes\(c\.legacyId \?\? c\.id\)/.test(form));

  // ── The congratulation (Sep-13-26) ─────────────────────────────────────
  // Reported as "not seeing the congratulations banner when goal value reached".
  // Claiming is DESTRUCTIVE — `markGoalAchieved` stamps `achievedAt`, which is
  // exactly what `getNewlyAchievedGoals` filters on — so an unfocused screen that
  // claims it spends the celebration where nobody can see it. The "Add money" FAB
  // that usually tips a goal over lives on GoalDetail, while the modal used to
  // live only on the list underneath it.
  const hook = readFileSync(
    new URL('../../hooks/useGoalAchievement.ts', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('claiming an achievement is gated on the screen being focused',
    /useIsFocused/.test(hook) && /if \(!isFocused\) return;/.test(hook));
  // Second cause of the same symptom: the money arrives through GoalFundModal,
  // itself a native <Modal>, so closing it and presenting this one in one commit
  // is the §8b stack and the ARRIVING modal is the one that silently loses.
  ok('…and held while another modal on the screen is still animating away',
    /blocked/.test(hook) && /settled/.test(hook));
  // The real fix underneath both: showing it is no longer what consumes it.
  ok('the congratulation is claimed on DISMISS, not on render',
    /markGoalCelebrated\(achievement\.goalId/.test(hook));
  // A recurring goal is celebrated FOR a month, so the stamp carries which one.
  ok('…and a recurring goal\'s stamp carries the month it was celebrated for',
    /monthKey:\s*achievement\.monthKey/.test(hook));
  ok('…and a re-show never pays the bonus twice',
    /const attemptingPay = !next\.bonusAlreadyAwarded;/.test(hook)
    && /attemptingPay\s*\n?\s*\?\s*awardGoalBonus/.test(hook));
  ok('…the bonus is credited BEFORE the goal is marked, so a crash under-awards',
    hook.indexOf('awardGoalBonus(') < hook.indexOf('markGoalAchieved('));

  for (const [name, rel] of [
    ['GoalsScreen', '../../screens/GoalsScreen.tsx'],
    ['GoalDetailScreen', '../../screens/GoalDetailScreen.tsx'],
  ]) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ok(`${name} shows the congratulation`, /GoalAchievedModal/.test(src));
    ok(`…and holds it while its own fund modal is open`, /blocked:\s*!!fundGoal/.test(src));
    ok(`…and claims it through the shared hook, not its own effect`,
      /useGoalAchievement\(/.test(src) && !/getNewlyAchievedGoals\(\)/.test(src));
  }

  // ── Overfunding (Sep-13-26) ────────────────────────────────────────────
  // Reported as "am able to add more than the goal value". It stays ALLOWED —
  // the contribution mirrors a transfer that already happened, so refusing it
  // would leave the goal disagreeing with the money — but it is never a surprise.
  const fund = readFileSync(
    new URL('../../components/GoalFundModal.tsx', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the fund modal knows what is still needed',
    /lifetimeTarget/.test(fund) && /remaining/.test(fund));
  ok('…offers it as a one-tap amount',
    /setFundText\(String\(remaining\)\)/.test(fund));
  ok('…and warns when the amount overshoots the target',
    /more than the/.test(fund) && /theme\.warning/.test(fund));
  ok('…but never blocks it — no cap on the submitted amount',
    !/Math\.min\(\s*amt/.test(fund));

  // ── Where a top-up gets FILED (Sep-13-26) ──────────────────────────────
  // Reported as "the update button in goal card shows others category but i
  // selected mutual funds". `autoRule.categoryIds` holds tree CHILD ids now
  // (`mf`, `restaurants`, …) and those are NOT flat categories — handing one
  // straight to the transaction put a value in the row nothing else understands:
  // "Other" in the modal's own hint, and an unknown bucket in every budget,
  // chart and monthly aggregate. A regression from widening the picker, and
  // exactly the "grep every reader when a key's derivation changes" trap.
  ok('the top-up category is resolved through the tree, not taken raw from the rule',
    /findParentById|PARENT_CATEGORIES/.test(fund) && /childCategory/.test(fund));
  ok('…so the row is filed two-tier, as if categorised by hand',
    /parentCategory:\s*cat!\.parentCategory/.test(fund));
  // And the assumption that the row satisfies the goal is CHECKED, not trusted:
  // any disagreement between inference and rule would otherwise mean money left
  // the account and the goal never moved, silently.
  ok('…and the goal is funded explicitly when the row does not match its rule',
    /ruleMatchesTxn\(goalAutoRule\(goal\)/.test(fund) && /if \(!matched\)/.test(fund));

  const tree = readFileSync(
    new URL('../../constants/twoTierCategories.ts', import.meta.url), 'utf8');
  const mfHasNoLegacyId = /\{ id: 'mf',(?![^}]*legacyId)[^}]*\}/.test(tree);
  ok('…which matters because a child like `mf` has no legacy id of its own',
    mfHasNoLegacyId);
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
if (failures.length) {
  console.log(`  ${C.red}${C.bold}${passed}/${total} passed${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}✗${C.reset} ${f}`));
  process.exit(1);
} else {
  console.log(`  ${C.green}${C.bold}${passed}/${total} passed${C.reset}`);
}
