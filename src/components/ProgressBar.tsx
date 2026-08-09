// =============================================================================
// ProgressBar — the ONE horizontal progress indicator.
//
// "Same hue, two weights": the track is a tinted version of the fill's own
// colour, with the solid colour running over it. This started as the Category
// breakdown ring (`category.color + '22'` under `category.color`) and is now the
// app-wide treatment — a neutral gray track reads as chrome and disconnects the
// bar from the thing it measures.
//
// Don't hand-roll a track/fill pair again: import this, or if you need an
// ANIMATED fill (reanimated `useAnimatedStyle`), keep your own fill view but take
// the track colour from `progressTrack(color)` so the pairing stays consistent.
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { progressTrack } from '../constants/theme';

type Props = {
  /** 0..1. Values outside the range are clamped, so callers can pass raw ratios. */
  progress: number;
  /** The fill colour. The track is derived from it — don't pass a track too. */
  color: string;
  height?: number;
  /** Escape hatch for a bar that must sit on a bespoke surface. Rarely right. */
  trackColor?: string;
  /** Layout only (flex, margins). Colour belongs to `color`. */
  style?: StyleProp<ViewStyle>;
};

const ProgressBar = ({ progress, color, height = 7, trackColor, style }: Props) => {
  const pct = Math.max(0, Math.min(1, Number(progress) || 0)) * 100;
  // Fully rounded ends unless the bar is tall enough for that to look like a pill.
  const r = height / 2;
  return (
    <View
      style={[
        styles.track,
        { height, borderRadius: r, backgroundColor: trackColor || progressTrack(color) },
        style,
      ]}
    >
      <View style={{ width: `${pct}%`, height: '100%', borderRadius: r, backgroundColor: color }} />
    </View>
  );
};

const styles = StyleSheet.create({
  // overflow:hidden so a 100% fill can't square off the track's rounded ends.
  track: { width: '100%', overflow: 'hidden' },
});

export default React.memo(ProgressBar);
