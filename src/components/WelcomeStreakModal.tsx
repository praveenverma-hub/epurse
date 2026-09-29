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

import React, { useEffect, useState } from 'react';
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
  withTiming,
} from 'react-native-reanimated';

import {
  useRewardStore,
  selectFirstLaunch,
} from '../store/useRewardStore';
import { REWARD_CONFIG, REWARD_COPY } from '../config/rewardConfig';
import { useTheme } from '../hooks/useTheme';
import { readableOn } from '../constants/theme';
import LiveFlame from './LiveFlame';
import SheetCloseButton from './SheetCloseButton';
import type { AutoModalId } from '../constants/autoModals';

import { hapticSuccess } from '../utils/haptics';

// ─── Constants ──────────────────────────────────────────────────────────────

const DWELL_MS    = REWARD_CONFIG.WELCOME_DWELL_MS;
const EXIT_MS     = 380;
const SCREEN_H    = Dimensions.get('window').height;

// ─── Component ──────────────────────────────────────────────────────────────

type Props = {
  activeAutoModal: AutoModalId | null;
  /** Development UI review: show the real modal without consuming first launch. */
  preview?: boolean;
  onPreviewClose?: () => void;
};

const WelcomeStreakModal: React.FC<Props> = ({ activeAutoModal, preview = false, onPreviewClose }) => {
  const theme = useTheme();
  const ctaInk = readableOn(theme.primary, '#FFFFFF');
  const isFirstLaunch      = useRewardStore(selectFirstLaunch);
  const setFirstLaunchDone = useRewardStore((s) => s.setFirstLaunchDone);

  // Tracks whether the sheet is currently visible to the Modal host. We can't
  // unmount until the slide-down completes, so this gates the Modal directly.
  const [mounted, setMounted] = useState(false);
  const shouldShow = (preview || isFirstLaunch === true) && activeAutoModal === 'welcome';

  // Y offset of the sheet — starts off-screen, springs to 0, slides back down.
  const translateY = useSharedValue<number>(SCREEN_H);
  const opacity    = useSharedValue<number>(0);

  // Bridge: lets the worklet flip the Zustand flag + hide the Modal back on
  // the JS thread once the exit animation finishes.
  const finishCelebration = (): void => {
    setMounted(false);
    if (preview) onPreviewClose?.();
    else setFirstLaunchDone();
  };

  useEffect(() => {
    if (!shouldShow) return;

    setMounted(true);

    // Quick haptic burst on entry to anchor the moment.
    hapticSuccess();

    // Backdrop fades in instantly; sheet slides up with a smooth ease (no bounce).
    opacity.value    = withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 360, easing: Easing.out(Easing.cubic) });

    // A preview stays open so the UI can be inspected. Real first-launch
    // celebrations keep the timed show-and-go behaviour.
    if (!preview) {
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
    }

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(opacity);
    };
  }, [shouldShow, preview]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissEarly}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissEarly} />

        {/* Shell carries the animation; the sheet keeps `overflow:'hidden'` (it clips
            the absolute-fill gradient to the rounded corners). The floating ✕ has to
            sit on the SHELL — inside the sheet its negative offset is clipped away. */}
        <Animated.View style={sheetStyle}>
          <SheetCloseButton onPress={dismissEarly} variant="absolute" />
          <View style={styles.sheet}>
            <LinearGradient
              colors={['#FFFFFF', '#F7F4FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View style={styles.flameWrap}>
              <LiveFlame size={48} />
            </View>

            <Text style={[styles.eyebrow, { color: theme.primary }]}>{REWARD_COPY.WELCOME_EYEBROW}</Text>
            <Text style={styles.headline}>{REWARD_COPY.WELCOME_HEADLINE}</Text>

            <Text style={styles.description}>
              {REWARD_COPY.WELCOME_DESCRIPTION}
            </Text>

            <Pressable style={[styles.cta, { backgroundColor: theme.primary }]} onPress={dismissEarly}>
              <Text style={[styles.ctaText, { color: ctaInk }]}>{REWARD_COPY.WELCOME_CTA}</Text>
            </Pressable>
          </View>
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
    backgroundColor:  'rgba(15, 17, 21, 0.48)',
    justifyContent:   'flex-end',
  },
  sheet: {
    paddingHorizontal: 24,
    paddingTop:        26,
    paddingBottom:     30,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    overflow:          'hidden',
    borderWidth:       1,
    borderColor:       '#E7E2F4',
  },
  flameWrap: {
    alignSelf:        'center',
    width:            64,
    height:           64,
    borderRadius:     32,
    backgroundColor:  '#FFF7E8',
    alignItems:       'center',
    justifyContent:   'center',
    marginBottom:     14,
    borderWidth:      1,
    borderColor:      '#F6D99B',
  },
  eyebrow: {
    fontSize:      11,
    fontWeight:    '900',
    letterSpacing: 1.6,
    textAlign:     'center',
    marginBottom:  7,
  },
  headline: {
    color:         '#1C1C1E',
    fontSize:      23,
    fontWeight:    '800',
    textAlign:     'center',
    letterSpacing: -0.3,
  },
  description: {
    color:         '#6B7280',
    fontSize:      14,
    lineHeight:    20,
    textAlign:     'center',
    marginTop:     10,
    paddingHorizontal: 10,
  },
  cta: {
    alignSelf:        'stretch',
    alignItems:       'center',
    marginTop:        22,
    paddingVertical:   14,
    borderRadius:      16,   // radius.lg — pill is for chips only
  },
  ctaText: {
    fontSize:      14,
    fontWeight:    '800',
    letterSpacing: 0.3,
  },
});
