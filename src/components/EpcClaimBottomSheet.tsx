// =============================================================================
// EpcClaimBottomSheet — explicit "Zero-Transaction Day" reward claim sheet.
//
// Trigger contract (owned by the parent):
//   • First app launch of the day
//   • Look-back confirms yesterday had 0 transactions
//   • The reward for that calendar day is still unclaimed
//
// Dismissal contract:
//   • Cannot be dismissed by tapping outside, swipe, or Android back.
//   • Only the primary Claim action closes the sheet — the user must
//     consciously accept the reward.
//
// Animation contract:
//   • Reanimated spring up on appear (heavy & physical).
//   • Reanimated timing down on claim, then the parent's onClaim fires —
//     parent updates EPC state, which triggers the header chip's own
//     scale-spring sequence to "pool" the coins into the vault.
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
  ViewStyle,
  TextStyle,
} from 'react-native';
import LottieView from 'lottie-react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radius, spacing, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { hapticSuccess } from '../utils/haptics';
import ThreeDEngravedCoin from './ThreeDEngravedCoin';

// ── Constants ────────────────────────────────────────────────────────────────

const { height: SCREEN_H } = Dimensions.get('window');

const ENTER_TIMING = { duration: 320, easing: Easing.out(Easing.cubic) };
const EXIT_TIMING  = { duration: 320, easing: Easing.in(Easing.cubic) };

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  /** Parent decides when to surface the sheet (after the trigger check). */
  visible: boolean;
  /** EPC (ePurse Coins) amount to award. */
  epcAmount: number;
  /** RP (Reality Points) amount to award. */
  rpAmount: number;
  /**
   * Fired AFTER the dismiss animation completes. The parent should:
   *   1. Credit both rpAmount and epcAmount to their respective balances.
   *   2. Mark the day as claimed (look-back guard).
   *   3. Trigger the header chip scale-spring sequence.
   */
  onClaim: () => void;
};

// ── Component ────────────────────────────────────────────────────────────────

const EpcClaimBottomSheet: React.FC<Props> = ({ visible, epcAmount, rpAmount, onClaim }) => {
  const theme = useTheme();

  // Keep the Modal mounted through the exit animation so the slide-down
  // is actually visible even after `visible` flips false in the parent.
  const [mounted, setMounted] = useState<boolean>(false);
  const [showConfetti, setShowConfetti] = useState<boolean>(false);
  // Guard so ConfettiShower onFinish and the timeout can't both dismiss.
  const dismissedRef = useRef<boolean>(false);

  const sheetY = useSharedValue<number>(SCREEN_H);
  const scrim  = useSharedValue<number>(0);
  const coin   = useSharedValue<number>(0.7);

  // ── Enter / exit driven by `visible` ──────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setMounted(true);
      dismissedRef.current = false;
      sheetY.value = withTiming(0, ENTER_TIMING);
      scrim.value  = withTiming(1, { duration: 260 });
      coin.value   = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    }
  }, [visible, sheetY, scrim, coin]);

  // ── Dismiss (called from timeout or didJustFinish, whichever comes first) ─
  const dismissSheet = (): void => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setShowConfetti(false);
    scrim.value = withTiming(0, { duration: 260 });
    sheetY.value = withTiming(SCREEN_H, EXIT_TIMING, (finished) => {
      if (finished) {
        runOnJS(setMounted)(false);
        runOnJS(onClaim)();
      }
    });
  };

  const handleAnimationFinish = (): void => {
    dismissSheet();
  };

  // ── Claim handler ─────────────────────────────────────────────────────────
  const handleClaim = (): void => {
    hapticSuccess();
    setShowConfetti(true);
    // Fallback: dismiss after 1.6 s in case video fails or runs longer.
    setTimeout(dismissSheet, 1600);
  };

  // ── Animated styles ───────────────────────────────────────────────────────
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrim.value,
  }));
  const coinStyle = useAnimatedStyle(() => ({
    transform: [{ scale: coin.value }],
  }));

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      // No-op — hardware back / outside taps cannot dismiss this sheet.
      onRequestClose={() => {}}
    >
      {/* Backdrop scrim — receives outside taps but does NOT close. */}
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { /* locked */ }} />
      </Animated.View>

      {/* Confetti overlay — plays once then dismisses the sheet */}
      {showConfetti && (
        <View style={styles.confettiOverlay} pointerEvents="none">
          <LottieView
            source={require('../assets/confetti.json')}
            style={StyleSheet.absoluteFill}
            autoPlay
            loop={false}
            onAnimationFinish={handleAnimationFinish}
          />
        </View>
      )}

      {/* Sheet body */}
      <Animated.View style={[styles.sheetWrap, sheetStyle]} pointerEvents="box-none">
        <SafeAreaView edges={['bottom']} style={styles.safe}>
          <View style={[styles.sheet, { backgroundColor: theme.card }]}>
            {/* Handle (decorative — not interactive) */}
            <View style={[styles.handle, { backgroundColor: theme.divider }]} />

            {/* Coin spotlight */}
            <View style={styles.coinSpotlight}>
              <View style={styles.coinHalo} />
              <Animated.View style={coinStyle}>
                <ThreeDEngravedCoin size={132} />
              </Animated.View>
            </View>

            {/* Copy */}
            <Text style={[styles.title, { color: theme.textPrimary }]}>
              Zero-Transaction Day!
            </Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              Your Aware Run stays unbroken. Zero transactions yesterday
              earns you a Savings Bonus on top of your streak.
            </Text>

            {/* Reward pills — RP + EPC */}
            <View style={styles.rewardRow}>
              <View style={[styles.rewardPill, { backgroundColor: theme.darkMode ? '#3B2A6B' : '#EDE9FE' }]}>
                <Text style={[styles.rewardPillValue, { color: '#7C3AED' }]}>+{rpAmount} RP</Text>
                <Text style={[styles.rewardPillLabel, { color: theme.textSecondary }]}>Reality Points</Text>
              </View>
              <View style={[styles.rewardPill, { backgroundColor: theme.darkMode ? '#3B2A0A' : '#FEF9E7' }]}>
                <Text style={[styles.rewardPillValue, { color: '#A0782A' }]}>+{epcAmount} EPC</Text>
                <Text style={[styles.rewardPillLabel, { color: theme.textSecondary }]}>ePurse Coins</Text>
              </View>
            </View>

            {/* Primary claim CTA — gold gradient pill */}
            <TouchableOpacity
              activeOpacity={0.88}
              onPress={handleClaim}
              style={styles.claimBtnWrap}
            >
              <LinearGradient
                colors={['#FFE89A', '#E6B958', '#A0782A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.claimBtn}
              >
                <Text style={styles.claimBtnText}>
                  Claim Savings Bonus
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
};

export default EpcClaimBottomSheet;

// ── Styles ───────────────────────────────────────────────────────────────────
// Theme-dependent colors (card, divider, textPrimary, textSecondary) are
// applied inline via the theme object. Everything here is layout/sizing only.

const styles = StyleSheet.create<{
  scrim: ViewStyle;
  sheetWrap: ViewStyle;
  safe: ViewStyle;
  sheet: ViewStyle;
  handle: ViewStyle;
  coinSpotlight: ViewStyle;
  coinHalo: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  rewardRow: ViewStyle;
  rewardPill: ViewStyle;
  rewardPillValue: TextStyle;
  rewardPillLabel: TextStyle;
  claimBtnWrap: ViewStyle;
  claimBtn: ViewStyle;
  claimBtnText: TextStyle;
  confettiOverlay: ViewStyle;
}>({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000B8',
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  safe: {
    backgroundColor: 'transparent',
  },
  sheet: {
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    ...shadows.elevated,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: spacing.lg,
  },

  // Coin presentation
  coinSpotlight: {
    width: 168,
    height: 168,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  coinHalo: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: '#E6B95822',
  },

  // Typography
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },

  // Primary CTA
  claimBtnWrap: {
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    ...shadows.elevated,
  },
  claimBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  claimBtnText: {
    color: '#1A1305',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  confettiOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },

  // Reward pills row
  rewardRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
    width: '100%',
  },
  rewardPill: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: 2,
  },
  rewardPillValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  rewardPillLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
