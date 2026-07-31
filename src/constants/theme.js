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

export default { colors, spacing, radius, typography, shadows };
