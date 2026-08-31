// =============================================================================
// COLLAPSING HEADER GEOMETRY — the arithmetic, not the pixels.
// -----------------------------------------------------------------------------
//   npm run test:headerLayout
//
// Two bugs shipped when Home moved to collapsing mode, and BOTH were arithmetic
// that a source-grep lint could not see — the lints asserted the migration had
// happened, not that the numbers came out right:
//
//   1. `contentContainerStyle={[{ paddingTop: headerTotal }, callerStyle]}`
//      lets the LAST entry win, so a screen that set `paddingTop` on its content
//      container silently REPLACED the managed header offset. Home's whole body
//      rendered under the header.
//   2. Collapsing mode had no equivalent of `fixedHeader.paddingBottom`, so the
//      gradient ended flush against the last row of hero content.
//
// The component can't be rendered headlessly (react-native), so the maths is
// re-derived here from the same constants and checked against what the two modes
// must agree on.
// =============================================================================
import { readFileSync } from 'node:fs';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const ROOT = '/Users/praveenverma/Desktop/pvn/ePurse/src';

/**
 * Strip comments. EVERY source scan in this suite runs on stripped source, and
 * that is load-bearing: three separate lints here have matched the very comment
 * that explained them, and a POSITIVE check that matches prose passes while the
 * code says nothing of the kind — a silent false pass, the dangerous direction.
 * The `*Doc` variants below exist for the handful of checks that are genuinely
 * about the documentation.
 */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');

const headerDoc = read('components/CollapsingHeaderScreen.tsx');
const dashDoc = read('screens/DashboardScreen.js');
const accountsDoc = read('screens/AccountsScreen.js');
const header = code(headerDoc);
const dash = code(dashDoc);
const accounts = code(accountsDoc);
const { spacing } = await import(`${ROOT}/constants/theme.js`);

console.log('\n── the managed top offset must survive a caller style ──');
// The exact defect: a style ARRAY resolves last-wins, so `[managed, caller]`
// hands the caller a silent override of the one value it must not touch.
check('the caller style is not allowed to be the last word on paddingTop',
  !/contentContainerStyle=\{\[\{ paddingTop: headerTotal \}, contentContainerStyle\]\}/.test(header),
  'last-wins merge — the caller replaces the header offset');
check('the managed offset is ADDITIVE with the caller value',
  /paddingTop: headerTotal \+ callerPadTop/.test(header)
  && /const callerPadTop = Number\(StyleSheet\.flatten\(contentContainerStyle\)\?\.paddingTop\) \|\| 0;/.test(header),
  'the caller value should mean "extra space below the header"');

// Simulate the merge both ways over realistic numbers.
const merge = { managed: 300, caller: 24 };
check(`old behaviour put content at ${merge.caller}pt — behind a ${merge.managed}pt header`,
  merge.caller < merge.managed);
check(`additive puts it at ${merge.managed + merge.caller}pt — clear of the header`,
  merge.managed + merge.caller > merge.managed);
// A caller that sets nothing must be unaffected.
check('a caller with no paddingTop still gets exactly the header height',
  merge.managed + 0 === merge.managed);

console.log('\n── both modes must end the header the same way ──');
const fixedPadB = /fixedHeader: \{[^}]*paddingBottom: spacing\.(\w+)/.exec(header)?.[1];
const collapsingPadB = /const HEADER_PAD_B = spacing\.(\w+);/.exec(header)?.[1];
check(`fixed mode pads below the hero (spacing.${fixedPadB})`, !!fixedPadB, 'fixedHeader.paddingBottom not found');
check(`collapsing mode pads below the hero too (spacing.${collapsingPadB})`, !!collapsingPadB,
  'HEADER_PAD_B not found — the gradient would end flush under the last hero row');
check('the two modes use the SAME bottom padding',
  fixedPadB === collapsingPadB, `fixed ${fixedPadB} vs collapsing ${collapsingPadB}`);
check('it is included in the header height, not just the style',
  /headerTotal    = insets\.top \+ barHeight \+ heroH \+ HEADER_PAD_B;/.test(header),
  'padding outside headerTotal would eat the content box instead of extending the header');

console.log('\n── Home reproduces its pre-migration spacing ──');
// Fixed mode: gradient ended `fixedHeader.paddingBottom` (16) below the stats row;
// `body` was tucked up by 16; `bodyContent` then padded 40. Net: the first card
// sat 24pt below the gradient's bottom edge. Collapsing mode has no tuck, so the
// caller padding IS that gap and must equal 24.
const OLD_HEADER_PAD = spacing.lg;   // 16
const OLD_BODY_TUCK  = spacing.lg;   // 16, styles.body marginTop: -spacing.lg
const OLD_CONTENT_PAD = spacing.xl + spacing.lg; // 40
const oldGap = OLD_CONTENT_PAD - OLD_BODY_TUCK;
check(`the old gap below the gradient was ${oldGap}pt`, oldGap === 24, String(oldGap));
const nowPad = /bodyContent: \{[^}]*paddingTop: spacing\.(\w+)/.exec(dash)?.[1];
check(`Home now asks for spacing.${nowPad} below the header`, !!nowPad);
check(`…which is the same ${oldGap}pt`, spacing[nowPad] === oldGap, `${spacing[nowPad]} vs ${oldGap}`);
check('and the header pad it sits below is unchanged from fixed mode',
  spacing[collapsingPadB] === OLD_HEADER_PAD, `${spacing[collapsingPadB]}`);
check('the dead body tuck is gone (it would double-count now)',
  !/body: \{ flex: 1, marginTop: -spacing\.lg \}/.test(dash),
  'styles.body pulled content up under the old fixed header');

console.log('\n── the body must not slide UNDER the header while it collapses ──');
// `parallax` is how fast the header moves relative to the scroll. Below 1 the
// header lags the finger, the body catches it, and content disappears behind the
// curve — deliberate on Accounts, wrong on Home where the first thing under the
// header is a card the user is trying to read.
{
  const insetsTop = 44, barH = 54, heroH = 200, padB = spacing.lg, callerPad = spacing.xl;
  const headerTotal = insetsTop + barH + heroH + padB;
  // Mirrors the component: FULL = heroH / P, header translates 0 → -heroH, clamped.
  const gapAt = (parallax, y) => {
    const P = Math.min(1, Math.max(0.1, parallax));
    const FULL = Math.max(1, heroH / P);
    const headerBottom = headerTotal - Math.min(heroH, (y / FULL) * heroH);
    return (headerTotal + callerPad - y) - headerBottom;
  };
  const duringCollapse = [0, 25, 50, 100, 150, 199];

  check('at the 0.6 default the body DOES slide under the header',
    duringCollapse.some((y) => gapAt(0.6, y) < 0),
    'if this stops being true the parallax model has changed');
  check('at parallax 1 the gap never closes during the collapse',
    duringCollapse.every((y) => gapAt(1, y) >= callerPad - 0.01),
    duringCollapse.map((y) => `${y}:${gapAt(1, y).toFixed(0)}`).join(' '));
  check('…and it is exactly the requested gap, not merely positive',
    duringCollapse.every((y) => Math.abs(gapAt(1, y) - callerPad) < 0.01),
    `expected a constant ${callerPad}pt`);
  // After the header is fully collapsed the body passes under the PINNED BAR.
  // That is what a sticky bar is for — not a regression.
  check('after full collapse the body does pass under the pinned bar',
    gapAt(1, heroH + 100) < 0, `${gapAt(1, heroH + 100).toFixed(0)}`);

  // This is the COMPONENT's default now, not a Home opt-in: the argument for it
  // — don't hide content the user is reading — is not screen-specific, and every
  // collapsing header should behave the same way.
  check('parallax 1 is the component default, so every collapsing header gets it',
    /parallax = 1,/.test(header), 'the old 0.6 default tucked content under the curve');
  check('…and no screen quietly opts back out',
    !/parallax=\{0?\.?\d*\}/.test(dash) && !/parallax=/.test(accounts),
    'an override here would reintroduce the inconsistency this replaced');
}

// Only the pinned BAR is subject to the light-surface rules — the hero is
// white-on-gradient by design and has faded out before any of it starts.
const barOfScreen = (src) => {
  const at = src.indexOf('renderBar=');
  const end = src.indexOf('renderHero=', at);
  return at < 0 ? '' : src.slice(at, end > at ? end : src.length);
};

console.log('\n── the pinned bar is a SECOND bar, cross-faded on opacity ──');
// The obvious implementation of "the header goes light" is to interpolate every
// colour in the bar. It does not survive React Native: `color` is not
// native-animatable, `scrollY` is (it drives the transforms), and RN moves a
// whole props node to the native driver and then THROWS on any JS-driven value
// sharing it. Two bars cross-fading on opacity need none of that.
{
  const heroFadeEnd  = Number(/const HERO_FADE_END = ([\d.]+);/.exec(header)?.[1]);
  const lightenStart = /const LIGHTEN_START = (\w+);/.exec(header)?.[1];
  check(`the hero has finished fading at ${heroFadeEnd} of the collapse`,
    heroFadeEnd > 0 && heroFadeEnd < 1, String(heroFadeEnd));
  check('the light bar starts coming in exactly where the hero ends',
    lightenStart === 'HERO_FADE_END',
    'white hero text over a whitening background for the length of any overlap');
  check('the hero fade uses that constant, not a second literal',
    /inputRange: \[0, FULL \* HERO_FADE_END\]/.test(header));

  // ── The rule the whole design exists to satisfy ───────────────────────────
  // Every animated value in this component must be one the NATIVE driver can
  // own: transform and opacity. Nothing else. If a colour or a radius ever
  // reappears here, the component is one props node away from a runtime throw.
  const src = header;
  // Find the values actually derived from scrollY (the native-driven one), then
  // every style prop each is applied to. Matching on NAMES would flag
  // `borderBottomLeftRadius: curveRadius`, which is a plain number.
  const NATIVE_OK = new Set(['opacity', 'translateX', 'translateY', 'scale', 'scaleX', 'scaleY', 'rotate']);
  const derived = [...src.matchAll(/const (\w+)\s*=\s*scrollY\.interpolate/g)].map((m) => m[1]);
  check(`${derived.length} animated values, all from the native-driven scrollY`,
    derived.length >= 5, derived.join(', '));
  const offenders = [];
  for (const name of derived) {
    for (const m of src.matchAll(new RegExp(`(\\w+):\\s*${name}\\b`, 'g'))) {
      if (!NATIVE_OK.has(m[1])) offenders.push(`${m[1]}: ${name}`);
    }
  }
  check('every one of them lands only on a native-animatable prop',
    offenders.length === 0,
    `${offenders.join(', ')} — RN takes the props node native, then throws`);
  // And nothing may be driven by a SECOND, JS-only Animated.Value in a style.
  check('there is no second animated value driving a style',
    (src.match(/new Animated\.Value\(/g) || []).length === 2,
    'scrollY + the frozen zeroProgress for fixed mode; a third means a JS driver is back');
  check('no animated colour anywhere in the component',
    !/outputRange: \[['"#]/.test(header),
    'a colour outputRange means a JS-driven style, and the mixing hazard is back');
  check('no animated component wrappers needed either',
    !/createAnimatedComponent/.test(header),
    'the two-bar model should not need an animated icon or touchable');

  // Model both fades.
  const FULL = 200;
  const heroAt      = (y) => Math.max(0, 1 - Math.min(1, y / (FULL * heroFadeEnd)));
  const collapsedAt = (y) => Math.min(1, Math.max(0, (y - FULL * heroFadeEnd) / (FULL - FULL * heroFadeEnd)));
  check('at rest the pinned bar is fully transparent and the hero fully visible',
    collapsedAt(0) === 0 && heroAt(0) === 1);
  check('the hero is gone before the pinned bar starts appearing',
    [0, 40, 80, 109, 110, 150, 200].every((y) => heroAt(y) === 0 || collapsedAt(y) === 0));
  check('fully collapsed, the pinned bar is opaque', collapsedAt(FULL) === 1);
  check('it is a cross-fade, not a snap',
    collapsedAt(FULL * 0.78) > 0.4 && collapsedAt(FULL * 0.78) < 0.6);
  check('over-scrolling past the collapse stays pinned (clamped)', collapsedAt(FULL * 4) === 1);
  check('the two bars fade in OPPOSITE directions (no double image)',
    /const collapsedOpacity = scrollY\.interpolate\(\{ \.\.\.lightenRange, outputRange: \[0, 1\] \}\)/.test(header)
    && /const expandedOpacity[\s\S]{0,120}outputRange: \[1, 0\]/.test(header),
    'both fading the same way would show the gradient bar through the light one');

  // ── Both bars are mounted, so the invisible one must be INERT ─────────────
  // A tap landing in a gap of the pinned bar's layout would otherwise hit a
  // control the user cannot see, and a screen reader would read both rows.
  check('the expanded bar is made inert once the LIGHT bar is up',
    /pointerEvents=\{lightBarActive \? 'none' : 'box-none'\}/.test(header)
    && /accessibilityElementsHidden=\{lightBarActive\}/.test(header));
  check('and the light bar is inert until it is up',
    /pointerEvents=\{lightBarActive \? 'box-none' : 'none'\}/.test(header)
    && /accessibilityElementsHidden=\{!lightBarActive\}/.test(header));
  // Gating on the bare latch would be wrong: gradient-only mode latches it too
  // (for the corner), and there the expanded bar must stay live.
  check('…gated on the LIGHT bar, not on the bare latch',
    /const lightBarActive = lightens && pinned;/.test(header),
    'gradient-only mode latches `pinned` for the corner but has no bar to gate for');
  check('the gate is a latched boolean, flipped once per crossing',
    /const \[pinned, setPinned\] = useState\(false\);/.test(header)
    && /if \(isPinned !== pinned\)/.test(header),
    'an interpolation cannot gate pointerEvents, and a per-frame setState would re-render while scrolling');
  check('the threshold is halfway through the fade, derived not hardcoded',
    /FULL \* \(LIGHTEN_START \+ \(1 - LIGHTEN_START\) \/ 2\)/.test(header));

  // ── Layout traps ─────────────────────────────────────────────────────────
  // Structural, not positional: walk back from `styles.pinnedBar` to the JSX tag
  // that opens it and check its INDENT. A root child sits at 6 spaces; anything
  // nested inside the header is deeper — and would translate away with it.
  {
    const lines = header.split('\n');
    const at = lines.findIndex((l) => l.includes('styles.pinnedBar'));
    let open = at;
    while (open >= 0 && !/^\s*<Animated\.View/.test(lines[open])) open--;
    const indent = open >= 0 ? lines[open].match(/^\s*/)[0].length : -1;
    const headerOpen = lines.findIndex((l) => /^\s*styles\.header,$/.test(l));
    let hOpen = headerOpen;
    while (hOpen >= 0 && !/^\s*<Animated\.View/.test(lines[hOpen])) hOpen--;
    const headerIndent = hOpen >= 0 ? lines[hOpen].match(/^\s*/)[0].length : -1;
    check(`the pinned bar opens at the header's own depth (${indent} vs ${headerIndent})`,
      indent > 0 && indent === headerIndent,
      'nested inside the header it would translate away instead of staying pinned');
  }
  check('its gutter is on an inner view, not on the bar itself',
    /styles\.pinnedEdge/.test(header)
    && !/styles\.pinnedBar,[\s\S]{0,300}paddingHorizontal: gutter/.test(header),
    'Yoga positions an absolute child against the PADDING box, so the hairline would be inset');
  check('it sits above the header on both platforms',
    /zIndex: 11,[\s\S]{0,80}elevation: 7,/.test(header),
    'Android orders by elevation, iOS by zIndex — it needs both');
  // ── The pinned bar must MEASURE the same as what it replaces ──────────────
  // The bar it fades in over is the collapsed gradient header, which is
  // `headerTotal` tall translated up by `heroH`. Getting this wrong ends the
  // white bar short of that edge and leaves its row flush against the bottom —
  // reported on device as "bottom padding is missing in the white header part".
  // This is the THIRD time a header bug here was pure arithmetic a source-grep
  // lint could not see, so derive it.
  {
    const insetsTop = 44, barH = 54, heroH = 196, padB = spacing.lg;
    const headerTotal   = insetsTop + barH + heroH + padB;
    const collapsedEdge = headerTotal - heroH;          // where the gradient ends
    const pinnedTotal   = insetsTop + barH + padB;      // what the component computes
    check(`the pinned bar is ${pinnedTotal}pt — exactly the collapsed header's edge`,
      pinnedTotal === collapsedEdge, `${pinnedTotal} vs ${collapsedEdge}`);
    check(`the naive height would have been ${padB}pt short`,
      collapsedEdge - (insetsTop + barH) === padB);
    check('the component derives it from collapsedTotal + the shared bottom pad',
      /const pinnedTotal = collapsedTotal \+ HEADER_PAD_B;/.test(header)
      && /height: pinnedTotal,/.test(header),
      'a second literal here is how it drifts from the gradient edge');
    // The extra height must be paid as PADDING, not absorbed by centring, or the
    // row sits lower than the gradient bar's and the text jumps mid-cross-fade.
    check('the extra height is padding, so the row stays at the same y in both bars',
      /paddingBottom: HEADER_PAD_B,/.test(header),
      'centring in the taller box would shift the row down by half the pad');
    const rowCentre = (boxH, padTop, padBottom) => padTop + (boxH - padTop - padBottom) / 2;
    check('…and both rows really do centre at the same y',
      rowCentre(insetsTop + barH, insetsTop, 0) === rowCentre(pinnedTotal, insetsTop, padB),
      `${rowCentre(insetsTop + barH, insetsTop, 0)} vs ${rowCentre(pinnedTotal, insetsTop, padB)}`);
    // And the body's gap below the header is unchanged by any of this.
    const callerPad = spacing.xl;
    check(`the body still sits ${callerPad}pt below the pinned bar`,
      (headerTotal + callerPad - heroH) - pinnedTotal === callerPad);
  }

  // ── `barHeight` is the bar's CONTENT, never its content plus padding ───────
  // Accounts used 68 "so the collapsed header keeps comfortable padding below the
  // heading" — its own words. Once HEADER_PAD_B started padding BOTH modes, that
  // 28pt of slack was paid a second time and its collapsed bar sat 28pt deeper
  // than Home's. Reported as "bottom padding in accounts tab header is more than
  // usual when collapsed".
  {
    const num = (src, name) => Number(new RegExp(`const ${name}\\s*=\\s*(\\d+)`).exec(src)?.[1]);
    const padB = spacing[collapsingPadB];
    // Each screen's bar content, derived from what actually sits in the row.
    const CHIP = Number(/export const CHIP_SIZE = (\d+);/.exec(read('components/HeaderChip.tsx'))?.[1]);
    const dashRowTop = Number(/headerRow: \{[\s\S]*?marginTop: spacing\.(\w+),/.exec(dash)?.[1]
      ? spacing[/headerRow: \{[\s\S]*?marginTop: spacing\.(\w+),/.exec(dash)[1]] : NaN);
    const screens = [
      { name: 'Home',     bar: num(dash, 'HEADER_BAR_H'),     content: dashRowTop + CHIP },
      // Accounts' tallest row item is its 40pt icon button.
      { name: 'Accounts', bar: num(accounts, 'HEADER_BAR_H'), content: 40 },
    ];
    for (const sc of screens) {
      check(`${sc.name}: barHeight ${sc.bar} is exactly its bar content (${sc.content})`,
        sc.bar === sc.content,
        'slack here becomes padding the component then pays again');
      check(`${sc.name}: the collapsed bar therefore pads ${padB}pt below its row`,
        (sc.bar - sc.content) + padB === padB);
    }
    check('the two collapsing headers pad their collapsed bar IDENTICALLY',
      (screens[0].bar - screens[0].content) === (screens[1].bar - screens[1].content),
      'one screen looking deeper than the other is the whole bug');

    // ── The bar → hero gap ────────────────────────────────────────────────
    // It measured 43pt on Accounts against Home's 16, from TWO stacked sources,
    // and only one of them was visible in any constant:
    //   • 28pt of slack inside the old HEADER_BAR_H (fixed above), and
    //   • 15pt of centring slack, because a PINNED 84pt hero box held ~54pt of
    //     text and the component centres the hero in its box.
    // A self-measuring hero removes the second: with no fixed height there is no
    // slack to centre in, so the gap is exactly the hero's own paddingTop.
    // Measure it the way the eye does: from the bottom of the BAR'S CONTENT to the
    // top of the hero's. Both boxes centre their content, so `barHeight` is not
    // where the bar visibly ends and `heroTop` is not where the hero visibly
    // starts — and measuring from the box edges is what let the previous change
    // look neutral when it was not.
    const BAR_CONTENT = 40;                             // the 40pt icon buttons
    const CHILD = 54;                                   // label + figure, roughly
    // `content` is the bar row's own height, which is NOT `bar` unless the screen
    // sized it correctly — that difference is the slack the eye reads as gap.
    const barBottom = ({ bar, content }) => content + (bar - content) / 2;
    const heroTop = ({ bar, box, child, pad }) => bar + (box == null ? 0 : (box - child) / 2) + pad;
    const gapOf = (g) => heroTop(g) - barBottom(g);

    const before        = { bar: 68, content: BAR_CONTENT, box: 84,      child: CHILD,      pad: 0 };
    const pinnedWithPad = { bar: 40, content: BAR_CONTENT, box: 84 + 28, child: CHILD + 28, pad: 28 };
    const now           = { bar: 40, content: BAR_CONTENT, box: null,    child: CHILD + spacing.lg, pad: spacing.lg };

    check(`the gap started at ${gapOf(before)}pt`, gapOf(before) === 29);
    // The correction: holding the hero CONTENT still while moving the bar content
    // up by 14 (its own centring slack, removed with the slack in barHeight) made
    // the visible gap WORSE, from 29 to 43. "Total unchanged" and "hero content
    // unchanged" were both true and both the wrong invariant.
    check(`the previous fix pushed it to ${gapOf(pinnedWithPad)}pt, not neutral`,
      gapOf(pinnedWithPad) === 43 && gapOf(pinnedWithPad) > gapOf(before),
      'the bar content moved up 14 while the hero content was held still');
    check(`it is now ${gapOf(now)}pt — the hero's padding and nothing else`,
      gapOf(now) === spacing.lg);
    check('a self-measuring hero has NO box slack to add to it',
      now.box === null && heroTop(now) === now.bar + now.pad);
    // Home, which is the comparison being made: its bar content fills barHeight
    // (54 = 12pt row margin + the 42pt chip), its hero measures itself, so the gap
    // is its own marginTop and nothing else. The two screens now agree.
    const home = { bar: 54, content: 54, box: null, child: CHILD + spacing.lg, pad: spacing.lg };
    check(`Home's gap is ${gapOf(home)}pt`, gapOf(home) === spacing.lg);
    check('…and Accounts now matches it exactly', gapOf(now) === gapOf(home),
      `${gapOf(now)} vs ${gapOf(home)}`);
    check('…which it did not before, by 13pt', gapOf(before) - gapOf(home) === 13);

    // Home's hero starts with `balanceBlock: { marginTop: spacing.lg }`, so the
    // two screens now open the same distance below their title rows.
    const homeGap = /balanceBlock: \{ marginTop: spacing\.(\w+) \}/.exec(dash)?.[1];
    const acctGap = /heroBlock: {5}\{ paddingTop: spacing\.(\w+) \}/.exec(accounts)?.[1];
    check(`both screens gap their hero by spacing.${homeGap}`,
      !!homeGap && homeGap === acctGap, `Home ${homeGap} vs Accounts ${acctGap}`);

    // The rule this all comes from: never pin a height around TEXT. It varies
    // with the font and the OS font-scale setting, so no constant is right
    // everywhere — and a too-large one shows up as exactly this gap.
    check('NEITHER collapsing screen pins a heroHeight any more',
      !/heroHeight=\{/.test(dash) && !/heroHeight=\{/.test(accounts),
      'a pinned box around text either clips it or pads it, and no test can catch which');
    check('…and both pass a first-frame estimate instead',
      /estimatedHeroHeight=\{/.test(dash) && /estimatedHeroHeight=\{/.test(accounts),
      'without one the body starts too high for a frame before the measurement lands');
    check('Accounts keeps its gap as PADDING, not a margin',
      /paddingTop: spacing\.lg/.test(accounts),
      'a margin inside a centred box is centred with it instead of offsetting content');
  }

  check('it takes elevation for z-order but not for a shadow',
    /elevation: 7,\s*\n(?:\s*\/\/.*\n)*\s*shadowColor: 'transparent',/.test(header),
    "elevation draws a shadow on Android, and this view's bounds end mid-gradient");
  check('it carries a hairline as well as the shadow',
    /backgroundColor: pinnedChrome\.hairline/.test(header),
    'card content scrolls under a card-coloured strip; the shadow alone is not a boundary');
}

console.log('\n── the corner radius: static values, no animated sweep ──');
// This was an animated 24→0 sweep and it was the LAST JS-driven style here.
// The cross-fade replaces it: a curved gradient fades out while a square light
// bar fades in, so the corner straightens with no radius ever changing. With the
// cross-fade switched OFF there is nothing to hide behind, so the header snaps
// its own corner at the end of the travel instead.
{
  const { radius } = await import(`${ROOT}/constants/theme.js`);
  check('curved at rest is still the default', /curveRadius = radius\.xl,/.test(header));
  check('square when pinned is still the default', /collapsedCurveRadius = 0,/.test(header));
  check('a FIXED header keeps its curve unconditionally',
    /borderBottomLeftRadius: curveRadius,\s*\n\s*borderBottomRightRadius: curveRadius,/.test(header),
    'nothing collapses there, so there is no pinned state to square for');
  check('the pinned bar takes the collapsed value, statically',
    /borderBottomLeftRadius: collapsedCurveRadius,/.test(header));
  // ── …but the corner still has to reach 0 in BOTH modes ────────────────────
  // With the light bar, the square bar cross-fading over the curved header does
  // it — a true sweep. Without it there is nothing covering the corner, so the
  // header squares its OWN at full collapse. Reported: "in case of gradient only,
  // then also on complete scroll the radius should become 0".
  check('the header squares its own corner when there is no light bar',
    /const headerRadius = !lightens && pinned \? collapsedCurveRadius : curveRadius;/.test(header)
    && /borderBottomLeftRadius: headerRadius,/.test(header),
    'gradient-only mode would otherwise stay curved while pinned');
  check('…and does NOT in light mode, where the cross-fade already sweeps it',
    /!lightens && pinned/.test(header),
    'a snap there would pop a corner through a half-transparent bar');
  // Model the radius the component ends up with, in both modes, across the scroll.
  {
    const FULL = 200, CURVE = 24, COLLAPSED = 0;
    const midFade = FULL * (0.55 + (1 - 0.55) / 2);
    const radiusAt = (lightens, y) => {
      const pinnedAt = lightens ? midFade : FULL;
      const pinned = y >= pinnedAt;
      return !lightens && pinned ? COLLAPSED : CURVE;
    };
    check('gradient-only: curved for the whole collapse, square at the end',
      [0, 50, 100, 150, 199].every((y) => radiusAt(false, y) === CURVE)
      && radiusAt(false, FULL) === COLLAPSED && radiusAt(false, FULL * 3) === COLLAPSED);
    check('light mode: the header keeps its curve throughout (the bar squares it)',
      [0, 100, 155, 199, FULL, FULL * 3].every((y) => radiusAt(true, y) === CURVE));
    check(`the two modes latch at different points (${midFade} vs ${FULL})`,
      midFade !== FULL && /const PINNED_AT = lightens\s*\n\s*\? FULL \* \(LIGHTEN_START/.test(header),
      'the fade midpoint is meaningless with no fade; the end of travel is');
  }

  check('the animated-radius machinery is gone',
    !/animatedRadius|radiusDriver|outerRadius|curveChanges/.test(header),
    'it was four rules deep and RN throws rather than type-errors when one breaks');
  check('nothing is left for a JS driver to feed',
    !/\.setValue\(/.test(header),
    'the scroll listener should only latch the pinned flag now');
  check('the sweep it replaces really was 24 → 0', radius.xl === 24);
  check('no screen hand-rolls either radius',
    !/collapsedCurveRadius=|curveRadius=\{(?!radius\.xl)/.test(dash) && !/collapsedCurveRadius=/.test(accounts));
}

console.log('\n── one composition per screen, inked twice ──');
// The pinned bar must not silently DROP an affordance: while it is up the bar
// behind it is inert, so anything missing there has no route at all.
{
  for (const [name, src] of [['Dashboard', dash], ['Accounts', accounts]]) {
    const row = /renderCollapsedBar=\{\(\) => (\w+)\(true\)\}\s*\n\s*renderBar=\{\(\) => \1\(false\)\}/.exec(src);
    check(`${name} feeds BOTH bars from one function`,
      !!row, 'two JSX branches are how the pinned bar goes stale');
    const bar = barOfScreen(src);
    check(`${name}: its bar hardcodes no white`,
      bar.length > 0 && !/#[Ff]{3}\b|#[Ff]{6}/.test(bar),
      'a white chosen for the gradient is invisible on the pinned bar');
    check(`${name}: it inks from the derived pinned chrome`,
      /pinnedHeaderChrome\(/.test(src) && /onLight \?/.test(src));
    check(`${name} flips its status bar with the header`,
      /useHeaderStatusBar\(/.test(src) && /onCollapseChange=\{/.test(src));
    check(`${name} no longer mounts a declarative <StatusBar>`,
      !/<StatusBar\b/.test(src),
      'a tab screen stays mounted, so its StatusBar style leaks to the next tab');
  }
  const statusBar = readFileSync(`${ROOT}/hooks/useHeaderStatusBar.js`, 'utf8');
  check('the glyph colour is MEASURED against the surface, not assumed dark',
    /contrastRatio\('#FFFFFF', pinned\) >= contrastRatio\('#000000', pinned\)/.test(statusBar),
    'a pinned header on the dark-mode card must keep LIGHT glyphs');
  check('…and it is focus-gated, like the pattern Accounts pioneered',
    /useIsFocused\(\)/.test(statusBar) && /if \(!isFocused\) return;/.test(statusBar));
  check('the chip variant is ONE named axis, not four colour props',
    /onLight\?: boolean;/.test(readFileSync(`${ROOT}/components/HeaderChip.tsx`, 'utf8')),
    'every caller re-deriving the same three replacements is the drift this avoids');
  check('no screen opts out of the light pinned bar',
    !/collapsedSurface=/.test(dash) && !/collapsedSurface=/.test(accounts));
}

console.log('\n── a release never rests in a half-collapsed header ──');
// Mid-collapse the hero is mid-fade: some of its text legible, some not. It is a
// state the design only ever passes THROUGH. Reported as "if user have scroll 40%
// the complete header should get open, else it looks very odd — some text visible
// some not and cluttered".
{
  const snapAt = Number(/const SNAP_AT = ([\d.]+);/.exec(header)?.[1]);
  check(`the threshold is ${snapAt}, below the hero's fade-out`,
    snapAt > 0 && snapAt < 1, String(snapAt));
  const heroFadeEnd = Number(/const HERO_FADE_END = ([\d.]+);/.exec(header)?.[1]);
  check('…and below HERO_FADE_END, so reopening never fades a text block back IN',
    snapAt < heroFadeEnd, `${snapAt} vs ${heroFadeEnd}`);

  // Mirror the component's resolution.
  const FULL = 200;
  const resolve = (y) => {
    if (y <= 0 || y >= FULL) return null;         // nothing partial to resolve
    return y / FULL < snapAt ? 0 : FULL;
  };
  check('a release just past the top reopens', resolve(1) === 0);
  check(`a release at ${snapAt * 100 - 1}% reopens`, resolve(FULL * (snapAt - 0.01)) === 0);
  check(`a release at exactly ${snapAt * 100}% completes the collapse`, resolve(FULL * snapAt) === FULL);
  check('a release just short of pinned completes it', resolve(FULL - 1) === FULL);
  check('every partial offset resolves to one end or the other',
    Array.from({ length: 199 }, (_, i) => resolve(i + 1)).every((r) => r === 0 || r === FULL));

  // "same for scroll up and down both case" — ONE threshold, no hysteresis, so
  // the same offset resolves the same way regardless of how it was reached.
  // "same for scroll up and down both case" — no hysteresis. The way to prove it
  // is that the target cannot depend on direction: `snapHeader` takes ONLY the
  // offset, and nothing in the snap path remembers a previous one. (Comparing
  // resolve(y) with itself would pass no matter what — it was written that way
  // first.) A hysteresis reference shows what it would have cost:
  const withHysteresis = (y, down) => {
    const t = down ? snapAt : 1 - snapAt;        // the usual two-threshold shape
    return y <= 0 || y >= FULL ? null : (y / FULL < t ? 0 : FULL);
  };
  const ambiguous = [10, 60, 79, 80, 120, 190]
    .filter((y) => withHysteresis(y, true) !== withHysteresis(y, false));
  check(`hysteresis would make ${ambiguous.length} of 6 offsets direction-dependent`,
    ambiguous.length > 0, 'if this is 0 the reference is not modelling anything');
  check('the snap takes ONLY an offset, so those offsets cannot be ambiguous',
    /const snapHeader = \(y: number\) => \{/.test(header),
    'a direction or velocity argument is how a second threshold creeps in');
  // Comment-stripped source matters here: un-stripped, this matched the word
  // "direction" in the component's own explanation of being direction-blind.
  check('…and nothing in the snap path remembers a previous offset',
    !/lastY|prevY|direction|scrollDir/.test(header)
    && !/SNAP_AT_UP|SNAP_AT_DOWN/.test(header),
    'one threshold, consulted the same way whichever way the finger moved');

  // Outside the collapse it must not fire at all.
  check('at rest (y = 0) nothing snaps', resolve(0) === null);
  check('past full collapse nothing snaps', resolve(FULL) === null && resolve(FULL * 4) === null);
  check('a pull-to-refresh (negative y) is never yanked',
    resolve(-40) === null && /if \(y <= 0 \|\| y >= FULL\) return;/.test(header),
    'snapping there would fight the RefreshControl');

  // ── The gesture plumbing ─────────────────────────────────────────────────
  // `scrollTo` CANCELS a fling, so snapping at drag-end would kill flick-scrolling
  // any time a finger lifted inside the header's range.
  check('a release WITH velocity waits for momentum to end',
    /const v = e\.nativeEvent\.velocity\?\.y \?\? 0;/.test(header)
    && /if \(Math\.abs\(v\) < 1e-6\) snapHeader/.test(header),
    'scrollTo cancels a fling — snapping at drag-end would kill flick-scrolling');
  check('…and only zero-vs-non-zero is compared',
    !/Math\.abs\(v\) [<>] 0\.\d/.test(header),
    'iOS reports points/ms and Android pixels/s, so a real threshold is two gestures');
  check('both end-of-gesture events are wired',
    /onScrollEndDrag=\{onScrollEndDrag\}/.test(header) && /onMomentumScrollEnd=\{onMomentumEnd\}/.test(header));

  // The component needs its own handle on the scroll view, without breaking a
  // caller that passes one.
  check('the scroll ref is merged, not replaced',
    /ref=\{setScrollRef\}/.test(header)
    && /innerScrollRef\.current = node;/.test(header)
    && /if \(typeof scrollRef === 'function'\) scrollRef\(node\);/.test(header),
    "a caller's scrollRef must still be populated");
  // The hook that owns that ref sits ABOVE the fixed-mode early return, so the
  // hook count cannot depend on `collapsible`.
  const fixedReturn = header.indexOf('if (!collapsible) {');
  check('its hooks are declared above the fixed-mode early return',
    header.indexOf('const innerScrollRef = useRef') < fixedReturn
    && header.indexOf('const setScrollRef = useCallback') < fixedReturn,
    'a hook after a conditional return makes the count depend on the mode');

  check('the behaviour has its own switch',
    /if \(!STATIC_CONFIG\.header\.snapOnRelease\) return;/.test(header));
}

console.log('\n── the whole behaviour is behind ONE config switch ──');
// `STATIC_CONFIG.header.lightenOnCollapse = false` must leave the gradient look
// EXACTLY as it was, with nothing for a caller to undo. Three separate things
// have to be gated, and missing any one leaves a half-state: a light bar over an
// un-faded gradient bar, or an invisible bar still eating taps, or a status bar
// that has flipped to dark glyphs on a gradient.
{
  const { STATIC_CONFIG } = await import(`${ROOT}/config/staticConfig.ts`);
  const cfgDoc = read('config/staticConfig.ts');
  const cfg = code(cfgDoc);

  // Shape: <screen | module | feature> → { switch: value }. A primitive at the
  // top level would break the convention on its first day.
  const groups = Object.entries(STATIC_CONFIG);
  check(`the config groups switches by module (${groups.map(([k]) => k).join(', ')})`,
    groups.length > 0 && groups.every(([, v]) => v && typeof v === 'object' && !Array.isArray(v)),
    'every top-level entry must be an object of switches');
  check('…and every switch is a discrete value, not a tuning number',
    groups.every(([, v]) => Object.values(v).every((x) => typeof x === 'boolean' || typeof x === 'string')),
    'numbers that several files must agree on belong in constants/, not here');
  // Deliberately NOT pinning the value: a switch whose current setting is
  // asserted is a switch you cannot flip without a red suite, which is the
  // opposite of the point. Only that it exists and is a boolean.
  for (const k of ['lightenOnCollapse', 'snapOnRelease']) {
    check(`header.${k} exists and is a boolean`,
      typeof STATIC_CONFIG.header[k] === 'boolean', `got ${typeof STATIC_CONFIG.header[k]}`);
  }

  const src = header;
  check('the component reads the switch, it is not a prop or a literal',
    /const lightens = STATIC_CONFIG\.header\.lightenOnCollapse;/.test(src)
    && !/lightenOnCollapse\?:/.test(src),
    'a per-screen prop would let two collapsing headers disagree again');

  // Gate 1 — the light bar is not rendered at all.
  check('OFF: the light bar is not rendered',
    /\{lightens \? \(\s*\n\s*<Animated\.View/.test(src),
    'a mounted-but-invisible bar is one pointerEvents mistake from eating taps');
  // Gate 2 — the gradient bar does not fade.
  check('OFF: the gradient bar keeps opacity 1',
    /= lightens\s*\n\s*\? scrollY\.interpolate\(\{ \.\.\.lightenRange, outputRange: \[1, 0\] \}\)\s*\n\s*: 1;/.test(src),
    'otherwise the header fades to nothing with no light bar behind it');
  // Gate 3 — the status bar is never told the surface went light.
  check('OFF: the status bar is never told the surface went light',
    /onCollapseChange\?\.\(lightens && isPinned\);/.test(src),
    'dark glyphs on a gradient header are unreadable');
  check('OFF: …but the latch itself still runs, for the corner',
    /const isPinned = y >= PINNED_AT;/.test(src),
    'gradient-only mode needs it to square the corner at full collapse');

  // A literal 1 rather than an interpolation that merely clamps to 1: the point
  // is that there is nothing to change by accident later.
  check('…and that 1 is a literal, not an interpolation that happens to stay at 1',
    !/outputRange: \[1, 1\]/.test(src));

  // Callers must not have to know. Flipping the switch is the whole change.
  for (const [name, s2] of [['Dashboard', dash], ['Accounts', accounts]]) {
    check(`${name} needs no change when the switch flips`,
      !/lightenOnCollapse|STATIC_CONFIG\.header/.test(s2),
      'it keeps passing renderCollapsedBar and onCollapseChange either way');
  }

  // The switches that already existed as lone `const USE_X = false` in a screen
  // moved here, or the config is stale on day one and there are two conventions.
  check('Dashboard\'s build-time looks come from the config too',
    /const USE_ORIGINAL_HEADER = STATIC_CONFIG\.dashboard\.useOriginalHeader;/.test(dash)
    && /const PERIOD_SELECTOR {5}= STATIC_CONFIG\.dashboard\.periodSelector;/.test(dash),
    'a lone const buried in a screen is what the config replaces');
  check('no build-time switch is left declared in a screen',
    !/^const (USE_|SHOW_|ENABLE_)\w+ = (true|false);$/m.test(dash + accounts),
    'move it into config/staticConfig.ts');
  check('the config documents what does NOT belong in it',
    /buildVariant/.test(cfgDoc) && /Settings row/.test(cfgDoc),
    'env variants and user settings are the two things that get miscategorised here');
}

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${fail === 0 ? C.green : C.red}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail === 0 ? 0 : 1);
