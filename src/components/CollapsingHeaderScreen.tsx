// =============================================================================
// CollapsingHeaderScreen — the app's ONE themed-header component, in two modes.
//
// This is the single source of truth for "gradient header at the top of a
// screen". Every screen's themed header renders through here so the chrome —
// gradient, curved bottom, safe-area inset, gutter, and the standard title bar
// (back chevron + title + right slot) — is defined once and stays consistent.
//
// ── Collapsing mode (default, `collapsible` = true) — e.g. Accounts ──
// A gradient header with a curved bottom sits pinned at the top. As the body
// scrolls up:
//   • the whole header (incl. the curve) translates up until only the compact
//     "bar" remains — a sticky title strip,
//   • the body scrolls UNDER the curved header (the header moves at `parallax`×
//     the scroll speed, so the faster content tucks beneath the curve),
//   • the tall "hero" region fades + slides away,
//   • `renderBar` receives a 0→1 `progress` so the caller can animate something
//     IN as the hero animates OUT (e.g. slide a value-chip into the top-right).
// The header is absolutely positioned over an Animated.ScrollView whose top
// padding equals the expanded header height. Transforms/opacity run on the
// native thread (useNativeDriver).
//
// ── Fixed mode (`collapsible` = false) — every other screen ──
// A static, content-sized gradient header at the top; `children` render BELOW it
// in normal flow, so the screen keeps its own body (ScrollView / FlatList /
// TabView). No scroll animation, no owned ScrollView — the least invasive way to
// give a screen the shared themed header.
//
// Standard bar: if `renderBar` is omitted, the component renders a standardized
// title row from `title` / `onBack` / `headerRight` (chevron-back + title + right
// node) — so simple screens don't re-implement the same row. Pass `renderBar`
// (and `renderHero`) for custom header content.
// =============================================================================

import React, { useRef, type ReactNode } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { spacing, radius } from '../constants/theme';

type Interp = Animated.AnimatedInterpolation<number>;

/** Default pinned-bar height (excl. safe-area inset) when a caller omits one. */
const DEFAULT_BAR_H = 44;

export interface CollapsingHeaderScreenProps {
  /** Themed gradient for the header, e.g. [start, end]. */
  gradientColors: string[];
  /**
   * false → static header, `children` render below it (screen owns its body).
   * true (default) → header collapses on scroll and owns the ScrollView.
   */
  collapsible?: boolean;
  /** Height of the always-visible pinned bar (excl. inset). Default 44. */
  barHeight?: number;
  /** Height of the hero region that collapses/fades (excl. inset). Default 0. */
  heroHeight?: number;
  /** Bottom-corner curve radius of the header. */
  curveRadius?: number;
  /**
   * How fast the header slides up relative to the scroll (0–1). < 1 makes the body
   * scroll UNDER the curved header (content outpaces it); 1 keeps content flush to
   * the header's bottom edge. Default 0.6. (Collapsing mode only.)
   */
  parallax?: number;
  /** Horizontal inset applied to the bar, hero and (by default) the body. */
  gutter?: number;
  // ── Standard-bar convenience (used when `renderBar` is not provided) ──
  /** Title shown in the standard bar. */
  title?: string;
  /** If set, the standard bar shows a back chevron that calls this. */
  onBack?: () => void;
  /** Node pinned to the right of the standard bar (icons/actions). */
  headerRight?: ReactNode;
  /** Foreground colour for the standard bar (title + chevron). Default #fff. */
  tint?: string;
  /**
   * Custom pinned bar content. Receives `progress` (0 = expanded → 1 = collapsed;
   * always 0 in fixed mode). Overrides the standard bar when provided.
   */
  renderBar?: (progress: Interp) => ReactNode;
  /**
   * Hero content. Collapsing mode fades + parallaxes it out; fixed mode renders
   * it statically under the bar.
   */
  renderHero?: () => ReactNode;
  /** Body. Collapsing: inside the owned ScrollView. Fixed: below the header. */
  children?: ReactNode;
  /** Extra style for the scroll content container (paddingTop is managed here). */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Forwarded to the underlying Animated.ScrollView. (Collapsing mode only.) */
  scrollRef?: React.Ref<Animated.LegacyRef<any>> | any;
  refreshControl?: React.ReactElement;
  /** Optional passthrough scroll listener (runs alongside the native driver). */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  showsVerticalScrollIndicator?: boolean;
}

/** Standardized title row: [chevron-back?] title [right?]. */
const StandardBar: React.FC<{
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
  tint: string;
}> = ({ title, onBack, right, tint }) => (
  <View style={styles.stdBar}>
    {onBack ? (
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.stdBackBtn}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color={tint} />
      </TouchableOpacity>
    ) : null}
    {title ? (
      <Text style={[styles.stdTitle, { color: tint }]} numberOfLines={1}>
        {title}
      </Text>
    ) : (
      <View style={styles.stdTitle} />
    )}
    {right ? <View style={styles.stdRight}>{right}</View> : null}
  </View>
);

const CollapsingHeaderScreen: React.FC<CollapsingHeaderScreenProps> = ({
  gradientColors,
  collapsible = true,
  barHeight = DEFAULT_BAR_H,
  heroHeight = 0,
  curveRadius = radius.xl,
  parallax = 0.6,
  gutter = spacing.lg,
  title,
  onBack,
  headerRight,
  tint = '#fff',
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
  // A frozen 0-progress interpolation for fixed mode / callers that ignore it.
  const zeroProgress = useRef(
    new Animated.Value(0).interpolate({ inputRange: [0, 1], outputRange: [0, 0] }),
  ).current;

  // Bar content: an explicit renderBar wins; otherwise the standard title row.
  const barContent = (progress: Interp) =>
    renderBar
      ? renderBar(progress)
      : <StandardBar title={title} onBack={onBack} right={headerRight} tint={tint} />;

  // ── Fixed mode: static header, body flows below ─────────────────────────────
  if (!collapsible) {
    // With children the wrapper fills the screen (body below the header); without
    // children (header-only, e.g. a TabView tab bar) it content-sizes to the header.
    return (
      <View style={children != null ? styles.root : undefined}>
        <View
          style={[
            styles.fixedHeader,
            {
              paddingTop: insets.top,
              paddingHorizontal: gutter,
              borderBottomLeftRadius: curveRadius,
              borderBottomRightRadius: curveRadius,
            },
          ]}
        >
          <LinearGradient
            colors={gradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {barContent(zeroProgress)}
          {/* Rendered directly (no margin wrapper) so each screen's own hero
              top-margins reproduce its original bar↔content spacing exactly. */}
          {renderHero ? renderHero() : null}
        </View>
        {children != null ? <View style={styles.fill}>{children}</View> : null}
      </View>
    );
  }

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
          {barContent(progress)}
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
  // Fixed mode — static header block that content-sizes to its bar + hero.
  fixedHeader: {
    overflow: 'hidden', // clip the gradient to the curved corners
    paddingBottom: spacing.lg,
    zIndex: 10,
    elevation: 6,
  },
  // Standard bar
  stdBar: { flexDirection: 'row', alignItems: 'center', minHeight: DEFAULT_BAR_H },
  stdBackBtn: { marginRight: spacing.sm, marginLeft: -4 },
  stdTitle: { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  stdRight: { flexDirection: 'row', alignItems: 'center', marginLeft: spacing.sm },
});
