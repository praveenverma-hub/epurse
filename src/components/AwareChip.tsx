// =============================================================================
// AwareChip.tsx — header status cluster for the user's "Aware Run" streak.
//
// Two structurally distinct tiers — chosen by streak length, not toggled:
//
//   ┌──────────────── Tier 1: Onboarding (days 1–2) ─────────────────┐
//   │  Horizontal frosted capsule:   🔥  2d  Aware                   │
//   │  Static emoji, side-by-side typography. Explicit + warm.       │
//   └────────────────────────────────────────────────────────────────┘
//
//   ┌──────────────── Tier 2: Live Canvas (days 3+) ─────────────────┐
//   │  Compact 44×44 square. Two stacked layers occupy the same      │
//   │  bounding box and cross-fade every 3s on the UI thread:        │
//   │     • LiveFlame canvas                                         │
//   │     • Numeric day count + tiny "Aware" caption                 │
//   │  No JS-thread setInterval — driven by withRepeat + withTiming. │
//   └────────────────────────────────────────────────────────────────┘
//
// Reads streak from ePurseStore, navigates to RewardShop on tap.
// =============================================================================

import React, { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useRewardStore, selectAwareStreak } from '../store/useRewardStore';
import { REWARD_CONFIG } from '../config/rewardConfig';
import LiveFlame from './LiveFlame';

// ─── Public types ───────────────────────────────────────────────────────────

export interface AwareChipProps {
  /** Fired when the user taps the chip — usually navigation to RewardShop. */
  onPress?: () => void;
  /** Optional extra style applied to the outermost touchable. */
  style?:   ViewStyle;
}

// ─── Constants (sourced from rewardConfig.ts) ───────────────────────────────

const TIER_SWITCH_DAYS = REWARD_CONFIG.CHIP_TIER2_DAYS;
const PHASE_MS         = REWARD_CONFIG.CHIP_PHASE_MS;
const FADE_MS          = REWARD_CONFIG.CHIP_FADE_MS;
const SQUARE_SIZE      = 44;

// ─── Component ──────────────────────────────────────────────────────────────

const AwareChip: React.FC<AwareChipProps> = ({ onPress, style }) => {
  const awareStreak = useRewardStore(selectAwareStreak);
  const days        = Math.max(0, Math.floor(awareStreak));

  if (days < TIER_SWITCH_DAYS) {
    return <Tier1Capsule days={days} onPress={onPress} style={style} />;
  }
  return <Tier2LiveSquare days={days} onPress={onPress} style={style} />;
};

export default AwareChip;

// ─── Tier 1: Onboarding capsule ─────────────────────────────────────────────

const Tier1Capsule: React.FC<{
  days:     number;
  onPress?: () => void;
  style?:   ViewStyle;
}> = ({ days, onPress, style }) => {
  // Day-0 (brand new) reads "Start" — psychologically softer than "0d".
  const label = days <= 0 ? 'Start' : `${days}d`;

  return (
    <TouchableOpacity
      style={[styles.capsule, style]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Aware streak ${days} days`}
    >
      <Text style={styles.capsuleEmoji}>🔥</Text>
      <Text style={styles.capsuleDays}>{label}</Text>
      <Text style={styles.capsuleSuffix}>Aware</Text>
    </TouchableOpacity>
  );
};

// ─── Tier 2: Live cross-fade square ─────────────────────────────────────────

const Tier2LiveSquare: React.FC<{
  days:     number;
  onPress?: () => void;
  style?:   ViewStyle;
}> = ({ days, onPress, style }) => {
  // `cycle` swings 0 → 1 → 0 → 1… forever. We derive both layers' opacity
  // and the number's subtle slide from this single value, so the whole
  // animation graph lives on the UI thread.
  const cycle = useSharedValue(0);

  useEffect(() => {
    cycle.value = withDelay(
      120,
      withRepeat(
        withSequence(
          // Hold flame for ~PHASE_MS, then fade to number over FADE_MS
          withTiming(0, { duration: PHASE_MS - FADE_MS }),
          withTiming(1, { duration: FADE_MS, easing: Easing.inOut(Easing.cubic) }),
          // Hold number for ~PHASE_MS, then fade back
          withTiming(1, { duration: PHASE_MS - FADE_MS }),
          withTiming(0, { duration: FADE_MS, easing: Easing.inOut(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(cycle);
  }, [cycle]);

  const flameLayerStyle = useAnimatedStyle(() => ({
    opacity:   interpolate(cycle.value, [0, 1], [1, 0]),
    transform: [
      { translateY: interpolate(cycle.value, [0, 1], [0, -3]) },
    ],
  }));

  const numberLayerStyle = useAnimatedStyle(() => ({
    opacity:   interpolate(cycle.value, [0, 1], [0, 1]),
    transform: [
      { translateY: interpolate(cycle.value, [0, 1], [4, 0]) },
    ],
  }));

  return (
    <TouchableOpacity
      style={[styles.square, style]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Aware streak ${days} days`}
    >
      {/* Soft gradient-ish glow ring — colour shifts with tier */}
      <View style={[styles.squareGlow, { backgroundColor: glowForStreak(days) }]} />

      {/* Layer A — LiveFlame */}
      <Animated.View style={[styles.squareLayer, flameLayerStyle]}>
        <LiveFlame size={26} />
      </Animated.View>

      {/* Layer B — Number + caption */}
      <Animated.View style={[styles.squareLayer, numberLayerStyle]}>
        <Text style={styles.squareNumber}>{days}</Text>
        <Text style={styles.squareCaption}>Aware</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const glowForStreak = (days: number): string => {
  if (days >= 30) return 'rgba(34, 211, 238, 0.18)'; // cyan — veteran
  if (days >= 14) return 'rgba(167, 139, 250, 0.18)'; // violet — habit
  return 'rgba(251, 146, 60, 0.20)';                   // warm orange — early
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Tier 1 — capsule
  capsule: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: 10,
    paddingVertical:   7,
    borderRadius:      999,
    backgroundColor:   'rgba(255,255,255,0.18)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.28)',
    gap: 6,
  },
  capsuleEmoji: {
    fontSize:  13,
    lineHeight: 15,
  },
  capsuleDays: {
    color:      '#FFFFFF',
    fontSize:   13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  capsuleSuffix: {
    color:      'rgba(255,255,255,0.78)',
    fontSize:   11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // Tier 2 — square
  square: {
    width:           SQUARE_SIZE,
    height:          SQUARE_SIZE,
    borderRadius:    14,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.28)',
    overflow:        'hidden',
    alignItems:      'center',
    justifyContent:  'center',
  },
  squareGlow: {
    ...StyleSheet.absoluteFillObject,
  },
  squareLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems:     'center',
    justifyContent: 'center',
  },
  squareNumber: {
    color:         '#FFFFFF',
    fontSize:      18,
    fontWeight:    '900',
    letterSpacing: -0.5,
    lineHeight:    20,
  },
  squareCaption: {
    color:         'rgba(255,255,255,0.78)',
    fontSize:      8,
    fontWeight:    '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop:     1,
  },
});
