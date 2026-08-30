// =============================================================================
// CAROUSEL GEOMETRY — the centring maths shared by both carousels.
// -----------------------------------------------------------------------------
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs \
//        src/utils/__tests__/carouselGeometry.test.mjs
//
// One invariant carries the whole thing: with `sidePad = (boxW - cardW) / 2`, the
// list's MAXIMUM scroll offset lands exactly on the LAST card's snap point. Get it
// wrong by even a few points and the final card parks off-centre with no way to
// nudge it — and because it's the last card, it's the one nobody scrolls to while
// testing. `GroupInsightCarousel` shipped with `- GUTTER / 2` in that expression
// and was ~4pt short for months.
// =============================================================================
import {
  CARD_GAP, NEIGHBOUR_OPACITY, NEIGHBOUR_SCALE, SIDE_PEEK,
  carouselMetrics, fullBleedCardW,
  CARD_BODY_MAX_CHARS, CARD_TITLE_MAX_CHARS_PER_LINE,
  listIndexFor, realIndexFor, wrapTarget,
} from '../../constants/carousel.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

/** Max scroll offset a horizontal list can reach, given its content. */
const maxScroll = (boxW, cardW, gap, count, sidePad) =>
  2 * sidePad + count * cardW + (count - 1) * gap - boxW;

console.log('\n── the last card must reach dead centre ──');
for (const boxW of [328, 360, 300, 411, 250]) {
  for (const count of [2, 3, 5, 8]) {
    const cardW = fullBleedCardW(boxW);
    const { snap, sidePad } = carouselMetrics(boxW, cardW);
    const reach = maxScroll(boxW, cardW, CARD_GAP, count, sidePad);
    const want  = (count - 1) * snap;
    check(`box ${boxW} × ${count} cards: max scroll ${reach} === last snap ${want}`,
      Math.abs(reach - want) < 0.01, `${reach} vs ${want}`);
  }
}

console.log('\n── a snapped card is centred ──');
{
  const boxW = 328;
  const cardW = fullBleedCardW(boxW);
  const { snap, sidePad } = carouselMetrics(boxW, cardW);
  // At offset i*snap, card i's left edge sits at sidePad on screen.
  check('left inset equals right inset', Math.abs(sidePad - (boxW - cardW - sidePad)) < 0.01,
    `${sidePad} vs ${boxW - cardW - sidePad}`);
  check('inset equals SIDE_PEEK for a full-bleed card', sidePad === SIDE_PEEK, `${sidePad}`);
  check('both neighbours are therefore visible', sidePad > CARD_GAP,
    `sidePad ${sidePad} must exceed the ${CARD_GAP}pt gap or the peek is swallowed`);
  // What's actually VISIBLE of a neighbour, once its scale is applied.
  const sliver = sidePad - CARD_GAP - (1 - NEIGHBOUR_SCALE) * cardW / 2;
  check(`the visible sliver is worth showing (${sliver.toFixed(1)}pt)`, sliver >= 8,
    `${sliver.toFixed(1)}pt — raise SIDE_PEEK or the peek reads as a rendering seam`);
}

console.log('\n── degenerate inputs ──');
check('width 0 → no negative card width', fullBleedCardW(0) === 0);
check('width 0 → no negative padding', carouselMetrics(0, 0).sidePad === 0);
check('a card WIDER than the box does not produce negative padding',
  carouselMetrics(200, 400).sidePad === 0);
check('a content-sized card still centres (GroupInsightCarousel case)',
  carouselMetrics(400, 300, 8).sidePad === 50 && carouselMetrics(400, 300, 8).snap === 308);

console.log('\n── neighbour feel stays subtle ──');
// Shrinking too far turns a peek into a stack of cards; too little and the
// active card doesn't read as selected.
check(`scale is a nudge, not a shrink (${NEIGHBOUR_SCALE})`,
  NEIGHBOUR_SCALE >= 0.9 && NEIGHBOUR_SCALE < 1);
check(`neighbours stay legible, not ghosted (${NEIGHBOUR_OPACITY})`,
  NEIGHBOUR_OPACITY >= 0.75 && NEIGHBOUR_OPACITY < 1);

console.log('\n── copy budgets are self-consistent ──');
// These exist because centring narrows the card. If someone widens the card again
// they should RAISE these, not leave them stale.
check('body budget allows two sensible lines', CARD_BODY_MAX_CHARS >= 40 && CARD_BODY_MAX_CHARS <= 80);
check('title budget allows a short phrase per line',
  CARD_TITLE_MAX_CHARS_PER_LINE >= 16 && CARD_TITLE_MAX_CHARS_PER_LINE <= 30);

// ── Endless loop indexing ───────────────────────────────────────────────────
// Clones at BOTH ends means list index ≠ card index. Every mapping below is an
// off-by-one that would only show as "the dot is wrong" or "the card changes
// colour when it wraps" on a device.
console.log('\n── loop index mapping ──');
{
  const N = 5;   // list is [clone(4), 0,1,2,3,4, clone(0)] → indices 0…6
  check('real card 0 lives at list index 1', listIndexFor(0, true) === 1);
  check('real card 4 lives at list index 5', listIndexFor(4, true) === 5);
  check('without a loop, the indices are the same', listIndexFor(3, false) === 3);

  const reals = [0, 1, 2, 3, 4, 5, 6].map((i) => realIndexFor(i, N, true));
  check('list 1…5 map to cards 0…4', JSON.stringify(reals.slice(1, 6)) === JSON.stringify([0, 1, 2, 3, 4]),
    JSON.stringify(reals));
  check('the LEADING clone reports the LAST card (so the dot is right)',
    realIndexFor(0, N, true) === N - 1, `${realIndexFor(0, N, true)}`);
  check('the TRAILING clone reports the FIRST card',
    realIndexFor(N + 1, N, true) === 0, `${realIndexFor(N + 1, N, true)}`);
  check('round-trip: card → list → card is identity',
    [0, 1, 2, 3, 4].every((i) => realIndexFor(listIndexFor(i, true), N, true) === i));
  check('no loop → identity mapping', realIndexFor(2, N, false) === 2);
  check('a 0-count list cannot divide by zero', realIndexFor(3, 0, true) === 3);

  check('settling in the middle stays put', wrapTarget(3, N, true) === null);
  check('settling on the first real card stays put', wrapTarget(1, N, true) === null);
  check('settling on the last real card stays put', wrapTarget(N, N, true) === null);
  check('settling on the TRAILING clone jumps to the first real card',
    wrapTarget(N + 1, N, true) === 1, `${wrapTarget(N + 1, N, true)}`);
  check('settling on the LEADING clone jumps to the last real card',
    wrapTarget(0, N, true) === N, `${wrapTarget(0, N, true)}`);
  check('a single card never wraps', wrapTarget(0, 1, false) === null);
  // The jump target must itself be a REAL card, never the other clone — that
  // would ping-pong between the two ends forever.
  check('a wrap target is always a real card',
    [0, N + 1].every((at) => { const t = wrapTarget(at, N, true); return t >= 1 && t <= N; }));
}

console.log('\n── the strip must span the SCREEN, not the page gutter ──');
// The active card was inset TWICE: the Dashboard's 16pt body gutter plus the 28pt
// side peek, so it began 44pt from the screen edge while every other Home card
// begins at 16pt. It read as a narrow strip floating inside the page. HomeCarousel
// takes a `bleed` prop (the host's gutter) and cancels it with a negative margin.
{
  const GUTTER = 16;   // Dashboard bodyContent paddingHorizontal (spacing.lg)
  for (const screen of [360, 390, 412]) {
    const inset = fullBleedCardW(screen - 2 * GUTTER);   // what it used to be
    const bled  = fullBleedCardW(screen);                // what it is now
    check(`screen ${screen}: bleeding the gutter widens the card by exactly 2×${GUTTER}`,
      bled - inset === 2 * GUTTER, `${inset} → ${bled}`);
    check(`screen ${screen}: the card's edge moves from ${GUTTER + SIDE_PEEK}pt to ${SIDE_PEEK}pt`,
      carouselMetrics(screen, bled).sidePad === SIDE_PEEK);
    // Still comfortably the dominant thing on screen, but not edge-to-edge —
    // a full-width card with no inset would collide with the peek entirely.
    const pct = (100 * bled) / screen;
    check(`screen ${screen}: the card takes ${pct.toFixed(0)}% of the width`, pct > 80 && pct < 92,
      `${pct.toFixed(1)}%`);
  }

  // Why the card CANNOT simply align with the 16pt gutter: at that inset the
  // neighbour sliver goes negative — the gap plus the 0.94 scale swallow it —
  // so a visible peek and the page's alignment spine are mutually exclusive.
  const sliverAt = (peek, screen = 360) => {
    const cw = screen - 2 * peek;
    return peek - CARD_GAP - (1 - NEIGHBOUR_SCALE) * cw / 2;
  };
  check(`aligning to the ${GUTTER}pt gutter would erase the peek (${sliverAt(GUTTER).toFixed(1)}pt)`,
    sliverAt(GUTTER) < 0, `${sliverAt(GUTTER).toFixed(1)}`);
  check(`SIDE_PEEK ${SIDE_PEEK} is at or above the floor for a readable peek`,
    sliverAt(SIDE_PEEK) >= 8, `${sliverAt(SIDE_PEEK).toFixed(1)}pt`);
  // Don't shrink it "to gain width" without re-checking this: 26 is the floor.
  check('one point below the floor would fail', sliverAt(24) < 8, `${sliverAt(24).toFixed(1)}`);
}

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${fail === 0 ? C.green : C.red}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail === 0 ? 0 : 1);
