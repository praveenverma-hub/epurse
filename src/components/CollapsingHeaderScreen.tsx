// =============================================================================
// CollapsingHeaderScreen — reusable "themed header that collapses on scroll".
//
// A gradient header with a curved bottom sits pinned at the top. As the body
// scrolls up:
//   • the whole header (incl. the curve) translates up until only the compact
//     "bar" remains — a sticky title strip,
//   • the body scrolls UNDER the curved header (the header moves at `parallax`×
//     the scroll speed, so the faster content tucks beneath the curve),
//   • the tall "hero" region fades + slides away,
//   • `renderBar` receives a 0→1 `progress` so the caller can animate something
//     IN as the hero animates OUT (e.g. slide a value-chip into the top-right).
//
// The header is absolutely positioned over an Animated.ScrollView whose top
// padding equals the expanded header height, so content lines up exactly and the
// two meet seamlessly at full collapse. Transforms/opacity run on the native
// thread (useNativeDriver).
//
// Generic on purpose — no app-specific content lives here. Screens pass the
// gradient, the two heights, and render props for the bar + hero. Reuse anywhere
// a screen wants a themed header that condenses its headline metric on scroll.
// =============================================================================

import React, { useRef, type ReactNode } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, radius } from '../constants/theme';

type Interp = Animated.AnimatedInterpolation<number>;

export interface CollapsingHeaderScreenProps {
  /** Themed gradient for the header, e.g. [start, end]. */
  gradientColors: string[];
  /** Height of the always-visible pinned bar (excl. the top safe-area inset). */
  barHeight: number;
  /** Height of the hero region that collapses/fades (excl. safe-area inset). */
  heroHeight: number;
  /** Bottom-corner curve radius of the header. */
  curveRadius?: number;
  /**
   * How fast the header slides up relative to the scroll (0–1). < 1 makes the body
   * scroll UNDER the curved header (content outpaces it); 1 keeps content flush to
   * the header's bottom edge. Default 0.6.
   */
  parallax?: number;
  /** Horizontal inset applied to the bar, hero and (by default) the body. */
  gutter?: number;
  /**
   * Pinned bar content. Receives `progress` (0 = expanded → 1 = collapsed) so a
   * chip/title can fade or slide in as the hero collapses.
   */
  renderBar: (progress: Interp) => ReactNode;
  /** Hero content; the component fades + parallaxes it out as it collapses. */
  renderHero?: () => ReactNode;
  /** Scrollable body. */
  children: ReactNode;
  /** Extra style for the scroll content container (paddingTop is managed here). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Forwarded to the underlying Animated.ScrollView. */
  scrollRef?: React.Ref<Animated.LegacyRef<any>> | any;
  refreshControl?: React.ReactElement;
  /** Optional passthrough scroll listener (runs alongside the native driver). */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  showsVerticalScrollIndicator?: boolean;
}

const CollapsingHeaderScreen: React.FC<CollapsingHeaderScreenProps> = ({
  gradientColors,
  barHeight,
  heroHeight,
  curveRadius = radius.xl,
  parallax = 0.6,
  gutter = spacing.lg,
  renderBar,
  renderHero,
  children,
  contentContainerStyle,
  scrollRef,
  refreshControl,
  onScroll,
  showsVerticalScrollIndicator = false,
}) => {
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

  const headerTotal    = insets.top + barHeight + heroHeight;
  const collapsedTotal = insets.top + barHeight;
  // The header only needs to travel `heroHeight` to fully collapse, but it moves at
  // `parallax`× the scroll speed — so it takes FULL px of scroll to get there, and
  // in the meantime the (faster) content slides UNDER the curved header.
  const P    = Math.min(1, Math.max(0.1, parallax));
  const FULL = heroHeight / P;

  const clamp = { extrapolate: 'clamp' as const };
  // Header (and its curve) slides up until only the bar remains.
  const headerTranslate = scrollY.interpolate({ inputRange: [0, FULL], outputRange: [0, -heroHeight], ...clamp });
  // Bar counter-translates by the same amount → stays pinned on screen.
  const barCounter      = scrollY.interpolate({ inputRange: [0, FULL], outputRange: [0, heroHeight], ...clamp });
  // 0 → 1 collapse progress handed to the caller's bar.
  const progress        = scrollY.interpolate({ inputRange: [0, FULL], outputRange: [0, 1], ...clamp });
  // Hero fades a touch faster than it collapses so it's gone before it tucks behind the bar.
  const heroOpacity     = scrollY.interpolate({ inputRange: [0, FULL * 0.55], outputRange: [1, 0], ...clamp });

  const onScrollEvent = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: true, listener: onScroll },
  );

  return (
    <View style={styles.root}>
      {/* Body — rendered first so the header paints on top of it. */}
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.fill}
        contentContainerStyle={[{ paddingTop: headerTotal }, contentContainerStyle]}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        scrollEventThrottle={16}
        onScroll={onScrollEvent}
        refreshControl={refreshControl}
      >
        {children}
      </Animated.ScrollView>

      {/* Header — absolute, slides up as you scroll. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.header,
          {
            height: headerTotal,
            borderBottomLeftRadius: curveRadius,
            borderBottomRightRadius: curveRadius,
            transform: [{ translateY: headerTranslate }],
          },
        ]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Hero — fades + slides up with the header. */}
        {renderHero ? (
          <Animated.View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: insets.top + barHeight,
              height: heroHeight,
              paddingHorizontal: gutter,
              justifyContent: 'center',
              opacity: heroOpacity,
            }}
          >
            {renderHero()}
          </Animated.View>
        ) : null}

        {/* Pinned bar — counter-translated so it stays put while the header rises. */}
        <Animated.View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: collapsedTotal,
            paddingTop: insets.top,
            paddingHorizontal: gutter,
            justifyContent: 'center',
            transform: [{ translateY: barCounter }],
          }}
        >
          {renderBar(progress)}
        </Animated.View>
      </Animated.View>
    </View>
  );
};

export default CollapsingHeaderScreen;

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden', // clip the gradient to the curved corners
    zIndex: 10,
    elevation: 6,       // Android drop shadow under the sticky bar
  },
});
