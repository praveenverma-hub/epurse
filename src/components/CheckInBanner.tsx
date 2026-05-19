// =============================================================================
// CheckInBanner.tsx — top-anchored celebration banner for hands-free check-ins.
//
// Reads the transient `lastCheckInResult` slice of useRewardStore. Whenever a
// new result lands:
//   1. Slides + scales down from the top with a spring bounce.
//   2. For NEW_DAY / SAVINGS types, bursts a confetti shower of colored shards
//      + floating sparkles around the pill — pure celebration moment.
//   3. Holds for BANNER_VISIBLE_MS (4.5s by default).
//   4. Fades up and clears the store flag so it never replays.
//
// Architectural contract:
//   • No props; entirely store-driven.
//   • Renders nothing when there is no fresh result OR when type === 'SAME_DAY'.
//   • Position respects safe-area inset → never clipped by the status bar.
//   • All animation runs on the UI thread (Reanimated v3 shared values +
//     withSequence/withSpring). The JS thread only schedules the dismiss timer
//     via runOnJS once per result.
// =============================================================================

import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
import { useTheme } from '../hooks/useTheme';

// ─── Constants ──────────────────────────────────────────────────────────────

const VISIBLE_MS    = REWARD_CONFIG.BANNER_VISIBLE_MS;
const ENTER_MS      = 320;
const EXIT_MS       = 280;
const TRAVEL_PX     = 80;
const SHARD_COUNT   = 22;
const SPARKLE_COUNT = 6;

// ─── Tone resolver (deliberately a JS function — runs on JS thread once) ────

interface Tone {
  /** Banner card border. */
  border:    string;
  /** Glow ring sitting behind the icon bubble. */
  iconHalo:  string;
  /** Icon bubble fill. */
  iconBg:    string;
  /** Accent colour for the earnings line and outer glow stripe. */
  accent:    string;
  /** Icon emoji rendered in the bubble. */
  emoji:     string;
  /** Confetti palette — celebration types only. */
  confetti:  string[];
  /** Card backdrop gradient (top → bottom). */
  cardGrad:  [string, string];
}

const toneFor = (type: CheckInResult['type']): Tone => {
  switch (type) {
    case 'SAVINGS':
      return {
        border:    'rgba(52, 211, 153, 0.55)',
        iconHalo:  'rgba(52, 211, 153, 0.30)',
        iconBg:    'rgba(16, 185, 129, 0.95)',
        accent:    '#34D399',
        emoji:     '🛡️',
        confetti:  ['#10B981', '#34D399', '#A7F3D0', '#FCD34D', '#FFFFFF', '#22D3EE'],
        cardGrad:  ['#0E2620', '#08161A'],
      };
    case 'NEW_DAY':
      return {
        border:    'rgba(252, 211, 77, 0.55)',
        iconHalo:  'rgba(252, 211, 77, 0.35)',
        iconBg:    'rgba(251, 146, 60, 0.95)',
        accent:    '#FCD34D',
        emoji:     '🔥',
        confetti:  ['#FB923C', '#FCD34D', '#F472B6', '#A78BFA', '#FFFFFF', '#FF5A1F'],
        cardGrad:  ['#1F1411', '#120A0F'],
      };
    case 'STREAK_RESET':
      return {
        border:    'rgba(251, 146, 60, 0.55)',
        iconHalo:  'rgba(251, 146, 60, 0.25)',
        iconBg:    'rgba(251, 146, 60, 0.85)',
        accent:    '#FB923C',
        emoji:     '🌅',
        confetti:  [], // a reset is not a celebration
        cardGrad:  ['#1A1410', '#0D0B08'],
      };
    default:
      return {
        border:    'rgba(255,255,255,0.20)',
        iconHalo:  'rgba(255,255,255,0.08)',
        iconBg:    'rgba(255,255,255,0.12)',
        accent:    '#A5ACBE',
        emoji:     'ⓘ',
        confetti:  [],
        cardGrad:  ['#161B2E', '#0E1220'],
      };
  }
};

// ─── Component ──────────────────────────────────────────────────────────────

const CheckInBanner: React.FC = () => {
  const result  = useRewardStore(selectLastCheckIn);
  const clear   = useRewardStore((s) => s.clearLastCheckInResult);
  const insets  = useSafeAreaInsets();
  const theme   = useTheme(); // kept for potential cross-theming hooks later

  // ─── Shared values driving the pill enter/exit ─────────────────────────
  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(-TRAVEL_PX);
  const scale     = useSharedValue<number>(0.85);

  useEffect(() => {
    if (!shouldRender(result)) return;

    // Reset to start state (cheap if it's the first tick, essential for re-arm)
    opacity.value   = 0;
    translate.value = -TRAVEL_PX;
    scale.value     = 0.85;

    // Enter — opacity easing + spring translate + spring scale (subtle pop)
    opacity.value = withSequence(
      withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(VISIBLE_MS, withTiming(0, { duration: EXIT_MS })),
    );

    translate.value = withSequence(
      withSpring(0, {
        damping:           16,
        stiffness:         170,
        mass:              0.85,
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

    scale.value = withSpring(1, {
      damping:   10,
      stiffness: 220,
      mass:      0.6,
    });

    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translate);
      cancelAnimation(scale);
    };
    // Re-arm only when a new check-in lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.ts]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [
      { translateY: translate.value },
      { scale:      scale.value     },
    ],
  }));

  if (!shouldRender(result)) return null;

  const tone           = toneFor(result!.type);
  // Caller-supplied subtitle wins (used by the Aware Run intro tap); otherwise
  // fall back to the auto-computed earnings tail.
  const earningsTail   = result!.subtitle ?? renderEarningsTail(result!);
  const isCelebration  = tone.confetti.length > 0;
  // Theme reference is kept for future cross-theming; suppress linter for now.
  void theme;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + 6 }]}
    >
      <Animated.View style={[styles.stage, wrapStyle]} pointerEvents="box-none">
        {/* ── Confetti & sparkles layer (renders BEHIND the pill so the card
            stays legible, with shards trailing outward into the margins) ── */}
        {isCelebration ? (
          <View pointerEvents="none" style={styles.confettiLayer}>
            {Array.from({ length: SHARD_COUNT }).map((_, i) => (
              <Shard
                key={`shard-${result!.ts}-${i}`}
                index={i}
                tonePalette={tone.confetti}
              />
            ))}
            {Array.from({ length: SPARKLE_COUNT }).map((_, i) => (
              <Sparkle
                key={`spark-${result!.ts}-${i}`}
                index={i}
                accent={tone.accent}
              />
            ))}
          </View>
        ) : null}

        {/* ── The pill ─────────────────────────────────────────────────── */}
        <Pressable
          onPress={() => clear()}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.pill, { borderColor: tone.border }]}
        >
          <LinearGradient
            colors={tone.cardGrad}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />

          {/* Icon bubble with halo */}
          <View style={[styles.iconHalo, { backgroundColor: tone.iconHalo }]}>
            <View style={[styles.iconBubble, { backgroundColor: tone.iconBg }]}>
              <Text style={styles.iconEmoji}>{tone.emoji}</Text>
            </View>
          </View>

          {/* Title + earnings tail */}
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={2}>
              {result!.message}
            </Text>
            {earningsTail ? (
              <Text style={[styles.tail, { color: tone.accent }]} numberOfLines={2}>
                {earningsTail}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
};

export default CheckInBanner;

// ─── Confetti shard — rectangle that bursts outward + falls + rotates ──────

const Shard: React.FC<{
  index:       number;
  tonePalette: string[];
}> = ({ index, tonePalette }) => {
  // Per-mount randoms — stable across this shard's animation cycle.
  const { color, burstX, burstY, rotEnd, delay, w, h } = useMemo(() => {
    const dir = Math.random() < 0.5 ? -1 : 1;
    return {
      color:  tonePalette[index % tonePalette.length],
      burstX: dir * (40 + Math.random() * 130),
      burstY: -10 + Math.random() * 110,
      rotEnd: (Math.random() - 0.5) * 720,
      delay:  Math.floor(Math.random() * 220),
      w:      3 + Math.random() * 3,
      h:      6 + Math.random() * 6,
    };
  }, [index, tonePalette]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const r  = useSharedValue(0);
  const op = useSharedValue(0);

  useEffect(() => {
    tx.value = 0;
    ty.value = 0;
    r.value  = 0;
    op.value = 0;

    op.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 900, easing: Easing.in(Easing.cubic) }),
      ),
    );
    tx.value = withDelay(delay, withTiming(burstX, { duration: 1100, easing: Easing.out(Easing.quad) }));
    ty.value = withDelay(delay, withTiming(burstY, { duration: 1100, easing: Easing.in(Easing.quad) }));
    r.value  = withDelay(delay, withTiming(rotEnd, { duration: 1100, easing: Easing.linear }));

    return () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(r);
      cancelAnimation(op);
    };
  }, [burstX, burstY, rotEnd, delay]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    opacity:   op.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate:     `${r.value}deg` },
    ],
  }));

  return (
    <Animated.View
      style={[
        styles.shard,
        { backgroundColor: color, width: w, height: h },
        style,
      ]}
    />
  );
};

// ─── Sparkle — slow-rising "✨" emoji, gives the moment a magic-dust feel ──

const Sparkle: React.FC<{
  index:  number;
  accent: string;
}> = ({ index, accent }) => {
  const { burstX, burstY, delay, size } = useMemo(() => ({
    burstX: (Math.random() - 0.5) * 180,
    burstY: -20 - Math.random() * 60,
    delay:  Math.floor(150 + Math.random() * 350),
    size:   12 + Math.random() * 6,
  }), [index]);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  const sc = useSharedValue(0.6);

  useEffect(() => {
    tx.value = 0;
    ty.value = 0;
    op.value = 0;
    sc.value = 0.6;

    op.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
        withDelay(450, withTiming(0, { duration: 600, easing: Easing.in(Easing.cubic) })),
      ),
    );
    tx.value = withDelay(delay, withTiming(burstX, { duration: 1200, easing: Easing.out(Easing.quad) }));
    ty.value = withDelay(delay, withTiming(burstY, { duration: 1200, easing: Easing.out(Easing.quad) }));
    sc.value = withDelay(delay, withSpring(1, { damping: 9, stiffness: 180, mass: 0.5 }));

    return () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(op);
      cancelAnimation(sc);
    };
  }, [burstX, burstY, delay]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({
    opacity:   op.value,
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale:      sc.value },
    ],
  }));

  return (
    <Animated.View style={[styles.sparkle, style]}>
      <Text style={[styles.sparkleEmoji, { fontSize: size, color: accent }]}>✨</Text>
    </Animated.View>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const shouldRender = (r: CheckInResult | null): boolean =>
  !!r && r.type !== 'SAME_DAY' && !!r.message;

const renderEarningsTail = (r: CheckInResult): string => {
  if (r.rpAwarded <= 0 && r.epcAwarded <= 0) return '';
  const parts: string[] = [];
  if (r.rpAwarded  > 0) parts.push(`+${r.rpAwarded} RP`);
  if (r.epcAwarded > 0) parts.push(`+${r.epcAwarded} EPC`);
  return parts.join(' · ');
};

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  host: {
    position:   'absolute',
    left:       16,
    right:      16,
    alignItems: 'center',
    zIndex:     1000,
    elevation:  1000,
  },
  stage: {
    width:      '100%',
    maxWidth:   520,
    alignItems: 'center',
  },

  // ── Pill ──
  pill: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 14,
    paddingVertical:   10,
    borderRadius:      18,
    borderWidth:       1.5,
    width:             '100%',
    overflow:          'hidden',
    shadowColor:       '#000',
    shadowOpacity:     0.35,
    shadowRadius:      18,
    shadowOffset:      { width: 0, height: 10 },
    elevation:         16,
  },

  // ── Icon bubble + halo ──
  iconHalo: {
    width:          40,
    height:         40,
    borderRadius:   20,
    alignItems:     'center',
    justifyContent: 'center',
    marginRight:    12,
  },
  iconBubble: {
    width:          30,
    height:         30,
    borderRadius:   15,
    alignItems:     'center',
    justifyContent: 'center',
  },
  iconEmoji: {
    fontSize:   16,
    lineHeight: 18,
  },

  // ── Text body ──
  body: {
    flex: 1,
  },
  title: {
    color:         '#F5F7FA',
    fontSize:      13,
    fontWeight:    '800',
    letterSpacing: 0.1,
    lineHeight:    17,
  },
  tail: {
    fontSize:      12,
    fontWeight:    '800',
    letterSpacing: 0.3,
    marginTop:     2,
  },

  // ── Confetti layer ──
  confettiLayer: {
    position:       'absolute',
    top:            0,
    left:           0,
    right:          0,
    bottom:         0,
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'visible',
  },
  shard: {
    position:     'absolute',
    borderRadius: 1.5,
  },
  sparkle: {
    position: 'absolute',
  },
  sparkleEmoji: {
    // Default; per-instance fontSize overrides via inline style.
    textShadowColor:  'rgba(0,0,0,0.35)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
});
