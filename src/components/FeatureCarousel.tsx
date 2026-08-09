// =============================================================================
// FeatureCarousel — the "what this app does for you" strip on the Dashboard.
//
// Auto-advancing, swipeable banners that surface the features people otherwise
// never find: automatic SMS capture, splitting, the netted IOU ledger, spend
// rules and the encrypted backup. Sits above Lent/Borrowed so it's visible
// without scrolling.
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
// ── Why these are DRAWN, not PNGs ───────────────────────────────────────────
//   1. An image can't follow the accent theme. The app ships four accents and
//      the user can switch at any time; every tint here derives from
//      `theme.primary`, so all of it repaints instantly.
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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, FlatList, Pressable, StyleSheet, Text, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import {
  colors, mix, radius, readableOn, shadows, spacing,
  typography as typographyBase, withAlpha,
} from '../constants/theme';
// Pure data, in its own module so `themeContrast.test.mjs` can import it — this
// component pulls in react-native and can't be loaded headlessly.
import { BANNER_STYLES } from '../constants/bannerStyles';
import type { TextStyle } from 'react-native';

// The JS theme widens fontWeight to `string` (ui-consistency §1).
const typography = typographyBase as unknown as Record<string, TextStyle>;

// ── Backgrounds ─────────────────────────────────────────────────────────────
// THREE treatments so five banners in a row don't read as one repeated card.
// Each is a near-white card with a faint accent wash plus a few translucent
// circles; the variants differ in where those circles sit, not in how loud the
// colour is. Everything derives from `theme.primary`, so all four accents work.
//
// Alpha, not `shade()`, for the bubbles: they OVERLAP, and translucency is what
// makes the overlaps read as soft glass rather than flat stacked discs.
type Feature = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  /** Where the CTA goes: [routeName, params]. */
  target: [string, object?];
};

// Ordered by how much they change day-to-day use, not by how clever they are.
// Auto-capture first because it's the reason the app needs no daily data entry;
// backup last because it matters most to people who already have data in here.
const FEATURES: Feature[] = [
  {
    id: 'sms',
    icon: 'flash-outline',
    eyebrow: 'No typing',
    title: 'Your bank SMS,\nread automatically',
    body: 'Every debit and credit, captured and categorised as it lands.',
    cta: 'See today’s activity',
    target: ['Transactions'],
  },
  {
    id: 'split',
    icon: 'people-outline',
    eyebrow: 'Shared spending',
    title: 'Split a bill,\nsettle just once',
    body: 'Groups, trips and one-off splits net to one balance per person.',
    cta: 'Open groups',
    target: ['Groups'],
  },
  {
    id: 'lb',
    icon: 'swap-horizontal-outline',
    eyebrow: 'Never forget',
    title: 'Who owes you,\nkept straight',
    body: 'Lent, borrowed and repaid — one net figure per person.',
    cta: 'Open the ledger',
    target: ['LentBorrowed', { kind: 'lent' }],
  },
  {
    id: 'budget',
    icon: 'options-outline',
    eyebrow: 'Your rules',
    title: 'Budgets that count\nwhat you say counts',
    body: 'Choose what counts as spending. Transfers and repayments stay out.',
    cta: 'Set a budget',
    target: ['Insights', { defaultTab: 'budget' }],
  },
  {
    id: 'backup',
    icon: 'shield-checkmark-outline',
    eyebrow: 'Private by design',
    title: 'Encrypted backup,\nonly you hold the key',
    body: 'Your own Google Drive, locked with a password only you hold.',
    cta: 'Set up backup',
    target: ['Backup'],
  },
];

/** Gap between cards. Part of the snap stride, with the card width. */
const GAP = 12;
/**
 * How much of the NEXT card stays visible at rest.
 *
 * Without it the cards are exactly viewport-wide, so the gap only exists
 * mid-swipe and at rest the strip looks like a single static card — which is
 * both what "no margin between each other" looked like and the reason a
 * carousel goes unswiped. The peek shows the separation and advertises that
 * there's more.
 */
const PEEK = 26;
/** Dwell time per banner. Long enough to read two lines without re-reading. */
const AUTO_MS = 5000;
/** How long a manual swipe suspends the timer before it resumes. */
const RESUME_MS = 9000;

// ── LOOP ────────────────────────────────────────────────────────────────────
// The list renders one CLONE of the first banner after the last, so advancing
// past the end keeps moving FORWARD into what looks like the first card, and we
// then silently jump the offset back to 0 with no animation. Previously the
// timer scrolled from the last index all the way back to 0, which rewound the
// whole strip in view — the opposite direction to every other advance.
//
// A clone is enough because only the forward direction wraps. Making backward
// wrap too would need a leading clone as well, which shifts every offset by one
// and buys nothing here: the timer never runs backwards, and a user swiping
// back from the first card expects to stop.
const LOOP_DATA = [...FEATURES, { ...FEATURES[0], id: `${FEATURES[0].id}__clone` }];
/** Must outlast the scroll animation, or the silent reset cancels it mid-flight. */
const RESET_MS = 420;

type Props = { onNavigate: (route: string, params?: object) => void };

const FeatureCarousel: React.FC<Props> = ({ onNavigate }) => {
  const theme = useTheme() as any;
  const isFocused = useIsFocused();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const listRef = useRef<FlatList<Feature>>(null);
  // A timestamp, not a boolean: a boolean needs a second timer to clear it, and
  // two timers racing is how a carousel ends up advancing mid-swipe.
  const pausedUntil = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  // Auto-advancing motion is a known accessibility problem; honour the OS switch
  // rather than deciding for the user. Read once, and follow later changes.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  const cardW  = Math.max(0, width - PEEK);
  const stride = cardW + GAP;

  // Auto-advance. Skipped entirely when the tab isn't focused — a timer
  // animating an offscreen list is wasted work, and the user would return to a
  // carousel that had silently moved on without them.
  useEffect(() => {
    if (!width || !isFocused || reduceMotion) return undefined;
    const id = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      setIndex((cur) => {
        const next = cur + 1;                       // never wraps backwards
        listRef.current?.scrollToOffset({ offset: next * stride, animated: true });
        if (next === FEATURES.length) {
          // Landed on the clone: snap back to the real first card once the
          // animation has finished. animated:false is what makes it invisible.
          resetTimer.current = setTimeout(() => {
            listRef.current?.scrollToOffset({ offset: 0, animated: false });
            setIndex(0);
          }, RESET_MS);
        }
        return next;
      });
    }, AUTO_MS);
    return () => { clearInterval(id); clearTimeout(resetTimer.current); };
  }, [width, stride, isFocused, reduceMotion]);

  // Touching the carousel suspends the timer — nothing is more annoying than a
  // banner sliding away under your thumb.
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
    // Hand-swiping onto the clone gets the same silent reset as the timer, so a
    // manual wrap doesn't strand the user on a duplicate card.
    if (at === FEATURES.length) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      setIndex(0);
      return;
    }
    setIndex(at);
  }, [stride]);

  const renderItem = useCallback(({ item, index: i }: { item: Feature; index: number }) => {
    // `% FEATURES.length` so the trailing clone (see LOOP) reuses the first
    // card's treatment and the wrap is invisible.
    const v = BANNER_STYLES[i % BANNER_STYLES.length];
    // Flattened to a SOLID colour so the inks below can actually be measured
    // against it — you can't compute contrast against a translucent overlay.
    const washEnd = mix(theme.primary, v.tint, '#FFFFFF');
    // Measured, not chosen: `textSecondary` is 4.83:1 on white and dips under
    // 4.5 on any tint, and the accent as text on a tint of itself is 1.3:1 on
    // Gold. `readableOn` leaves each alone when it already passes.
    const bodyInk   = readableOn(washEnd, colors.textSecondary);
    const accentInk = readableOn(washEnd, theme.primary);
    const iconInk   = readableOn(mix(theme.primary, 0.16, '#FFFFFF'), theme.primary, 3);
    return (
    <View style={{ width: cardW }}>
      <Pressable
        onPress={() => onNavigate(item.target[0], item.target[1])}
        accessibilityRole="button"
        accessibilityLabel={`${item.title.replace(/\n/g, ' ')}. ${item.body}`}
        style={({ pressed }) => [styles.cardWrap, { borderColor: withAlpha(theme.primary, 0.24) },
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
                  backgroundColor: withAlpha(theme.primary, b.alpha),
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
              <Text style={styles.title}>{item.title}</Text>
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
            <View style={[styles.iconChip, { borderColor: withAlpha(theme.primary, 0.22) }]}>
              <Ionicons name={item.icon} size={26} color={iconInk} />
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </View>
    );
  }, [cardW, theme, onNavigate]);

  return (
    <View onLayout={onLayout}>
      {/* Nothing renders until the width is known — at width 0 every card would
          collapse and the snap interval would be meaningless. */}
      {width > 0 && (
        <>
          <FlatList
            data={LOOP_DATA}
            keyExtractor={(f) => f.id}
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
            // Without this the LAST card can never snap flush left: max scroll
            // offset falls PEEK short of its snap point, so it parks crooked.
            contentContainerStyle={{ paddingRight: PEEK }}
            ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
            // The parent ScrollView owns vertical; this owns horizontal.
            nestedScrollEnabled
            ref={listRef}
          />

          <View style={styles.dots}>
            {FEATURES.map((f, i) => (
              <Pressable
                key={f.id}
                onPress={() => {
                  onTouch();
                  setIndex(i);
                  listRef.current?.scrollToOffset({ offset: i * stride, animated: true });
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Go to banner ${i + 1} of ${FEATURES.length}`}
                style={[
                  styles.dot,
                  i === index % FEATURES.length
                    ? { backgroundColor: theme.primary, width: 16 }
                    : { backgroundColor: theme.divider },
                ]}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
};

export default FeatureCarousel;

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
    ...shadows.card,
  },
  pressed: { opacity: 0.9 },
  card: {
    minHeight: 138,
    padding: spacing.lg,
    justifyContent: 'center',
    // Bubbles bleed past the edges; the wrapper clips them.
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  copy: { flex: 1 },
  iconChip: {
    width: 54, height: 54, borderRadius: 27,
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
