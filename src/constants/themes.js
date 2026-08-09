// =============================================================================
// Themes — primary palette options + neutrals for light/dark.
// -----------------------------------------------------------------------------
// User can pick one of five accent themes (orange, blue, amber, indigo,
// platinum — the neutral one);
// the default is `blue` ("Ocean") — see DEFAULT_THEME_ID below. The
// `primary` / `gradient*` keys swap to match the choice; neutrals come from
// LIGHT_NEUTRALS or DARK_NEUTRALS based on `darkMode` flag.
//
// To add a new theme, add an entry to THEMES below and the picker UI
// will pick it up automatically (themesService scans Object.values).
// =============================================================================

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
  amber: {
    id: 'amber',
    label: 'Gold',
    swatch: '#FFD600',
    primary: '#FFD600',
    primaryDark: '#F9A825',
    primaryLight: '#FFF9C4',
    gradientStart: '#FF8F00',
    gradientEnd: '#FFD600',
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
  const neutrals = darkMode ? DARK_NEUTRALS : LIGHT_NEUTRALS;
  return {
    ...theme,
    ...neutrals,
    ...STATUS_COLORS,
    // Every gradient consumer reads `gradientStops`, so a theme can be a simple
    // pair OR a multi-stop ramp without any call site knowing the difference.
    gradientStops: theme.gradientStops || [theme.gradientStart, theme.gradientEnd],
    darkMode,
  };
};
