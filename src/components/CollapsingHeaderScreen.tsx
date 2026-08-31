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
//   • a SEPARATE light bar cross-fades in over it, so what is left pinned at the
//     top is chrome (card + hairline + elevation — the tab bar's surface
//     language) rather than a saturated band sitting on the content,
//   • `renderBar` receives a 0→1 `progress` so the caller can animate something
//     IN as the hero animates OUT (e.g. slide a value-chip into the top-right).
//
// ── Why the pinned bar is a second component, not a recoloured first one ──
// The obvious implementation is to interpolate every colour in the bar from
// white to dark. It does not survive contact with React Native: `color` /
// `backgroundColor` are NOT native-animatable, `scrollY` IS (it drives the
// transforms), and RN moves a whole props node to the native driver and then
// throws on any JS-driven value sharing it. That forces every text, icon,
// touchable and badge in every collapsing bar to be re-plumbed as an animated
// component with the two drivers kept apart by hand — a lot of surface area for
// a runtime error that no type or test catches.
//
// Two bars cross-fading on OPACITY need none of that. Opacity is native, the
// colours are plain static values on both sides, and each screen gets to make
// its pinned bar a deliberately simpler composition instead of a shrunken copy.
// The cost is that both bars are mounted, so interaction and the screen reader
// are gated on `pinned` — see `collapsedBar` / `expandedBar` below.
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

import React, { useCallback, useRef, useState, type ReactNode } from 'react';
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

import { spacing, radius, pinnedHeaderChrome } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { STATIC_CONFIG } from '../config/staticConfig';

type Interp = Animated.AnimatedInterpolation<number>;

/** Default pinned-bar height (excl. safe-area inset) when a caller omits one. */
const DEFAULT_BAR_H = 44;

/** Gradient below the hero. Mirrors `fixedHeader.paddingBottom` so the two modes
 *  end the header the same distance below their last row of content. */
const HEADER_PAD_B = spacing.lg;

/**
 * Where in the collapse (0 = expanded, 1 = pinned) the hero has finished fading
 * and the light bar starts coming in.
 *
 * One constant for both deliberately: the hero is white-on-gradient, so it must
 * be GONE before anything starts turning light behind it.
 */
const HERO_FADE_END = 0.55;
const LIGHTEN_START = HERO_FADE_END;

/**
 * How far down the collapse a release has to be before the header finishes
 * collapsing rather than reopening.
 *
 * Below half on purpose: the hero has faded out entirely by `HERO_FADE_END`
 * (0.55), so past ~0.4 the user is looking at a header whose tall content is
 * nearly gone — reopening it from there would fade a block of text back IN, which
 * reads as the app undoing the scroll. Under 0.4 the hero is still substantially
 * there and opening is the smaller move.
 */
const SNAP_AT = 0.4;

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
  /**
   * Height of the hero region that collapses/fades (excl. inset).
   *
   * OMIT IT and the hero measures itself — strongly preferred for anything whose
   * height depends on TEXT. The hero is laid out at exactly this height, so a
   * number that is too small clips it and one that is too large leaves it
   * floating, and neither shows up in a test: line height varies with the font,
   * the platform and the user's OS font-scale setting, so a value tuned on one
   * device is wrong on another.
   *
   * Pass it only for a hero built purely from fixed-size boxes.
   */
  heroHeight?: number;
  /**
   * First-frame guess used only until the self-measured height arrives (ignored
   * when `heroHeight` is given). It exists so the very first paint is close
   * enough that the correction isn't visible as a jump — being a few points out
   * is fine, being 200 out is not.
   */
  estimatedHeroHeight?: number;
  /** Bottom-corner curve radius of the header (expanded). */
  curveRadius?: number;
  /**
   * Bottom-corner radius of the PINNED bar. **Defaults to 0**: every collapsing
   * header is curved at rest — matching the app's cards — and pins as a flat
   * app-bar edge, where a curve reads as a floating shape rather than as chrome.
   *
   * Reached differently in each mode, but reached either way. With the light bar
   * it is that bar's static radius and the curve straightens as the two
   * cross-fade — a true sweep, nothing animating a radius. Without it, the header
   * snaps its own corner to this value at full collapse (see `headerRadius`).
   *
   * Pass `curveRadius`'s value to keep the curve while pinned.
   * (Collapsing mode only — a fixed header never pins.)
   */
  collapsedCurveRadius?: number;
  /**
   * How fast the header slides up relative to the scroll (0–1).
   *
   * **Defaults to 1**, which keeps the body a constant distance below the header
   * for the whole collapse. Below 1 the header LAGS the finger and the body
   * catches it: at 0.6, 100px of scroll already puts the first card 16pt BEHIND
   * the header, and it worsens from there. That tuck-under-the-curve was the
   * original default and it hid content people were trying to read.
   *
   * The body still passes under the PINNED BAR once the header has fully
   * collapsed — that is what a sticky bar is for. (Collapsing mode only.)
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
   * Custom bar content for the EXPANDED (on-gradient) header. Receives `progress`
   * (0 = expanded → 1 = collapsed; always 0 in fixed mode). Overrides the
   * standard bar when provided. Colours here are on-gradient: white is correct.
   */
  renderBar?: (progress: Interp) => ReactNode;
  /**
   * Bar content for the PINNED (light) state — a second, static composition that
   * cross-fades in as the header collapses. Colours here sit on
   * `collapsedSurface`, so they must be DARK; `pinnedInk` / `pinnedInkMuted` from
   * `pinnedHeaderChrome(collapsedSurface, theme)` are the values to use.
   *
   * Treat it as a chance to simplify, not as a copy to keep in sync: the pinned
   * bar is 54pt of chrome, so it wants the one or two controls that still matter,
   * not everything the tall header had. But it must not DROP an affordance that
   * has no other route (ui-consistency §2) — while pinned, the expanded bar
   * behind it is inert, so anything missing here is unreachable.
   *
   * Omit it and the standard title row is used, inked for the light surface.
   * (Collapsing mode only — a fixed header never pins.)
   */
  renderCollapsedBar?: () => ReactNode;
  /**
   * Colour the pinned bar paints. Defaults to `theme.card`, which makes it the
   * same surface as the tab bar at the other end of the screen. (Collapsing only.)
   */
  collapsedSurface?: string;
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
  /**
   * Fires when the header crosses into (or back out of) its pinned light state.
   *
   * The header covers the status-bar inset, so light glyphs stop being readable
   * the moment the pinned bar is opaque — but a declarative `<StatusBar>` mounted
   * here would leak its style onto the next tab (tab screens stay mounted). Pass
   * this to `useHeaderStatusBar`, which is imperative and focus-gated.
   *
   * A threshold, not a ramp: it fires on the crossing, so it costs one render per
   * collapse rather than one per frame.
   */
  onCollapseChange?: (collapsed: boolean) => void;
  showsVerticalScrollIndicator?: boolean;
}

/**
 * Standardized title row: [chevron-back?] title [right?].
 *
 * A back chevron means this is a pushed (second-level or deeper) screen, and
 * those centre their title; root/tab screens keep it left-aligned. When centred
 * the title is absolutely positioned rather than flexed, so unequal side slots
 * (a 24px chevron on the left vs. an action icon or nothing on the right) can't
 * push it off true centre.
 */
const StandardBar: React.FC<{
  title?: string;
  onBack?: () => void;
  right?: ReactNode;
  tint: string;
}> = ({ title, onBack, right, tint }) => {
  const centred = !!onBack;
  return (
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

      {centred ? (
        <View style={styles.stdFlex} />
      ) : title ? (
        <Text style={[styles.stdTitle, styles.stdTitleText, { color: tint }]} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.stdTitle} />
      )}

      {right ? <View style={styles.stdRight}>{right}</View> : null}

      {/* Centred title sits on top of the row; pointerEvents none so it can
          never swallow taps meant for the chevron or a right-slot action. */}
      {centred && title ? (
        <View style={styles.stdTitleCentreWrap} pointerEvents="none">
          <Text
            style={[styles.stdTitleText, styles.stdTitleCentre, { color: tint }]}
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const CollapsingHeaderScreen: React.FC<CollapsingHeaderScreenProps> = ({
  gradientColors,
  collapsible = true,
  barHeight = DEFAULT_BAR_H,
  heroHeight,
  estimatedHeroHeight = 0,
  curveRadius = radius.xl,
  collapsedCurveRadius = 0,
  parallax = 1,
  gutter = spacing.lg,
  title,
  onBack,
  headerRight,
  tint = '#fff',
  renderBar,
  renderCollapsedBar,
  collapsedSurface,
  renderHero,
  children,
  contentContainerStyle,
  scrollRef,
  refreshControl,
  onScroll,
  onCollapseChange,
  showsVerticalScrollIndicator = false,
}) => {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const scrollY = useRef(new Animated.Value(0)).current;
  // Both bars stay mounted and cross-fade, so the invisible one has to be made
  // inert — for touch AND for the screen reader. That needs a real boolean, not
  // an interpolation, so it is latched here and only changes on the crossing.
  const [pinned, setPinned] = useState(false);
  // Own handle on the scroll view so the header can finish its own collapse
  // (`snapHeader`), merged with the caller's `scrollRef` so passing one still
  // works. Declared up here with the other hooks, above the fixed-mode early
  // return, so the hook count can't depend on `collapsible`.
  const innerScrollRef = useRef<any>(null);
  const setScrollRef = useCallback(
    (node: any) => {
      innerScrollRef.current = node;
      if (typeof scrollRef === 'function') scrollRef(node);
      else if (scrollRef) (scrollRef as { current: any }).current = node;
    },
    [scrollRef],
  );
  // Self-measured hero height, used when the caller doesn't pin one.
  const [measuredHero, setMeasuredHero] = useState<number | null>(null);
  const autoHero = heroHeight == null;
  const onHeroLayout = useCallback((e: any) => {
    const h = Math.round(e.nativeEvent.layout.height);
    // Guard the update: onLayout fires on every re-render, and setting state
    // unconditionally would re-render forever.
    setMeasuredHero((prev) => (prev === h ? prev : h));
  }, []);
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

  const heroH = heroHeight ?? measuredHero ?? estimatedHeroHeight;
  // Breathing room below the hero, so the gradient doesn't end flush against the
  // last line of hero content. Fixed mode has always had this as
  // `fixedHeader.paddingBottom`; collapsing mode had none, so a migrated screen's
  // header stopped dead under its bottom row. It also gives the corner curve
  // something to draw into once the hero has collapsed away.
  const headerTotal    = insets.top + barHeight + heroH + HEADER_PAD_B;
  const collapsedTotal = insets.top + barHeight;
  // What the header actually MEASURES once fully collapsed: it is `headerTotal`
  // tall and has translated up by `heroH`, so its visible bottom edge is
  // `headerTotal - heroH` — i.e. `collapsedTotal` PLUS the bottom padding. The
  // pinned bar has to be exactly that, or it ends short of the edge it replaces
  // and its own row sits flush against the bottom with no breathing room.
  const pinnedTotal = collapsedTotal + HEADER_PAD_B;
  // The header only needs to travel `heroHeight` to fully collapse, but it moves at
  // `parallax`× the scroll speed — so it takes FULL px of scroll to get there, and
  // in the meantime the (faster) content slides UNDER the curved header.
  const P    = Math.min(1, Math.max(0.1, parallax));
  const FULL = Math.max(1, heroH / P);

  const clamp = { extrapolate: 'clamp' as const };
  // Header (and its curve) slides up until only the bar remains.
  const headerTranslate = scrollY.interpolate({ inputRange: [0, FULL], outputRange: [0, -heroH], ...clamp });
  // Bar counter-translates by the same amount → stays pinned on screen.
  const barCounter      = scrollY.interpolate({ inputRange: [0, FULL], outputRange: [0, heroH], ...clamp });
  // 0 → 1 collapse progress handed to the caller's bar.
  const progress        = scrollY.interpolate({ inputRange: [0, FULL], outputRange: [0, 1], ...clamp });
  // Hero fades a touch faster than it collapses so it's gone before it tucks behind the bar.
  const heroOpacity     = scrollY.interpolate({ inputRange: [0, FULL * HERO_FADE_END], outputRange: [1, 0], ...clamp });

  // ── The gradient → light cross-fade ─────────────────────────────────────────
  // Opacity ONLY, on the native driver, in both directions. That is the whole
  // reason this is two bars instead of one bar with animated colours — see the
  // note at the top of the file.
  //
  // The whole behaviour is behind ONE switch. With it off the header still
  // collapses to a pinned strip and still squares its corner at the end of the
  // travel, but it stays the gradient the entire way: the gradient bar never
  // fades, the light bar is never rendered, and `onCollapseChange` never reports
  // true — so callers keep passing `renderCollapsedBar` and wiring
  // `onCollapseChange` exactly as they do, and nothing has to be undone.
  const lightens = STATIC_CONFIG.header.lightenOnCollapse;
  const lightenRange = { inputRange: [FULL * LIGHTEN_START, FULL], ...clamp };
  const collapsedOpacity = scrollY.interpolate({ ...lightenRange, outputRange: [0, 1] });
  // A LITERAL 1, not an interpolation clamped to 1: with the switch off there is
  // nothing to fade, and a value that merely happens to stay at 1 is a value
  // someone can later change by accident.
  const expandedOpacity: Animated.AnimatedInterpolation<number> | number = lightens
    ? scrollY.interpolate({ ...lightenRange, outputRange: [1, 0] })
    : 1;
  // Where the pinned look takes over — a different moment in each mode, because
  // the mechanism is different. WITH the cross-fade it is the fade's midpoint:
  // past there the light bar is the more opaque of the two, so that is when
  // interaction and the status bar have to switch. WITHOUT it there is no fade at
  // all, so the only meaningful moment is the END of the travel — the corner
  // squares off exactly as the header stops moving.
  const PINNED_AT = lightens
    ? FULL * (LIGHTEN_START + (1 - LIGHTEN_START) / 2)
    : FULL;

  // ── The header's own corner ─────────────────────────────────────────────────
  // In light mode this NEVER changes: the square, opaque pinned bar covers the
  // header's corners, so curve→straight rides the cross-fade and is a true sweep.
  // Snapping here as well would show a corner popping through a half-transparent
  // bar.
  //
  // In gradient-only mode there is no bar to do that, so the header squares its
  // own corner at full collapse. A SNAP, deliberately: `borderRadius` is not
  // native-animatable and `scrollY` is, so sweeping it needs a JS-driven value —
  // the machinery that was removed after this screen broke. A snap at the instant
  // the header stops moving is the cheap, safe answer. (If it reads badly the fix
  // is a second square-cornered gradient overlay cross-fading in, which needs the
  // bar content lifted out of the header first.)
  const headerRadius = !lightens && pinned ? collapsedCurveRadius : curveRadius;
  // Only the LIGHT pinned bar makes the surface light, so only it may make the
  // expanded bar inert or flip the status bar. Gradient-only still latches
  // `pinned` for the corner above, but changes neither of those.
  const lightBarActive = lightens && pinned;

  // ── Never rest in a half-collapsed header ───────────────────────────────────
  // Mid-collapse the hero is mid-fade: some of its text is legible, some isn't.
  // It is a state the design only ever passes THROUGH, so a release inside it
  // finishes the move — open below `SNAP_AT`, pinned above. One threshold in both
  // directions, so the same offset always resolves the same way.
  const snapHeader = (y: number) => {
    if (!STATIC_CONFIG.header.snapOnRelease) return;
    // Outside the collapse there is nothing partial to resolve — and `y <= 0` is
    // also where a pull-to-refresh lives, which must not be yanked.
    if (y <= 0 || y >= FULL) return;
    innerScrollRef.current?.scrollTo({ y: y / FULL < SNAP_AT ? 0 : FULL, animated: true });
  };

  const onScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // A release with ANY velocity is followed by momentum, and `scrollTo` cancels
    // a fling — snapping here would kill flick-scrolling every time a finger
    // happened to lift inside the header's range. So only a release that is
    // already still snaps now; everything else waits for momentum to end.
    //
    // Zero-vs-non-zero is the only comparison made, deliberately: the two
    // platforms report velocity in different units (iOS points/ms, Android
    // pixels/s), so any real threshold would mean two different gestures.
    const v = e.nativeEvent.velocity?.y ?? 0;
    if (Math.abs(v) < 1e-6) snapHeader(e.nativeEvent.contentOffset.y);
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    snapHeader(e.nativeEvent.contentOffset.y);

  const pinnedChrome = pinnedHeaderChrome(collapsedSurface ?? theme.card, theme);

  const callerPadTop = Number(StyleSheet.flatten(contentContainerStyle)?.paddingTop) || 0;

  // ── Corner radius: two STATIC values, one per bar ───────────────────────────
  // This used to be an animated sweep, and it was the last JS-driven style in the
  // component — `borderRadius` is not supported by the native driver, `scrollY`
  // IS (it drives the transforms), so it needed its own value fed from the scroll
  // listener, kept off any node the native driver owns, and clipped by a parent
  // that had to be squarer than the child. Four rules to remember, and RN's
  // punishment for breaking one is a runtime throw, not a type error.
  //
  // The two-bar cross-fade makes all of it unnecessary: the curved gradient
  // header fades OUT while the square light bar fades IN, so the curve visibly
  // becomes a straight edge without any radius ever changing. Same effect, no
  // animated radius anywhere, and nothing left in this component that the native
  // driver cannot own.

  const onScrollEvent = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const y = e.nativeEvent.contentOffset.y;
        // The only work this listener does now — a comparison, and a setState
        // on the crossing. There is no per-frame JS animation left to feed.
        const isPinned = y >= PINNED_AT;
        if (isPinned !== pinned) {
          setPinned(isPinned);
          // Reports "the header is now a LIGHT surface", which is what the status
          // bar needs — never true in gradient-only mode.
          onCollapseChange?.(lightens && isPinned);
        }
        onScroll?.(e);
      },
    },
  );

  return (
    <View style={styles.root}>
      {/* Body — rendered first so the header paints on top of it. */}
      <Animated.ScrollView
        ref={setScrollRef}
        style={styles.fill}
        // ADDITIVE, not a merge. A style array lets the LAST entry win, so a
        // caller that set `paddingTop` on its content container silently replaced
        // the managed header offset and its whole body rendered UNDER the header.
        // Treat the caller's value as extra space below the header instead — which
        // is what anyone setting it actually means.
        contentContainerStyle={[contentContainerStyle, { paddingTop: headerTotal + callerPadTop }]}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        scrollEventThrottle={16}
        onScroll={onScrollEvent}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollEnd={onMomentumEnd}
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
            borderBottomLeftRadius: headerRadius,
            borderBottomRightRadius: headerRadius,
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
            onLayout={autoHero ? onHeroLayout : undefined}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: insets.top + barHeight,
              // Auto mode lets it size to its content and reports that height
              // back; pinned mode lays it out at exactly the given height.
              height: autoHero ? undefined : heroHeight,
              paddingHorizontal: gutter,
              justifyContent: 'center',
              opacity: heroOpacity,
            }}
          >
            {renderHero()}
          </Animated.View>
        ) : null}

        {/* Expanded (on-gradient) bar — counter-translated so it stays put while
            the header rises, and faded out as the pinned bar takes over.
            INERT once pinned: it is directly behind an opaque bar, so a tap
            landing in a gap of the pinned bar's layout would otherwise hit a
            control the user cannot see. Same for the screen reader. */}
        <Animated.View
          pointerEvents={lightBarActive ? 'none' : 'box-none'}
          accessibilityElementsHidden={lightBarActive}
          importantForAccessibility={lightBarActive ? 'no-hide-descendants' : 'auto'}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: collapsedTotal,
            paddingTop: insets.top,
            paddingHorizontal: gutter,
            justifyContent: 'center',
            opacity: expandedOpacity,
            transform: [{ translateY: barCounter }],
          }}
        >
          {barContent(progress)}
        </Animated.View>
      </Animated.View>

      {/* ── The pinned LIGHT bar ──────────────────────────────────────────────
          A sibling of the header, not a child: the header translates up and this
          must not. It stacks above it and cross-fades in on opacity.
          Not rendered at all when the switch is off — an invisible-but-mounted
          bar would still be a node in the tree, and `pointerEvents` gating is one
          mistake away from swallowing taps meant for the gradient bar. */}
      {lightens ? (
      <Animated.View
        pointerEvents={lightBarActive ? 'box-none' : 'none'}
        accessibilityElementsHidden={!lightBarActive}
        importantForAccessibility={lightBarActive ? 'auto' : 'no-hide-descendants'}
        style={[
          styles.pinnedBar,
          {
            height: pinnedTotal,
            backgroundColor: pinnedChrome.surface,
            // Static, and NOT animated alongside the opacity below: a JS-driven
            // radius sharing a props node with a native-driven opacity is exactly
            // what RN refuses — it moves the node to the native driver and then
            // throws on the radius. The curve→straight transition comes from the
            // cross-fade, not from this number changing.
            borderBottomLeftRadius: collapsedCurveRadius,
            borderBottomRightRadius: collapsedCurveRadius,
            opacity: collapsedOpacity,
          },
        ]}
      >
        {/* The gutter lives on an inner view, NOT on the bar: Yoga positions an
            absolute child against its parent's padding box, so the hairline below
            would be inset by the gutter at both ends instead of spanning. */}
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            paddingTop: insets.top,
            // The bar is `HEADER_PAD_B` taller than the row needs; paying it as
            // padding rather than letting `flex: 1` centre in the whole box keeps
            // the row at the SAME y as the gradient bar's, so nothing shifts
            // vertically as the two cross-fade.
            paddingBottom: HEADER_PAD_B,
            paddingHorizontal: gutter,
            justifyContent: 'center',
          }}
        >
          {renderCollapsedBar
            ? renderCollapsedBar()
            : <StandardBar title={title} onBack={onBack} right={headerRight} tint={pinnedChrome.ink} />}
        </View>
        {/* Card content scrolls under a card-coloured strip, so the elevation
            shadow is not a boundary on its own — the same reason the tab bar
            keeps a hairline AND a shadow. */}
        <View style={[styles.pinnedEdge, { backgroundColor: pinnedChrome.hairline }]} />
      </Animated.View>
      ) : null}
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
  // The pinned light bar. Above the header so it covers it; `overflow: hidden` so
  // the hairline is clipped by the corner radius while the curve is still open.
  pinnedBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    // Above the header (zIndex 10 / elevation 6) so it covers it on BOTH
    // platforms: Android draws children in elevation order regardless of
    // document order, iOS uses zIndex. Neither alone is enough.
    zIndex: 11,
    elevation: 7,
    // …but elevation on Android also draws a shadow, and this view's bounds end
    // mid-gradient, so that shadow would be a horizontal line across the header
    // while expanded. It doesn't need one: once pinned, the header underneath has
    // translated up until ITS bottom edge is exactly this bar's bottom edge, so
    // the elevation-6 shadow already sits in the right place.
    shadowColor: 'transparent',
  },
  // Matched to the tab bar's 0.5, not StyleSheet.hairlineWidth, so the two edges
  // of the app's chrome are the same weight on every screen density.
  pinnedEdge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0.5 },
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
  stdTitleText: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  stdTitle: { flex: 1 },
  stdFlex: { flex: 1 },
  stdRight: { flexDirection: 'row', alignItems: 'center', marginLeft: spacing.sm },
  // Centred (pushed-screen) title — absolutely centred over the row. The side
  // padding keeps a long title truncating instead of running under the chevron.
  stdTitleCentreWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  stdTitleCentre: { textAlign: 'center' },
});
