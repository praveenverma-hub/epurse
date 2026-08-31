// =============================================================================
// AwareChip.tsx — SUPERSEDED by CrystalPiggyVault
// TODO: Review or remove this file once CrystalPiggyVault flow is confirmed stable.
//       The flame capsule + cross-fade square chip logic is preserved here for reference.
// =============================================================================

// import React, { useEffect } from 'react';
// import {
//   StyleSheet,
//   Text,
//   View,
//   TouchableOpacity,
//   type ViewStyle,
// } from 'react-native';
// import Animated, {
//   Easing,
//   cancelAnimation,
//   interpolate,
//   useAnimatedStyle,
//   useSharedValue,
//   withDelay,
//   withRepeat,
//   withSequence,
//   withTiming,
// } from 'react-native-reanimated';
//
// import { useRewardStore, selectAwareStreak } from '../store/useRewardStore';
// import { REWARD_CONFIG } from '../config/rewardConfig';
// import LiveFlame from './LiveFlame';
//
// // ─── Public types ───────────────────────────────────────────────────────────
//
// export interface AwareChipProps {
//   /** Fired when the user taps the chip — usually navigation to the Profile hub. */
//   onPress?: () => void;
//   /** Optional extra style applied to the outermost touchable. */
//   style?:   ViewStyle;
// }
//
// // ─── Constants (sourced from rewardConfig.ts) ───────────────────────────────
//
// const TIER_SWITCH_DAYS = REWARD_CONFIG.CHIP_TIER2_DAYS;
// const PHASE_MS         = REWARD_CONFIG.CHIP_PHASE_MS;
// const FADE_MS          = REWARD_CONFIG.CHIP_FADE_MS;
// const SQUARE_SIZE      = 44;
//
// // ─── Component ──────────────────────────────────────────────────────────────
//
// const AwareChip: React.FC<AwareChipProps> = ({ onPress, style }) => {
//   const awareStreak = useRewardStore(selectAwareStreak);
//   const days        = Math.max(0, Math.floor(awareStreak));
//
//   if (days < TIER_SWITCH_DAYS) {
//     return <Tier1Capsule days={days} onPress={onPress} style={style} />;
//   }
//   return <Tier2LiveSquare days={days} onPress={onPress} style={style} />;
// };
//
// export default AwareChip;
//
// // ─── Tier 1: Onboarding capsule ─────────────────────────────────────────────
//
// const Tier1Capsule: React.FC<{
//   days:     number;
//   onPress?: () => void;
//   style?:   ViewStyle;
// }> = ({ days, onPress, style }) => {
//   const label = days <= 0 ? 'Start' : `${days}d`;
//
//   return (
//     <TouchableOpacity
//       style={[styles.capsule, style]}
//       onPress={onPress}
//       activeOpacity={0.8}
//       accessibilityRole="button"
//       accessibilityLabel={`Aware streak ${days} days`}
//     >
//       <Text style={styles.capsuleEmoji}>🔥</Text>
//       <Text style={styles.capsuleDays}>{label}</Text>
//       <Text style={styles.capsuleSuffix}>Aware</Text>
//     </TouchableOpacity>
//   );
// };
//
// // ─── Tier 2: Live cross-fade square ─────────────────────────────────────────
//
// const Tier2LiveSquare: React.FC<{
//   days:     number;
//   onPress?: () => void;
//   style?:   ViewStyle;
// }> = ({ days, onPress, style }) => {
//   const cycle = useSharedValue(0);
//
//   useEffect(() => {
//     cycle.value = withDelay(
//       120,
//       withRepeat(
//         withSequence(
//           withTiming(0, { duration: PHASE_MS - FADE_MS }),
//           withTiming(1, { duration: FADE_MS, easing: Easing.inOut(Easing.cubic) }),
//           withTiming(1, { duration: PHASE_MS - FADE_MS }),
//           withTiming(0, { duration: FADE_MS, easing: Easing.inOut(Easing.cubic) }),
//         ),
//         -1,
//         false,
//       ),
//     );
//     return () => cancelAnimation(cycle);
//   }, [cycle]);
//
//   const flameLayerStyle = useAnimatedStyle(() => ({
//     opacity:   interpolate(cycle.value, [0, 1], [1, 0]),
//     transform: [{ translateY: interpolate(cycle.value, [0, 1], [0, -3]) }],
//   }));
//
//   const numberLayerStyle = useAnimatedStyle(() => ({
//     opacity:   interpolate(cycle.value, [0, 1], [0, 1]),
//     transform: [{ translateY: interpolate(cycle.value, [0, 1], [4, 0]) }],
//   }));
//
//   return (
//     <TouchableOpacity
//       style={[styles.square, style]}
//       onPress={onPress}
//       activeOpacity={0.85}
//       accessibilityRole="button"
//       accessibilityLabel={`Aware streak ${days} days`}
//     >
//       <View style={[styles.squareGlow, { backgroundColor: glowForStreak(days) }]} />
//       <Animated.View style={[styles.squareLayer, flameLayerStyle]}>
//         <LiveFlame size={26} />
//       </Animated.View>
//       <Animated.View style={[styles.squareLayer, numberLayerStyle]}>
//         <Text style={styles.squareNumber}>{days}</Text>
//         <Text style={styles.squareCaption}>Aware</Text>
//       </Animated.View>
//     </TouchableOpacity>
//   );
// };
//
// // ─── Helpers ────────────────────────────────────────────────────────────────
//
// const glowForStreak = (days: number): string => {
//   if (days >= 30) return 'rgba(34, 211, 238, 0.18)';
//   if (days >= 14) return 'rgba(167, 139, 250, 0.18)';
//   return 'rgba(251, 146, 60, 0.20)';
// };
//
// // ─── Styles ─────────────────────────────────────────────────────────────────
//
// const styles = StyleSheet.create({
//   capsule: {
//     flexDirection:     'row',
//     alignItems:        'center',
//     paddingHorizontal: 10,
//     paddingVertical:   7,
//     borderRadius:      999,
//     backgroundColor:   'rgba(255,255,255,0.18)',
//     borderWidth:       1,
//     borderColor:       'rgba(255,255,255,0.28)',
//     gap: 6,
//   },
//   capsuleEmoji:  { fontSize: 13, lineHeight: 15 },
//   capsuleDays:   { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: -0.2 },
//   capsuleSuffix: { color: 'rgba(255,255,255,0.78)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
//
//   square: {
//     width:           44,
//     height:          44,
//     borderRadius:    14,
//     backgroundColor: 'rgba(255,255,255,0.16)',
//     borderWidth:     1,
//     borderColor:     'rgba(255,255,255,0.28)',
//     overflow:        'hidden',
//     alignItems:      'center',
//     justifyContent:  'center',
//   },
//   squareGlow:    { ...StyleSheet.absoluteFillObject },
//   squareLayer:   { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
//   squareNumber:  { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: -0.5, lineHeight: 20 },
//   squareCaption: { color: 'rgba(255,255,255,0.78)', fontSize: 8, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 1 },
// });
