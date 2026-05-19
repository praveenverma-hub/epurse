// =============================================================================
// WelcomeStreakModal.tsx — Day-1 Aware Run celebration overlay
//
// Behavioural contract:
//   • Mounts only when ePurseStore.isFirstLaunch === true.
//   • Slide-up + spring bounce on entry (high-dopamine arrival).
//   • Holds for 4.5 seconds (DWELL_MS), then animates slide-down past the
//     viewport before dispatching setFirstLaunchDone() so the flag never
//     persists past the celebration cycle.
//   • No user interaction required — purely "show and go". Tapping the
//     backdrop / "Got it" pill exits early without changing the contract.
// =============================================================================

import React, { useEffect, useRef } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useEPurseStore } from '../store/ePurseStore';
import LiveFlame from './LiveFlame';
import { hapticSuccess } from '../utils/haptics';

// ─── Constants ──────────────────────────────────────────────────────────────

const DWELL_MS    = 4500;
const EXIT_MS     = 380;
const SCREEN_H    = Dimensions.get('window').height;

// ─── Component ──────────────────────────────────────────────────────────────

const WelcomeStreakModal: React.FC = () => {
  const isFirstLaunch     = useEPurseStore((s: any) => s.isFirstLaunch);
  const setFirstLaunchDone = useEPurseStore((s: any) => s.setFirstLaunchDone);

  // Tracks whether the sheet is currently visible to the Modal host. We can't
  // unmount until the slide-down completes, so this gates the Modal directly.
  const visibleRef = useRef<boolean>(isFirstLaunch === true);

  // Y offset of the sheet — starts off-screen, springs to 0, slides back down.
  const translateY = useSharedValue<number>(SCREEN_H);
  const opacity    = useSharedValue<number>(0);

  // Bridge: lets the worklet flip the Zustand flag + hide the Modal back on
  // the JS thread once the exit animation finishes.
  const finishCelebration = (): void => {
    visibleRef.current = false;
    setFirstLaunchDone();
  };

  useEffect(() => {
    if (!isFirstLaunch) return;

    // Quick haptic burst on entry to anchor the moment.
    hapticSuccess();

    // Backdrop fades in instantly; sheet springs up with bounce.
    opacity.value    = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
    translateY.value = withSpring(0, {
      damping:        14,
      stiffness:      130,
      mass:           0.9,
      overshootClamping: false,
      restDisplacementThreshold: 0.5,
    });

    // After DWELL_MS, slide everything down and flip the flag.
    translateY.value = withDelay(
      DWELL_MS,
      withTiming(
        SCREEN_H * 1.1,
        { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishCelebration)();
        },
      ),
    );
    opacity.value = withDelay(
      DWELL_MS,
      withTiming(0, { duration: EXIT_MS }),
    );

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(opacity);
    };
  }, [isFirstLaunch]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Early-exit handler — user taps backdrop / "Got it" pill before the
  // dwell timer elapses. Same exit animation, same flag flip.
  const dismissEarly = (): void => {
    cancelAnimation(translateY);
    cancelAnimation(opacity);
    opacity.value    = withTiming(0, { duration: EXIT_MS });
    translateY.value = withTiming(
      SCREEN_H * 1.1,
      { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishCelebration)();
      },
    );
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isFirstLaunch && !visibleRef.current) return null;

  return (
    <Modal
      visible={!!isFirstLaunch || visibleRef.current}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissEarly}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissEarly} />

        <Animated.View style={[styles.sheet, sheetStyle]}>
          <LinearGradient
            colors={['#1B2342', '#0F1428']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />

          <View style={styles.flameWrap}>
            <LiveFlame size={56} />
          </View>

          <Text style={styles.headline}>🚀 Day 1 Aware Run Ignited!</Text>

          <Text style={styles.description}>
            Welcome to ePurse. Your spending awareness journey begins today.
            Keep your Review Queue clean every day to earn coins, level up,
            and unlock beautiful live widgets and premium workspace layouts!
          </Text>

          <Pressable style={styles.cta} onPress={dismissEarly}>
            <Text style={styles.ctaText}>Got it</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

export default WelcomeStreakModal;

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:             1,
    backgroundColor:  'rgba(5, 8, 16, 0.78)',
    justifyContent:   'flex-end',
  },
  sheet: {
    paddingHorizontal: 24,
    paddingTop:        28,
    paddingBottom:     38,
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
    overflow:          'hidden',
    borderWidth:       1,
    borderColor:       'rgba(255, 255, 255, 0.08)',
  },
  flameWrap: {
    alignSelf:        'center',
    width:            72,
    height:           72,
    borderRadius:     36,
    backgroundColor:  'rgba(251, 146, 60, 0.15)',
    alignItems:       'center',
    justifyContent:   'center',
    marginBottom:     18,
    borderWidth:      1,
    borderColor:      'rgba(252, 211, 77, 0.35)',
  },
  headline: {
    color:         '#F5F7FA',
    fontSize:      22,
    fontWeight:    '800',
    textAlign:     'center',
    letterSpacing: -0.3,
  },
  description: {
    color:         '#A5ACBE',
    fontSize:      14,
    lineHeight:    21,
    textAlign:     'center',
    marginTop:     12,
  },
  cta: {
    alignSelf:        'center',
    marginTop:        24,
    paddingHorizontal: 36,
    paddingVertical:   12,
    borderRadius:      999,
    backgroundColor:   '#FF5A1F',
  },
  ctaText: {
    color:         '#FFFFFF',
    fontSize:      14,
    fontWeight:    '800',
    letterSpacing: 0.3,
  },
});
