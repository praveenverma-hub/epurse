// =============================================================================
// AppBrandFooter — Swiggy-style branded footer wordmark.
//
// A gray band (bracketed by a top + bottom hairline) with the app name rendered
// as big, bold, OUTLINED text. The outline is stroked in the user's active theme
// accent, so the brand mark is "personalised" to whatever theme they picked.
// Sits at the very bottom of a scroll (currently the Home/Dashboard screen).
//
// True outlined letters need an SVG <Text stroke fill="none"> — RN's <Text> has
// no text-stroke. react-native-svg is already a project dependency.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, StyleSheet, Dimensions, type LayoutChangeEvent } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';

import { useTheme } from '../hooks/useTheme';
import { colors, spacing } from '../constants/theme';

const SCREEN_W = Dimensions.get('window').width;
const MARK_H = 60;

interface AppBrandFooterProps {
  /** Text of the wordmark. Defaults to the app name. */
  name?: string;
  /** Motto / tagline shown under the wordmark. Pass '' to hide it. */
  tagline?: string;
}

const AppBrandFooter: React.FC<AppBrandFooterProps> = ({
  name = 'ePurse',
  tagline = 'Financial clarity pays off.',
}) => {
  // primaryDark reads better than primary as a thin outline (esp. the amber theme).
  const { primaryDark } = useTheme();
  // Size the SVG to the actual band width so the left-anchored wordmark can't
  // overflow the footer (decoupled from whatever horizontal padding the host uses).
  const [markW, setMarkW] = useState<number>(SCREEN_W - spacing.lg * 2);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - markW) > 1) setMarkW(w);
  };
  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Svg width={markW} height={MARK_H}>
        <SvgText
          x={2}
          y={MARK_H * 0.74}
          fontSize={44}
          fontWeight="900"
          letterSpacing={1.5}
          textAnchor="start"
          fill="none"
          stroke={primaryDark}
          strokeWidth={1.4}
        >
          {name}
        </SvgText>
      </Svg>
      {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
    </View>
  );
};

export default AppBrandFooter;

const styles = StyleSheet.create({
  wrap: {
    marginTop:         spacing.xl,
    paddingVertical:   spacing.lg,
    alignItems:        'flex-start',
    justifyContent:    'center',
    backgroundColor:   '#EBEEF2',
    borderTopWidth:    1,
    borderBottomWidth: 1,
    borderColor:       colors.divider,
  },
  tagline: {
    marginTop:     -6,
    marginLeft:    3,
    color:         colors.textMuted,
    fontSize:      12,
    fontWeight:    '600',
    letterSpacing: 0.3,
    textAlign:     'left',
  },
});
