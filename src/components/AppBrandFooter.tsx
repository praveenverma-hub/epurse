// =============================================================================
// AppBrandFooter — full-bleed branded footer at the very bottom of a screen.
//
// A gray band (bracketed by a top + bottom hairline) spanning the FULL width,
// with the app name as a big, bold, solid wordmark in the active theme accent,
// and the motto beneath it. Left-aligned to the app's content gutter.
//
// The band breaks out of the host's horizontal padding (marginHorizontal
// −gutter) so it runs edge-to-edge, and carries no outer margins.
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { colors, spacing } from '../constants/theme';

// Host content padding this footer breaks out of (Dashboard bodyContent = spacing.lg).
const GUTTER = spacing.lg;

interface AppBrandFooterProps {
  /** The wordmark text. */
  name?: string;
  /** Motto shown under the wordmark. Pass '' to hide it. */
  tagline?: string;
}

const AppBrandFooter: React.FC<AppBrandFooterProps> = ({
  name = 'ePurse',
  tagline = 'Financial clarity pays off.',
}) => {
  const { primaryDark } = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.name, { color: primaryDark }]}>{name}</Text>
      {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
    </View>
  );
};

export default AppBrandFooter;

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal:  -GUTTER,
    paddingVertical:   spacing.xl,
    paddingLeft:       GUTTER,
    paddingBottom:     spacing.xl * 3, // absorb safe-area / nav bar space
    backgroundColor:   '#EBEEF2',
    borderTopWidth:    1,
    borderColor:       colors.divider,
    alignItems:        'flex-start',
    marginTop:         'auto',         // push to bottom when ScrollView has flexGrow:1
  },
  name: {
    fontSize:      42,
    fontWeight:    '900',
    letterSpacing: -1,
  },
  tagline: {
    marginTop:     2,
    color:         colors.textMuted,
    fontSize:      12,
    fontWeight:    '600',
    letterSpacing: 0.3,
  },
});
