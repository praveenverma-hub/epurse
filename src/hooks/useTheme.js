// =============================================================================
// useTheme — returns the active palette (primary + neutrals + status colors).
// -----------------------------------------------------------------------------
// Reads themeId + darkMode from the Zustand store; rebuilds palette on change.
// Use this inside components that need theme-aware colours (gradients,
// primary accents). For static neutrals like spacing/radius/typography,
// keep importing from constants/theme.js — those are theme-agnostic.
// =============================================================================

import { useMemo } from 'react';
import { useEPurseStore } from '../store/ePurseStore';
import { buildPalette } from '../constants/themes';
import { LB_BASE } from '../constants/theme';

export const useTheme = () => {
  const themeId  = useEPurseStore((s) => s.themeId);
  const darkMode = useEPurseStore((s) => s.darkMode);
  return useMemo(() => buildPalette(themeId, darkMode), [themeId, darkMode]);
};

/**
 * The active theme's gradient stops, ready for <LinearGradient colors={...} />.
 *
 * Returns `gradientStops`, which is USUALLY the [start, end] pair but is a
 * five-stop metallic ramp for Platinum. Always call this rather than reading
 * `gradientStart`/`gradientEnd` yourself — a hand-built pair silently drops the
 * extra stops and that theme renders flat on your screen only.
 */
export const useGradient = () => useTheme().gradientStops;

/**
 * The Lent / Borrowed gradient pair — the app's original emerald and violet,
 * FIXED, not theme-derived.
 *
 * Tried and reverted (Aug-10): making them the accent, and then tinting them 15%
 * toward it. Both were measurably fine and both looked wrong — the user's call
 * was that the originals are the more soothing pair, and money-in vs money-out
 * reads faster as two constant colours you learn once than as two that drift
 * with the accent. Treat these as semantic, like success/danger: NOT part of the
 * theme (ui-consistency §7).
 *
 * Still a hook, and still the single source, because the same pair was
 * hard-coded in three files — the Dashboard widget, LentBorrowedScreen's header
 * and LbPersonScreen's submit button — which is how they drift apart.
 */
export const useLbGradients = () => LB_BASE;
