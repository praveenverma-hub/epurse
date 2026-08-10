// =============================================================================
// MONTH PACE — the tab bar's top edge as a budget track.
// -----------------------------------------------------------------------------
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs \
//        src/utils/__tests__/monthPace.test.mjs
//
// This draws a 3pt line at the very bottom of every screen, which is exactly the
// kind of thing nobody looks at closely — so every boundary is pinned here rather
// than eyeballed on a device. The two that matter most are the ones that decide
// whether it draws AT ALL (no budget → the plain hairline it always was) and
// whether it recolours (over the cap, not merely ahead of the month).
// =============================================================================
import {
  monthPace, PACE_HAIRLINE_H, PACE_NOTCH_W, PACE_STRIP_H,
} from '../../analytics/monthPace.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const usage = (cap, actual) => ({ total: { cap, actual } });
/** Local midnight, so the day-of-month maths matches the device's clock. */
const at = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).getTime();

console.log('\n── it must NOT draw without a real budget ──');
// The app deliberately never nags a user into planning one, and a track showing
// 0-of-0 would be a lie. `null` here is what keeps the bar's plain hairline.
check('no budget at all → null', monthPace(null, at(2026, 8, 11)) === null);
check('undefined usage → null', monthPace(undefined, at(2026, 8, 11)) === null);
check('a budget with a zero cap → null', monthPace(usage(0, 500), at(2026, 8, 11)) === null);
check('a negative cap → null', monthPace(usage(-100, 50), at(2026, 8, 11)) === null);
check('a non-numeric cap → null', monthPace(usage('abc', 50), at(2026, 8, 11)) === null);
check('a malformed usage object → null', monthPace({}, at(2026, 8, 11)) === null);
check('an invalid clock → null', monthPace(usage(1000, 500), NaN) === null);

console.log('\n── fill = budget used, clamped ──');
{
  const p = monthPace(usage(1000, 250), at(2026, 8, 11));
  check('a quarter spent → fill 0.25', Math.abs(p.fill - 0.25) < 1e-9, `${p.fill}`);
  check('not over', p.over === false);
}
check('nothing spent → fill 0', monthPace(usage(1000, 0), at(2026, 8, 11)).fill === 0);
{
  // A NaN actual would otherwise divide into a full bar, which reads as "you have
  // spent everything" — the most alarming possible thing to say by accident.
  const p = monthPace(usage(1000, NaN), at(2026, 8, 11));
  check('a NaN actual reads as 0, never as full', p.fill === 0 && p.over === false, JSON.stringify(p));
  check('a negative actual (refund-heavy month) floors at 0',
    monthPace(usage(1000, -80), at(2026, 8, 11)).fill === 0);
}
{
  const p = monthPace(usage(1000, 2500), at(2026, 8, 11));
  check('2.5× the cap → fill clamps to 1', p.fill === 1, `${p.fill}`);
  check('…but `ratio` keeps the true figure for anything that wants it',
    Math.abs(p.ratio - 2.5) < 1e-9, `${p.ratio}`);
}

console.log('\n── `over` is the ONLY thing that recolours ──');
check('exactly at the cap is NOT over (you have not exceeded it)',
  monthPace(usage(1000, 1000), at(2026, 8, 11)).over === false);
check('a rupee past the cap IS over', monthPace(usage(1000, 1000.01), at(2026, 8, 11)).over === true);

console.log('\n── the notch: where the month has got to ──');
{
  // Day-of-month over its length. The 1st is "just started", not 0 — part of it
  // has already passed.
  const jan1 = monthPace(usage(1000, 0), at(2026, 1, 1));
  check('Jan 1 → 1/31 elapsed', Math.abs(jan1.elapsed - 1 / 31) < 1e-9, `${jan1.elapsed}`);
  const jan31 = monthPace(usage(1000, 0), at(2026, 1, 31));
  check('Jan 31 → the notch reaches the end', jan31.elapsed === 1, `${jan31.elapsed}`);
  // Month length must come from the calendar, not a constant — a hardcoded 30 or
  // 31 puts the notch in the wrong place for 7 months of the year plus February.
  check('Feb 28 2026 (non-leap) → elapsed 1',
    monthPace(usage(1000, 0), at(2026, 2, 28)).elapsed === 1);
  check('Feb 28 2024 (LEAP) → NOT yet 1, there is a 29th',
    Math.abs(monthPace(usage(1000, 0), at(2024, 2, 28)).elapsed - 28 / 29) < 1e-9,
    `${monthPace(usage(1000, 0), at(2024, 2, 28)).elapsed}`);
  check('Feb 29 2024 → elapsed 1', monthPace(usage(1000, 0), at(2024, 2, 29)).elapsed === 1);
  check('Apr 15 of 30 days → 0.5', Math.abs(monthPace(usage(1000, 0), at(2026, 4, 15)).elapsed - 0.5) < 1e-9);
  check('Dec 31 → elapsed 1 (year boundary does not wrap the month length)',
    monthPace(usage(1000, 0), at(2026, 12, 31)).elapsed === 1);
}

console.log('\n── `ahead` compares the two, and must NOT be over-eager ──');
{
  // Halfway through April having spent 60% → ahead. This is the signal the notch
  // exists to give, and it deliberately does NOT change the colour: paying rent
  // on the 1st makes you "ahead" for four weeks, and a warning tone for four
  // weeks is noise, not information.
  const p = monthPace(usage(1000, 600), at(2026, 4, 15));
  check('60% spent at the halfway mark → ahead', p.ahead === true);
  check('…and still not `over`', p.over === false);
  check('40% spent at the halfway mark → not ahead',
    monthPace(usage(1000, 400), at(2026, 4, 15)).ahead === false);
  check('over the cap is necessarily ahead too',
    monthPace(usage(1000, 1200), at(2026, 4, 15)).ahead === true);
  check('day 1, nothing spent → not ahead',
    monthPace(usage(1000, 0), at(2026, 4, 1)).ahead === false);
}

console.log('\n── the geometry the component relies on ──');
check(`the informative strip is taller than the hairline it replaces (${PACE_STRIP_H} > ${PACE_HAIRLINE_H})`,
  PACE_STRIP_H > PACE_HAIRLINE_H);
check('but small enough not to be a band', PACE_STRIP_H <= 4, `${PACE_STRIP_H}`);
check('the strip only costs a couple of points of bar height',
  PACE_STRIP_H - PACE_HAIRLINE_H <= 3, `${PACE_STRIP_H - PACE_HAIRLINE_H}`);
check(`the notch is visible but not a segment (${PACE_NOTCH_W}pt)`,
  PACE_NOTCH_W >= 1 && PACE_NOTCH_W < PACE_STRIP_H * 2);

console.log('\n── every fill/elapsed pair is a legal CSS percentage ──');
// Both go straight into `width`/`left` as `${n * 100}%`, so a value outside 0–1
// would silently paint outside the track.
{
  const cases = [[1000, 0], [1000, 1], [1000, 999], [1000, 1000], [1000, 99999], [1, 1e9], [1000, -5]];
  let bad = [];
  for (const [cap, actual] of cases) {
    for (const d of [1, 14, 28, 31]) {
      const p = monthPace(usage(cap, actual), at(2026, 1, d));
      if (!(p.fill >= 0 && p.fill <= 1 && p.elapsed > 0 && p.elapsed <= 1)) {
        bad.push(`${cap}/${actual}@${d}: ${p.fill}/${p.elapsed}`);
      }
    }
  }
  check(`all ${cases.length * 4} combinations stay inside 0–1`, bad.length === 0, bad.join(', '));
}

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${fail === 0 ? C.green : C.red}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail === 0 ? 0 : 1);
