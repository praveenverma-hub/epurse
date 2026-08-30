// =============================================================================
// CardSkeleton — a placeholder shaped like the content that is about to arrive.
//
// A SKELETON rather than a spinner, deliberately. A spinner says "something is
// happening"; a skeleton says "a card goes here, this big" — it reserves the
// exact space, so nothing below it jumps when the real content lands, and it
// reads as the page already being drawn rather than as an error state. On a
// dashboard whose whole job is to be glanceable, a spinning wheel in the middle
// of the fold is the more alarming of the two.
//
// It also fixes a real layout collapse: HomeCarousel is self-measuring, so on its
// first frame the width is unknown and it rendered NOTHING — a zero-height view
// that still occupied a slot in the Dashboard's `gap`, i.e. a blank band.
//
// The pulse is opacity-only and runs on the native driver, so it costs nothing on
// the JS thread during the busiest moment in the app's lifecycle (rehydration +
// the SMS sweep). It respects reduce-motion by simply not animating — a static
// placeholder is still a correct placeholder.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { mix, radius, shadows, spacing } from '../constants/theme';

const PULSE_MS = 900;
const DIM = 0.45;

export interface CardSkeletonProps {
  /** Reserve exactly the height the real content will take. */
  height: number;
  width?: number | `${number}%`;
  /** Placeholder bars drawn inside, as fractions of the width. Empty = a bare block. */
  lines?: number[];
  style?: ViewStyle;
  /** Announced to screen readers in place of the (meaningless) placeholder shapes. */
  label?: string;
}

const CardSkeleton: React.FC<CardSkeletonProps> = ({
  height,
  width = '100%',
  lines = [0.4, 0.75, 0.55],
  style,
  label = 'Loading',
}) => {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive) setReduceMotion(!!on); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => setReduceMotion(!!on));
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    if (reduceMotion) { pulse.setValue(1); return undefined; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: DIM, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  // Derived from the card surface, not a fixed grey: on the dark palette a light
  // grey placeholder would glow brighter than the real card it stands in for.
  const bar = mix(theme.textPrimary, 0.09, theme.card);

  return (
    <View
      style={[
        styles.card,
        { height, width, backgroundColor: theme.card, borderColor: theme.divider },
        style,
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.inner, { opacity: pulse }]}>
        {lines.map((w, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { backgroundColor: bar, width: `${Math.round(w * 100)}%` },
              i === 0 && styles.barLead,
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
};

export default CardSkeleton;

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    justifyContent: 'center',
    ...shadows.card,
  },
  inner: { gap: spacing.sm },
  bar: { height: 10, borderRadius: 5 },
  // The first bar reads as a title: shorter and slightly taller than the body.
  barLead: { height: 14, borderRadius: 7, marginBottom: spacing.xs },
});
