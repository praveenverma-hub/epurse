// =============================================================================
// CheckInBanner.tsx — auto-dismissing floating earnings pill
//
// Reads the transient `lastCheckInResult` slice of useRewardStore. Whenever a
// new check-in result lands, slides in from the top, holds for BANNER_VISIBLE_MS,
// then slides out and clears the store-side result so it never replays.
//
// Architectural contract:
//   • No props; entirely store-driven.
//   • Renders nothing when there is no fresh result or when type === 'SAME_DAY'.
//   • Animation graph runs entirely on the UI thread (Reanimated v3 shared
//     values + withSequence). The JS thread only flips one timer.
// =============================================================================

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  useRewardStore,
  selectLastCheckIn,
  type CheckInResult,
} from '../store/useRewardStore';
import { REWARD_CONFIG } from '../config/rewardConfig';

// ─── Constants ──────────────────────────────────────────────────────────────

const VISIBLE_MS = REWARD_CONFIG.BANNER_VISIBLE_MS;
const ENTER_MS   = 320;
const EXIT_MS    = 280;
const TRAVEL_PX  = 72;

// ─── Component ──────────────────────────────────────────────────────────────

const CheckInBanner: React.FC = () => {
  const result = useRewardStore(selectLastCheckIn);
  const clear  = useRewardStore((s) => s.clearLastCheckInResult);

  // Shared values for the slide+fade graph.
  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(-TRAVEL_PX);

  useEffect(() => {
    if (!shouldRender(result)) return;

    // Sequence: spring-down → hold → fade-up. Reset is dispatched once the
    // exit animation finishes, on the JS thread.
    opacity.value = withSequence(
      withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(VISIBLE_MS, withTiming(0, { duration: EXIT_MS })),
    );

    translate.value = withSequence(
      withSpring(0, {
        damping:        16,
        stiffness:      170,
        mass:           0.85,
        overshootClamping: false,
      }),
      withDelay(
        VISIBLE_MS,
        withTiming(
          -TRAVEL_PX,
          { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(clear)();
          },
        ),
      ),
    );

    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translate);
    };
    // We intentionally only re-arm on a NEW result timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.ts]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translate.value }],
  }));

  if (!shouldRender(result)) return null;

  return (
    <View pointerEvents="none" style={styles.host}>
      <Animated.View style={[styles.pill, wrapStyle, toneFor(result!.type)]}>
        <Text style={styles.text} numberOfLines={2}>
          {result!.message}
          {renderEarningsTail(result!)}
        </Text>
      </Animated.View>
    </View>
  );
};

export default CheckInBanner;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Banner is visible iff there's a fresh result AND it's not the silent
 * SAME_DAY type. SAME_DAY check-ins are returned by `checkIn()` for caller
 * convenience but should never produce UI noise.
 */
const shouldRender = (r: CheckInResult | null): boolean =>
  !!r && r.type !== 'SAME_DAY' && !!r.message;

/**
 * Appends "(+X RP / +Y EPC)" when the check-in awarded something. We don't
 * inline this in the store message because callers may want to keep the
 * banner clean even when awards happen (e.g., during STREAK_RESET).
 */
const renderEarningsTail = (r: CheckInResult): string => {
  if (r.rpAwarded <= 0 && r.epcAwarded <= 0) return '';
  const parts: string[] = [];
  if (r.rpAwarded  > 0) parts.push(`+${r.rpAwarded} RP`);
  if (r.epcAwarded > 0) parts.push(`+${r.epcAwarded} EPC`);
  return `  ·  ${parts.join(' / ')}`;
};

/** Tone tint by check-in type — keeps the visual language consistent. */
const toneFor = (type: CheckInResult['type']) => {
  switch (type) {
    case 'SAVINGS':      return styles.toneSavings;
    case 'STREAK_RESET': return styles.toneReset;
    case 'NEW_DAY':      return styles.toneNewDay;
    default:             return styles.toneDefault;
  }
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  host: {
    position:        'absolute',
    top:             8,
    left:            16,
    right:           16,
    alignItems:      'center',
    zIndex:          50,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical:   8,
    borderRadius:      999,
    flexDirection:     'row',
    alignItems:        'center',
    maxWidth:          '100%',
    borderWidth:       1,
    shadowColor:       '#000',
    shadowOpacity:     0.25,
    shadowRadius:      10,
    shadowOffset:      { width: 0, height: 4 },
    elevation:         8,
  },
  toneDefault: {
    backgroundColor: 'rgba(20, 24, 36, 0.92)',
    borderColor:     'rgba(255,255,255,0.16)',
  },
  toneNewDay: {
    backgroundColor: 'rgba(20, 24, 36, 0.92)',
    borderColor:     'rgba(252, 211, 77, 0.45)',
  },
  toneSavings: {
    backgroundColor: 'rgba(7, 27, 22, 0.94)',
    borderColor:     'rgba(16, 185, 129, 0.55)',
  },
  toneReset: {
    backgroundColor: 'rgba(31, 24, 18, 0.94)',
    borderColor:     'rgba(251, 146, 60, 0.55)',
  },
  text: {
    color:         '#F5F7FA',
    fontSize:      13,
    fontWeight:    '700',
    letterSpacing: 0.1,
  },
});
