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

export const useTheme = () => {
  const themeId  = useEPurseStore((s) => s.themeId);
  const darkMode = useEPurseStore((s) => s.darkMode);
  return useMemo(() => buildPalette(themeId, darkMode), [themeId, darkMode]);
};

/**
 * Convenience selector returning just the gradient pair as an array, since
 * <LinearGradient colors={[start, end]} ... /> is the most frequent use-case.
 */
export const useGradient = () => {
  const { gradientStart, gradientEnd } = useTheme();
  return [gradientStart, gradientEnd];
};
