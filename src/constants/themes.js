// =============================================================================
// Themes — primary palette options + neutrals for light/dark.
// -----------------------------------------------------------------------------
// User can pick one of four accent themes (orange, blue, amber, sky). The
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
  sky: {
    id: 'sky',
    label: 'Sky',
    swatch: '#0EA5E9',
    primary: '#0EA5E9',
    primaryDark: '#0284C7',
    primaryLight: '#38BDF8',
    gradientStart: '#0284C7',
    gradientEnd: '#38BDF8',
  },
};

export const DEFAULT_THEME_ID = 'orange';

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
  // Kept for LentBorrowed screens — independent of theme.
  gradientGreenStart: '#059669',
  gradientGreenEnd: '#10B981',
  gradientPurpleStart: '#6D28D9',
  gradientPurpleEnd: '#8B5CF6',
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
    darkMode,
  };
};
