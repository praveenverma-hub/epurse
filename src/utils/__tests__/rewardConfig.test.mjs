// =============================================================================
// rewardConfig test suite — the goal-completion REWARD (Sep-14-26 rework)
// -----------------------------------------------------------------------------
// ZERO-DEPENDENCY runner:
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs src/utils/__tests__/rewardConfig.test.mjs
//
// "show me the reward we are giving on goal completions, need to audit that"
// then "consider the amount... don't pay unnecessarily... recurring goals
// should also be awarded... not awarded too much too early... have the
// awarding logic at one place." This suite covers the part that's plain,
// dependency-free TS and can actually run headlessly: `bandForGoalAmount` and
// `computeGoalReward`, THE single formula both goal durations share.
//
// `useRewardStore.awardGoalBonus` (the monthly reward-ceiling clamp) and
// `useGoalAchievement` (the wiring that calls it) can't run in this harness —
// zustand's `persist` middleware calls `AsyncStorage.setItem` synchronously
// inside `set()`, and the RN AsyncStorage shim has no `setItem` outside a real
// app — so THAT half is covered by source-text assertions instead, the same
// convention already used for every other RN-coupled hook/store file in this
// suite (see goalPlan.test.mjs's own `useGoalAchievement.ts` checks).
// =============================================================================

import { readFileSync } from 'node:fs';
import {
  REWARD_CONFIG,
  bandForGoalAmount,
  computeGoalReward,
  goalRewardDisplay,
  multiplierForStreak,
} from '../../config/rewardConfig.ts';

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

// ── band selection ───────────────────────────────────────────────────────────
section('bandForGoalAmount — ascending, first match wins, unbounded at the top');
check('a small target lands in Small', bandForGoalAmount(3000).label, 'Small');
check('exactly the boundary is INCLUSIVE of the lower band', bandForGoalAmount(5000).label, 'Small');
check('one rupee over the boundary moves to the next band', bandForGoalAmount(5001).label, 'Medium');
check('the Medium/Large boundary', bandForGoalAmount(25000).label, 'Medium');
check('…and just over it', bandForGoalAmount(25001).label, 'Large');
check('the Large/Very-Large boundary', bandForGoalAmount(100000).label, 'Large');
check('…and just over it', bandForGoalAmount(100001).label, 'Very Large');
check('an absurdly large target still lands in the SAME top band', bandForGoalAmount(50_00_00_000).label, 'Very Large');
check('zero reads as Small, not an error', bandForGoalAmount(0).label, 'Small');
check('a negative amount is clamped to zero, not a crash', bandForGoalAmount(-500).label, 'Small');
check('garbage reads as zero, not NaN propagating', bandForGoalAmount(undefined).label, 'Small');

// ── the reward is amount-aware but BOUNDED, not a raw proportion ────────────
section('computeGoalReward — amount matters, but the top band is a ceiling, not a formula');
{
  const small = computeGoalReward({ durationKind: 'oneTime', amount: 2000, streakDay: 1 });
  const huge  = computeGoalReward({ durationKind: 'oneTime', amount: 50_00_000, streakDay: 1 });
  const huger = computeGoalReward({ durationKind: 'oneTime', amount: 5_00_00_000, streakDay: 1 });
  ok('a bigger goal pays more than a small one', huge.rpAwarded > small.rpAwarded);
  check('…but a goal 10x bigger than the top band does NOT pay 10x more — same band, same payout',
    huger.rpAwarded, huge.rpAwarded);
  check('…exactly the top band\'s configured value', huge.rpAwarded, REWARD_CONFIG.GOAL_REWARD_BANDS.at(-1).oneTimeRp);
}

// ── one-time vs recurring: same band table, different payout scale ─────────
section('One-time and recurring share the SAME amount bands, but not the same payout');
{
  const AMOUNT = 10_000; // Medium band for either duration
  const oneTime   = computeGoalReward({ durationKind: 'oneTime',   amount: AMOUNT, streakDay: 1 });
  const recurring = computeGoalReward({ durationKind: 'recurring', amount: AMOUNT, streakDay: 1 });
  check('both classify into the SAME band for the same amount', oneTime.band, recurring.band);
  ok('…but a one-time (once-ever) completion pays MORE than a recurring (every-month) one at the same amount',
    oneTime.rpAwarded > recurring.rpAwarded && oneTime.epcAwarded > recurring.epcAwarded);
}
// Every band, both directions — a config typo that inverted one row would
// otherwise only surface at whatever amount someone happened to test by hand.
for (const band of REWARD_CONFIG.GOAL_REWARD_BANDS) {
  ok(`band "${band.label}": one-time pays more RP than recurring`, band.oneTimeRp > band.recurringRp);
  ok(`band "${band.label}": one-time pays more EPC than recurring`, band.oneTimeEpc > band.recurringEpc);
}

// ── the streak multiplier still applies, same ladder as everything else ────
section('The Aware Run multiplier scales the band, same as every other reward');
{
  const AMOUNT = 10_000;
  const day1  = computeGoalReward({ durationKind: 'oneTime', amount: AMOUNT, streakDay: 1 });
  const day10 = computeGoalReward({ durationKind: 'oneTime', amount: AMOUNT, streakDay: 10 });
  const day20 = computeGoalReward({ durationKind: 'oneTime', amount: AMOUNT, streakDay: 20 });
  check('day 1 sits at the base multiplier (1.0x)', day1.rpAwarded, Math.round(bandForGoalAmount(AMOUNT).oneTimeRp * 1.0));
  check('day 10 (Steady, 1.2x) pays more than day 1', day10.rpAwarded > day1.rpAwarded, true);
  check('day 20 (Veteran, 1.5x) pays the most', day20.rpAwarded, Math.round(bandForGoalAmount(AMOUNT).oneTimeRp * 1.5));
  check('…matches multiplierForStreak directly, not a re-derived number', multiplierForStreak(20), 1.5);
}

// ── EPC never rounds down to zero ───────────────────────────────────────────
section('EPC always pays at least 1, even at the smallest band and lowest streak');
{
  const smallest = computeGoalReward({ durationKind: 'recurring', amount: 1, streakDay: 0 });
  ok('recurring/Small at day 0 still pays a whole coin, never 0', smallest.epcAwarded >= 1);
}

// ── GOAL_REWARD_ENABLED — the build-time kill switch ────────────────────────
// "make the reward goals config based check, whether to reward or not"
// (Sep-16-26). `REWARD_CONFIG` is a plain object (no runtime freeze — `as
// const` is compile-time only), so flipping the flag here and restoring it is
// a legitimate way to exercise both branches of `computeGoalReward` directly.
section('GOAL_REWARD_ENABLED — one flag, read in exactly one place');
{
  const before = REWARD_CONFIG.GOAL_REWARD_ENABLED;
  check('defaults to on', before, true);

  REWARD_CONFIG.GOAL_REWARD_ENABLED = false;
  const off = computeGoalReward({ durationKind: 'oneTime', amount: 50_000, streakDay: 20 });
  check('…off pays nothing, RP', off.rpAwarded, 0);
  check('…off pays nothing, EPC', off.epcAwarded, 0);
  ok('…but still reports which band the goal WOULD have earned',
    off.band === bandForGoalAmount(50_000).label);

  REWARD_CONFIG.GOAL_REWARD_ENABLED = true;
  const on = computeGoalReward({ durationKind: 'oneTime', amount: 50_000, streakDay: 20 });
  ok('flipping it back on restores the normal payout', on.rpAwarded > 0 && on.epcAwarded > 0);

  REWARD_CONFIG.GOAL_REWARD_ENABLED = before; // leave the config as we found it
}

// ── goalRewardDisplay — the single source GoalCard + GoalDetailScreen share ─
// "the point of showing RP/EPC is to inform/motivate the user... so do we
// show them all the time" (Sep-16-26). Answer encoded here: yes, whenever
// there's something real to show — a PROJECTION while still active (even
// before anything's been earned, since that's the whole point), or the
// actual EARNED total once there's nothing left to motivate toward.
section('goalRewardDisplay — projection while active, earned total once inactive');
{
  ok('an active ONE-TIME goal with a target projects its COMPLETION reward',
    (() => {
      const d = goalRewardDisplay({
        isOneTime: true, lifetimeTarget: 50_000, planned: 0, inactive: false,
        rpEarned: 0, epcEarned: 0, streakDay: 1,
      });
      return d && d.mode === 'projected' && d.rp > 0;
    })());

  ok('an active RECURRING goal projects THIS MONTH\'s reward from its planned figure, not a target',
    (() => {
      const d = goalRewardDisplay({
        isOneTime: false, lifetimeTarget: 0, planned: 5_000, inactive: false,
        rpEarned: 0, epcEarned: 0, streakDay: 1,
      });
      return d && d.mode === 'projected' && d.rp > 0;
    })());

  check('a projection is NEVER zero — this is what makes it safe to show before anything is earned',
    (() => {
      const d = goalRewardDisplay({
        isOneTime: true, lifetimeTarget: 100, planned: 0, inactive: false,
        rpEarned: 0, epcEarned: 0, streakDay: 0,
      });
      return d.rp > 0 && d.epc > 0;
    })(), true);

  check('an active goal with NOTHING to project from (no target, nothing planned) shows nothing at all',
    goalRewardDisplay({
      isOneTime: false, lifetimeTarget: 0, planned: 0, inactive: false,
      rpEarned: 0, epcEarned: 0, streakDay: 5,
    }), null);

  ok('an INACTIVE goal (achieved or discontinued) shows what it ACTUALLY earned instead',
    (() => {
      const d = goalRewardDisplay({
        isOneTime: true, lifetimeTarget: 50_000, planned: 0, inactive: true,
        rpEarned: 260, epcEarned: 26, streakDay: 20,
      });
      return d.mode === 'earned' && d.rp === 260 && d.epc === 26;
    })());

  ok('…even if the streak is high — an inactive goal\'s number is history, not a live re-quote',
    (() => {
      const d = goalRewardDisplay({
        isOneTime: true, lifetimeTarget: 50_000, planned: 0, inactive: true,
        rpEarned: 260, epcEarned: 26, streakDay: 20,
      });
      // 260/26 is what was actually credited, NOT computeGoalReward's live
      // quote for a 50k target at day-20 streak (which would be different —
      // the band's base RP times the day-20 multiplier, not the raw base).
      const liveQuote = computeGoalReward({ durationKind: 'oneTime', amount: 50_000, streakDay: 20 });
      return d.rp === 260 && d.epc === 26 && d.rp !== liveQuote.rpAwarded;
    })());

  check('an inactive goal that genuinely never earned anything reads as a dash-worthy zero, not hidden',
    (() => {
      const d = goalRewardDisplay({
        isOneTime: false, lifetimeTarget: 0, planned: 0, inactive: true,
        rpEarned: 0, epcEarned: 0, streakDay: 5,
      });
      return d.mode === 'earned' && d.rp === 0 && d.epc === 0;
    })(), true);

  {
    const before = REWARD_CONFIG.GOAL_REWARD_ENABLED;
    REWARD_CONFIG.GOAL_REWARD_ENABLED = false;
    check('the kill switch suppresses EVERYTHING here too, not just the payout',
      goalRewardDisplay({
        isOneTime: true, lifetimeTarget: 50_000, planned: 0, inactive: false,
        rpEarned: 0, epcEarned: 0, streakDay: 20,
      }), null);
    REWARD_CONFIG.GOAL_REWARD_ENABLED = before;
  }
}

// ── the monthly reward CEILING — the actual anti-grind backstop ────────────
// `useRewardStore.awardGoalBonus` can't run headlessly (see file header), so
// its clamp logic is verified as source text, the same convention every other
// RN-coupled store/hook file in this suite already uses.
section('The monthly reward ceiling — verified in useRewardStore.ts (cannot execute AsyncStorage-backed code here)');
{
  const store = readFileSync(
    new URL('../../store/useRewardStore.ts', import.meta.url), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok('awardGoalBonus takes a durationKind and an amount, not just a name',
    /awardGoalBonus:\s*\(goalId, goalName, durationKind, amount\)/.test(store));
  ok('…and calls computeGoalReward — the ONE formula, not a re-implementation here',
    /computeGoalReward\(\{\s*\n?\s*durationKind, amount, streakDay: state\.awareStreak,?\s*\n?\s*\}\)/.test(store));
  ok('a calendar-month key gates the running total, same shape as the daily review cap',
    /goalRewardMonthKey/.test(store) && /toCalendarDate\(\)\.slice\(0,\s*7\)/.test(store));
  ok('the payout is CLAMPED against the remaining monthly room, not just quoted',
    /Math\.min\(quotedRp, rpRoom\)/.test(store) && /Math\.min\(quotedEpc, epcRoom\)/.test(store));
  ok('room is computed from the configured ceiling minus what THIS month already used',
    /GOAL_REWARD_MONTHLY_CAP_RP\s*-\s*rpUsed/.test(store)
    && /GOAL_REWARD_MONTHLY_CAP_EPC\s*-\s*epcUsed/.test(store));
  ok('a clamped-to-zero result is still returned, never thrown away',
    /return \{ rpAwarded, epcAwarded, multiplier \};/.test(store));
  ok('…and a zero result skips the bell notification rather than announcing "+0 RP"',
    /if \(rpAwarded > 0 \|\| epcAwarded > 0\)/.test(store));
}

// ── the recurring path actually pays now, and only once per month ──────────
section('The store-side wiring that lets a recurring goal pay (ePurseStore.js is plain JS — kept in test:store)');
{
  const src = readFileSync(new URL('../../store/ePurseStore.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('a recurring completion is no longer hardcoded as already-awarded',
    !/kind: 'monthly', monthKey: mk, bonusAlreadyAwarded: true/.test(src));
  ok('…it is eligible unless THIS month was already paid',
    /bonusAlreadyAwarded: goal\.bonusAwardedMonth === mk/.test(src));
  ok('markGoalMonthlyBonusAwarded is the monthly twin of markGoalAchieved\'s bonus stamp',
    /markGoalMonthlyBonusAwarded:\s*\(goalId, mk\)/.test(src));
}

// ── the hook wiring: both durations attempt payment, only once per occasion ─
section('useGoalAchievement.ts — both durations attempt payment, gated by bonusAlreadyAwarded');
{
  const hook = readFileSync(new URL('../../hooks/useGoalAchievement.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('the duration kind is derived for the band, not hardcoded to one-time',
    /next\.kind === 'lifetime' \? 'oneTime' : 'recurring'/.test(hook));
  ok('the amount passed is next.target — the SAME field either kind already carries',
    /awardGoalBonus\(next\.goalId, next\.name, next\.kind === 'lifetime' \? 'oneTime' : 'recurring', next\.target\)/.test(hook));
  ok('a monthly payment attempt stamps bonusAwardedMonth, mirroring the lifetime path',
    /markGoalMonthlyBonusAwarded\(next\.goalId, next\.monthKey\)/.test(hook));
  ok('a REAL payout also credits the goal\'s own RP/EPC ledger',
    /creditGoalReward\(next\.goalId, paid\.rpAwarded, paid\.epcAwarded\)/.test(hook));
  ok('…but only when something was actually paid, never on a re-show or a zero clamp',
    /if \(paid && \(paid\.rpAwarded > 0 \|\| paid\.epcAwarded > 0\)\)/.test(hook));
}

// ── the card: layout branches on the SAME kill switch as the payout ────────
section('GoalCard.tsx — pencil/quick-action/reward-row all branch on GOAL_REWARD_ENABLED (cannot execute RN/SVG code here)');
{
  const card = readFileSync(new URL('../../components/GoalCard.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('reads the SAME flag the payout itself reads — no separate prop threaded down',
    /const rewardsOn = REWARD_CONFIG\.GOAL_REWARD_ENABLED;/.test(card));
  ok('the pencil moves to the LEFT only when rewards are on',
    /rewardsOn \? styles\.cornerLeft : styles\.cornerRight/.test(card));
  ok('the top-right quick action only renders when rewards are on AND there is a handler',
    /\{rewardsOn && actionHandler \?/.test(card));
  ok('the labelled bottom button is the ORIGINAL behaviour — rendered only when rewards are OFF',
    /!rewardsOn && showResume/.test(card) && /!rewardsOn && showFund/.test(card));
  ok('the reward chip row is the alternative — rendered only when rewards are ON and there is something to show',
    /\) : rewardsOn && rewardDisplay \? \(/.test(card));
  ok('the projection/earned split reads goalRewardDisplay, not the raw ledger props directly',
    /const rewardDisplay = rewardsOn/.test(card) && /goalRewardDisplay\(\{/.test(card));
  ok('the live Aware Run streak feeds the projection, so it reflects TODAY\'s multiplier',
    /const awareStreak = useRewardStore\(\(s: any\) => s\.awareStreak\);/.test(card));
  ok('a dash ONLY ever replaces an "earned" (historical) zero — a projection is never zero, never dashed',
    /rewardDisplay\.mode === 'earned' && rewardDisplay\.rp === 0 \? '— RP'/.test(card));
  ok('no caption is rendered any more ("just show")',
    !/rewardCaption/.test(card));
  ok('no divider line above the reward row',
    !/rewardRow:\s*\{[^}]*borderTopWidth/.test(card));
  ok('RP and EPC are merged into ONE row, not two separate chips',
    !/rewardChip:/.test(card) && /styles\.rewardChipTxt/.test(card));
  ok('the goal name has no divider line under it any more',
    !/stats:\s*\{[^}]*borderTopWidth/.test(card));
}

// ── the detail screen shows the SAME info, from the SAME shared function ───
section('GoalDetailScreen.tsx — "we have to show these value in goal details as well"');
{
  const detail = readFileSync(new URL('../../screens/GoalDetailScreen.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('computes the SAME projection/earned split GoalCard does, not a re-implementation',
    /goalRewardDisplay\(\{/.test(detail));
  ok('reads the live streak too, so its projection matches GoalCard\'s at any given moment',
    /const awareStreak = useRewardStore\(\(s: any\) => s\.awareStreak\);/.test(detail));
  ok('passes BOTH discontinued and achieved into inactive — a discontinued goal has nothing to earn either',
    /inactive: achieved \|\| discontinued/.test(detail));
  ok('renders nothing (not an empty box) when there is nothing to show',
    /\{rewardDisplay \? \(/.test(detail));
  ok('no caption here either — "just show", the same instruction applies to both screens',
    !/rewardCaption/.test(detail));
  // Sep-16-26 follow-up: "move the rp and epc row above the recurring and
  // savings row" — the status+reward row (`statusRow`) must appear BEFORE
  // the kind/duration/category row (`chipRow`) in source order.
  ok('the status+reward row is placed ABOVE the kind/duration/category row',
    detail.indexOf('styles.statusRow') > 0
    && detail.indexOf('styles.statusRow') < detail.indexOf('styles.chipRow'));
  // "we show the separator with amount once the month ends as in group and
  // other places" — the LIVE (still-open) current month must NOT get a
  // MonthDivider (its total isn't final yet); only CLOSED months in History
  // do, one per entry, reusing the exact shared component Groups/Activity
  // already use for a month + its total.
  ok('History renders one MonthDivider per CLOSED month, with that month\'s own total',
    /<MonthDivider key=\{h\.monthKey\} monthKey=\{h\.monthKey\} total=\{h\.funded\} \/>/.test(detail));
  ok('the LIVE current month gets no divider — its total isn\'t final yet',
    !/monthKey=\{monthKey\(new Date\(\)\)\}/.test(detail));
}

// ── the shared type: no orphaned field left after removing the caption ────
section('GoalRewardDisplay no longer carries an unused caption field');
{
  const rc = readFileSync(new URL('../../config/rewardConfig.ts', import.meta.url), 'utf8');
  ok('the interface itself was trimmed, not just left unused',
    !/caption:\s*string;/.test(rc));
}

// ── the screens: every GoalCard call site actually passes the ledger ──────
section('GoalsScreen.tsx passes rpEarned/epcEarned through to every GoalCard');
{
  const screen = readFileSync(new URL('../../screens/GoalsScreen.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const goalCardBlocks = screen.match(/<GoalCard[\s\S]*?\/>/g) || [];
  check('both GoalCard call sites exist (active grid + inactive grid)', goalCardBlocks.length, 2);
  ok('EVERY call site passes both fields — a caller silently skipping one would just show a dash forever',
    goalCardBlocks.every((b) => /rpEarned=\{g\.rpEarned\}/.test(b) && /epcEarned=\{g\.epcEarned\}/.test(b)));
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
