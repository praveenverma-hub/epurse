// =============================================================================
// QueueCapInfoSheet.tsx — bottom-sheet explainer for the daily earnings cap.
//
// Renders a polished, slide-up sheet on demand. Pure presentation — no store
// reads. Copy lives in rewardConfig.REWARD_COPY so wording can be updated in
// one place.
// =============================================================================

import React, { useEffect } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { REWARD_CONFIG, REWARD_COPY } from '../config/rewardConfig';
import { useGradient, useTheme } from '../hooks/useTheme';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface QueueCapInfoSheetProps {
  visible: boolean;
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCREEN_H = Dimensions.get('window').height;
const ENTER_MS = 320;
const EXIT_MS  = 240;

// ─── Component ──────────────────────────────────────────────────────────────

const QueueCapInfoSheet: React.FC<QueueCapInfoSheetProps> = ({
  visible,
  onClose,
}) => {
  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(SCREEN_H);

  // CTA follows the active accent (gradient pill) instead of a hardcoded orange.
  const gradient = useGradient();
  const { textOnGradient } = useTheme();

  useEffect(() => {
    if (visible) {
      opacity.value   = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
      translate.value = withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
    } else {
      opacity.value   = withTiming(0, { duration: EXIT_MS });
      translate.value = withTiming(SCREEN_H, {
        duration: EXIT_MS,
        easing:   Easing.in(Easing.cubic),
      });
    }
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translate);
    };
  }, [visible]);

  const handleDismiss = (): void => {
    opacity.value = withTiming(0, { duration: EXIT_MS });
    translate.value = withTiming(
      SCREEN_H,
      { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClose)();
      },
    );
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translate.value }],
  }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />

        <Animated.View style={[styles.sheet, sheetStyle]}>
          <View style={styles.handle} />

          <Text style={styles.headline}>{REWARD_COPY.CAP_HEADLINE}</Text>

          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>
                {REWARD_CONFIG.DAILY_REVIEW_CAP} / day
              </Text>
            </View>
            <Text style={styles.metaCaption}>Earning cap, resets daily</Text>
          </View>

          <Text style={styles.body}>{REWARD_COPY.CAP_DESCRIPTION}</Text>

          <Pressable style={styles.ctaWrap} onPress={handleDismiss}>
            <LinearGradient
              colors={gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cta}
            >
              <Text style={[styles.ctaText, { color: textOnGradient }]}>Got it</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

export default QueueCapInfoSheet;

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:             1,
    backgroundColor:  'rgba(5, 8, 16, 0.65)',
    justifyContent:   'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 22,
    paddingTop:        12,
    paddingBottom:     34,
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
  },
  handle: {
    width:            38,
    height:           4,
    borderRadius:     2,
    backgroundColor:  '#E5E7EB',
    alignSelf:        'center',
    marginBottom:     14,
  },
  headline: {
    color:         '#1C1C1E',
    fontSize:      19,
    fontWeight:    '800',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginTop:     14,
    gap:           10,
  },
  metaPill: {
    backgroundColor:   '#FFF3E8',
    borderRadius:      999,
    paddingHorizontal: 12,
    paddingVertical:   5,
    borderWidth:       1,
    borderColor:       'rgba(255, 90, 31, 0.25)',
  },
  metaPillText: {
    color:      '#FF5A1F',
    fontSize:   12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  metaCaption: {
    color:    '#6B7388',
    fontSize: 12,
    fontWeight: '600',
  },
  body: {
    color:      '#3F4658',
    fontSize:   14,
    lineHeight: 21,
    marginTop:  14,
  },
  // Wrapper owns position + clip so the gradient respects the pill radius on Android.
  ctaWrap: {
    alignSelf:    'flex-end',
    marginTop:    22,
    borderRadius: 999,
    overflow:     'hidden',
  },
  cta: {
    paddingHorizontal: 24,
    paddingVertical:   10,
    borderRadius:      999,
    alignItems:        'center',
    justifyContent:    'center',
  },
  ctaText: {
    color:         '#FFFFFF',
    fontSize:      13,
    fontWeight:    '800',
    letterSpacing: 0.3,
  },
});
