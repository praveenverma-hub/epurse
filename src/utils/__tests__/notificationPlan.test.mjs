// =============================================================================
// NOTIFICATION PLAN — which pushes get scheduled ahead, for when, with what copy
//   npm run test:notifPlan
// Fixture "now" is Sunday 11 Oct 2026, noon.
// =============================================================================
import { buildPlannedPushes, PLAN_HORIZON_DAYS } from '../../analytics/notificationPlan.ts';
import { planPushes, DAILY_PUSH_CAP, CHANNELS } from '../../constants/notificationPolicy.ts';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const at = (month, d, h = 12, m = 0) => new Date(2026, month, d, h, m, 0, 0).getTime();
const OCT = 9, NOV = 10;
const NOW = at(OCT, 11);
const DAY = 24 * 60 * 60 * 1000;

const base = (over = {}) => ({
  now: NOW,
  hasRecentActivity: true,
  monthlyRecapOn: false,
  recapMonthHandled: null,
  weeklyRecapOn: false,
  weeklyRecapHandled: null,
  budgetMonthKey: null,
  lastPlanMonthKey: null,
  lastMidmonthNudgeMonth: null,
  goals: [],
  reviewQueue: [],
  reviewLast: null,
  cards: [],
  ...over,
});
const of = (facts, kind) => buildPlannedPushes(facts).filter((p) => p.kind === kind);

console.log(`\n${C.bold}══════ Notification plan ══════${C.reset}`);

console.log('\n── nothing from nothing ──');
check('no facts → no pushes', buildPlannedPushes(base()).length === 0);
check('every planned push stays inside the horizon',
  buildPlannedPushes(base({ monthlyRecapOn: true, weeklyRecapOn: true, budgetMonthKey: '2026-10',
    cards: [{ id: 'c', label: 'HDFC ••1', statementDay: 20, notifiedMonth: null }] }))
    .every((p) => p.fireAt > NOW && p.fireAt <= NOW + PLAN_HORIZON_DAYS * DAY));

console.log('\n── monthly recap (1st, 09:30) ──');
let r = of(base({ monthlyRecapOn: true }), 'monthlyRecap');
check('1 Nov 09:30, for October', r.length === 1 && r[0].fireAt === at(NOV, 1, 9, 30) && r[0].key === 'recap:2026-10', JSON.stringify(r));
check('…carries the month for the tap handler', r[0]?.data?.type === 'monthly_recap' && r[0].data.monthKey === '2026-10');
check('…copy names the month', r[0]?.title.includes('October'));
check('recap switched off → nothing', of(base(), 'monthlyRecap').length === 0);
check('no recent activity → nothing', of(base({ monthlyRecapOn: true, hasRecentActivity: false }), 'monthlyRecap').length === 0);
check('already shown in the app → nothing', of(base({ monthlyRecapOn: true, recapMonthHandled: '2026-10' }), 'monthlyRecap').length === 0);

console.log('\n── plan budget (3rd, 19:00) ──');
r = of(base({ budgetMonthKey: '2026-10' }), 'budgetPlan');
check('a budget this month → reminded on 3 Nov to plan November', r.length === 1 && r[0].fireAt === at(NOV, 3, 19) && r[0].key === 'budget_missing:2026-11', JSON.stringify(r));
check('…offering to keep October\'s plan', r[0]?.body.includes('October'));
r = of(base({ now: at(OCT, 1, 8), lastPlanMonthKey: '2026-09' }), 'budgetPlan');
check('1 Oct, no budget yet → 3 Oct 19:00', r.some((p) => p.fireAt === at(OCT, 3, 19)), JSON.stringify(r.map((p) => p.key)));
check('never budgeted → never asked', of(base(), 'budgetPlan').length === 0);
check('two months skipped by 3 Nov → stop asking', of(base({ lastPlanMonthKey: '2026-08' }), 'budgetPlan').length === 0);
check('one month skipped → still asked once more', of(base({ lastPlanMonthKey: '2026-09' }), 'budgetPlan').length === 1);

console.log('\n── mid-month (15th, 10:00) ──');
r = of(base({ budgetMonthKey: '2026-10' }), 'midmonthNudge');
check('budget this month → 15 Oct 10:00', r.length === 1 && r[0].fireAt === at(OCT, 15, 10));
check('…no numbers in a push written days ahead', !/₹|\d+%/.test(`${r[0]?.title} ${r[0]?.body}`));
check('past the 15th → nothing', of(base({ now: at(OCT, 16), budgetMonthKey: '2026-10' }), 'midmonthNudge').length === 0);
check('no budget → nothing', of(base(), 'midmonthNudge').length === 0);
check('already shown in the app → nothing', of(base({ budgetMonthKey: '2026-10', lastMidmonthNudgeMonth: '2026-10' }), 'midmonthNudge').length === 0);

console.log('\n── weekly (Mondays, 09:30) ──');
r = of(base({ weeklyRecapOn: true }), 'weeklyRecap');
check('every Monday in the horizon, starting tomorrow', r.length === 5 && r[0].fireAt === at(OCT, 12, 9, 30), r.map((p) => new Date(p.fireAt).toDateString()).join());
check('keyed by the week that ended (matches maybeQueueWeeklyRecap)', r[0]?.key === 'weekly:2026-10-5');
check('opens the weekly modal on tap', r[0]?.data?.type === 'weekly_recap');
check('the week already shown is skipped', of(base({ weeklyRecapOn: true, weeklyRecapHandled: '2026-10-5' }), 'weeklyRecap')[0]?.fireAt === at(OCT, 19, 9, 30));

console.log('\n── goal behind plan ──');
const goal = (over) => ({ id: 'g', name: 'Holiday', emoji: '🏖️', planned: 6000, funded: 2000, usualFundingDay: 5, ...over });
r = of(base({ goals: [goal()] }), 'goalBehind');
check('check day already passed (5th + 3) → today 19:00', r.length === 1 && r[0].fireAt === at(OCT, 11, 19), JSON.stringify(r));
check('…copy states the shortfall', r[0]?.title.includes('₹4,000'));
r = of(base({ goals: [goal({ usualFundingDay: null })] }), 'goalBehind');
check('no history → the 25th, 19:00', r[0]?.fireAt === at(OCT, 25, 19));
r = of(base({ goals: [goal({ id: 'a', funded: 5000 }), goal({ id: 'b', name: 'Laptop', funded: 0 })] }), 'goalBehind');
check('only the worst goal, once a month', r.length === 1 && r[0].key === 'goal_behind:b:2026-10');
check('funded, unplanned or inactive goals → nothing',
  of(base({ goals: [goal({ funded: 6000 }), goal({ planned: 0 }), goal({ inactive: true })] }), 'goalBehind').length === 0);
check('last day of the month after 19:00 → not pushed into next month',
  of(base({ now: at(OCT, 31, 20), goals: [goal()] }), 'goalBehind').length === 0);

console.log('\n── statement closed ──');
r = of(base({ cards: [{ id: 'c', label: 'HDFC ••4021', statementDay: 20, notifiedMonth: null }] }), 'ccCycleHeadsUp');
check('on the statement day, 10:00', r.length === 1 && r[0].fireAt === at(OCT, 20, 10) && r[0].key === 'cc_cycle:c:2026-10');
check('already told this month → next month, if in range', of(base({ cards: [{ id: 'c', label: 'x', statementDay: 5, notifiedMonth: '2026-10' }] }), 'ccCycleHeadsUp')[0]?.fireAt === at(NOV, 5, 10));
check('day 31 in a 30-day month → the 30th', of(base({ now: at(NOV, 1), cards: [{ id: 'c', label: 'x', statementDay: 31, notifiedMonth: null }] }), 'ccCycleHeadsUp')[0]?.fireAt === at(NOV, 30, 10));

console.log('\n── review reminder ──');
const q = (n, ageDays = 0) => Array.from({ length: n }, () => ({ createdAt: NOW - ageDays * DAY }));
r = of(base({ reviewQueue: q(6) }), 'reviewReminder');
check('6 waiting → today 19:00, with the count', r.length === 1 && r[0].fireAt === at(OCT, 11, 19) && r[0].title.startsWith('6 ') && r[0].meta?.count === 6);
check('2 fresh → nothing', of(base({ reviewQueue: q(2) }), 'reviewReminder').length === 0);
check('after 19:00 → tomorrow', of(base({ now: at(OCT, 11, 20), reviewQueue: q(6) }), 'reviewReminder')[0]?.fireAt === at(OCT, 12, 19));
check('inside the cooldown → nothing', of(base({ reviewQueue: q(6), reviewLast: { at: NOW - DAY, count: 5 } }), 'reviewReminder').length === 0);
check('copy states a benefit, no pressure', /accurate/.test(r[0]?.body || '') && !/streak|RP|EPC/.test(`${r[0]?.title} ${r[0]?.body}`));

console.log('\n── through the policy ──');
const all = buildPlannedPushes(base({
  monthlyRecapOn: true, weeklyRecapOn: true, budgetMonthKey: '2026-10',
  goals: [goal({ usualFundingDay: 9 })], reviewQueue: q(6),
  cards: [{ id: 'c', label: 'x', statementDay: 12, notifiedMonth: null }],
}));
const plan = planPushes(all, { now: NOW, prefs: { reviewReminder: true }, log: [], lastOpenAt: NOW });
const perDay = {};
plan.forEach((p) => { if (!CHANNELS[p.kind].essential) { const k = new Date(p.at).toDateString(); perDay[k] = (perDay[k] || 0) + 1; } });
check(`never more than ${DAILY_PUSH_CAP} on any day`, Object.values(perDay).every((n) => n <= DAILY_PUSH_CAP), JSON.stringify(perDay));
check('review reminder needs the switch', !planPushes(all, { now: NOW, prefs: {}, log: [], lastOpenAt: NOW }).some((p) => p.kind === 'reviewReminder'));
check('weeklies stop after 3 unseen (user never opens the app)', plan.filter((p) => p.kind === 'weeklyRecap').length === 3, plan.filter((p) => p.kind === 'weeklyRecap').length);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
