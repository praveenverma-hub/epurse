// Goal History tab maths:  npm run test:goalHistory
import { goalMonths, summarizeGoalMonths, isMet } from '../goalHistory.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};

const hist = {
  '2026-06': { perGoal: { g1: { planned: 5000, funded: 5000 } } },
  '2026-07': { perGoal: { g1: { planned: 5000, funded: 2000 } } },
  '2026-08': { perGoal: { g1: { planned: 5000, funded: 6000 }, g2: { planned: 100, funded: 0 } } },
  '2026-09': { perGoal: { g1: { planned: 5000, funded: 5000 } } },
  '2026-10': { perGoal: { g1: { planned: 5000, funded: 1 } } },
};
const m = goalMonths(hist, 'g1', '2026-10');
check('newest first, current month and other goals left out', m.map((x) => x.monthKey).join() === '2026-09,2026-08,2026-07,2026-06', m.map((x) => x.monthKey).join());
const s = summarizeGoalMonths(m);
check('hit rate 3 of 4', s.metMonths === 3 && s.planMonths === 4, JSON.stringify(s));
check('streak stops at the miss', s.streak === 2, `${s.streak}`);
check('average funded', s.avgFunded === 4500, `${s.avgFunded}`);
check('best month', s.best.monthKey === '2026-08' && s.best.funded === 6000);
check('exactly the plan is met', isMet({ monthKey: 'x', planned: 100, funded: 100 }));

const auto = summarizeGoalMonths([{ monthKey: '2026-09', planned: 0, funded: 800 }, { monthKey: '2026-08', planned: 1000, funded: 1000 }]);
check('an unplanned month is skipped by the streak and hit rate', auto.streak === 1 && auto.planMonths === 1 && auto.metMonths === 1, JSON.stringify(auto));
check('…but counts toward funded', auto.avgFunded === 900);
const none = summarizeGoalMonths([]);
check('no months → zeros, no best', none.months === 0 && none.avgFunded === 0 && none.best === null);
check('a goal with no history → empty', goalMonths({}, 'g1', '2026-10').length === 0 && goalMonths(null, 'g1', '2026-10').length === 0);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
