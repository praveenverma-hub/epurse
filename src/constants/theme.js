// Premium Swiggy-inspired theme
export const colors = {
  // Primary palette (Swiggy-style warm orange)
  primary: '#FF5A1F',
  primaryDark: '#E64A0F',
  primaryLight: '#FF7E45',

  // Accent gradients
  gradientStart: '#FF5A1F',
  gradientEnd: '#FC8019',
  gradientBlueStart: '#1E40AF',
  gradientBlueEnd: '#3B82F6',
  gradientGreenStart: '#059669',
  gradientGreenEnd: '#10B981',

  // Surfaces
  background: '#F4F5F7',
  card: '#FFFFFF',
  cardAlt: '#FAFAFB',
  divider: '#EAECEE',
  // Border for OUTLINED form controls (inputs, select rows, chips). Deliberately
  // darker than `divider`: divider is tuned to separate rows inside a filled card,
  // and at that lightness an unfilled control has no visible edge at all.
  inputBorder: '#D7DADE',

  // Text
  textPrimary: '#1C1C1E',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textOnGradient: '#FFFFFF',

  // Status
  success: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',

  // Misc
  shadow: '#000000',
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

export const shadows = {
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
// 3.1:1 on Ocean and 1.3:1 on Gold, i.e. invisible.
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
// Semantic card colours — FIXED, not part of the theme
// -----------------------------------------------------------------------------
// Money-in and money-out are their own meaning, like success/danger, so they get
// their own constant colours rather than the accent. Two alternatives were built
// and reverted (Aug-10): both cards derived from the accent, then the originals
// tinted 15% toward it. Both measured fine; both were wrong. A colour you learn
// once is faster to read than one that shifts with a setting, and the originals
// are simply the more restful pair.
//
// KNOWN GAP, deliberately accepted: white on the light end of the emerald is
// 2.54:1, under the 4.5:1 minimum for the small helper line. Every fix — a
// darker green, dark ink, a scrim — was tried and each loses the look this is
// keeping. The 26px amount is large text and clears its 3:1 bar. Bounded by a
// test so it can't quietly get worse; see ui-consistency §7.
// ─────────────────────────────────────────────────────────────────────────────
export const LB_BASE = {
  lent:     ['#059669', '#10B981'],   // emerald — money coming to you
  borrowed: ['#6D28D9', '#8B5CF6'],   // violet  — money you owe
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
 * bottoms out at 1.41:1 on Amber and near-black at 1.03:1 on Platinum. The level
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
