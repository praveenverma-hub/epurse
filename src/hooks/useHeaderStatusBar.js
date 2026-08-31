// =============================================================================
// useHeaderStatusBar — glyph colour for a screen whose header turns light.
//
// A collapsing header covers the status-bar inset too, so when it cross-fades
// from gradient to `card` the clock and battery go from sitting on a saturated
// band to sitting on white. `light-content` there is invisible.
//
// IMPERATIVE and FOCUS-GATED, both deliberately. A declarative <StatusBar> stays
// MOUNTED in a tab navigator after you switch away, so its style leaks onto the
// next tab — which is why AccountsScreen already drove this by hand. Dashboard
// used the declarative form and got away with it only because 'light-content'
// happened to suit every other tab; the moment it can also say 'dark-content',
// the leak becomes visible. So both screens go through this one hook.
//
// The style is MEASURED, not assumed: it asks which of white/black reads better
// on the surface, so the dark-mode neutrals (where a pinned header is near-black
// and the glyphs must stay light) come out right without a second branch.
// =============================================================================
import { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { contrastRatio } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';

/**
 * @param {boolean} collapsed true once the header has gone light — the flag
 *   `CollapsingHeaderScreen` reports through `onCollapseChange`.
 * @param {string} [surface] the pinned surface, if the screen overrode
 *   `collapsedSurface`. Defaults to the same `theme.card` the component does.
 */
export const useHeaderStatusBar = (collapsed, surface) => {
  const theme = useTheme();
  const isFocused = useIsFocused();
  const pinned = surface ?? theme.card;

  useEffect(() => {
    if (!isFocused) return;
    // Expanded, the header is a gradient chosen to carry white; pinned, ask.
    const style = !collapsed || contrastRatio('#FFFFFF', pinned) >= contrastRatio('#000000', pinned)
      ? 'light-content'
      : 'dark-content';
    StatusBar.setBarStyle(style);
    if (Platform.OS === 'android') StatusBar.setBackgroundColor?.('transparent');
  }, [isFocused, collapsed, pinned]);
};

export default useHeaderStatusBar;
