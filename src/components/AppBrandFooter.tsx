// =============================================================================
// AppBrandFooter — full-bleed branded footer at the very bottom of a screen.
//
// A band spanning the FULL width, with the app name as a big, bold wordmark in
// the active theme accent and the motto beneath it. Left-aligned to the app's
// content gutter. The band breaks out of the host's horizontal padding
// (marginHorizontal −gutter) so it runs edge-to-edge, and carries no outer
// margins.
//
// THE BAND IS AN ACCENT WASH, and every ink on it is derived from it. It used to
// be a flat `#EBEEF2` grey described as "bracketed by a top + bottom hairline" —
// but that band measured **1.07:1** against the page background and its hairline
// 1.02:1 against the band, so neither existed to the eye. A flat grey can only
// ever be right for one accent anyway.
//
// The wash alone is NOT enough, which measuring is the only way to know: at 10%
// the band is hue-distinct but barely luminance-distinct, and on Gold it lands at
// 1.03:1 — flatter than the grey it replaced. So the boundary is carried by a
// hairline DERIVED to a floor (≥1.98:1 worst case, vs 1.02:1 before) while the
// wash carries the identity. Wash for whose app this is, hairline for where it
// starts.
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { colors, mix, readableOn, spacing } from '../constants/theme';

// Host content padding this footer breaks out of (Dashboard bodyContent = spacing.lg).
const GUTTER = spacing.lg;

/**
 * How much accent goes into the band.
 *
 * 10% is deliberately below the ~22% where a wash's luminance EQUALS
 * `colors.background` exactly and the surface starts reading as transparent
 * (ui-consistency §7). Raising it does not solve the visibility problem — the
 * hairline does — it only tints the page.
 */
const BAND_TINT = 0.1;

/**
 * Contrast floor for the band's top edge. Not a WCAG bar (a decorative divider
 * has none); it's the "actually visible on every accent" floor, and the reason
 * this is a `readableOn` call rather than a second tint: a fixed alpha bottoms
 * out at 1.11:1 on Gold, whose accent is nearly the page's own luminance.
 */
const EDGE_MIN = 1.8;

interface AppBrandFooterProps {
  /** The wordmark text. */
  name?: string;
  /** Motto shown under the wordmark. Pass '' to hide it. */
  tagline?: string;
  /**
   * Space below the band, for whatever chrome overlays the bottom of the host
   * screen — on a tab screen, `tabBarClearance(insets.bottom)`.
   *
   * This used to be a hardcoded `spacing.xl * 3` (96) in here, commented
   * "absorb safe-area / nav bar space" — which quietly made this component the
   * ONLY thing keeping Dashboard's last row off the tab bar (its own
   * TAB_BAR_HEIGHT spacer is commented out). Reusing or removing the footer
   * would have broken Home with no visible connection to the cause. It's a
   * prop so the host owns its own clearance.
   *
   * It has to stay the BAND's own padding, too: space after a full-bleed band
   * would lift it off the screen's bottom edge.
   */
  bottomClearance?: number;
}

const AppBrandFooter: React.FC<AppBrandFooterProps> = ({
  name = 'ePurse',
  tagline = 'Financial clarity pays off.',
  bottomClearance = spacing.xl * 3,
}) => {
  const { primary, primaryDark, background } = useTheme();

  const ink = React.useMemo(() => {
    const band = mix(primary, BAND_TINT, background);
    return {
      band,
      edge: readableOn(band, primary, EDGE_MIN),
      // 42px/900 is LARGE text, so the wordmark takes the 3:1 bar, not 4.5.
      // Gold's `primaryDark` is 1.69:1 on the band raw — the only accent that
      // fails, and the reason this is derived rather than passed straight through.
      name: readableOn(band, primaryDark, 3),
      // `textMuted` (the old value) measures 2.18:1 here — well under AA at 12px.
      tagline: readableOn(band, colors.textSecondary),
    };
  }, [primary, primaryDark, background]);

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: ink.band, borderTopColor: ink.edge, paddingBottom: bottomClearance },
      ]}
    >
      <Text style={[styles.name, { color: ink.name }]}>{name}</Text>
      {tagline ? <Text style={[styles.tagline, { color: ink.tagline }]}>{tagline}</Text> : null}
    </View>
  );
};

export default AppBrandFooter;

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: -GUTTER,
    paddingVertical:  spacing.xl,
    paddingLeft:      GUTTER,
    // paddingBottom + colours come from the component — they depend on the theme
    // and on the host's clearance, neither of which a static style can see.
    borderTopWidth:   1,
    alignItems:       'flex-start',
    marginTop:        20,         // push to bottom when ScrollView has flexGrow:1
  },
  name: {
    fontSize:      42,
    fontWeight:    '900',
    letterSpacing: -1,
  },
  tagline: {
    marginTop:     2,
    fontSize:      12,
    fontWeight:    '600',
    letterSpacing: 0.3,
  },
});
