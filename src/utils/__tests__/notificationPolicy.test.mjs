// =============================================================================
// NOTIFICATION POLICY + NUDGE FACTS
//   npm run test:notifPolicy
// Pins the push rules (cap, quiet hours, back-off, dedupe, priority) and the
// shared trigger conditions the carousel and the push planner both read.
// =============================================================================
import {
  CHANNELS, PUSH_PRIORITY, CAROUSEL_CARD, DAILY_PUSH_CAP,
  decide, planPushes, isQuiet, outOfQuiet, pushEnabled,
} from '../../constants/notificationPolicy.ts';
import {
  monthsBetween, budgetMissingFact, usualFundingDay, goalCheckDay,
  goalsBehindPlan, goalsNearTarget, reviewReminderFact,
} from '../../analytics/nudgeFacts.ts';
import { buildHomeCards } from '../../analytics/homeCards.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const at = (d, h = 12, m = 0, month = 9) => new Date(2026, month, d, h, m, 0, 0).getTime(); // Oct 2026 by default
const DAY = 24 * 60 * 60 * 1000;
const NOW = at(11, 12);
const ctx = (over = {}) => ({ now: NOW, prefs: {}, log: [], lastOpenAt: NOW, appActive: false, ...over });

console.log(`\n${C.bold}══════ Notification policy ══════${C.reset}`);

console.log('\n── every kind is fully described ──');
const kinds = Object.keys(CHANNELS);
check('every kind appears exactly once in PUSH_PRIORITY',
  kinds.every((k) => PUSH_PRIORITY.filter((p) => p === k).length === 1) && PUSH_PRIORITY.length === kinds.length);
check('review reminder is OFF unless the user turns it on', pushEnabled({}, 'reviewReminder') === false && pushEnabled({ reviewReminder: true }, 'reviewReminder') === true);
check('every other kind defaults ON', kinds.filter((k) => k !== 'reviewReminder').every((k) => pushEnabled({}, k)));
check('an explicit off wins over the default', pushEnabled({ budgetBreach: false }, 'budgetBreach') === false);

console.log('\n── decide ──');
let d = decide({ key: 'b:1', kind: 'budgetBreach', fireAt: NOW }, ctx({ prefs: { budgetBreach: false } }));
check('switch off → no push, bell entry kept', d.push === false && d.reason === 'pref' && d.bell === true);
d = decide({ key: 'b:1', kind: 'budgetBreach', fireAt: NOW }, ctx({ log: [{ key: 'b:1', kind: 'budgetBreach', at: NOW - DAY }] }));
check('same event key already sent → duplicate', d.reason === 'duplicate');
d = decide({ key: 'b:2', kind: 'budgetBreach', fireAt: NOW }, ctx({ appActive: true }));
check('immediate push while the app is open → bell only', d.push === false && d.reason === 'foreground' && d.bell === true);
d = decide({ key: 'r:1', kind: 'monthlyRecap', fireAt: NOW + DAY }, ctx({ appActive: true }));
check('a FUTURE push is still scheduled while the app is open', d.push === true && d.fireAt === NOW + DAY);
d = decide({ key: 'p:1', kind: 'budgetPlan', fireAt: NOW - DAY }, ctx());
check('a past fire time sends now, not in the past', d.push === true && d.fireAt === NOW);

console.log('\n── quiet hours (21:30–08:30) ──');
check('21:29 is not quiet, 21:30 is', !isQuiet(at(11, 21, 29)) && isQuiet(at(11, 21, 30)));
check('08:29 is quiet, 08:30 is not', isQuiet(at(11, 8, 29)) && !isQuiet(at(11, 8, 30)));
check('22:00 moves to 08:30 the NEXT day', outOfQuiet(at(11, 22)) === at(12, 8, 30));
check('02:00 moves to 08:30 the SAME day', outOfQuiet(at(12, 2)) === at(12, 8, 30));
d = decide({ key: 'w:1', kind: 'weeklyRecap', fireAt: at(12, 23) }, ctx());
check('decide defers a quiet-hours push instead of dropping it', d.push === true && d.fireAt === at(13, 8, 30));
check('quiet hours apply to CC bill due too (only the cap is exempt)', decide({ key: 'c', kind: 'ccBillDue', fireAt: at(12, 23) }, ctx()).fireAt === at(13, 8, 30));

console.log(`\n── daily cap (${DAILY_PUSH_CAP}) ──`);
const twoToday = [
  { key: 'x1', kind: 'weeklyRecap', at: at(11, 9) },
  { key: 'x2', kind: 'midmonthNudge', at: at(11, 10) },
];
d = decide({ key: 'x3', kind: 'goalBehind', fireAt: at(11, 19) }, ctx({ log: twoToday, lastOpenAt: at(11, 20) }));
check('a third push on the same day is capped', d.reason === 'cap');
d = decide({ key: 'x3', kind: 'goalBehind', fireAt: at(12, 19) }, ctx({ log: twoToday, lastOpenAt: at(11, 20) }));
check('the next day is a fresh allowance', d.push === true);
d = decide({ key: 'c1', kind: 'ccBillDue', fireAt: at(11, 19) }, ctx({ log: twoToday, lastOpenAt: at(11, 20) }));
check('CC bill due is never capped', d.push === true);
d = decide({ key: 'x4', kind: 'goalBehind', fireAt: at(11, 19) },
  ctx({ log: [twoToday[0], { key: 'c0', kind: 'ccBillDue', at: at(11, 10) }], lastOpenAt: at(11, 20) }));
check('…and does not use up the allowance', d.push === true);

console.log('\n── back-off ──');
const unseen = [1, 2, 3].map((i) => ({ key: `g${i}`, kind: 'goalBehind', at: at(i, 19) }));
d = decide({ key: 'g4', kind: 'goalBehind', fireAt: at(5, 19) }, ctx({ now: at(5, 12), log: unseen, lastOpenAt: at(1, 9) }));
check('3 of a kind with no app open since → that kind pauses', d.reason === 'backoff');
d = decide({ key: 'w4', kind: 'weeklyRecap', fireAt: at(5, 19) }, ctx({ now: at(5, 12), log: unseen, lastOpenAt: at(1, 9) }));
check('…other kinds are unaffected', d.push === true);
d = decide({ key: 'g4', kind: 'goalBehind', fireAt: at(5, 19) }, ctx({ now: at(5, 12), log: unseen, lastOpenAt: at(4, 9) }));
check('opening the app lifts the pause', d.push === true);
const unseenCc = [1, 2, 3].map((i) => ({ key: `c${i}`, kind: 'ccBillDue', at: at(i, 10) }));
d = decide({ key: 'c4', kind: 'ccBillDue', fireAt: at(5, 10) }, ctx({ now: at(5, 9), log: unseenCc, lastOpenAt: at(1, 9) }));
check('CC bill due is never paused by back-off', d.push === true);
d = decide({ key: 'g4', kind: 'goalBehind', fireAt: at(25, 19) }, ctx({ now: at(25, 12), log: unseen, lastOpenAt: at(1, 9) }));
check('the pause does not time out on its own — only an app open lifts it', d.reason === 'backoff');

console.log('\n── planPushes ──');
let plan = planPushes([
  { key: 'mid', kind: 'midmonthNudge', fireAt: at(15, 10) },
  { key: 'wk', kind: 'weeklyRecap', fireAt: at(15, 9, 30) },
  { key: 'goal', kind: 'goalBehind', fireAt: at(15, 19) },
], ctx());
check('3 wanting one day → the 2 highest-priority win, whatever their time',
  plan.map((p) => p.key).join() === 'wk,goal', plan.map((p) => p.key).join());
plan = planPushes([
  { key: 'a', kind: 'weeklyRecap', fireAt: at(14, 9) },
  { key: 'a', kind: 'weeklyRecap', fireAt: at(14, 9) },
], ctx());
check('the same event twice in one batch is planned once', plan.length === 1);
plan = planPushes([
  { key: 'late', kind: 'goalBehind', fireAt: at(14, 23) },
  { key: 'm1', kind: 'midmonthNudge', fireAt: at(15, 10) },
  { key: 'm2', kind: 'ccCycleHeadsUp', fireAt: at(15, 11) },
], ctx());
check('a push deferred out of quiet hours counts on the day it lands',
  plan.map((p) => p.key).join() === 'late,m1' && plan[0].at === at(15, 8, 30), JSON.stringify(plan));

console.log('\n── carousel and push agree on order ──');
const cards = buildHomeCards({
  now: new Date(2026, 7, 10, 15).getTime(),
  ccBills: { h: { amount: 12400, cardLast4: '4021', bankName: 'HDFC Bank', dueDate: '12-Aug-26' } },
  budget: { total: { cap: 10000, actual: 12000, pct: 120, remaining: 0, over: true, overshoot: 2000 }, daysLeftInMonth: 9 },
  subscriptions: [{ merchant: 'Netflix', amount: 649, priceHike: true, hikeFrom: 549, hikeTo: 649 }],
}, [], 10).map((c) => c.id);
const shared = PUSH_PRIORITY.filter((k) => CAROUSEL_CARD[k] && cards.includes(CAROUSEL_CARD[k]));
check('fixture produces every shared card that exists today', shared.length >= 3, cards.join());
check('shared kinds rank the same in the carousel as in PUSH_PRIORITY',
  shared.every((k, i) => i === 0 || cards.indexOf(CAROUSEL_CARD[shared[i - 1]]) < cards.indexOf(CAROUSEL_CARD[k])),
  `${shared.join()} vs ${cards.join()}`);

console.log(`\n${C.bold}══════ Nudge facts ══════${C.reset}`);

console.log('\n── budget not planned ──');
check('monthsBetween crosses a year', monthsBetween('2026-12', '2027-01') === 1 && monthsBetween('2026-09', '2026-10') === 1);
check('a budget already set → nothing', budgetMissingFact({ hasBudget: true, lastPlanMonthKey: '2026-09', now: NOW }) === null);
check('never budgeted → never asked', budgetMissingFact({ hasBudget: false, lastPlanMonthKey: null, now: NOW }) === null);
check('first month without a plan → ask', budgetMissingFact({ hasBudget: false, lastPlanMonthKey: '2026-09', now: NOW })?.skippedMonths === 0);
check('one month skipped → still ask', budgetMissingFact({ hasBudget: false, lastPlanMonthKey: '2026-08', now: NOW })?.skippedMonths === 1);
check('two months skipped → stop', budgetMissingFact({ hasBudget: false, lastPlanMonthKey: '2026-07', now: NOW }) === null);
check('plan from this month (reset mid-month) → not a new-month prompt', budgetMissingFact({ hasBudget: false, lastPlanMonthKey: '2026-10', now: NOW }) === null);

console.log('\n── goal funding day ──');
check('largest contribution per month, median of the last 3', usualFundingDay([
  [{ day: 2, amount: 100 }], [{ day: 1, amount: 50 }, { day: 5, amount: 5000 }], [{ day: 6, amount: 5000 }], [{ day: 4, amount: 5000 }],
]) === 5);
check('two months → their average', usualFundingDay([[{ day: 4, amount: 1 }], [{ day: 7, amount: 1 }]]) === 6);
check('no history → null', usualFundingDay([]) === null && usualFundingDay([[{ day: 3, amount: 0 }]]) === null);
check('check day = usual day + 3', goalCheckDay(5, 31) === 8);
check('no history → the 25th', goalCheckDay(null, 31) === 25);
check('never past the month end', goalCheckDay(29, 30) === 30 && goalCheckDay(null, 28) === 25 && goalCheckDay(27, 28) === 28);

console.log('\n── goal behind plan ──');
const G = [
  { id: 'a', name: 'Holiday', planned: 6000, funded: 4000, usualFundingDay: 5 },
  { id: 'b', name: 'Laptop', planned: 10000, funded: 2000, usualFundingDay: null },
  { id: 'c', name: 'SIP', planned: 5000, funded: 5000, usualFundingDay: 5 },
  { id: 'd', name: 'Auto only', planned: 0, funded: 300 },
  { id: 'e', name: 'Stopped', planned: 3000, funded: 0, inactive: true },
];
check('on the 11th only the goal past its own check day (8th) is behind', goalsBehindPlan(G, NOW).map((g) => g.id).join() === 'a');
check('on the 25th both, largest shortfall first', goalsBehindPlan(G, at(25)).map((g) => g.id).join() === 'b,a');
check('shortfall is planned − funded', goalsBehindPlan(G, at(25))[1].shortfall === 2000);

console.log('\n── goal near target ──');
const N = goalsNearTarget([
  { id: 'x', name: 'A', target: 10000, saved: 8900 },
  { id: 'y', name: 'B', target: 10000, saved: 9000 },
  { id: 'z', name: 'C', target: 50000, saved: 49000 },
  { id: 'w', name: 'D', target: 10000, saved: 10000 },
  { id: 'v', name: 'E', target: 10000, saved: 9500, achieved: true },
]);
check('≥ 90% and not yet reached, closest first', N.map((g) => g.id).join() === 'y,z' && N[0].remaining === 1000, N.map((g) => g.id).join());

console.log('\n── review reminder ──');
const q = (n, ageDays = 0) => Array.from({ length: n }, (_, i) => ({ createdAt: NOW - ageDays * DAY - i * 60000 }));
check('empty queue → nothing', reviewReminderFact({ queue: [], now: NOW }) === null);
check('4 fresh → nothing yet', reviewReminderFact({ queue: q(4), now: NOW }) === null);
check('5 fresh → remind', reviewReminderFact({ queue: q(5), now: NOW })?.count === 5);
check('2, oldest 4 days old → remind', reviewReminderFact({ queue: q(2, 4), now: NOW })?.oldestDays === 4);
check('2, oldest just under 3 days → nothing', reviewReminderFact({ queue: q(2, 2.9), now: NOW }) === null);
check('reminded yesterday at 5, now 6 → cooldown', reviewReminderFact({ queue: q(6), now: NOW, lastSent: { at: NOW - DAY, count: 5 } }) === null);
check('reminded yesterday at 5, now 10 → doubled, remind', reviewReminderFact({ queue: q(10), now: NOW, lastSent: { at: NOW - DAY, count: 5 } })?.count === 10);
check('reminded 3 days ago → cooldown over', reviewReminderFact({ queue: q(6), now: NOW, lastSent: { at: NOW - 3 * DAY, count: 5 } })?.count === 6);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
