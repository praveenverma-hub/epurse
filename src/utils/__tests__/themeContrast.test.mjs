// =============================================================================
// Theme contrast — text stays readable on every accent
// -----------------------------------------------------------------------------
//   npm run test:contrast
//
// Colour bugs don't throw. A tinted surface looks harmless in a screenshot on
// one theme and is unreadable on another, and nobody opens all four to check.
// These assertions are the check.
//
// Both real failures this guards against actually shipped for a turn:
//   • `textSecondary` is 4.83:1 on plain white, so ANY accent wash pushes body
//     copy under the 4.5:1 minimum.
//   • Using `theme.primary` as TEXT on a tint of that same primary measured
//     3.1:1 on Ocean and 1.3:1 on Gold — effectively invisible.
// `readableOn` fixes both by darkening only as far as it must; this suite
// proves it does so for every theme, including any theme added later.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const { mix, luminance, contrastRatio, readableOn, colors, LB_BASE, gradientTextPlan, badgeOnGradient,
        pinnedHeaderChrome, chromeHairline, PINNED_FILL_SCALE, withAlpha } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/theme.js');
const { THEMES, DEFAULT_THEME_ID, buildPalette } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/themes.js');
const { readFileSync } = await import('node:fs');
const { BANNER_STYLES } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/bannerStyles.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const AA_TEXT = 4.5;   // WCAG AA, normal text
const AA_UI   = 3.0;   // WCAG AA, graphics / large text

console.log(`\n${C.bold}══════ Theme contrast ══════${C.reset}\n`);

// ── helpers behave ──
{
  check('mix: full weight returns the colour itself', mix('#3B82F6', 1, '#FFFFFF') === '#3b82f6');
  check('mix: zero weight returns the background',    mix('#3B82F6', 0, '#FFFFFF') === '#ffffff');
  check('luminance: black 0, white 1',
    luminance('#000000') === 0 && Math.abs(luminance('#FFFFFF') - 1) < 1e-9);
  check('contrastRatio: black on white is 21:1', Math.abs(contrastRatio('#000000', '#FFFFFF') - 21) < 0.01);
  check('readableOn: leaves a colour that already passes alone',
    readableOn('#FFFFFF', '#1C1C1E') === '#1C1C1E');
  check('readableOn: darkens one that does not',
    contrastRatio(readableOn('#FFFFFF', '#FFD600'), '#FFFFFF') >= AA_TEXT);
  check('readableOn: honours a lower bar for graphics',
    contrastRatio(readableOn('#FFFFFF', '#FFD600', AA_UI), '#FFFFFF') >= AA_UI);
  // Guard the guard: a helper that always returned black would pass everything
  // below while destroying the design.
  check('readableOn: does NOT just return black',
    readableOn('#FFFFFF', '#FFD600') !== '#000000');

  // ── the LIGHTEN pass (dark surfaces) ──────────────────────────────────────
  // Darkening can't fix a dark accent on a dark surface. This used to return
  // '#000000' and hand back 1.25:1 — worse than the input.
  {
    const DARK_CARD = '#1A1D24';
    for (const accent of ['#33383F', '#6366F1', '#1C1C1E']) {
      const ink = readableOn(DARK_CARD, accent);
      const ratio = contrastRatio(ink, DARK_CARD);
      check(`readableOn lightens ${accent} on a dark card (${ratio.toFixed(2)}:1)`,
        ratio >= AA_TEXT, `${ink} → ${ratio.toFixed(2)}`);
    }
    check('readableOn: pure black on a dark card does not stay black',
      readableOn(DARK_CARD, '#000000') !== '#000000');
    // The darken pass must run FIRST and be untouched, or every existing
    // light-surface caller silently shifts colour. Rather than pin hexes (which
    // only re-states whatever the code currently does), re-implement the
    // PRE-CHANGE function and diff the two across every light surface × accent ×
    // bar the app actually uses.
    const before = (bg, color, min = 4.5) => {
      for (let d = 0; d <= 0.9; d += 0.05) {
        const c = d === 0 ? color : mix(color, 1 - d, '#000000');
        if (contrastRatio(c, bg) >= min) return c;
      }
      return '#000000';
    };
    const LIGHT_SURFACES = ['#FFFFFF', '#F4F5F7', '#FAFAFB', '#F1F3F5', '#EBEEF2', '#EAECEE'];
    const drift = [];
    for (const bg of LIGHT_SURFACES) {
      for (const t of Object.values(THEMES)) {
        for (const c of [t.primary, t.primaryDark, t.primaryLight, colors.textSecondary, colors.textMuted, colors.textPrimary]) {
          for (const min of [AA_UI, AA_TEXT]) {
            if (before(bg, c, min) !== readableOn(bg, c, min)) drift.push(`${bg}/${c}@${min}`);
          }
        }
      }
    }
    check(`readableOn: no light-surface result changed (${LIGHT_SURFACES.length * Object.keys(THEMES).length * 12} pairs)`,
      drift.length === 0, drift.slice(0, 5).join(', '));
  }
}

// ── the default is the one the user actually sees ──
check(`default theme '${DEFAULT_THEME_ID}' exists in THEMES`, !!THEMES[DEFAULT_THEME_ID]);
check("removed themes are gone ('sky')", !THEMES.sky);
// Platinum is the neutral accent. Assert it stays neutral AND dark: the point of
// it is that every derived surface comes out grey, which only holds if the three
// channels stay close and the tone stays deep.
{
  const p = THEMES.platinum;
  check('platinum exists and is dark enough to read as ink', !!p && contrastRatio(p.primary, '#FFFFFF') > 8,
    p && contrastRatio(p.primary, '#FFFFFF').toFixed(1));
  const ch = [1, 3, 5].map((i) => parseInt(p.primary.slice(i, i + 2), 16));
  check('platinum is NEUTRAL (channels within a narrow spread)',
    Math.max(...ch) - Math.min(...ch) <= 20, `spread ${Math.max(...ch) - Math.min(...ch)}`);
}

// ── every accent × every banner treatment × every card TONE ──
// A HomeCarousel card is drawn in one of three base colours, not just the accent:
// `tone: 'danger'` (urgent cards) and `'success'` swap the base that the wash,
// the bubbles and every ink derive from. Sweeping only `primary` would leave the
// urgent cards — the ones that matter most — unmeasured.
{
  let worstText = Infinity, worstIcon = Infinity, worstWhere = '';
  for (const [id, t] of Object.entries(THEMES)) {
    // Keys match HomeCarousel's tone → colour mapping. `danger`/`success` are
    // fixed status colours, so they don't vary per theme, but they still have to
    // clear the bar against a wash mixed from themselves.
    const bases = { accent: t.primary, danger: colors.danger, success: colors.success };
    for (const [tone, base] of Object.entries(bases)) {
      for (const v of BANNER_STYLES) {
        const wash = mix(base, v.tint, '#FFFFFF');

        const title  = contrastRatio(colors.textPrimary, wash);
        const body   = contrastRatio(readableOn(wash, colors.textSecondary), wash);
        const accent = contrastRatio(readableOn(wash, base), wash);
        const iconBg = mix(base, 0.16, '#FFFFFF');
        const icon   = contrastRatio(readableOn(iconBg, base, AA_UI), iconBg);

        const lowText = Math.min(title, body, accent);
        if (lowText < worstText) { worstText = lowText; worstWhere = `${id}/${tone} @ tint ${v.tint}`; }
        worstIcon = Math.min(worstIcon, icon);
      }
    }
  }
  check(`card text clears AA on every theme × tone (worst ${worstText.toFixed(2)}:1, ${worstWhere})`,
    worstText >= AA_TEXT, `${worstText.toFixed(2)}`);
  check(`card icon clears the graphics bar (worst ${worstIcon.toFixed(2)}:1)`,
    worstIcon >= AA_UI, `${worstIcon.toFixed(2)}`);
}

// ── the wash must not disappear into the page ──
// At ~22% accent the surface luminance EQUALS colors.background, which is what
// made the cards read as transparent. Elevation carries the separation, but the
// wash still shouldn't land on top of the page colour.
{
  let worst = Infinity, where = '';
  for (const [id, t] of Object.entries(THEMES)) {
    // Same three tone bases as the ink sweep above — a danger-toned card has its
    // own wash and can vanish into the page independently of the accent.
    for (const [tone, base] of Object.entries({ accent: t.primary, danger: colors.danger, success: colors.success })) {
      for (const v of BANNER_STYLES) {
        const gap = Math.abs(luminance(mix(base, v.tint, '#FFFFFF')) - luminance(colors.background));
        if (gap < worst) { worst = gap; where = `${id}/${tone} @ tint ${v.tint}`; }
      }
    }
  }
  check(`wash stays distinct from the page background (worst gap ${worst.toFixed(3)}, ${where})`,
    worst > 0.01, `${worst.toFixed(4)}`);
}

// ── gradient stops ──────────────────────────────────────────────────────────
// Platinum is metallic: a bright BAND between dark ends, not a flat dark ramp.
// Everything reads `gradientStops`, so a theme can be a pair or a long ramp.
{
  let allHaveStops = true;
  for (const id of Object.keys(THEMES)) {
    const p = buildPalette(id, false);
    if (!Array.isArray(p.gradientStops) || p.gradientStops.length < 2) allHaveStops = false;
  }
  check('buildPalette always yields gradientStops (pair or ramp)', allHaveStops);

  const ramp = buildPalette('platinum', false).gradientStops;
  check('platinum ships a multi-stop ramp, not a pair', ramp.length >= 4, `${ramp.length} stops`);

  const worstOnRamp = Math.min(...ramp.map((c) => contrastRatio('#FFFFFF', c)));
  check(`white header text holds on every platinum stop (worst ${worstOnRamp.toFixed(2)}:1)`,
    worstOnRamp >= AA_TEXT, `${worstOnRamp.toFixed(2)}`);

  // The SHINE itself. A flat two-stop dark ramp spans ~0.049; the metallic one
  // spans ~0.125. Without this, someone "simplifying" the ramp back to two dark
  // stops would pass every other check while removing the whole effect.
  const lums = ramp.map(luminance);
  const span = Math.max(...lums) - Math.min(...lums);
  check(`platinum ramp has a real highlight (luminance span ${span.toFixed(3)})`,
    span >= 0.08, `${span.toFixed(3)}`);
  const bright = lums.indexOf(Math.max(...lums));
  const pos = bright / (lums.length - 1);          // 0 = start of the diagonal, 1 = end
  check('platinum highlight is INTERIOR, not an end stop (that is what reads as metal)',
    bright > 0 && bright < lums.length - 1, `brightest at index ${bright}`);
  // ...and CORNERED, not centred. A highlight at 50% reads as a seam across the
  // header instead of light catching an edge, and it lands right behind the
  // greeting text. Off-centre puts the glint in empty space.
  check(`platinum highlight sits toward a corner (at ${(pos * 100).toFixed(0)}% of the diagonal)`,
    Math.abs(pos - 0.5) >= 0.2, `offset ${Math.abs(pos - 0.5).toFixed(2)}`);
  // The text corner must stay the dark one.
  check('the START of the ramp (top-left, under the greeting) is the darkest stop',
    lums.indexOf(Math.min(...lums)) === 0);
}

// ── Lent / Borrowed cards ───────────────────────────────────────────────────
// These are SEMANTIC and FIXED — the app's original emerald / violet, not part
// of the theme. Accent-derived and accent-tinted versions were both built and
// reverted at the user's call: money-in vs money-out reads faster as two
// constant colours you learn once than as two that drift with the accent.
//
// So the invariant is stability, not adaptation, plus enough hue separation to
// tell them apart at a glance.
{
  const hueOf = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return null;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const hg = hueOf(LB_BASE.lent[1]);
  const hp = hueOf(LB_BASE.borrowed[1]);

  check('LB lent is green', hg >= 120 && hg <= 190, `${hg?.toFixed(0)}°`);
  check('LB borrowed is violet', hp >= 240 && hp <= 300, `${hp?.toFixed(0)}°`);
  check('the two hues are far apart (readable at a glance)',
    Math.abs(hg - hp) >= 60, `${Math.abs(hg - hp).toFixed(0)}°`);
  check('LB colours do NOT vary by theme (semantic, like success/danger)',
    LB_BASE.lent[0] === '#059669' && LB_BASE.lent[1] === '#10B981' &&
    LB_BASE.borrowed[0] === '#6D28D9' && LB_BASE.borrowed[1] === '#8B5CF6');

  // ── The accepted contrast gap, asserted as a BOUND rather than hidden ──
  // White on these is below AA and that is a deliberate design decision (every
  // fix — darker green, dark ink, a scrim — loses the look being kept). What a
  // test can still do is stop it getting WORSE, and record the real number so
  // nobody rediscovers it as a surprise.
  const worstWhite = Math.min(
    ...[...LB_BASE.lent, ...LB_BASE.borrowed].map((c) => contrastRatio('#FFFFFF', c)),
  );
  check(`known gap: white on LB cards is ${worstWhite.toFixed(2)}:1 (accepted, must not worsen)`,
    worstWhite >= 2.5, `${worstWhite.toFixed(2)}`);
  // The 26px/800 amount is LARGE text, which has a 3:1 bar — that one must hold.
  const worstLarge = Math.min(...LB_BASE.borrowed.map((c) => contrastRatio('#FFFFFF', c)));
  check(`the large amount still clears the 3:1 large-text bar on violet (${worstLarge.toFixed(2)}:1)`,
    worstLarge >= AA_UI, `${worstLarge.toFixed(2)}`);
  // gradientTextPlan is still the tool for any NEW gradient surface, so keep it
  // honest even though these cards deliberately opt out of it.
  const plan = gradientTextPlan(LB_BASE.lent);
  check('gradientTextPlan would still find a passing option for this green',
    contrastRatio(plan.ink, plan.scrim === 0 ? LB_BASE.lent[1]
      : mix(LB_BASE.lent[1], 1 - plan.scrim, plan.scrimColor)) >= AA_TEXT);
}

// ── InfoSheet bullet icons sit on a fixed light tile ───────────────────────
// The badge tile is #F1F3F5 regardless of theme, so a raw accent can be far too
// pale on it — Gold measures ~1.5:1. Icons are graphical elements (3:1 bar), and
// `readableOn(bg, accent, 3)` is what the component uses.
{
  const BADGE_BG = '#F1F3F5';
  let worst = Infinity, where = '';
  for (const [id, t] of Object.entries(THEMES)) {
    const ink = readableOn(BADGE_BG, t.primary, AA_UI);
    const ratio = contrastRatio(ink, BADGE_BG);
    if (ratio < worst) { worst = ratio; where = id; }
  }
  check(`InfoSheet bullet icons clear the graphics bar on the badge tile (worst ${worst.toFixed(2)}:1, ${where})`,
    worst >= AA_UI, `${worst.toFixed(2)}`);
  const rawWorst = Math.min(...Object.values(THEMES).map((t) => contrastRatio(t.primary, BADGE_BG)));
  check(`the raw accent would still fail on that tile (${rawWorst.toFixed(2)}:1) — keep readableOn`,
    rawWorst < AA_UI, `${rawWorst.toFixed(2)}`);
}

// ── the ACTIVE segment of the period selector ──────────────────────────────
// The selected D/W/M/Y cell is a solid WHITE pill on the gradient, so its label
// is accent-on-white. Using `theme.primary` raw — which is what the old circular
// pills did — measures 3.12:1 on Sunset and **1.41:1 on Gold**: it failed on four
// of the five accents, at 13px bold. `readableOn` is the fix, and this bounds it.
{
  let worst = Infinity, where = '';
  for (const [id, t] of Object.entries(THEMES)) {
    const ink = readableOn('#FFFFFF', t.primary);
    const ratio = contrastRatio(ink, '#FFFFFF');
    if (ratio < worst) { worst = ratio; where = id; }
    check(`${id}: active segment label is readable on its white cell (${ratio.toFixed(2)}:1)`,
      ratio >= AA_TEXT, `${ratio.toFixed(2)}`);
  }
  check(`worst accent clears AA for the active segment (${worst.toFixed(2)}:1, ${where})`,
    worst >= AA_TEXT, `${worst.toFixed(2)}`);
  // The raw accent must remain a FAILING option, or this test stops meaning
  // anything the day someone "simplifies" readableOn back out of the call site.
  const rawWorst = Math.min(...Object.values(THEMES).map((t) => contrastRatio(t.primary, '#FFFFFF')));
  check(`the raw accent would still fail (${rawWorst.toFixed(2)}:1) — keep readableOn`,
    rawWorst < AA_TEXT, `${rawWorst.toFixed(2)}`);
}

// ── the bottom tab bar's ACTIVE tab ────────────────────────────────────────
// The selected tab painted itself with the raw accent on the bar's own surface,
// which measures 3.12:1 on Sunset and **1.41:1 on Gold** — so on four of five
// accents the SELECTED tab was harder to read than the unselected ones
// (`textSecondary` is 4.83:1 there). The label is 10px, so it takes the strict
// AA bar and the icon shares its ink.
{
  const LIGHT_BAR = buildPalette(DEFAULT_THEME_ID, false).card;
  check('the bar paints on the theme surface, which is white in light mode',
    LIGHT_BAR === '#FFFFFF', LIGHT_BAR);

  const inactive = contrastRatio(buildPalette(DEFAULT_THEME_ID, false).textSecondary, LIGHT_BAR);
  check(`an INACTIVE tab already clears AA (${inactive.toFixed(2)}:1)`, inactive >= AA_TEXT);

  // Both modes: the bar follows the theme now, so dark mode must hold too — it's
  // unreachable in the UI today (`darkMode` is reserved), which is exactly why a
  // test is the only thing that will notice if it breaks.
  for (const dark of [false, true]) {
    for (const id of Object.keys(THEMES)) {
      const p = buildPalette(id, dark);
      const ratio = contrastRatio(readableOn(p.card, p.primary), p.card);
      check(`${id}${dark ? ' (dark)' : ''}: active tab ink readable on the bar (${ratio.toFixed(2)}:1)`,
        ratio >= AA_TEXT, `${ratio.toFixed(2)}`);
    }
  }

  const rawWorst = Math.min(
    ...Object.keys(THEMES).map((id) => {
      const p = buildPalette(id, false);
      return contrastRatio(p.primary, p.card);
    }),
  );
  check(`the raw accent would still fail on the bar (${rawWorst.toFixed(2)}:1) — keep readableOn`,
    rawWorst < AA_TEXT, `${rawWorst.toFixed(2)}`);

  // The derived hairline has to separate the bar from a card scrolling UNDER it,
  // and both are the same colour in light mode. It only needs to be visible, not
  // to pass a text bar — but it must not be a no-op.
  for (const dark of [false, true]) {
    const p = buildPalette(DEFAULT_THEME_ID, dark);
    const hair = mix(p.textPrimary, 0.1, p.card);
    check(`the top hairline is distinguishable from the bar${dark ? ' (dark)' : ''}`,
      hair !== p.card && contrastRatio(hair, p.card) > 1.05, `${hair} vs ${p.card}`);
  }
}

// ── the brand footer's accent-wash band ─────────────────────────────────────
// The band was a flat `#EBEEF2` at 1.07:1 against the page — invisible — with a
// hairline at 1.02:1 on itself. It's now a 10% accent wash, and the measurements
// below are why it ALSO keeps a derived hairline: at that tint the wash is
// hue-distinct but barely luminance-distinct, and on Gold it is FLATTER than the
// grey it replaced. The wash carries identity; the hairline carries the boundary.
{
  const BAND_TINT = 0.1;
  const EDGE_MIN = 1.8;
  const OLD_BAND = '#EBEEF2';
  const OLD_EDGE = contrastRatio(colors.divider, OLD_BAND);
  check(`the OLD flat band was invisible against the page (${contrastRatio(OLD_BAND, colors.background).toFixed(3)}:1)`,
    contrastRatio(OLD_BAND, colors.background) < 1.1);
  check(`the OLD hairline was invisible on it (${OLD_EDGE.toFixed(2)}:1)`, OLD_EDGE < 1.1);

  let worstEdge = Infinity, worstName = Infinity, worstTag = Infinity;
  for (const dark of [false, true]) {
    for (const [id, t] of Object.entries(THEMES)) {
      const p = buildPalette(id, dark);
      const band = mix(p.primary, BAND_TINT, p.background);
      const edge = contrastRatio(readableOn(band, p.primary, EDGE_MIN), band);
      // 42px/900 — large text, so the 3:1 bar. Gold's primaryDark is the only
      // accent that fails raw (1.69:1), which is why it is derived.
      const nameInk = contrastRatio(readableOn(band, p.primaryDark, AA_UI), band);
      const tagInk = contrastRatio(readableOn(band, p.textSecondary), band);
      worstEdge = Math.min(worstEdge, edge);
      worstName = Math.min(worstName, nameInk);
      worstTag = Math.min(worstTag, tagInk);
      check(`${id}${dark ? ' (dark)' : ''}: band edge is visible (${edge.toFixed(2)}:1)`,
        edge >= EDGE_MIN - 0.01, `${edge.toFixed(2)}`);
      check(`${id}${dark ? ' (dark)' : ''}: wordmark clears the large-text bar (${nameInk.toFixed(2)}:1)`,
        nameInk >= AA_UI, `${nameInk.toFixed(2)}`);
      check(`${id}${dark ? ' (dark)' : ''}: tagline clears AA (${tagInk.toFixed(2)}:1)`,
        tagInk >= AA_TEXT, `${tagInk.toFixed(2)}`);
    }
  }
  check(`the derived edge beats the old hairline everywhere (${worstEdge.toFixed(2)}:1 vs ${OLD_EDGE.toFixed(2)}:1)`,
    worstEdge > OLD_EDGE * 1.5);

  // The reason the hairline can't be dropped: prove the wash alone does NOT make
  // the band visible. If someone later raises the tint and deletes the edge, this
  // is what tells them it doesn't work — Gold is the case that breaks.
  const amberBand = mix(THEMES.amber.primary, BAND_TINT, colors.background);
  check(`Gold's wash alone is flatter than the old grey (${contrastRatio(amberBand, colors.background).toFixed(3)}:1) — keep the edge`,
    contrastRatio(amberBand, colors.background) < contrastRatio(OLD_BAND, colors.background),
    `${contrastRatio(amberBand, colors.background).toFixed(3)}`);

  // The tint must stay well clear of the point where a wash's luminance equals
  // the page background and the surface reads as transparent (§7).
  check(`the band tint (${BAND_TINT}) is far below the ~0.22 transparency point`, BAND_TINT < 0.15);
  const rawTag = contrastRatio(colors.textMuted, OLD_BAND);
  check(`textMuted — the old tagline colour — would still fail (${rawTag.toFixed(2)}:1)`,
    rawTag < AA_TEXT, `${rawTag.toFixed(2)}`);
}

// ── the header badge must be VISIBLE on every accent ───────────────────────
// A badge is an opaque graphical element (3:1 bar). No flat colour clears it on
// all five gradients — white bottoms out at 1.41:1 on Amber, near-black at
// 1.03:1 on Platinum. The level badge shipped as a hardcoded violet `#7C3AED`,
// the worst of the three at **1.02:1 on Platinum**: a badge nobody could see.
// `badgeOnGradient` picks per theme instead.
{
  let worst = Infinity, where = '';
  for (const [id, t] of Object.entries(THEMES)) {
    const stops = buildPalette(id).gradientStops;
    const { fill, ink, ratio } = badgeOnGradient(stops);
    // The reported ratio must match an independent re-measure — never trust the
    // value the function under test hands back about itself.
    const measured = Math.min(...stops.map((s2) => contrastRatio(fill, s2)));
    check(`${id}: badge fill is legible on the gradient (${measured.toFixed(2)}:1)`,
      measured >= AA_UI && Math.abs(measured - ratio) < 0.01,
      `reported ${ratio.toFixed(2)}, measured ${measured.toFixed(2)}`);
    // And its own number must be readable ON the badge.
    check(`${id}: the badge number is readable on the badge`,
      contrastRatio(ink, fill) >= AA_TEXT, `${contrastRatio(ink, fill).toFixed(2)}`);
    if (measured < worst) { worst = measured; where = id; }
    void t;
  }
  check(`the worst accent still clears the graphics bar (${worst.toFixed(2)}:1, ${where})`,
    worst >= AA_UI, `${worst.toFixed(2)}`);
  // The colour it replaced, for the record — this must stay a failing option.
  const violetWorst = Math.min(
    ...Object.keys(THEMES).flatMap((id) => buildPalette(id).gradientStops.map((s2) => contrastRatio('#7C3AED', s2))),
  );
  check(`the old hardcoded violet would still fail (${violetWorst.toFixed(2)}:1)`,
    violetWorst < AA_UI, `${violetWorst.toFixed(2)}`);
}

// ── nobody hand-builds the pair ─────────────────────────────────────────────
// A screen that writes [theme.gradientStart, theme.gradientEnd] silently drops
// the extra stops, so Platinum renders FLAT on that screen only — invisible
// unless you happen to open it with that theme active. Five screens did exactly
// this before the ramp existed.
{
  const ROOT = '/Users/praveenverma/Desktop/pvn/ePurse/src';
  const walk = (dir) => readFileSync && [];
  const { readdirSync, statSync } = await import('node:fs');
  const files = [];
  (function rec(dir) {
    for (const name of readdirSync(dir)) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) { if (name !== '__tests__') rec(full); }
      else if (/\.(js|tsx|ts)$/.test(name)) files.push(full);
    }
  })(ROOT);

  const offenders = [];
  const lbOffenders = [];
  for (const f of files) {
    if (f.endsWith('constants/themes.js')) continue;   // defines the fallback
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.trim();
      // Comments discuss these names legitimately (including the doc comment that
      // explains why the pair was removed) — only real code counts.
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      if (line.includes('gradientStops')) return;      // the legitimate fallback
      if (/gradientStart\s*,\s*[A-Za-z_$][\w$]*\.gradientEnd/.test(line)) {
        offenders.push(`${f.replace(ROOT, 'src')}:${i + 1}`);
      }
      // Same trap for the Lent/Borrowed pair: three screens each hard-coded the
      // fixed green/purple, so theming one left the others behind.
      // Purple existed ONLY as the "borrowed" colour, so any reappearance means
      // someone re-hardcoded the pair. Green survives as a BANK-brand gradient
      // (AccountDetailsScreen tints by issuer), so it isn't a signal by itself.
      if (/gradientPurple/.test(line)) {
        lbOffenders.push(`${f.replace(ROOT, 'src')}:${i + 1}`);
      }
    });
  }
  check('no screen hand-builds [gradientStart, gradientEnd] — use useGradient()',
    offenders.length === 0, offenders.join(', '));
  check('no screen hard-codes the fixed LB green/purple — use useLbGradients()',
    lbOffenders.length === 0, lbOffenders.join(', '));

  // ── Dashboard elevation language (Aug-26) ────────────────────────────────
  // Home's six top-level sections had FOUR different depths, one of them
  // (BudgetSummary's 0.08/r12/e3) a value that existed nowhere else — so
  // elevation encoded nothing. The rule now: every top-level section sits at
  // `shadows.card`, and `shadows.elevated` is reserved for a surface that is
  // deliberately lifted (the Lent/Borrowed hero pair, the queue deck).
  //
  // Scoped to the HOME sections on purpose. 22 files across the app hand-roll a
  // shadow and many are legitimate (coloured glows on RewardShop widgets,
  // dark-mode-aware surfaces); linting all of them would be a sweep, not a
  // guard, and pretending otherwise would make this test a chore to satisfy.
  const HOME_SECTIONS = [
    'components/HomeCarousel.tsx',
    'components/LentBorrowedWidget.js',
    'components/MonthlyRecapCard.tsx',
    'components/BudgetSummary.tsx',
    'components/DailyQueueStack.js',
    'components/TransactionItem.js',
  ];
  const rawShadows = [];
  for (const rel of HOME_SECTIONS) {
    const full = `${ROOT}/${rel}`;
    readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      // `shadowOpacity: 0` is a deliberate FLATTEN, not a new depth —
      // TransactionItem's `cardMuted` uses it for archived rows, because dimming a
      // real elevation via container opacity draws a grey box on Android.
      if (/shadowOpacity:\s*0\s*,?\s*$/.test(code)) return;
      if (/shadowOpacity\s*:/.test(code)) rawShadows.push(`${rel}:${i + 1}`);
    });
  }
  check('Home sections use the shadow TOKENS, never a hand-rolled depth',
    rawShadows.length === 0, rawShadows.join(', '));

  // ── The active segment's ink must be DERIVED, at the call site ────────────
  // The block above proves `readableOn('#FFFFFF', primary)` produces a passing
  // colour — but it says nothing about whether the screen actually calls it. A
  // mutation replacing `periodActiveInk` with a raw `theme.primary` left every
  // contrast assertion green while putting 1.41:1 text back on Gold. Testing the
  // helper is not testing the caller, so grep the caller.
  const dash = readFileSync(`${ROOT}/screens/DashboardScreen.js`, 'utf8');
  const dashLines = dash.split('\n');
  const inkAt = dashLines.findIndex((l) => l.includes('const periodActiveInk'));
  // The whole DECLARATION, not just its first line: this started as a one-liner
  // and became a multi-line ternary when the third selector variant landed, at
  // which point a line-scoped grep failed on formatting rather than on substance.
  const inkDecl = inkAt >= 0 ? dashLines.slice(inkAt, inkAt + 6).join(' ') : '';
  check('the active-segment ink is derived through readableOn at the call site',
    inkAt >= 0 && inkDecl.includes('readableOn'),
    inkAt >= 0 ? inkDecl.trim().slice(0, 120) : 'periodActiveInk not found — did it get renamed?');

  // ── Same lint for the tab bar, for the same reason ────────────────────────
  const bar = readFileSync(`${ROOT}/components/AnimatedTabBar.js`, 'utf8');
  const barLines = bar.split('\n');
  const barInkAt = barLines.findIndex((l) => l.includes('const activeColor'));
  const barInkDecl = barInkAt >= 0 ? barLines.slice(barInkAt, barInkAt + 4).join(' ') : '';
  check('the active TAB ink is derived through readableOn at the call site',
    barInkAt >= 0 && barInkDecl.includes('readableOn'),
    barInkAt >= 0 ? barInkDecl.trim().slice(0, 120) : 'activeColor not found — did it get renamed?');
  // The surface must come from the theme, or the bar is the one piece of chrome
  // left white when dark mode ships — and every ratio above is measured against
  // `theme.card`, so a hardcoded hex would make them measure the wrong thing.
  check('the tab bar takes its surface from the theme, not a hardcoded hex',
    !/backgroundColor:\s*'#/.test(bar) && bar.includes('backgroundColor: theme.card'),
    (bar.match(/backgroundColor:.*/g) || []).join(' | '));

  // ── The brand footer must DERIVE its band and every ink on it ─────────────
  // A mutation putting `colors.divider` back as the band's edge left all 138
  // assertions green: the suite proved a derived edge is visible, not that the
  // component derives one. The whole point of the accent wash is that nothing on
  // it can be a fixed colour, because the band itself moves with the theme.
  const footer = readFileSync(`${ROOT}/components/AppBrandFooter.tsx`, 'utf8');
  check('the footer band is an accent wash, not a hardcoded surface',
    /mix\(primary,\s*BAND_TINT/.test(footer) && !/backgroundColor:\s*'#/.test(footer),
    (footer.match(/backgroundColor:.*/g) || []).join(' | '));
  for (const [what, re] of [
    ['edge', /edge:\s*readableOn\(band, primary, EDGE_MIN\)/],
    ['wordmark', /name:\s*readableOn\(band, primaryDark, 3\)/],
    ['tagline', /tagline:\s*readableOn\(band, colors\.textSecondary\)/],
  ]) {
    check(`the footer's ${what} ink is derived from the band at the call site`, re.test(footer),
      `no match for ${re}`);
  }
  check('no fixed divider/muted colour survives on the footer band',
    !/borderColor:\s*colors\.divider/.test(footer) && !/colors\.textMuted/.test(footer),
    'a fixed grey on a themed wash cannot be measured');

  // ── The startup skeleton must reserve the REAL card height ────────────────
  // The carousel is self-measuring, so its first frame can never draw a card. It
  // used to render nothing at all — a zero-height view that still took a slot in
  // the Dashboard's section `gap`, which is the blank band users saw on startup.
  // A skeleton only fixes that while its height MATCHES the card's minimum; drift
  // and the strip jumps when real cards land, which is the thing being fixed.
  const carousel = readFileSync(`${ROOT}/components/HomeCarousel.tsx`, 'utf8');
  const skelH = carousel.match(/const SKELETON_H = (\d+);/)?.[1];
  const cardMinH = carousel.match(/minHeight:\s*(\d+)/)?.[1];
  check(`the skeleton reserves exactly the card's minHeight (${skelH} vs ${cardMinH})`,
    !!skelH && skelH === cardMinH, `SKELETON_H ${skelH}, card minHeight ${cardMinH}`);
  check('the carousel renders a skeleton rather than nothing while unmeasured',
    /const showSkeleton = loading \|\| width === 0;/.test(carousel)
    && carousel.includes('<CardSkeleton'),
    'width === 0 must render a placeholder, not collapse');

  // The skeleton's bars are drawn on the CARD surface, so a fixed grey would glow
  // on the dark palette instead of reading as an absence of content.
  const skeleton = readFileSync(`${ROOT}/components/CardSkeleton.tsx`, 'utf8');
  check('the skeleton derives its bar colour from the theme, not a fixed grey',
    /mix\(theme\.textPrimary,/.test(skeleton) && !/backgroundColor:\s*'#/.test(skeleton),
    (skeleton.match(/backgroundColor:.*/g) || []).join(' | '));
  for (const dark of [false, true]) {
    const pal = buildPalette(DEFAULT_THEME_ID, dark);
    const bar = mix(pal.textPrimary, 0.09, pal.card);
    const r = contrastRatio(bar, pal.card);
    // Visible as a shape, but quieter than real content — it is a placeholder,
    // not something to read.
    check(`skeleton bars are visible but subdued${dark ? ' (dark)' : ''} (${r.toFixed(2)}:1)`,
      r > 1.05 && r < 2, `${r.toFixed(2)}`);
  }

  // The Dashboard must not compute Home-card facts inside a zustand selector:
  // those run on EVERY store write and both getters return a fresh object, so
  // the screen re-rendered and rebuilt every card on every update — worst during
  // the launch SMS sweep, exactly when the carousel was struggling.
  check('Home card facts are memoised, not computed inside a store selector',
    !/useEPurseStore\(\(s\) => s\.getCategoryBreakdown\(\)/.test(dash)
    && !/useEPurseStore\(\(s\) => \(s\.budget \? s\.getBudgetUsage\(\)/.test(dash),
    'wrap these in useMemo — a selector returning a new object never compares equal');
  // The bleed is a CALL-SITE decision — the component defaults to 0, so the
  // geometry suite proving the maths says nothing about whether Dashboard asks
  // for it. Without this, dropping the prop silently restores the double inset.
  check('the Home carousel breaks out of the page gutter at the call site',
    /bleed=\{spacing\.lg\}/.test(dash),
    'HomeCarousel defaults to bleed=0; the host must pass its own gutter');
  // …and that the component USES it. A prop that is declared, passed and then
  // ignored is not a type error, so nothing else would notice.
  check('…and the component actually applies it as a negative margin',
    /marginHorizontal: -bleed/.test(carousel),
    'the bleed prop is accepted but never reaches a style');
  check('the carousel waits for the persisted store before drawing cards',
    dash.includes('useStoreHydrated') && /loading=\{!hydrated\}/.test(dash),
    'an empty store is not a user with no data');

  // ── Home's collapsing header ───────────────────────────────────────────────
  // Turning collapsing ON is a migration, not a flag flip: the component OWNS the
  // ScrollView in that mode, so the body has to be its children rather than a
  // sibling <ScrollView>, and it manages `contentContainerStyle`'s paddingTop
  // (= the expanded header height). Leaving the screen's own paddingTop in place
  // would push the first card that far below the header a second time.
  const header = readFileSync(`${ROOT}/components/CollapsingHeaderScreen.tsx`, 'utf8');
  check('Home no longer forces the header into fixed mode',
    !/collapsible=\{false\}/.test(dash), 'collapsible={false} is still on the Dashboard header');
  // Test the IMPORT, not the JSX: the comment explaining this migration contains
  // the string "<ScrollView>", and the first version of this check matched its
  // own documentation.
  check('…and the body is INSIDE the header component, not a sibling ScrollView',
    dash.includes('</CollapsingHeaderScreen>')
    && !/^\s*View, Text, StyleSheet, ScrollView/m.test(dash),
    'collapsing mode owns the scroll view — the screen must not import its own');
  check('…and the screen does not double the managed top padding',
    !/bodyContent: \{[^}]*paddingTop: spacing\.xl \+ spacing\.lg/.test(dash),
    'contentContainerStyle paddingTop is set by CollapsingHeaderScreen');

  // The hero is three stacked TEXT blocks, so its height moves with the font and
  // the OS font-scale setting. A pinned `heroHeight` lays it out at exactly that
  // number — too small clips it, too large leaves it floating — and no test can
  // catch either, because the value that is right on one device is wrong on the
  // next. It must measure itself.
  check('Home lets its hero MEASURE itself rather than pinning a height',
    !/heroHeight=\{/.test(dash) && /estimatedHeroHeight=\{/.test(dash),
    'pass estimatedHeroHeight (first frame only), never heroHeight, for a text hero');
  check('the header component supports a self-measuring hero',
    /const autoHero = heroHeight == null;/.test(header)
    && /onLayout=\{autoHero \? onHeroLayout : undefined\}/.test(header)
    && /height: autoHero \? undefined : heroHeight,/.test(header),
    'auto mode must let the hero size to content and report it back');
  check('the measurement guards against an infinite re-render',
    /prev === h \? prev : h/.test(header),
    'onLayout fires on every render; setting state unconditionally loops');
  // A pinned caller must keep its old behaviour exactly.
  check('an explicit heroHeight still wins (Accounts is unchanged)',
    /const heroH = heroHeight \?\? measuredHero \?\? estimatedHeroHeight;/.test(header));
  check('a zero-height hero cannot divide by zero in the interpolation',
    /const FULL = Math\.max\(1, heroH \/ P\);/.test(header),
    'heroH is 0 on the first frame when no estimate is given');

  // ── Nobody may hand-pick the tab-bar clearance again ──────────────────────
  // AnalyticsScreen paid `spacing.lg` (16) against a bar that occupies 62 + the
  // safe-area inset, so its last section rendered behind the bar. Three other
  // screens each guessed a different number. The inset is only knowable at
  // runtime, so the helper is the only correct answer.
  const CLEARANCE_SCREENS = [
    'screens/AnalyticsScreen.js', 'screens/BudgetScreen.js',
    'screens/TransactionsScreen.js', 'screens/AccountsScreen.js',
    'screens/DashboardScreen.js',
  ];
  const missing = CLEARANCE_SCREENS.filter((rel) => !readFileSync(`${ROOT}/${rel}`, 'utf8').includes('tabBarClearance'));
  check('every tab screen pays its bottom clearance through the shared helper',
    missing.length === 0, missing.join(', '));
}

// ═════════════════════════════════════════════════════════════════════════════
// A COLLAPSING HEADER'S PINNED (LIGHT) STATE
// -----------------------------------------------------------------------------
// The header cross-fades from a saturated gradient to `theme.card` as it pins, so
// every colour in its bar has two ends. The gradient end was already measured
// (white ink, `badgeOnGradient`); this is the other end, which is a colour
// inversion — and the failure mode is total, not marginal: white text and a
// `#FFFFFF14` chip on a white strip are not "low contrast", they are gone.
// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}══════ Pinned header chrome ══════${C.reset}\n`);
{
  const SRC = '/Users/praveenverma/Desktop/pvn/ePurse/src';
  const { LIGHT_NEUTRALS, DARK_NEUTRALS } = await import(`${SRC}/constants/themes.js`);

  // Both neutral sets: the whole point of deriving rather than hardcoding a dark
  // ink is that `card` is near-black in dark mode, where the ink must LIGHTEN.
  const SURFACES = [
    ['light card', (LIGHT_NEUTRALS ?? colors).card ?? colors.card, LIGHT_NEUTRALS ?? colors],
    ['dark card',  (DARK_NEUTRALS  ?? {}).card ?? '#1A1D24',       DARK_NEUTRALS  ?? colors],
  ];

  for (const [label, surface, palette] of SURFACES) {
    const pin = pinnedHeaderChrome(surface, palette);

    const inkR = contrastRatio(pin.ink, surface);
    check(`${label}: the bar's ink clears AA on it (${inkR.toFixed(2)}:1)`,
      inkR >= AA_TEXT, `${pin.ink} on ${surface}`);

    const mutedR = contrastRatio(pin.inkMuted, surface);
    check(`${label}: the muted ink clears AA too (${mutedR.toFixed(2)}:1)`,
      mutedR >= AA_TEXT, `${pin.inkMuted} on ${surface}`);

    // A badge is opaque and cannot tint its way to legibility, so it inverts.
    const badgeR = contrastRatio(pin.badgeInk, pin.badgeFill);
    check(`${label}: the badge number reads on the badge (${badgeR.toFixed(2)}:1)`,
      badgeR >= AA_TEXT, `${pin.badgeInk} on ${pin.badgeFill}`);
    const badgeOnBar = contrastRatio(pin.badgeFill, surface);
    check(`${label}: and the badge itself is visible on the bar (${badgeOnBar.toFixed(2)}:1)`,
      badgeOnBar >= AA_UI, `${pin.badgeFill} on ${surface}`);

    // The chips are translucent, so they only have to be SEEN, not read.
    // `mix` composites the alpha down onto the surface the way the GPU will.
    const composite = (c) => {
      const a = parseInt(c.slice(7, 9), 16) / 255;
      return mix(c.slice(0, 7), a, surface);
    };
    const fillR   = contrastRatio(composite(pin.fill(0x14 / 255)), surface);
    const borderR = contrastRatio(composite(pin.fill(0x2e / 255)), surface);
    check(`${label}: a chip fill is visible against the bar (${fillR.toFixed(3)}:1)`,
      fillR > 1.02, 'a chip you cannot see is not a control');
    check(`${label}: its border is stronger than its fill`,
      borderR > fillR, `${borderR.toFixed(3)} vs ${fillR.toFixed(3)}`);

    const hairR = contrastRatio(pin.hairline, surface);
    check(`${label}: the bottom hairline separates bar from body (${hairR.toFixed(3)}:1)`,
      hairR > 1.05, 'card content scrolls under a card-coloured bar');
  }

  // ── The surface is a PROP, so it need not agree with the palette ──────────
  // The two cases above are self-consistent — a dark palette carries a light
  // `textPrimary`, so even an underived ink passes on a dark card, and the
  // derivation looks unnecessary. It isn't: `collapsedSurface` is an override,
  // and the moment a header pins to something that is not its palette's `card`
  // (an accent strip, a tinted surface) a raw `textPrimary` is what fails.
  for (const t of Object.values(THEMES)) {
    const pin = pinnedHeaderChrome(t.primary, colors);
    const raw = contrastRatio(colors.textPrimary, t.primary);
    const der = contrastRatio(pin.ink, t.primary);
    check(`${t.label}: an accent surface still gets a legible ink (${der.toFixed(2)}:1)`,
      der >= AA_TEXT, `${pin.ink} on ${t.primary}`);
    if (raw < AA_TEXT) {
      check(`${t.label}: …which the raw textPrimary would NOT have been (${raw.toFixed(2)}:1)`,
        der > raw, 'this is the pair the derivation exists for');
    }
    // The muted ink carries the greeting — small text, so the same bar. It is
    // the one MORE likely to fail: textSecondary is only 4.83:1 on plain white.
    const mRaw = contrastRatio(colors.textSecondary, t.primary);
    const mDer = contrastRatio(pin.inkMuted, t.primary);
    check(`${t.label}: and a legible MUTED ink (${mDer.toFixed(2)}:1)`,
      mDer >= AA_TEXT, `${pin.inkMuted} on ${t.primary}`);
    if (mRaw < AA_TEXT) {
      check(`${t.label}: …raw textSecondary would have been ${mRaw.toFixed(2)}:1`, mDer > mRaw);
    }
  }

  // The pinned header and the tab bar are the same surface at opposite ends of
  // the screen. Two separately-derived hairlines would drift the first time one
  // was tuned; one helper, asserted here, cannot.
  check('the header edge and the tab-bar edge are the SAME derivation',
    pinnedHeaderChrome(colors.card, colors).hairline === chromeHairline(colors.card, colors));

  // ── The transition must not JUMP at either end ────────────────────────────
  // Both ends are hand-authored numbers, and the visible symptom of getting
  // them wrong is a chip that changes weight the instant you touch the screen.
  check('the expanded end is exactly what the chip already painted',
    withAlpha('#FFFFFF', 0x14 / 255).toLowerCase() === '#ffffff14'
    && withAlpha('#FFFFFF', 0x2e / 255).toLowerCase() === '#ffffff2e',
    'the animation starts from the chip\'s own static colours');

  // Near-black at alpha A on white is heavier than white at alpha A on a
  // gradient, so carrying the alpha across unchanged makes every chip gain
  // weight as the header lightens. Measured on Ocean's mid stop.
  {
    const gradMid = THEMES.blue.gradientEnd;
    const A = 0x2e / 255;
    const onGradient = contrastRatio(mix('#FFFFFF', A, gradMid), gradMid);
    const unscaled   = contrastRatio(mix(colors.textPrimary, A, colors.card), colors.card);
    const scaled     = contrastRatio(mix(colors.textPrimary, A * PINNED_FILL_SCALE, colors.card), colors.card);
    check(`unscaled, the pinned chip is HEAVIER than the gradient one (${unscaled.toFixed(2)} vs ${onGradient.toFixed(2)})`,
      unscaled > onGradient, 'if this stops being true the scale is solving nothing');
    check(`scaling by ${PINNED_FILL_SCALE} lands closer to the gradient weight`,
      Math.abs(scaled - onGradient) < Math.abs(unscaled - onGradient),
      `${scaled.toFixed(2)} vs ${unscaled.toFixed(2)}, target ${onGradient.toFixed(2)}`);
    check('…and errs quiet rather than heavy',
      scaled <= onGradient + 0.01, `${scaled.toFixed(3)} vs ${onGradient.toFixed(3)}`);
  }

  // ── The chip variant must actually derive, not re-pick ────────────────────
  // HeaderChip's `onLight` is where every collapsing bar gets its light-surface
  // fill, border and badge. If it hardcoded them, the same wrong numbers would
  // reach both screens and the derivation above would be measuring nothing.
  const chipSrc = readFileSync(`${SRC}/components/HeaderChip.tsx`, 'utf8');
  check('HeaderChip derives its light-surface colours',
    /pinnedHeaderChrome\(theme\.card, theme\)/.test(chipSrc)
    && /pinnedChrome\.fill\(CHIP_FILL_ALPHA\)/.test(chipSrc));
  check('…from the SAME alphas the gradient variant uses',
    /const GRADIENT_CHIP_FILL {3}= '#FFFFFF14';/.test(chipSrc)
    && withAlpha('#FFFFFF', 0x14 / 255).toLowerCase() === '#ffffff14',
    'a drift here shows as chips that change weight between the two bars');
  const badge = pinnedHeaderChrome(colors.card, colors);
  check(`the pinned badge inverts rather than tinting (${contrastRatio(badge.badgeInk, badge.badgeFill).toFixed(1)}:1)`,
    contrastRatio(badge.badgeInk, badge.badgeFill) >= AA_TEXT,
    'a badge is opaque, so it cannot tint its way to legibility like the chips can');
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
