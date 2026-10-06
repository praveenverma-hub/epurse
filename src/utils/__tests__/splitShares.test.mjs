import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// splitShares — the share presets + remainder maths both split pages share.
//   npm run test:splitShares
// =============================================================================
const { evenAmounts, evenPercents, fullOwedShares, isEqualShares, leftToAllocate, isFullyAllocated } =
  await import(`${PROJECT_ROOT}/src/utils/splitShares.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const sum = (a) => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check('evenAmounts splits 1000 over 3 and sums exactly', sum(evenAmounts(1000, 3)) === 1000, JSON.stringify(evenAmounts(1000, 3)));
check('…the LAST absorbs the rounding', eq(evenAmounts(100, 3), [33.33, 33.33, 33.34]));
check('evenAmounts of 0 people is empty', evenAmounts(100, 0).length === 0);
check('evenPercents(3) = 34/33/33 (You absorbs the remainder)', eq(evenPercents(3), [34, 33, 33]));
check('evenPercents always sums to 100', [1, 2, 3, 4, 5, 6, 7, 9].every((n) => sum(evenPercents(n)) === 100));
check('fullOwed (amount): payer 0, others split the whole', eq(fullOwedShares(600, 4, 0), [0, 200, 200, 200]));
check('…rounding stays exact', sum(fullOwedShares(100, 4, 0)) === 100);
check('fullOwed (percent): payer 0, others sum to 100', eq(fullOwedShares(100, 3, 0, { whole: true }), [0, 50, 50]));
check('…whole-percent remainder goes to the first other', eq(fullOwedShares(100, 4, 0, { whole: true }), [0, 34, 33, 33]));
check('fullOwed with a non-first payer', eq(fullOwedShares(300, 3, 2), [150, 150, 0]));
check('a lone payer keeps it all (nobody to owe)', eq(fullOwedShares(300, 1, 0), [300]));
check('isEqualShares tolerates a 1-point rounding gap', isEqualShares([34, 33, 33]));
check('…but not a real difference', !isEqualShares([50, 30, 20]));
check('…and a single person is never "equal"', !isEqualShares([100]));
check('leftToAllocate: 2400 target, 550 in → 1850', leftToAllocate(550, 2400) === 1850);
check('…negative when over-allocated', leftToAllocate(120, 100) === -20);
check('isFullyAllocated: percent tolerates 0.5, rupees 0.01', isFullyAllocated(99.6, 100, 'percent') && !isFullyAllocated(99.4, 100, 'percent') && isFullyAllocated(100.005, 100, 'amount') && !isFullyAllocated(99.9, 100, 'amount'));

console.log(`\n${C.bold}${fail ? C.red : C.green}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail ? 1 : 0);
