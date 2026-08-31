// =============================================================================
// Themes — primary palette options + neutrals for light/dark.
// -----------------------------------------------------------------------------
// User can pick one of five accent themes (orange, blue, carbon, indigo,
// platinum — the neutral one);
// the default is `blue` ("Ocean") — see DEFAULT_THEME_ID below. The
// `primary` / `gradient*` keys swap to match the choice; neutrals come from
// LIGHT_NEUTRALS or DARK_NEUTRALS based on `darkMode` flag.
//
// To add a new theme, add an entry to THEMES below and the picker UI
// will pick it up automatically (themesService scans Object.values).
// =============================================================================

import { STATIC_CONFIG } from '../config/staticConfig';

/**
 * Whether a theme is allowed to bring its own canvas (see staticConfig). Read
 * once at module load, like every other static switch — it is a build-time
 * decision, not a user setting.
 */
const CANVAS_THEMES_ENABLED = STATIC_CONFIG.theme.canvasThemes;


/**
 * Carbon's canvas — deep slate, the other half of the pair the accent is named
 * for. A theme normally takes LIGHT_NEUTRALS or DARK_NEUTRALS depending on the
 * `darkMode` flag; Carbon brings its own, because the slate is not "dark mode
 * applied to Carbon", it IS Carbon.
 *
 * Built as a ramp off #0F172A (the given base) rather than reusing
 * DARK_NEUTRALS' neutral greys, which would grey out the very hue the theme is
 * for. Every step keeps the same JOB it has in the light palette: `card` lifts
 * off `background` by about the same amount, `divider` separates rows inside a
 * card, `inputBorder` is darker still so an unfilled control has an edge.
 *
 * Measured against the light palette it mirrors — it is not a downgrade
 * anywhere, and is better in the two places light has always been weak:
 *
 *   textSecondary on card   7.17:1   (light 4.83)
 *   textPrimary  on card  13.51:1   (light 17.01)
 *   textMuted    on card   4.30:1   (light 2.54 — a long-standing accepted gap)
 *   divider      on card   1.358    (light 1.184)
 *   card         on bg     1.120    (light 1.091)
 *   mint accent  on card  12.21:1   (the accent on white is 1.31)
 *
 * The status colours also gain: success 6.28, danger 4.24, warning 7.42,
 * info 4.33 — against 2.54 / 3.76 / 2.15 / 3.68 on white.
 */
export const CARBON_NEUTRALS = {
  background: '#0F172A',
  card: '#182234',
  cardAlt: '#1F2B40',
  divider: '#2A3853',
  // Lighter than `divider`, not equal to it. The first cut set both to #2A3853
  // and a test caught it: an unfilled input would have had exactly as much edge
  // as a row separator inside a card, which is the distinction this key exists
  // to make (1.79 vs 1.36 on the card; the light palette runs 1.40 vs 1.18).
  inputBorder: '#3A4A69',
  textPrimary: '#E6EDF5',
  textSecondary: '#9BB0C9',
  // 5.03:1 — deliberately ABOVE AA. On white, `textMuted` is 2.54:1, a gap the
  // app has carried for a long time because the alternatives all lose the look.
  // A new canvas is the one chance to not inherit it, and on slate the quiet
  // grey can clear the bar and still read as the quietest of the three.
  textMuted: '#7A93AF',
  textOnGradient: '#FFFFFF',
  shadow: '#000000',
};

export const THEMES = {
  orange: {
    id: 'orange',
    label: 'Sunset',
    swatch: '#FF5A1F',
    primary: '#FF5A1F',
    primaryDark: '#E64A0F',
    primaryLight: '#FF7E45',
    gradientStart: '#FF5A1F',
    gradientEnd: '#FC8019',
  },
  blue: {
    id: 'blue',
    label: 'Ocean',
    swatch: '#3B82F6',
    primary: '#3B82F6',
    primaryDark: '#2563EB',
    primaryLight: '#60A5FA',
    gradientStart: '#1E40AF',
    gradientEnd: '#3B82F6',
  },
  /**
   * Carbon — deep slate base, carbon-mint accent. Replaced 'amber' ("Gold",
   * #FFD600) on Aug-31; store migration v26 moves anyone who had Gold onto this,
   * since it took that slot.
   *
   * THE GRADIENT DOES NOT END ON THE MINT, and can't. White is the header ink on
   * every theme, and pure #00FFC2 holds it at **1.31:1** — the header title,
   * greeting and chips would all be illegible. The end stop is the same mint
   * mixed 40% over the slate (#097467), which holds white at 5.67:1, comparable
   * to Platinum's brightest stop (5.8:1). Push it brighter and the header — the
   * largest painted surface in the app — is the first thing to fail.
   *
   * The pure mint is the ACCENT (`primary`): buttons, chips, active states,
   * progress fills, and every `readableOn`-derived ink. That is where a colour
   * this bright belongs — small, on a surface, with its ink measured.
   * It is no lighter a starting point than the Gold it replaces (1.41:1).
   *
   * CARBON OWNS ITS CANVAS (Aug-31). Every other accent is orthogonal to the
   * `darkMode` flag — Platinum's doc says as much, "Platinum + darkMode is the
   * fully-blacked-out combination". Carbon is not: the slate IS the theme, so it
   * carries `alwaysDark` + its own `neutrals`, and picking it means picking a
   * dark app. That's the point of the pair — a bright mint needs a dark ground
   * to be an accent rather than a glare.
   */
  carbon: {
    id: 'carbon',
    label: 'Carbon',
    swatch: '#00FFC2',
    primary: '#00FFC2',
    primaryDark: '#00C79A',
    primaryLight: '#7FFFE0',
    gradientStart: '#0F172A',
    gradientEnd: '#097467',
    alwaysDark: true,
    neutrals: CARBON_NEUTRALS,
  },
  /**
   * Platinum — the one NEUTRAL accent. Near-black graphite with a silver-grey
   * light tone, for people who don't want a coloured app.
   *
   * Deliberately not a fifth hue: it's dark enough (11.8:1 on white) that every
   * surface derived from it — the banner washes, tinted chips, `readableOn`
   * inks — comes out as a calm grey rather than a colour, which is the whole
   * point. Verified against the contrast suite like the rest.
   *
   * NOTE this is an ACCENT, not the app's dark mode: that's the separate
   * `darkMode` flag, which swaps LIGHT_NEUTRALS → DARK_NEUTRALS. Platinum +
   * darkMode is the fully-blacked-out combination.
   */
  platinum: {
    id: 'platinum',
    label: 'Platinum',
    swatch: '#33383F',
    primary: '#33383F',
    primaryDark: '#1C2027',
    primaryLight: '#6E7681',
    gradientStart: '#14171C',
    gradientEnd: '#3D444E',
    /**
     * Metallic ramp. A two-stop dark→dark gradient reads as matte charcoal, not
     * as metal: shine is a bright BAND with dark either side, so the eye reads a
     * specular highlight rather than a flat wash. Roughly 2.5x the luminance
     * span of the flat pair (0.006→0.131 vs 0.008→0.057).
     *
     * The highlight sits at 75% along the diagonal — the LOWER-RIGHT CORNER, not
     * the middle. A centred band looks like a seam across the header rather than
     * light catching an edge, and it put the brightest point directly behind the
     * greeting. Cornered, the top-left where that text sits is now the DARKEST
     * stop (18.9:1 for white) and the glint falls in empty space.
     *
     * Capped at #5C6675, which still holds white text at 5.8:1 — brighter starts
     * to fail the header, the one place this gradient is largest.
     *
     * Only this theme sets it; `buildPalette` falls back to [start, end] for
     * the rest, and everything reads `gradientStops`, never the pair.
     */
    gradientStops: ['#0E1116', '#151A21', '#242B34', '#5C6675', '#20262E'],
  },
  // 'sky' was removed Aug-26 (too close to 'blue', which is now the default).
  // Anyone still holding `themeId: 'sky'` is remapped by store migration v24 —
  // `buildPalette` would fall back for the COLOURS, but the picker reads
  // `Object.values(THEMES)` and would have shown no swatch selected.
  indigo: {
    id: 'indigo',
    label: 'Indigo',
    swatch: '#6366F1',
    primary: '#6366F1',
    primaryDark: '#4F46E5',
    primaryLight: '#818CF8',
    gradientStart: '#4F46E5',
    gradientEnd: '#6366F1',
  },
};

/**
 * Ocean blue (Aug-26, user's call — was 'orange').
 *
 * This only affects a FRESH install and anyone who has never touched the theme
 * picker: `themeId` is persisted, so an existing user keeps whatever they chose.
 * That's deliberate — silently repainting someone's app is worse than an
 * inconsistent default. It's also what `migrate`'s `state.themeId ?? DEFAULT`
 * fallback means: absent, not "reset me".
 */
export const DEFAULT_THEME_ID = 'blue';

// ----- Neutrals (light) -----------------------------------------------------
export const LIGHT_NEUTRALS = {
  background: '#F4F5F7',
  card: '#FFFFFF',
  cardAlt: '#FAFAFB',
  divider: '#EAECEE',
  // Border for OUTLINED controls — deliberately darker than `divider`, which is
  // tuned to separate rows INSIDE a filled card and leaves an unfilled control
  // with no visible edge. Mirrors `colors.inputBorder`; it lives here too so
  // `theme.*` is a SUPERSET of the static palette, which is what lets a screen
  // be migrated off `colors` by renaming the object and nothing else.
  inputBorder: '#D7DADE',
  textPrimary: '#1C1C1E',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textOnGradient: '#FFFFFF',
  shadow: '#000000',
};

// ----- Neutrals (dark) ------------------------------------------------------
export const DARK_NEUTRALS = {
  background: '#0F1115',
  card: '#1A1D24',
  cardAlt: '#22252C',
  divider: '#2A2D34',
  inputBorder: '#3A3E47',
  textPrimary: '#F4F5F7',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textOnGradient: '#FFFFFF',
  shadow: '#000000',
};

// ----- Status colors (theme-agnostic) ---------------------------------------
export const STATUS_COLORS = {
  success: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
  // Bank-brand gradient (AccountDetailsScreen tints a card by issuer).
  // NOT the Lent/Borrowed pair any more — that derives from the theme via
  // useLbGradients; the purple half of the old pair is gone with it.
  gradientGreenStart: '#059669',
  gradientGreenEnd: '#10B981',
  gradientBlueStart: '#1E40AF',
  gradientBlueEnd: '#3B82F6',
};

// ----- Build a full palette from themeId + darkMode -------------------------
export const buildPalette = (themeId = DEFAULT_THEME_ID, darkMode = false) => {
  const theme = THEMES[themeId] || THEMES[DEFAULT_THEME_ID];

  // A theme may OWN ITS CANVAS. `alwaysDark` forces the dark neutrals whatever
  // the user's `darkMode` flag says, and `neutrals` overrides individual keys on
  // top — so an accent that only makes sense on one ground (Carbon's mint) can
  // carry that ground with it instead of depending on a separate switch.
  //
  // Order matters: base neutrals, then the theme's overrides. A theme supplying
  // a PARTIAL set still gets a complete palette, so adding one key later can't
  // leave a screen with `undefined` for a colour.
  //
  // `darkMode` in the returned palette is the EFFECTIVE value, not the flag —
  // everything that branches on it (status-bar glyphs, decorative gradients,
  // the reward palette's light/dark pairs) has to follow the canvas actually
  // being painted, not the setting.
  const effectiveDark = !!darkMode || (CANVAS_THEMES_ENABLED && !!theme.alwaysDark);
  const base = effectiveDark ? DARK_NEUTRALS : LIGHT_NEUTRALS;
  const neutrals = CANVAS_THEMES_ENABLED && theme.neutrals
    ? { ...base, ...theme.neutrals }
    : base;

  return {
    ...theme,
    ...neutrals,
    ...STATUS_COLORS,
    // Every gradient consumer reads `gradientStops`, so a theme can be a simple
    // pair OR a multi-stop ramp without any call site knowing the difference.
    gradientStops: theme.gradientStops || [theme.gradientStart, theme.gradientEnd],
    darkMode: effectiveDark,
  };
};
