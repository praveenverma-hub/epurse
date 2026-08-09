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

const { mix, luminance, contrastRatio, readableOn, colors, LB_BASE, gradientTextPlan } =
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

// ── every accent × every banner treatment ──
{
  let worstText = Infinity, worstIcon = Infinity, worstWhere = '';
  for (const [id, t] of Object.entries(THEMES)) {
    for (const v of BANNER_STYLES) {
      const wash = mix(t.primary, v.tint, '#FFFFFF');

      const title  = contrastRatio(colors.textPrimary, wash);
      const body   = contrastRatio(readableOn(wash, colors.textSecondary), wash);
      const accent = contrastRatio(readableOn(wash, t.primary), wash);
      const iconBg = mix(t.primary, 0.16, '#FFFFFF');
      const icon   = contrastRatio(readableOn(iconBg, t.primary, AA_UI), iconBg);

      const lowText = Math.min(title, body, accent);
      if (lowText < worstText) { worstText = lowText; worstWhere = `${id} @ tint ${v.tint}`; }
      worstIcon = Math.min(worstIcon, icon);
    }
  }
  check(`banner text clears AA on every theme (worst ${worstText.toFixed(2)}:1, ${worstWhere})`,
    worstText >= AA_TEXT, `${worstText.toFixed(2)}`);
  check(`banner icon clears the graphics bar (worst ${worstIcon.toFixed(2)}:1)`,
    worstIcon >= AA_UI, `${worstIcon.toFixed(2)}`);
}

// ── the wash must not disappear into the page ──
// At ~22% accent the surface luminance EQUALS colors.background, which is what
// made the cards read as transparent. Elevation carries the separation, but the
// wash still shouldn't land on top of the page colour.
{
  let worst = Infinity, where = '';
  for (const [id, t] of Object.entries(THEMES)) {
    for (const v of BANNER_STYLES) {
      const gap = Math.abs(luminance(mix(t.primary, v.tint, '#FFFFFF')) - luminance(colors.background));
      if (gap < worst) { worst = gap; where = `${id} @ tint ${v.tint}`; }
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
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
