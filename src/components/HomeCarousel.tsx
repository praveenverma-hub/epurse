// =============================================================================
// HomeCarousel — the Dashboard's swipeable "what matters right now" strip.
//
// Was `FeatureCarousel`, five hardcoded feature banners in a fixed order. Renamed
// with the rework (Aug-26) because it no longer only advertises features: it
// renders whatever `buildHomeCards()` ranked highest — an over-budget warning, a
// subscription that got more expensive, where this month's money went — and the
// feature banners are now just the lowest tier, shown to people who have no data
// yet. See `analytics/homeCards.js` for the ranking and why promos are the empty
// state rather than something to dismiss.
//
// This file is PRESENTATION ONLY. It doesn't know what a card means, only how to
// draw one and how to move between them. Anything about which card wins belongs
// in homeCards.js, where it's testable without react-native.
//
// The timer is deliberately conservative: it stops while the tab is unfocused,
// stops for RESUME_MS after any touch, and doesn't run at all under the OS
// reduce-motion setting. An unstoppable carousel on a finance dashboard is a
// nuisance, not a feature.
//
// ── Look ────────────────────────────────────────────────────────────────────
// LIGHT, not saturated. The first version filled each card with a deep brand
// gradient and white text; against a Dashboard of white cards with hairline
// accent borders, the banners read as a different app pasted in. These are now
// the same white card with a barely-there wash, soft translucent "bubbles" for
// depth, and ordinary dark text. The accent lives in the bubbles, the icon and
// the CTA — themed without shouting.
//
// A card's `tone` picks WHICH accent: urgent cards draw in `theme.danger` so
// urgency registers before the text is read. Keep that rare — if three cards are
// red, none of them is, which is why only the URGENT tier sets it.
//
// ── Why these are DRAWN, not PNGs ───────────────────────────────────────────
//   1. An image can't follow the accent theme, and now can't follow live data
//      either — half these cards contain a number that changes daily.
//   2. Five PNGs at 3x for a full-bleed banner is roughly 1-2 MB of APK for
//      what is a wash, some circles and two lines of text.
//   3. Text inside an image can't scale with the OS font setting, can't be read
//      by a screen reader, and needs re-exporting to fix a typo.
// If real illustrations are ever wanted, they drop into the same absolutely
// positioned layer the bubbles use, behind the copy.
//
// Self-measuring (onLayout) rather than Dimensions.get: a width read once at
// module load is wrong after a rotation or on a foldable, and this is a
// snap-to-interval list where a stale width means every card lands off-centre.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Pressable, StyleSheet, Text, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle,
  useSharedValue, type SharedValue,
} from 'react-native-reanimated';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import CardSkeleton from './CardSkeleton';
import {
  colors, mix, radius, readableOn, shadows, spacing,
  typography as typographyBase, withAlpha,
} from '../constants/theme';
// Pure data, in its own module so `themeContrast.test.mjs` can import it — this
// component pulls in react-native and can't be loaded headlessly.
import { BANNER_STYLES } from '../constants/bannerStyles';
// Geometry + neighbour feel shared with GroupInsightCarousel so the two can't
// drift into looking like different apps' carousels.
import {
  CARD_GAP, NEIGHBOUR_OPACITY, NEIGHBOUR_SCALE, SIDE_PEEK,
  carouselMetrics, fullBleedCardW,
  listIndexFor as listIndexOf, realIndexFor as realIndexOf, wrapTarget,
} from '../constants/carousel';
import type { TextStyle } from 'react-native';

// The JS theme widens fontWeight to `string` (ui-consistency §1).
const typography = typographyBase as unknown as Record<string, TextStyle>;

/**
 * Height the loading skeleton reserves — the card's own `minHeight`, so the strip
 * does not resize when real cards replace it. Kept next to that style; if the
 * card's minimum changes, this has to move with it (a test asserts they match).
 */
const SKELETON_H = 138;

/**
 * One card. Built by `buildHomeCards()`; this component never constructs one.
 * `tier` is carried for ordering/debugging and isn't read while rendering.
 */
export type HomeCard = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  /** Where the CTA goes: [routeName, params]. */
  target: [string, object?];
  tone?: 'accent' | 'danger' | 'success';
  tier?: number;
};

// Card geometry lives in constants/carousel.js — see SIDE_PEEK for why a centred
// card is narrower than its container, and carouselMetrics for the centring maths.
/** Dwell time per card. Long enough to read two lines without re-reading. */
const AUTO_MS = 5000;
/** How long a manual swipe suspends the timer before it resumes. */
const RESUME_MS = 9000;
/** Must outlast the scroll animation, or the silent reset cancels it mid-flight. */
const RESET_MS = 420;

// ── One card ──────────────────────────────────────────────────────────────────
// Its own component rather than an inline render function, because the
// neighbour scale/fade needs `useAnimatedStyle` — a hook, and hooks cannot live
// in a `renderItem` callback. Memoised so scrolling doesn't re-render every card
// in JS; the animation itself never crosses to JS.
const CarouselCard: React.FC<{
  item: HomeCard;
  /** Position in the LIST — drives the scroll interpolation. */
  index: number;
  /** Position of the CARD — drives which banner treatment it gets. */
  styleIndex: number;
  cardW: number;
  stride: number;
  scrollX: SharedValue<number>;
  animate: boolean;
  theme: any;
  onNavigate: (route: string, params?: object) => void;
}> = React.memo(({ item, index: i, styleIndex, cardW, stride, scrollX, animate, theme, onNavigate }) => {
  // The snapped card is full size; its neighbours are smaller and dimmer, which
  // is what makes the peeking slivers read as "there's more" rather than as a
  // misaligned edge. Interpolated against the two adjacent snap points and
  // CLAMPed, so cards further out don't keep shrinking.
  const animStyle = useAnimatedStyle(() => {
    if (!animate || !stride) return { transform: [{ scale: 1 }], opacity: 1 };
    const input = [(i - 1) * stride, i * stride, (i + 1) * stride];
    return {
      transform: [{
        scale: interpolate(scrollX.value, input,
          [NEIGHBOUR_SCALE, 1, NEIGHBOUR_SCALE], Extrapolation.CLAMP),
      }],
      opacity: interpolate(scrollX.value, input,
        [NEIGHBOUR_OPACITY, 1, NEIGHBOUR_OPACITY], Extrapolation.CLAMP),
    };
  });

  // Keyed on the CARD index, so both clones reuse the treatment of the card they
  // duplicate and the silent wrap can't be seen as a colour change.
  const v = BANNER_STYLES[styleIndex % BANNER_STYLES.length];
  // Urgent cards borrow the danger colour; everything else follows the accent.
  const accent = item.tone === 'danger'
    ? theme.danger
    : item.tone === 'success'
      ? theme.success
      : theme.primary;
  // Flattened to a SOLID colour so the inks below can actually be measured
  // against it — you can't compute contrast against a translucent overlay.
  const washEnd = mix(accent, v.tint, '#FFFFFF');
  // Measured, not chosen: `textSecondary` is 4.83:1 on white and dips under
  // 4.5 on any tint, and the accent as text on a tint of itself is 1.3:1 on
  // Gold. `readableOn` leaves each alone when it already passes.
  const bodyInk   = readableOn(washEnd, colors.textSecondary);
  const accentInk = readableOn(washEnd, accent);
  const iconInk   = readableOn(mix(accent, 0.16, '#FFFFFF'), accent, 3);
  return (
    // The slot keeps its full width; only the visual card scales, so the snap
    // stride stays exact while the neighbours shrink.
    <Animated.View style={[{ width: cardW }, animStyle]}>
    <Pressable
      onPress={() => onNavigate(item.target[0], item.target[1])}
      accessibilityRole="button"
      accessibilityLabel={`${item.title.replace(/\n/g, ' ')}. ${item.body}`}
      style={({ pressed }) => [styles.cardWrap, { borderColor: withAlpha(accent, 0.24) },
                               pressed && styles.pressed]}
    >
      <LinearGradient
        colors={['#FFFFFF', washEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Decorative only — hidden from screen readers, and non-interactive
            so they can't intercept the card's tap. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
          {v.bubbles.map((b, bi) => (
            <View
              key={bi}
              style={{
                position: 'absolute',
                width: b.size, height: b.size, borderRadius: b.size / 2,
                backgroundColor: withAlpha(accent, b.alpha),
                top: b.top, bottom: b.bottom, left: b.left, right: b.right,
              }}
            />
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={[styles.eyebrow, { color: accentInk }]}>
              {item.eyebrow.toUpperCase()}
            </Text>
            {/* Capped at 2 lines like the body: card height is content-driven,
                and a 3-line title on ONE card leaves the whole strip ragged.
                The promos hard-wrap with \n; live titles carry a number of
                unknown length and wrap on their own. */}
            <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
            <Text style={[styles.body, { color: bodyInk }]} numberOfLines={2}>{item.body}</Text>

            <View style={styles.ctaRow}>
              <Text style={[styles.cta, { color: accentInk }]}>{item.cta}</Text>
              <Ionicons name="arrow-forward" size={13} color={accentInk} />
            </View>
          </View>

          {/* Solid white, not another tint: at 14% accent the chip was the
              same value as the bubbles drifting behind it, so the glyph looked
              like it was floating loose on a blob. A real surface with a
              border reads as a distinct element. */}
          <View style={[styles.iconChip, { borderColor: withAlpha(accent, 0.22) }]}>
            <Ionicons name={item.icon} size={26} color={iconInk} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
    </Animated.View>
  );
});
CarouselCard.displayName = 'CarouselCard';

type Props = {
  cards: HomeCard[];
  onNavigate: (route: string, params?: object) => void;
  /**
   * The data behind these cards isn't ready yet (the persisted store is still
   * rehydrating). Shows a skeleton INSTEAD of cards.
   *
   * Not cosmetic: with an empty store every live builder returns null and
   * `buildHomeCards` falls back to the promo banners, so a mid-month user saw
   * five feature ads flash past before their real cards arrived — and since the
   * two sets share no ids, the list unmounted and remounted every item under the
   * scroll position. Waiting is the honest thing to render.
   */
  loading?: boolean;
  /**
   * Horizontal padding of the host to break OUT of, so the strip spans the full
   * screen. Pass the host's gutter (Dashboard: `spacing.lg`).
   *
   * Without it the active card is DOUBLE-inset — the host's 16pt gutter plus the
   * 28pt side peek — so it started 44pt from the screen edge while every other
   * Home card starts at 16pt, and read as a narrow strip floating inside the page
   * rather than as the page's own content. Bleeding the container gives that 32pt
   * straight back to the card (272 → 304pt on a 360pt screen) without touching the
   * peek.
   *
   * Note the card still cannot reach the 16pt gutter: at that inset the neighbour
   * sliver computes NEGATIVE (the gap plus the 0.94 scale swallow it), so the peek
   * and the alignment spine are mutually exclusive. 26pt is the floor for a
   * readable peek; 28 is where it sits.
   */
  bleed?: number;
};

const HomeCarousel: React.FC<Props> = ({ cards, onNavigate, loading = false, bleed = 0 }) => {
  const theme = useTheme() as any;
  const isFocused = useIsFocused();
  const [width, setWidth] = useState(0);
  // LIST index, not card index — with clones at both ends the first real card is
  // at 1 (see LOOP). `realIndexFor` converts when the dots need a card number.
  const [index, setIndex] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);
  const listRef = useRef<any>(null);
  // A timestamp, not a boolean: a boolean needs a second timer to clear it, and
  // two timers racing is how a carousel ends up advancing mid-swipe.
  const pausedUntil = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  const count = cards.length;
  // Below two cards there is nothing to advance to, so the timer, the clone and
  // the dots all switch off. Card counts really do change at runtime now — a
  // budget going over adds one — so none of this can be decided at module load.
  const canLoop = count > 1;

  // Centred, with BOTH neighbours peeking in: the card is the viewport minus a
  // peek on each side, and the list carries that same padding so a snapped card
  // lands dead centre. Previously the card was viewport-minus-one-peek with only
  // a right pad, so every card sat flush LEFT and the strip read as misaligned.
  const cardW  = fullBleedCardW(width);
  const { snap: stride, sidePad } = carouselMetrics(width, cardW);

  // Drives the neighbour scale/fade. A shared value, so the interpolation runs on
  // the UI thread and keeps up with the finger instead of round-tripping to JS.
  const scrollX = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((e) => { scrollX.value = e.contentOffset.x; });

  // ── LOOP — clones at BOTH ends ────────────────────────────────────────────
  // [ clone(last) , …cards… , clone(first) ]
  //   index 0        1 … count        count + 1
  //
  // A trailing clone alone used to be enough, when only forward wrap mattered.
  // Centring the strip changed that: with a peek on each side, the FIRST card had
  // nothing to its left — 28pt of bare page where every other card shows a
  // neighbour, which reads as a broken edge rather than "you're at the start". A
  // leading clone gives card 1 a left neighbour and makes backward swiping wrap
  // too, so every card now looks identical wherever you are in the list.
  //
  // The cost is that list index ≠ card index: real cards live at 1…count, and
  // anything that maps between the two has to go through `realIndexFor`. That's
  // the whole complication, and it's why the single-clone version was preferred
  // while the cards sat flush left.
  const loopData = useMemo(() => {
    if (!canLoop) return cards;
    return [
      { ...cards[count - 1], id: `${cards[count - 1].id}__tailClone` },
      ...cards,
      { ...cards[0], id: `${cards[0].id}__headClone` },
    ];
  }, [cards, canLoop, count]);

  // Index maths lives in constants/carousel.js so it's testable without a device
  // — see `realIndexFor` / `listIndexFor` / `wrapTarget` there.
  const realIndexFor = useCallback((listIndex: number) => realIndexOf(listIndex, count, canLoop), [count, canLoop]);
  const listIndexFor = useCallback((i: number) => listIndexOf(i, canLoop), [canLoop]);

  // Fixed-size items, so the list can start on the first REAL card before its
  // first paint (`initialScrollIndex`) instead of visibly jumping there after a
  // scrollToOffset in an effect.
  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({ length: cardW, offset: i * stride, index: i }),
    [cardW, stride],
  );

  // Auto-advancing motion is a known accessibility problem; honour the OS switch
  // rather than deciding for the user. Read once, and follow later changes.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  // The card list is live, so it can shrink under a parked index (an over-budget
  // card disappears the moment a budget is raised). Left alone, the strip would
  // sit scrolled past its own content showing blank space.
  useEffect(() => {
    if (count === 0) return;
    const first = listIndexFor(0);
    const last  = listIndexFor(count - 1);
    if (index < first || index > last) {
      setIndex(first);
      listRef.current?.scrollToOffset({ offset: first * stride, animated: false });
    }
  }, [count, index, listIndexFor, stride]);

  // Auto-advance. Skipped entirely when the tab isn't focused — a timer
  // animating an offscreen list is wasted work, and the user would return to a
  // carousel that had silently moved on without them.
  useEffect(() => {
    if (!width || !isFocused || reduceMotion || !canLoop) return undefined;
    const id = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      setIndex((cur) => {
        const next = cur + 1;
        listRef.current?.scrollToOffset({ offset: next * stride, animated: true });
        // Landed on the TRAILING clone (which shows card 0): once the animation
        // has finished, jump to the real card 0 with no animation so the wrap is
        // invisible. Always forward — never a rewind of the whole strip.
        if (next === count + 1) {
          resetTimer.current = setTimeout(() => {
            const first = listIndexFor(0);
            listRef.current?.scrollToOffset({ offset: first * stride, animated: false });
            setIndex(first);
          }, RESET_MS);
        }
        return next;
      });
    }, AUTO_MS);
    return () => { clearInterval(id); clearTimeout(resetTimer.current); };
  }, [width, stride, isFocused, reduceMotion, canLoop, count, listIndexFor]);

  // Touching the carousel suspends the timer — nothing is more annoying than a
  // card sliding away under your thumb.
  const onTouch = useCallback(() => { pausedUntil.current = Date.now() + RESUME_MS; }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setWidth(e.nativeEvent.layout.width);
  }, []);

  // Derived from the measured offset rather than onViewableItemsChanged: that
  // callback's config can't be changed after mount, and a half-swiped card
  // shouldn't move the dot until it actually settles.
  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!stride) return;
    const at = Math.round(e.nativeEvent.contentOffset.x / stride);
    // Settling on either CLONE teleports to the real card it duplicates, with no
    // animation, so the strip appears endless in both directions and the user is
    // never stranded on a duplicate. Swiping right off the first card now lands on
    // the last one, which it couldn't before the leading clone existed.
    const target = wrapTarget(at, count, canLoop);
    if (target != null) {
      listRef.current?.scrollToOffset({ offset: target * stride, animated: false });
      setIndex(target);
      return;
    }
    setIndex(at);
  }, [stride, count, canLoop]);

  const renderItem = useCallback(({ item, index: i }: { item: HomeCard; index: number }) => (
    <CarouselCard
      item={item}
      index={i}
      // The banner treatment must follow the CARD, not the list slot: a clone
      // styled by its slot would visibly change appearance at the silent jump.
      styleIndex={realIndexFor(i)}
      cardW={cardW}
      stride={stride}
      scrollX={scrollX}
      // Reduce-motion users get the layout without the scale/fade. It's gesture-
      // driven rather than autonomous, but it's still motion they asked to avoid.
      animate={!reduceMotion}
      theme={theme}
      onNavigate={onNavigate}
    />
  ), [cardW, stride, scrollX, reduceMotion, theme, onNavigate, realIndexFor]);

  // ── One card ────────────────────────────────────────────────────────────────
  // Its own component, not an inline render function, because the scale/fade
  // needs `useAnimatedStyle` — a hook, and hooks can't live in a renderItem
  // callback. Memoised so a scroll doesn't re-render every card in JS (the
  // animation itself never touches JS).

  // No cards at all means no data AND no promos — render nothing rather than an
  // empty bordered box. Not the same as `loading`, which has content coming.
  if (count === 0 && !loading) return null;

  // The width is measured, so the FIRST frame can never draw a card. That frame
  // used to render nothing at all — a zero-height view that still took a slot in
  // the Dashboard's section `gap`, i.e. the blank band on startup. The skeleton
  // reserves the real height instead, so the layout is right before the data is.
  const showSkeleton = loading || width === 0;

  return (
    <View onLayout={onLayout} style={bleed ? { marginHorizontal: -bleed } : undefined}>
      {showSkeleton && (
        <View>
          <CardSkeleton
            height={SKELETON_H}
            style={{ marginHorizontal: SIDE_PEEK }}
            label="Loading your dashboard cards"
          />
          {/* Placeholder dots, so the strip doesn't grow taller when they appear. */}
          <View style={styles.dots} pointerEvents="none">
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.dot, { backgroundColor: theme.divider }]} />
            ))}
          </View>
        </View>
      )}
      {!showSkeleton && (
        <>
          <Animated.FlatList
            data={loopData}
            keyExtractor={(c) => c.id}
            renderItem={renderItem}
            horizontal
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            onScrollBeginDrag={onTouch}
            onTouchStart={onTouch}
            decelerationRate="fast"
            // NOT `pagingEnabled`: that snaps to the VIEWPORT width, which would
            // ignore the gap and leave every card after the first sitting a
            // little further off-screen. snapToInterval snaps to card + gap, so
            // each card lands flush at the left edge and stays aligned with the
            // dashboard's other cards — the gap lives between them, not inside.
            snapToInterval={stride}
            snapToAlignment="start"
            disableIntervalMomentum
            // Start on the first REAL card (index 1) rather than the leading
            // clone. With getItemLayout this is applied before the first paint,
            // so there's no visible jump — a scrollToOffset in an effect would
            // show the clone for a frame.
            initialScrollIndex={canLoop ? 1 : 0}
            getItemLayout={getItemLayout}
            onScroll={scrollHandler}
            scrollEventThrottle={16}
            // Equal padding BOTH sides is what centres a snapped card — and it
            // makes the maths exact: max scroll offset lands precisely on the last
            // card's snap point, so the final card reaches dead centre instead of
            // parking short (see carouselMetrics).
            contentContainerStyle={{ paddingHorizontal: sidePad }}
            ItemSeparatorComponent={() => <View style={{ width: CARD_GAP }} />}
            // The parent ScrollView owns vertical; this owns horizontal.
            nestedScrollEnabled
            ref={listRef}
          />

          {/* One card needs no pager. */}
          {canLoop && (
            <View style={styles.dots}>
              {cards.map((c, i) => (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    onTouch();
                    const t = listIndexFor(i);
                    setIndex(t);
                    listRef.current?.scrollToOffset({ offset: t * stride, animated: true });
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to card ${i + 1} of ${count}`}
                  style={[
                    // `realIndexFor` so the dot is right even while parked on a
                    // clone mid-wrap: the leading clone maps to the LAST card,
                    // the trailing one to the first.
                    styles.dot,
                    i === realIndexFor(index)
                      ? { backgroundColor: theme.primary, width: 16 }
                      : { backgroundColor: theme.divider },
                  ]}
                />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
};

export default HomeCarousel;

const styles = StyleSheet.create({
  // `shadows.card` is what stops these reading as TRANSPARENT: every other card
  // on the Dashboard is elevated, and without it the banner sat flat on the gray
  // page like a printed panel. Depth is also the only lever that adds presence
  // WITHOUT costing legibility — pushing the wash darker instead makes the body
  // text worse, and at ~22% accent the surface matches the page background's
  // luminance exactly, which is the very thing that looked see-through.
  cardWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    backgroundColor: colors.card,   // opaque base under the wash
    // ── flex: 1 is LOAD-BEARING, don't remove it ────────────────────────────
    // Card content is variable height now that these carry live data: a promo
    // hand-wraps its title to two lines (~163pt tall) while "₹12.4k due
    // tomorrow" is one line (~141pt) and "🍔 Food & Dining" with a one-line body
    // is ~124pt. In a horizontal list the item wrappers all STRETCH to the
    // tallest card, so without this the Pressable rendered at its natural height,
    // sat at the top of a taller row, and left up to ~40pt of dead space beneath
    // it. Every card now fills the row and `card`'s `justifyContent: 'center'`
    // centres the shorter ones, so the strip is uniform as you swipe.
    flex: 1,
    ...shadows.card,
  },
  pressed: { opacity: 0.9 },
  card: {
    // Floors the height when EVERY card is short (all-live, all one-liners);
    // otherwise the tallest card sets it and this is inert.
    minHeight: 138,
    // spacing.md, not lg: centring the card costs it ~30pt of width (a peek on
    // BOTH sides now), and the text column is what pays. 4pt back per side here
    // plus 8 off the icon chip keeps the copy budget within 4 characters of what
    // the old left-aligned card allowed. See constants/carousel CARD_BODY_MAX_CHARS.
    padding: spacing.md,
    justifyContent: 'center',
    // Must also flex, or the gradient stops at its natural height and the
    // opaque `colors.card` base shows through below it — the same gap, just a
    // different colour.
    flex: 1,
    // Bubbles bleed past the edges; the wrapper clips them.
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1 },
  iconChip: {
    // 46, was 54 — see the padding note above; the glyph stays 26 so it doesn't
    // look shrunken, it just loses some of its surround.
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    ...shadows.card,
  },
  eyebrow: { ...typography.tiny, fontWeight: '800', letterSpacing: 0.9, marginBottom: 5 },
  title: { ...typography.h3, color: colors.textPrimary, fontWeight: '800', lineHeight: 22 },
  body: { ...typography.small, color: colors.textSecondary, lineHeight: 17, marginTop: 6 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.md },
  cta: { ...typography.small, fontWeight: '800' },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.md,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
