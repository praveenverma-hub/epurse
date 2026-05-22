// =============================================================================
// InfoSheet.tsx — reusable bottom-sheet explainer.
//
// Pure presentation surface for short "what is this?" definitions triggered
// by tapping a (i) icon. Slides up with a spring, dismisses on backdrop tap
// or via the "Got it" CTA. Animation graph runs entirely on the UI thread.
//
// Render in dark or light mode? Light only for now — these sheets surface on
// top of light-mode contexts (RewardShop hero card on dark backdrop too, but
// the sheet itself sits on top of the screen darkness, not inside it).
// =============================================================================

import React, { useEffect } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface InfoSheetBullet {
  /** Short leading label, e.g. "How you earn it". */
  label: string;
  /** Detail line beside the label. */
  value: string;
}

export interface InfoSheetProps {
  visible:    boolean;
  onClose:    () => void;
  /** Heading shown at the top of the sheet (may include an emoji prefix). */
  title:      string;
  /**
   * Optional bold meta line under the title (e.g. "Reality Points · RP").
   * Used as a subheading clarifying the term.
   */
  eyebrow?:   string;
  /** Main body paragraph. */
  body:       string;
  /** Optional structured bullet list rendered below the body. */
  bullets?:   InfoSheetBullet[];
  /** Override the CTA button label. Default: "Got it". */
  ctaText?:   string;
  /** Optional override for the host wrapper (rarely needed). */
  style?:     StyleProp<ViewStyle>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCREEN_H = Dimensions.get('window').height;
const ENTER_MS = 320;
const EXIT_MS  = 240;

// ─── Component ──────────────────────────────────────────────────────────────

const InfoSheet: React.FC<InfoSheetProps> = ({
  visible,
  onClose,
  title,
  eyebrow,
  body,
  bullets,
  ctaText = 'Got it',
  style,
}) => {
  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(SCREEN_H);

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
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <Animated.View style={[styles.backdrop, backdropStyle, style]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />

        <Animated.View style={[styles.sheet, sheetStyle]}>
          <View style={styles.handle} />

          <Text style={styles.headline}>{title}</Text>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}

          <Text style={styles.body}>{body}</Text>

          {bullets?.length ? (
            <View style={styles.bulletWrap}>
              {bullets.map((b, i) => (
                <View key={`${b.label}-${i}`} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <View style={styles.bulletText}>
                    <Text style={styles.bulletLabel}>{b.label}</Text>
                    <Text style={styles.bulletValue}>{b.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable style={styles.cta} onPress={handleDismiss}>
            <Text style={styles.ctaText}>{ctaText}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

export default InfoSheet;

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:             1,
    backgroundColor:  'rgba(5, 8, 16, 0.65)',
    justifyContent:   'flex-end',
  },
  sheet: {
    backgroundColor:      '#FFFFFF',
    paddingHorizontal:    22,
    paddingTop:           12,
    paddingBottom:        34,
    borderTopLeftRadius:  28,
    borderTopRightRadius: 28,
  },
  handle: {
    width:           38,
    height:          4,
    borderRadius:    2,
    backgroundColor: '#E5E7EB',
    alignSelf:       'center',
    marginBottom:    14,
  },
  headline: {
    color:         '#1C1C1E',
    fontSize:      19,
    fontWeight:    '800',
    letterSpacing: -0.3,
  },
  eyebrow: {
    color:         '#FF5A1F',
    fontSize:      11,
    fontWeight:    '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop:     6,
  },
  body: {
    color:      '#3F4658',
    fontSize:   14,
    lineHeight: 21,
    marginTop:  12,
  },
  bulletWrap: {
    marginTop: 14,
    gap:       10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
  },
  bulletDot: {
    width:           7,
    height:          7,
    borderRadius:    4,
    backgroundColor: '#FF5A1F',
    marginTop:       7,
  },
  bulletText: {
    flex: 1,
  },
  bulletLabel: {
    color:         '#1C1C1E',
    fontSize:      13,
    fontWeight:    '800',
    letterSpacing: 0.1,
  },
  bulletValue: {
    color:      '#3F4658',
    fontSize:   13,
    lineHeight: 19,
    marginTop:  1,
  },
  cta: {
    alignSelf:         'flex-end',
    marginTop:         22,
    paddingHorizontal: 24,
    paddingVertical:   10,
    borderRadius:      999,
    backgroundColor:   '#FF5A1F',
  },
  ctaText: {
    color:         '#FFFFFF',
    fontSize:      13,
    fontWeight:    '800',
    letterSpacing: 0.3,
  },
});
