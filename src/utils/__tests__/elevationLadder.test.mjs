// =============================================================================
// Elevation ladder — every shadow has to sit on a rung
// -----------------------------------------------------------------------------
//   npm run test:elevation
//
// A shadow answers exactly one question: "how far off the page is this?" The
// rungs live in `constants/theme.js` (pop / card / elevated / sheet / fab). This
// suite exists because NONE of the ways that ladder breaks will throw, crash, or
// show up in tsc — every one of them ships as a screen that just looks wrong:
//
//   1. A hand-rolled value drifts. ProfileScreen's hero shipped at black 0.4,
//      ShopScreen's list at 0.3, CheckInBanner's pill at elevation 16 (the FAB
//      is 10) — each one written in isolation, none of them ever compared.
//   2. Nobody could SEE the drift, which is why it went unchecked for so long:
//      `overflow:'hidden'` on the same view as a shadow clips it to nothing on
//      iOS and squares it on Android, so those three numbers had literally never
//      been rendered. Un-clipping them (Sep-13-26) is what finally surfaced them.
//   3. A shadow is declared with iOS props but no `elevation`, so it simply does
//      not exist on Android (GaugeProgress.centerDisc shipped this way).
//   4. A BOTTOM sheet uses a DOWNWARD offset, throwing its shadow into its own
//      body where nothing can ever see it. Every bottom sheet in the app did
//      this, which is precisely why they had all drifted to private numbers.
//
// Every scan runs on COMMENT-STRIPPED source — the comments explaining these
// fixes quote the very numbers being banned ("shipped at black 0.4"), so a
// scan over raw source would fail on its own documentation.
// =============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const ROOT = new URL('../../', import.meta.url).pathname;   // .../src/
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = `${dir}/${f}`;
  if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
  return /\.(js|ts|tsx)$/.test(f) ? [p] : [];
});
const FILES = walk(ROOT).filter((p) => !p.endsWith('constants/theme.js'));

// ─── Collect every style block that carries a shadow ─────────────────────────
// Brace-depth scan rather than a regex: style bodies contain nested objects
// (`shadowOffset: { ... }`) that a lazy `.*?` walks straight past.
const blocks = [];
for (const path of FILES) {
  const rel = path.slice(ROOT.length).replace(/^\/+/, '');
  const lines = strip(readFileSync(path, 'utf8')).split('\n');
  let key = null, depth = 0, buf = [];
  for (const L of lines) {
    if (key === null) {
      const m = L.match(/^\s{2,}([A-Za-z0-9_]+):\s*\{\s*$/);
      if (m) { key = m[1]; depth = 1; buf = []; }
      continue;
    }
    depth += (L.match(/\{/g) || []).length;
    depth -= (L.match(/\}/g) || []).length;
    if (depth > 0) { buf.push(L); continue; }
    const body = buf.join('\n');
    if (/shadowColor|shadowOpacity|\.\.\.shadows\.|elevation:/.test(body)) {
      blocks.push({
        rel, key, body,
        token:     (body.match(/\.\.\.shadows\.([a-z]+)/) || [])[1] || null,
        color:     (body.match(/shadowColor:\s*([^,\n]+)/) || [])[1]?.trim() || null,
        opacity:   parseFloat((body.match(/shadowOpacity:\s*([\d.]+)/) || [])[1]),
        elevation: parseFloat((body.match(/elevation:\s*([\d.]+)/) || [])[1]),
        offsetY:   parseFloat((body.match(/shadowOffset:\s*\{[^}]*height:\s*(-?[\d.]+)/) || [])[1]),
        clipped:   /overflow:\s*'hidden'/.test(body),
        radius:    parseFloat((body.match(/shadowRadius:\s*([\d.]+)/) || [])[1]),
        pinnedTop: /position:\s*'absolute'/.test(body) && /\btop:\s*0\b/.test(body),
        bottomSheet: /borderTopLeftRadius/.test(body) && !/borderBottomLeftRadius/.test(body),
      });
    }
    key = null;
  }
}

const read = (rel) => strip(readFileSync(`${ROOT}${rel}`, 'utf8'));
const at = (b) => `${b.rel}:${b.key}`;
const NEUTRAL = /^('#000'|'#000000'|colors\.shadow|t\.shadow|theme\.shadow)$/;
// A block that sets shadowOpacity but names NO shadowColor is having its colour
// injected at runtime — the chart markers take theirs from the datum's own hue
// (ConcentricSpendingRings.tipBadge) or from the gradient under the knob
// (GaugeProgress.pointer). Those are coloured shadows, so they get the colour
// allowance even though the hue never appears in the static style.
const isColoured = (b) => !b.color || !NEUTRAL.test(b.color);

console.log(`\n${C.bold}══════ Elevation ladder ══════${C.reset}\n`);
check('the sweep actually found the app\'s shadows', blocks.length > 60, `found ${blocks.length}`);

// ─── 1. The tokens themselves ────────────────────────────────────────────────
const theme = strip(readFileSync(`${ROOT}constants/theme.js`, 'utf8'));
const rung = (n) => {
  const m = theme.match(new RegExp(`\\b${n}:\\s*\\{([^}]*\\{[^}]*\\}[^}]*)\\}`));
  if (!m) return null;
  return {
    opacity:   parseFloat((m[1].match(/shadowOpacity:\s*([\d.]+)/) || [])[1]),
    elevation: parseFloat((m[1].match(/elevation:\s*([\d.]+)/) || [])[1]),
    offsetY:   parseFloat((m[1].match(/height:\s*(-?[\d.]+)/) || [])[1]),
    radius:    parseFloat((m[1].match(/shadowRadius:\s*([\d.]+)/) || [])[1]),
  };
};
const POP = rung('pop'), CARD = rung('card'), ELEV = rung('elevated'), SHEET = rung('sheet'),
      TOPBAR = rung('topBar'), FAB = rung('fab');
check('all six rungs are defined', [POP, CARD, ELEV, SHEET, TOPBAR, FAB].every(Boolean));
check('the rungs climb: pop ≤ card < elevated < fab (by elevation)',
  POP.elevation <= CARD.elevation && CARD.elevation < ELEV.elevation && ELEV.elevation < FAB.elevation,
  `${POP.elevation}/${CARD.elevation}/${ELEV.elevation}/${FAB.elevation}`);
check('`sheet` casts UPWARD — a bottom sheet\'s shadow points at the content it covers',
  SHEET.offsetY < 0, `offsetY ${SHEET.offsetY}`);
check('every neutral rung stays at or under 0.12 opacity — black past that reads as grime, not depth',
  [POP, CARD, ELEV, SHEET].every((r) => r.opacity <= 0.22) && CARD.opacity <= 0.12 && ELEV.opacity <= 0.12);
check('only `fab` spends a high opacity, and it pays for it with COLOUR',
  FAB.opacity > 0.2 && /fab:\s*\{[^}]*shadowColor:\s*colors\.primary/s.test(theme));

// ─── 2. No hand-rolled value outranks the ladder ─────────────────────────────
// A black shadow is capped at the top neutral rung. Colour buys headroom (it
// reads as light coming off the element, not as dirt under it) but not much.
const NEUTRAL_CAP = 0.16;   // the floating-notification pair (Toast / CheckInBanner)
const COLOUR_CAP  = 0.45;   // chart markers over saturated fills
const tooDark = blocks.filter((b) => !b.token && b.opacity > NEUTRAL_CAP && !isColoured(b));
check(`no neutral shadow above ${NEUTRAL_CAP} opacity`, tooDark.length === 0,
  tooDark.map((b) => `${at(b)}=${b.opacity}`).join(', '));
const tooBright = blocks.filter((b) => !b.token && b.opacity > COLOUR_CAP);
check(`no shadow above ${COLOUR_CAP} opacity at all`, tooBright.length === 0,
  tooBright.map((b) => `${at(b)}=${b.opacity}`).join(', '));

// Elevation ceiling. A block with no `shadowColor` and a huge elevation is
// z-stacking plumbing (RN sorts Android siblings by elevation), not a shadow.
const Z_ONLY = (b) => !b.color && !b.token;
const tooHigh = blocks.filter((b) => !b.token && !Z_ONLY(b) && b.elevation > FAB.elevation);
check(`no hand-rolled elevation above the FAB's ${FAB.elevation}`, tooHigh.length === 0,
  tooHigh.map((b) => `${at(b)}=${b.elevation}`).join(', '));

// ─── 3. A shadow must render on BOTH platforms ───────────────────────────────
// iOS draws from shadowColor/Opacity/Radius/Offset; Android draws from
// `elevation` alone. Declaring one without the other ships a shadow that is
// simply absent on half the install base, and nothing anywhere reports it.
const iosOnly = blocks.filter((b) => !b.token && b.color && b.opacity > 0 && !(b.elevation > 0));
check('no shadow declared for iOS but missing `elevation` (invisible on Android)',
  iosOnly.length === 0, iosOnly.map(at).join(', '));

// ─── 4. A shadow and its own clip may not share a view ───────────────────────
// `overflow:'hidden'` sets masksToBounds on iOS (erasing the shadow) and clips
// the elevation outline on Android. The fix is always a shell/inner split.
const CLIP_OK = new Set([
  // Documented, measured trade-offs — see each file's own comment. Both are
  // Android-elevation-only (no shadowColor), inside animation-critical views
  // where the extra nesting costs more than the corner it would buy back.
  'components/CollapsingHeaderScreen.tsx:header',
  'components/CollapsingHeaderScreen.tsx:pinnedBar',
  'components/CollapsingHeaderScreen.tsx:fixedHeader',
  'components/TransactionItem.js:groupBanner',
]);
const clipped = blocks.filter((b) => b.clipped && (b.token || b.color || b.elevation > 0) && !CLIP_OK.has(at(b)));
check('no style key carries a shadow AND `overflow:\'hidden\'` (the clip erases it)',
  clipped.length === 0, clipped.map(at).join(', '));

// ─── 4b. A bar at the TOP edge must not cast back up over itself ─────────────
// A shadow spans `offsetY ± radius`, so it spills ABOVE its own element by
// `radius - offsetY`. Every card rung spills upward deliberately — that is what
// reads as "lifted". But on a bar pinned to the top of the screen that spill has
// nowhere to go: on Activity's header it landed in the status-bar inset as a grey
// line under the clock, and on its pinned filter ribbon it drew a line along the
// ribbon's own top edge. `topBar` keeps radius <= offsetY so the spill is zero.
const spillUp = (o) => (o.radius || 0) - (o.offsetY || 0);
check('`topBar` casts straight DOWN — zero upward spill', spillUp(TOPBAR) <= 0,
  `spills ${spillUp(TOPBAR)}pt up`);
check('every other rung DOES spill upward (that is what reads as lifted)',
  spillUp(CARD) > 0 && spillUp(ELEV) > 0);

// A GENERIC scan for this is not possible and shouldn't be faked: `top: 0` is
// relative to whatever parent a view sits in, so static analysis cannot tell
// screen chrome from a badge pinned inside a chart (ConcentricSpendingRings)
// or a card at the top of a stacked deck (DailyQueueSection) — both of which a
// `position:'absolute' + top:0` heuristic flags, and for both of which an
// upward spill is perfectly correct. So the rule is enforced where it bit:
{
  const txn = read('screens/TransactionsScreen.js');
  const block = (k) => (txn.match(new RegExp(`\\n  ${k}: \\{([\\s\\S]*?)\\n  \\},`)) || [])[1] || '';

  // First child of `SafeAreaView edges={['top']}`, so anything it spills upward
  // lands in the status-bar inset. Nothing scrolls beneath it either — it is a
  // SIBLING of the list container — so it separates with a hairline and no shadow.
  const header = block('headerSection');
  check('Activity header carries no shadow at all (it sits against the status bar)',
    !/\.\.\.shadows\.|shadowColor|shadowOpacity/.test(header), header.trim().slice(0, 80));
  // Nor a bottom divider. The SURFACE CHANGE is the separator: the bar is
  // `colors.card` and the list below is `colors.background`. A hairline on top of
  // that drew a second separator for one boundary — and in the state that mattered
  // (the sticky ribbon slid in, also `colors.card`) it sat between two white
  // surfaces as a hard line across the top of the filter row.
  check('…and no bottom divider either — the white-on-grey surface change separates it',
    !/borderBottom/.test(header), header.trim().slice(0, 80));
  check('…which only holds while the two surfaces actually differ',
    /headerSection:\s*\{[^}]*backgroundColor:\s*colors\.card/s.test(txn)
    && /\bbody:\s*\{[^}]*backgroundColor:\s*colors\.background/s.test(txn));

  // The search field keeps its own edge — that is what makes it read as a control
  // rather than a gap in the bar, and with the header unshadowed it nests in nothing.
  check('the search field keeps its own edge inside the header',
    /searchBar:\s*\{[\s\S]*?\.\.\.shadows\.card,[\s\S]*?\n  \},/.test(txn));

  // This one DOES cover moving content, so it keeps a shadow — a downward one.
  const ribbon = block('stickyChipRibbon');
  check('Activity\'s pinned filter ribbon uses `topBar`, so it casts only downward',
    /\.\.\.shadows\.topBar/.test(ribbon), ribbon.trim().slice(0, 80));
}

// ─── 5. Bottom sheets cast upward ────────────────────────────────────────────
const wrongWay = blocks.filter((b) => b.bottomSheet && (b.token === 'elevated' || b.token === 'card' || (b.offsetY > 0)));
check('every bottom sheet uses the `sheet` rung, never a downward cast',
  wrongWay.length === 0, wrongWay.map((b) => `${at(b)}${b.token ? `=shadows.${b.token}` : `=y${b.offsetY}`}`).join(', '));

// ─── 6. The ladder is actually USED ──────────────────────────────────────────
const tokened = blocks.filter((b) => b.token).length;
check('most shadows come from the ladder, not from private numbers',
  tokened / blocks.length > 0.6, `${tokened}/${blocks.length} tokenised`);
check('`shadows.sheet` and `shadows.pop` have real callers (a rung nobody uses is a rung that drifts)',
  blocks.some((b) => b.token === 'sheet') && blocks.some((b) => b.token === 'pop'));

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
