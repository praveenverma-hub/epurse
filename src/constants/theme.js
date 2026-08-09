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
  gradientPurpleStart: '#6D28D9',
  gradientPurpleEnd: '#8B5CF6',

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

export default { colors, spacing, radius, typography, shadows };
