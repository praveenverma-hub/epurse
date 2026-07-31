// =============================================================================
// InfoSheet.tsx — reusable "what is this?" explainer, triggered by an (i) icon.
//
// Two presentations, one component (pick with `variant`):
//   • 'sheet'  (default) — slides up from the bottom, drag-handle on top.
//   • 'center'           — fades + scales into the middle of the screen.
// Everything else (content, gradient CTA, dismiss-on-backdrop) is shared, so a
// caller can flip between the two by changing a single prop. The whole animation
// graph runs on the UI thread off one `progress` shared value.
//
// Render in dark or light mode? Light only for now — these surfaces sit on top of
// the (dimmed) screen, not inside a themed container.
// =============================================================================

import React, { useEffect, type ReactNode } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';

import { useGradient, useTheme } from '../hooks/useTheme';
import SheetCloseButton from './SheetCloseButton';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface InfoSheetBullet {
  /** Short leading label, e.g. "How you earn it". */
  label: string;
  /** Detail line beside the label. */
  value: string;
  /** Optional leading emoji — renders a badge instead of the accent dot. */
  emoji?: string;
}

/** How the explainer is presented. Default 'sheet'. */
export type InfoSheetVariant = 'sheet' | 'center';

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
  /** Main body paragraph. Optional — omit for a title + bullet-list only sheet. */
  body?:      string;
  /** Optional structured bullet list rendered below the body. */
  bullets?:   InfoSheetBullet[];
  /** Optional icon rendered above the headline (pass an <Ionicons> node). */
  icon?:      ReactNode;
  /** Override the CTA button label. Default: "Got it". */
  ctaText?:   string;
  /** Bottom sheet (default) or centered modal. */
  variant?:   InfoSheetVariant;
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
  icon,
  ctaText = 'Got it',
  variant = 'sheet',
  style,
}) => {
  const isCenter = variant === 'center';
  // Single 0→1 progress drives both presentations (0 = hidden, 1 = shown).
  const progress = useSharedValue<number>(0);

  // CTA follows the active accent (gradient pill), so the sheet matches the
  // theme the user picked instead of a hardcoded orange.
  const gradient = useGradient();
  const { textOnGradient } = useTheme();

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, {
      duration: visible ? ENTER_MS : EXIT_MS,
      easing:   visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
    });
    return () => cancelAnimation(progress);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = (): void => {
    progress.value = withTiming(
      0,
      { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClose)();
      },
    );
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() =>
    isCenter
      ? { opacity: progress.value, transform: [{ scale: 0.92 + progress.value * 0.08 }] }
      : { transform: [{ translateY: (1 - progress.value) * SCREEN_H }] },
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Animated.View style={[styles.backdrop, isCenter && styles.backdropCenter, backdropStyle, style]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />

        <Animated.View style={[styles.sheet, isCenter && styles.centerCard, cardStyle]}>
          <SheetCloseButton onPress={handleDismiss} variant="absolute" />
          {isCenter ? null : <View style={styles.handle} />}

          <View style={styles.titleRow}>
            {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
            <Text style={[styles.headline, styles.headlineFlex]}>{title}</Text>
          </View>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}

          {body ? <Text style={styles.body}>{body}</Text> : null}

          {bullets?.length ? (
            <View style={styles.bulletWrap}>
              {bullets.map((b, i) => (
                <View key={`${b.label}-${i}`} style={styles.bulletRow}>
                  {b.emoji ? (
                    <View style={styles.bulletBadge}>
                      <Text style={styles.bulletBadgeText}>{b.emoji}</Text>
                    </View>
                  ) : (
                    <View style={styles.bulletDot} />
                  )}
                  <View style={styles.bulletText}>
                    <Text style={styles.bulletLabel}>{b.label}</Text>
                    <Text style={styles.bulletValue}>{b.value}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable style={styles.ctaWrap} onPress={handleDismiss}>
            <LinearGradient
              colors={gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.cta}
            >
              <Text style={[styles.ctaText, { color: textOnGradient }]}>{ctaText}</Text>
            </LinearGradient>
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
  // Centered variant: middle of the screen with side gutters.
  backdropCenter: {
    justifyContent:    'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor:      '#FFFFFF',
    paddingHorizontal:    22,
    paddingTop:           12,
    paddingBottom:        34,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
  },
  // Centered card: all four corners rounded, no drag handle, symmetric padding.
  centerCard: {
    alignSelf:               'stretch',
    paddingTop:              22,
    paddingBottom:           22,
    borderTopLeftRadius:     24,
    borderTopRightRadius:    24,
    borderBottomLeftRadius:  24,
    borderBottomRightRadius: 24,
  },
  handle: {
    width:           38,
    height:          4,
    borderRadius:    2,
    backgroundColor: '#E5E7EB',
    alignSelf:       'center',
    marginBottom:    14,
  },
  // Icon + heading on one row.
  titleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  iconWrap: {},
  headline: {
    color:         '#1C1C1E',
    fontSize:      19,
    fontWeight:    '800',
    letterSpacing: -0.3,
  },
  headlineFlex: { flex: 1 },
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
    gap:       12,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
  },
  bulletDot: {
    width:           7,
    height:          7,
    borderRadius:    3.5,   // exactly half of 7 — a true circle, not a squarish dot
    backgroundColor: '#FF5A1F',
    marginTop:       7,
  },
  // Emoji badge (used when a bullet has an `emoji`) — small rounded tile.
  bulletBadge: {
    width:           32,
    height:          32,
    borderRadius:    9,
    backgroundColor: '#F1F3F5',
    alignItems:      'center',
    justifyContent:  'center',
  },
  bulletBadgeText: { fontSize: 16 },
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
  // Wrapper owns position + clip so the gradient respects the pill radius on Android.
  // radius 16 (`radius.lg`), like every other button — the pill tier is for chips
  // only. paddingVertical is 13 (not 10) so the button clears ~43px tall; at 37px a
  // 16 radius is still half the height and would render as a capsule.
  ctaWrap: {
    alignSelf:    'flex-end',
    marginTop:    22,
    borderRadius: 16,
    overflow:     'hidden',
  },
  cta: {
    paddingHorizontal: 24,
    paddingVertical:   13,
    borderRadius:      16,
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
