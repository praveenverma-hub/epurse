// Premium Swiggy-inspired theme
/**
 * ⚠ THIS PALETTE IS FROZEN LIGHT — and it is the one thing blocking dark mode.
 *
 * `StyleSheet.create` captures these values at module load, so nothing that
 * happens later — a theme switch, the `darkMode` flag, a canvas theme — can
 * reach a style built from them. **972 references across 50 files** still do,
 * which is why `STATIC_CONFIG.theme.canvasThemes` is off: turning it on today
 * paints the themed surfaces slate and leaves these white.
 *
 * NEW CODE SHOULD NOT IMPORT THIS. Use `useTheme()` and build styles with
 * `makeStyles(theme)` + `useMemo` (see `ProfileScreen.tsx`). `theme.*` is a
 * strict SUPERSET of these keys — a test asserts it — so a file migrates by
 * renaming `colors.` to `t.`.
 *
 * The full plan, the measured slate palette and the file-by-file inventory:
 * **`docs/DARK_MODE.md`**. Read it before touching colour here.
 */
export const colors = {
  // =========================================================
  // ePurse Brand
  // Violet is the identity — not the color of every component.
  // =========================================================
  primary: '#5B3CC4',
  primaryDark: '#321F70',
  primaryLight: '#7B4DFF',

  // Supporting brand shades
  lavender: '#B58CFF',
  lavenderSoft: '#F0EBFF',
  lavenderSurface: '#F5F2FD',

  // Secondary brand accent — use sparingly
  peach: '#FF9B76',
  peachDark: '#D96847',
  peachSoft: '#FFF1EC',

  // =========================================================
  // Primary Brand Gradient
  // Best for headers, primary CTAs, selected premium surfaces.
  // =========================================================
  gradientStart: '#321F70',
  gradientMid: '#5B3CC4',
  gradientEnd: '#7B4DFF',

  // =========================================================
  // Supporting Gradients
  // These are functional accents, not competing brand themes.
  // =========================================================

  // Information / accounts / data visualization
  gradientBlueStart: '#315FA8',
  gradientBlueEnd: '#5B8DEF',

  // Positive / received / savings
  gradientGreenStart: '#12856E',
  gradientGreenEnd: '#20B486',

  // Lent — money expected back
  gradientLentStart: '#16A673',
  gradientLentEnd: '#4fdc83',

  // Borrowed — money to return
  gradientBorrowStart: '#FF7657',
  gradientBorrowEnd: '#FF9B76',


  // Lent / Borrowed summary card (Home) — pastel fill, coloured ink
  lentCardStart: '#DFF8EF',
  lentCardEnd: '#B9F3DE',
  lentCardText: '#2E8D78',
  borrowCardStart: '#FFEFE9',
  borrowCardEnd: '#FFD7CC',
  borrowCardText: '#D67656',

  // Soft premium/insight gradient
  gradientSoftStart: '#F5F0FF',
  gradientSoftEnd: '#FFF3ED',

  // =========================================================
  // Surfaces
  // Warm-neutral with a very subtle violet character.
  // =========================================================
  background: '#F4F5F7',
  card: '#FFFFFF',
  cardAlt: '#FAFAFB',
  surfaceSecondary: '#F5F2FD',
  surfaceElevated: '#FFFFFF',

  divider: '#ECE9F1',
  border: '#E4E0EB',

  // Strong enough for unfilled form controls while staying soft.
  inputBorder: '#D7DADE',
  inputBackground: '#F7F5FA',

  // =========================================================
  // Text
  // Slight violet undertone instead of harsh pure black.
  // =========================================================
  textPrimary: '#181525',
  textSecondary: '#625D70',
  textMuted: '#8B8796',
  textDisabled: '#B8B3C1',
  textOnGradient: '#FFFFFF',

  // =========================================================
  // General Status
  // =========================================================
  success: '#18A878',
  danger: '#D9363E',
  warning: '#E6A52F',
  info: '#4285D4',

  successSoft: '#E8F7F1',
  dangerSoft: '#FDEBEC',
  warningSoft: '#FFF5DD',
  infoSoft: '#EBF2FC',

  // =========================================================
  // Financial Semantics
  // Keep these consistent throughout the entire app.
  // =========================================================

  // Income / money coming in
  income: '#18A878',
  incomeSoft: '#E8F7F1',

  // Expense — actual spending
  expense: '#E05252',
  expenseSoft: '#FDEEEE',

  // Savings
  savings: '#159A8A',
  savingsSoft: '#E7F7F4',

  // Lent — somebody owes the user
  lent: '#16A673',
  lentSoft: '#E8F7F3',

  // Borrowed — user needs to return money
  // Intentionally coral rather than danger red.
  borrowed: '#FF7657',
  borrowedSoft: '#FFF1EC',

  // Budget
  budget: '#E6A52F',
  budgetSoft: '#FFF5DD',

  // Rewards / EP Coins
  reward: '#F2C45C',
  rewardSoft: '#FFF8DF',

  // Review queue / needs attention
  review: '#E6A52F',
  reviewSoft: '#FFF5DD',

  // Active Run / streak
  activeRun: '#FF7657',
  activeRunSoft: '#FFF0EB',

  // =========================================================
  // Budget Progress States
  // Important: 90–100% should NOT make every card red.
  // =========================================================
  budgetNormal: '#6D4AE2',
  budgetNormalTrack: '#E9E3F9',

  budgetNearLimit: '#E6A52F',
  budgetNearLimitSoft: '#FFF5DD',

  budgetOver: '#E05252',
  budgetOverSoft: '#FDEEEE',

  budgetRemaining: '#18A878',

  // =========================================================
  // Interactive states
  // =========================================================
  link: '#5B3CC4',
  focus: '#7B4DFF',

  selectedBackground: '#F0EBFF',
  pressedBackground: '#E8E1F7',

  disabledBackground: '#ECE9F1',
  disabledText: '#9B96A5',

  // =========================================================
  // Misc
  // =========================================================
  shadow: '#211834',
  overlay: '#181525',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

/**
 * Height of a full-width ACTION button — the one number every primary/secondary
 * button in the app is built from.
 *
 * There were three: `GradientButton` came out ~46 (padding 14 + a 15pt line),
 * BudgetPlan's Reset ~53 (padding 16 + a 1.5pt border either side), and
 * SmsDiagnostic pinned `minHeight: 52`. A footer pair with a 7pt height
 * difference reads as a rendering fault, not as a hierarchy — and no amount of
 * matching PADDING fixes it, because a border and a different font size change
 * the total independently.
 *
 * 48, not 52: it is the standard control height, comfortably over the 44pt tap
 * minimum, and closest to what the most-used button (`GradientButton`) already
 * measured — so adopting it moves the fewest pixels.
 *
 * Applied as **`minHeight`**, never `height`: at a large OS font-scale setting a
 * fixed height clips the label. The button holds 48 and grows if it must.
 */
export const BUTTON_H = 48;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const typography = {
  display: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  h2: { fontSize: 20, fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  bodyBold: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '400' },
  tiny: { fontSize: 11, fontWeight: '500' },
};

// ─────────────────────────────────────────────────────────────────────────────
// ELEVATION LADDER — five rungs, and a rung has to be EARNED
// -----------------------------------------------------------------------------
// A shadow answers exactly one question: "how far off the page is this?" If two
// things sit at the same depth they take the same rung, and anything that isn't
// actually lifted takes no rung at all — a border or a fill says "separate
// object" far more cheaply, and spending a shadow on every block flattens the
// hierarchy instead of building one.
//
//   (none)     content IN the page — list rows, a chip inside a card, inline
//              tiles. Most surfaces live here.
//   pop        a small control marked as selected / grabbable (swatch, colour
//              dot, toggle thumb, drag grip). Tight radius, no real lift.
//   card       a card resting ON the page background.
//   elevated   a thing floating ABOVE the content — centred modals, a card
//              being dragged or swiped, a popover.
//   sheet      a panel rising from the BOTTOM edge. Casts UPWARD (negative
//              height) — a downward offset on a bottom sheet throws the shadow
//              into its own body, where it is invisible, which is why every
//              hand-rolled bottom sheet in this app had drifted to its own
//              made-up numbers.
//   fab        the ONE floating action button on a screen.
//
// THE OPACITY RULE: a high opacity is only ever paid for with COLOUR. `fab`
// gets 0.32 because it is the accent hue — it reads as light coming off the
// button. Black above ~0.12 stops reading as elevation and starts reading as
// grime. ProfileScreen's hero shipped at black 0.4 (Sep-13-26) purely because
// an `overflow:'hidden'` on the same view had been clipping it away, so the
// number was never once seen on a device.
// ─────────────────────────────────────────────────────────────────────────────
export const shadows = {
  pop: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 3,
    elevation: 2,
  },
  card: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  elevated: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  sheet: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 12,
  },
  // A bar fixed to the TOP edge, with content scrolling beneath it. The mirror
  // of `sheet`: `sheet` rises from the bottom and casts UP, `topBar` sits at the
  // top and casts DOWN — each toward the content it covers.
  //
  // Note `shadowRadius <= shadowOffset.height`. A shadow spans `offsetY ± radius`
  // vertically, so it spills ABOVE its own element by `radius - offsetY`; every
  // other rung here spills upward on purpose (that's what makes a card look
  // lifted rather than stuck down). On a top bar that spill has nowhere to go but
  // the status-bar inset, where it reads as a dirty line under the clock — which
  // is exactly what `shadows.card` on Activity's header was drawing. Keeping the
  // radius at or under the offset makes the upward spill exactly ZERO.
  topBar: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 4,
  },
  fab: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 10,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Progress surfaces — "same hue, two weights"
// -----------------------------------------------------------------------------
// Every progress indicator (bar or ring) is a TINTED track of the fill's own
// colour with the solid colour running over it. A neutral gray track reads as
// chrome and disconnects the bar from what it measures; the tint makes the
// remaining amount obviously the same thing as the spent amount.
// One alpha for all of them so bars and rings can never drift apart.
// ─────────────────────────────────────────────────────────────────────────────
// Expressed as /255 so it reproduces the original hand-written '22' suffix on the
// Category-breakdown ring EXACTLY — that ring is where this pattern came from, and
// it should look identical after being routed through the helper.
export const PROGRESS_TRACK_ALPHA = 34 / 255;

/**
 * Append an alpha channel to a hex colour. Falls back to `colors.divider` for
 * anything that can't take an 8-digit suffix (rgb()/rgba()/named colours) —
 * returning the input unchanged there would paint the track SOLID and swallow
 * the fill entirely.
 */
export const withAlpha = (color, a) => {
  if (typeof color !== 'string') return colors.divider;
  let hex = color.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex.slice(1).split('').map((c) => c + c).join('')}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return colors.divider;
  const clamped = Math.max(0, Math.min(1, Number(a) || 0));
  return hex + Math.round(clamped * 255).toString(16).padStart(2, '0');
};

/** The track colour for a given fill colour. Use this, don't re-pick an alpha. */
export const progressTrack = (color) => withAlpha(color, PROGRESS_TRACK_ALPHA);

// ─────────────────────────────────────────────────────────────────────────────
// Readable text on a TINTED surface
// -----------------------------------------------------------------------------
// A faint accent wash looks harmless and quietly breaks text. Measured on the
// feature banners' own wash: `textSecondary` lands at 4.2–4.4:1 (it is only
// 4.83:1 on plain white, so ANY tint pushes it under 4.5), and using
// `theme.primary` as text on a tint OF THAT SAME primary is far worse —
// 3.2:1 on Ocean and 1.2:1 on Carbon, i.e. invisible.
//
// So don't hand-pick colours for tinted surfaces: state the colour you want and
// let `readableOn` darken it only as far as it must.
// ─────────────────────────────────────────────────────────────────────────────

const toRgb = (color) => {
  if (typeof color !== 'string') return null;
  let hex = color.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex.slice(1).split('').map((c) => c + c).join('')}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

const toHex = (rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/**
 * Flatten `fg` at `alpha` over `bg` into a SOLID colour.
 * Use this for a tinted surface rather than an 8-digit alpha hex: a translucent
 * colour can't be measured for contrast, and a surface you can't measure is one
 * nobody checks.
 */
export const mix = (fg, alpha, bg = colors.card) => {
  const f = toRgb(fg);
  const b = toRgb(bg);
  if (!f || !b) return bg;
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  return toHex(f.map((c, i) => c * a + b[i] * (1 - a)));
};

/**
 * THE fill for every search input: a light tint of the active theme's primary,
 * flattened over `card` so it follows theme + dark-mode switches.
 */
export const SEARCH_FILL_ALPHA = 0.08;
export const searchFill = (theme) => mix(theme.primary, SEARCH_FILL_ALPHA, theme.card);

/** WCAG relative luminance, 0 (black) → 1 (white). */
export const luminance = (color) => {
  const rgb = toRgb(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio, 1 → 21. */
export const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * `color`, pushed just far enough to reach `min` contrast against `bg`.
 *
 * Returns `color` untouched when it already passes, so a colour that's fine on
 * white isn't needlessly muddied. `min` defaults to 4.5 (WCAG AA for normal
 * text); pass 3 for large text or a graphical element like an icon.
 *
 * Tries DARKENING first, then LIGHTENING. The second pass exists because
 * darkening is the wrong move on a dark surface: this returned `#000000` on any
 * background it couldn't beat, so on the dark-mode card (`#1A1D24`) the Platinum
 * and Indigo accents came back as near-black at **1.25:1** — worse than the
 * colour it was handed. Caught by the contrast suite the day the tab bar started
 * painting from the theme, which is what first routed dark mode through here.
 *
 * The darken pass is untouched, so every light-surface result is byte-identical
 * to before; only the give-up value changes, from black to something legible.
 */
export const readableOn = (bg, color, min = 4.5) => {
  if (!toRgb(color) || !toRgb(bg)) return color;
  for (let d = 0; d <= 0.9; d += 0.05) {
    const candidate = d === 0 ? color : mix(color, 1 - d, '#000000');
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  for (let l = 0.05; l <= 1; l += 0.05) {
    const candidate = mix('#FFFFFF', l, color);
    if (contrastRatio(candidate, bg) >= min) return candidate;
  }
  return contrastRatio('#FFFFFF', bg) >= contrastRatio('#000000', bg) ? '#FFFFFF' : '#000000';
};

// ─────────────────────────────────────────────────────────────────────────────
// Semantic card colours — the SHARED DEFAULT, now plumbed through the theme
// -----------------------------------------------------------------------------
// Money-in and money-out are their own meaning, like success/danger, so they
// don't derive from the accent. Two alternatives were built and reverted
// (Aug-10): both cards derived from the accent, then the originals tinted 15%
// toward it. Both measured fine; both were wrong. A colour you learn once is
// faster to read than one that shifts with a setting.
//
// THEMABLE as of Sep-21-26: `buildPalette` (`constants/themes.js`) merges
// `theme.lb || LB_BASE` into every palette, and `useLbGradients()` reads that
// merged value rather than this constant directly. No theme defines its own
// `lb` yet, so every accent still shows this exact pair — "themable, same
// colour for now" per the user's call, not a design reversal. If a theme ever
// needs its own LB pair (the way Carbon owns its canvas), give it an `lb` key
// in `THEMES` and this fallback keeps every other theme unchanged.
//
// Current hexes (Sep-21-26, brand palette's "You Lent" / "You Borrowed" cards,
// user's own pick, superseding the Sep-21-26 orange chosen earlier the same
// day to avoid the violet-brand clash):
//   lent     #16A673 → #22C55E  (emerald/green — money coming to you)
//   borrowed #FF7657 → #FF9B76  (peach/coral — money you owe)
//
// KNOWN GAP, WORSENED by this change — flagged, not fixed, since the user
// finalised these exact hexes: white text on the LIGHTEST stop
// (`borrowed[1]`, #FF9B76) is only **2.06:1**, under both the previous
// accepted floor (2.5, the old emerald's gap) and the 3:1 large-text bar the
// 26px amount relies on. Every card still renders white-on-colour, no scrim —
// if this reads as too washed out on device, the fix is either a slightly
// deeper `borrowed[1]` or routing the amount through `gradientTextPlan()`
// (unused here on purpose today, see ui-consistency §7). Bounded by a test at
// the new, lower floor so it can't get WORSE than this without a decision.
// ─────────────────────────────────────────────────────────────────────────────
// Hexes live on `colors.gradientLent*` / `gradientBorrow*` — edit them there.
export const LB_BASE = {
  lent:     [colors.gradientLentStart, colors.gradientLentEnd],       // emerald — money coming to you
  borrowed: [colors.gradientBorrowStart, colors.gradientBorrowEnd],   // peach/coral — money you owe
};

// The Home summary card's pastel treatment — built from `colors`, edit it there.
export const LB_CARD = {
  lent: {
    background: [colors.lentCardStart, colors.lentCardEnd],
    text: colors.lentCardText,     // title + subtitle
    amount: colors.lent,
  },
  borrowed: {
    background: [colors.borrowCardStart, colors.borrowCardEnd],
    text: colors.borrowCardText,
    amount: colors.borrowed,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Chrome for a header that turns LIGHT when it pins to the top
// -----------------------------------------------------------------------------
// A collapsing header is a gradient while it is tall and a plain light strip once
// it pins — so every colour in its bar has TWO values, and the pinned pair has to
// be derived, not picked. White text, a `#FFFFFF14` chip fill and a white-or-dark
// badge are all chosen against a saturated gradient; drop them onto `card` and
// the text is white-on-white and the chips vanish entirely.
//
// One helper owns the pinned end so the two collapsing headers can't disagree,
// and so it can be measured headlessly on every accent (and on the dark-mode
// neutrals, where `readableOn` flips the ink rather than returning black).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Translucent white at alpha `a` reads far softer on a saturated gradient than
 * the same alpha of near-black does on white, so carrying the alpha across
 * unchanged makes every chip jump heavier as the header lightens. Measured on
 * Ocean's mid stop: white at 0.18 is ~1.35:1 against it, near-black at 0.18 on
 * `card` is ~1.54:1; scaled by 0.6 it lands at ~1.27:1 — the closest match, and
 * the direction that errs quiet rather than heavy.
 */
export const PINNED_FILL_SCALE = 0.6;

/**
 * Separator between a pinned chrome surface and the content scrolling past it.
 *
 * Shared by the bottom of the pinned header and the top of the tab bar: both are
 * `card`-coloured strips with `card`-coloured cards passing under them, so the
 * elevation shadow alone is not a boundary. Derived from the ink rather than
 * taken from `divider` — `divider` is tuned to separate rows INSIDE a card.
 */
export const CHROME_HAIRLINE_ALPHA = 0.1;
export const chromeHairline = (surface, palette = colors) =>
  mix(palette.textPrimary, CHROME_HAIRLINE_ALPHA, surface);

/**
 * Every colour a collapsing header's bar needs once it has gone light.
 *
 * @param {string} surface the colour the header fades to (normally `theme.card`)
 * @param {object} palette anything carrying `textPrimary` / `textSecondary`
 * @returns {{surface: string, ink: string, inkMuted: string, hairline: string,
 *           fill: (alpha: number) => string, badgeFill: string, badgeInk: string}}
 */
export const pinnedHeaderChrome = (surface, palette = colors) => {
  const ink      = readableOn(surface, palette.textPrimary);
  const inkMuted = readableOn(surface, palette.textSecondary);
  return {
    surface,
    ink,
    inkMuted,
    hairline: chromeHairline(surface, palette),
    /** The pinned twin of `withAlpha('#FFFFFF', alpha)` on the gradient. */
    fill: (alpha) => withAlpha(ink, alpha * PINNED_FILL_SCALE),
    // A badge is opaque, so it can't tint its way to legibility like the chips:
    // it inverts instead — ink-on-surface becomes surface-on-ink.
    badgeFill: ink,
    badgeInk:  surface,
  };
};

/**
 * Fill + ink for a small opaque BADGE sitting on a themed gradient.
 *
 * A badge is a graphical element (3:1 bar), and no single flat colour clears it
 * on every accent — measured against each theme's full `gradientStops`, white
 * bottoms out at 2.55:1 on Sunset and near-black at 1.03:1 on Platinum. The level
 * badge was a hardcoded violet `#7C3AED`, which is the worst of the three at
 * **1.02:1 on Platinum** — a badge you simply cannot see.
 *
 * So pick per theme: whichever of white / near-black has the better WORST case
 * against the stops, with the opposite colour as its text. That lifts the worst
 * case across all five accents to 3.68:1, clearing the bar.
 *
 * @param {string[]} stops the active theme's gradientStops
 * @returns {{ fill: string, ink: string, ratio: number }}
 */
export const badgeOnGradient = (stops) => {
  const list = Array.isArray(stops) && stops.length ? stops : ['#000000'];
  const worstAgainst = (c) => Math.min(...list.map((s) => contrastRatio(c, s)));
  const white = worstAgainst('#FFFFFF');
  const dark  = worstAgainst(colors.textPrimary);
  return white >= dark
    ? { fill: '#FFFFFF', ink: colors.textPrimary, ratio: white }
    : { fill: colors.textPrimary, ink: '#FFFFFF', ratio: dark };
};

/**
 * How to put text on a GRADIENT: `{ ink, scrim }`.
 *
 * A single ink judged against one end doesn't work — the stops span a range, so
 * dark ink that reads well on the light end fails on the dark end (black on
 * Ocean's #1E40AF is 2.4:1). This picks whichever of white / near-black gives
 * the better WORST-CASE across every stop, then adds the smallest scrim that
 * clears `min`. Most themes need no scrim at all.
 *
 * `scrim` is an alpha for a flat overlay between the gradient and the text,
 * black under white ink and white under dark ink.
 *
 * Hardcoding white — which the Lent/Borrowed cards did — is 1.4:1 on the Gold
 * accent and 2.5:1 on Sunset.
 */
export const gradientTextPlan = (stops, min = 4.5, prefer = null) => {
  const list = Array.isArray(stops) && stops.length ? stops : ['#000000'];
  // `prefer` pins the ink and lets the scrim do the work — used where flipping
  // to dark text would break a deliberate look (the vibrant Lent/Borrowed cards
  // are white-on-colour by design; one theme silently flipping to dark ink
  // would read as a bug, not a feature).
  const inks = prefer ? [prefer] : ['#FFFFFF', colors.textPrimary];
  for (const scrim of [0, 0.08, 0.12, 0.16, 0.2, 0.26, 0.32, 0.4, 0.5]) {
    for (const ink of inks) {
      const towards = ink === '#FFFFFF' ? '#000000' : '#FFFFFF';
      const effective = list.map((c) => (scrim === 0 ? c : mix(c, 1 - scrim, towards)));
      const worst = Math.min(...effective.map((c) => contrastRatio(ink, c)));
      if (worst >= min) return { ink, scrim, scrimColor: towards, ratio: worst };
    }
  }
  // Nothing cleared the bar — fall back to the strongest option rather than
  // silently returning something unreadable.
  return { ink: '#FFFFFF', scrim: 0.52, scrimColor: '#000000', ratio: 0 };
};

export default { colors, spacing, radius, typography, shadows };
