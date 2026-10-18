// =============================================================================
// LAYOUT — shape helpers that must hold from a 320dp phone to a 430dp one.
// -----------------------------------------------------------------------------
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs \
//        src/utils/__tests__/layout.test.mjs
// =============================================================================
import {
  ACCOUNT_CARD_RATIO, FONT_SCALE_FIXED, FONT_SCALE_MAX, gridItemWidth, ratioHeight,
} from '../../constants/layout.ts';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

console.log('\n── font scale caps ──');
check('cap still honours the OS setting (> 1)', FONT_SCALE_MAX > 1, `${FONT_SCALE_MAX}`);
check('cap stays small enough not to break cards (≤ 1.3)', FONT_SCALE_MAX <= 1.3, `${FONT_SCALE_MAX}`);
check('fixed boxes do not grow', FONT_SCALE_FIXED === 1, `${FONT_SCALE_FIXED}`);

console.log('\n── ratioHeight keeps the shape ──');
check('bank card at its usual width is 300×170', ratioHeight(300, ACCOUNT_CARD_RATIO) === 170,
  `${ratioHeight(300, ACCOUNT_CARD_RATIO)}`);
for (const w of [232, 272, 300, 342]) {
  const h = ratioHeight(w, ACCOUNT_CARD_RATIO);
  check(`card ${w} wide keeps its ratio (±1pt)`, Math.abs(h - w / ACCOUNT_CARD_RATIO) <= 0.5, `${h}`);
}
check('min clamps a narrow card', ratioHeight(200, ACCOUNT_CARD_RATIO, { min: 150 }) === 150);
check('max clamps a wide one', ratioHeight(600, 2, { max: 180 }) === 180);

console.log('\n── gridItemWidth never overflows the row ──');
for (const w of [288, 328, 361, 379, 398]) {
  for (const cols of [2, 3]) {
    const gap = 12;
    const tile = gridItemWidth(w, cols, gap);
    check(`${w} / ${cols} cols: tiles + gaps fit`, tile * cols + gap * (cols - 1) <= w,
      `${tile * cols + gap * (cols - 1)} > ${w}`);
    check(`${w} / ${cols} cols: integer tile`, Number.isInteger(tile), `${tile}`);
  }
}

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${fail === 0 ? C.green : C.red}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail === 0 ? 0 : 1);
