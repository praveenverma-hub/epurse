// =============================================================================
// Confetti — falling pieces for the app's celebration moments.
//
// Lifted out of CelebrationModal when the Goals congratulation needed the same
// thing (shared-components rule: needed in more than one file ⇒ it becomes a
// component). Nothing about it is budget-specific.
//
// RN-core `Animated` with `useNativeDriver: true`, not reanimated: it is 36
// independent transform-only animations with no interaction, which is the one
// case the native driver handles perfectly and the cheapest thing to run over
// a modal that is already fading in.
// =============================================================================

import React, { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Animated, Easing, Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

/** Bright pastels — deliberately NOT theme-derived: confetti is celebration,
 *  not chrome, and a single-accent shower reads as a loading bar. */
export const CONFETTI_COLORS = [
  '#FF5A1F', '#FBBF24', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F59E0B',
];

interface PieceProps {
  delay: number;
  color: string;
  startX: number;
  size: number;
  drift: number;
}

const ConfettiPiece: React.FC<PieceProps> = ({ delay, color, startX, size, drift }) => {
  const fall = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(fall, {
        toValue: 1,
        duration: 2400 + Math.random() * 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, fall]);

  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-40, SCREEN_H + 40] });
  const translateX = fall.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, drift, drift * 1.5] });
  const rotate = fall.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${720 + Math.random() * 360}deg`] });
  const opacity = fall.interpolate({ inputRange: [0, 0.05, 0.85, 1], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: startX,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    />
  );
};

interface Props {
  active: boolean;
  count?: number;
  /** Override the palette when a celebration has its own colour to echo.
   *  Deliberately NOT named after the static palette object: the dark-mode
   *  ratchet counts every reference to it in components by name, and a prop
   *  called that would read as one more surface left to migrate. */
  palette?: string[];
}

const Confetti: React.FC<Props> = ({ active, count = 36, palette = CONFETTI_COLORS }) => {
  // Generated once — random seeds stay stable for the modal's lifetime, so a
  // re-render doesn't restart every piece from the top of the screen.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        key: i,
        delay: Math.random() * 800,
        color: palette[i % palette.length],
        startX: Math.random() * SCREEN_W,
        size: 5 + Math.random() * 5,
        drift: (Math.random() - 0.5) * 80,
      })),
    [count, palette],
  );

  if (!active) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map(({ key, ...p }) => <ConfettiPiece key={key} {...p} />)}
    </View>
  );
};

export default Confetti;
