// =============================================================================
// TipStrip — Home's slim tip band. Presentation only: the slides come from
// `buildHomeTips()` (analytics/homeTips.js).
//
// A LIGHT full-bleed band, not a card: each slide a calm wash of its own tonal
// variant of the accent (constants/tipBand.js), so it shifts as it's swiped while
// sitting IN the page of white cards rather than on top of it. Swipe-only,
// never auto-advancing — a slide can carry an action, and an action must not
// slide away while it's being read. Loops both ways with a clone at each end
// (same index maths as HomeCarousel, constants/carousel.js).
// =============================================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList, Pressable, StyleSheet, View,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FixedTextScale, Text } from './AppText';
import CardSkeleton from './CardSkeleton';
import { useTheme } from '../hooks/useTheme';
import { readableOn, spacing, typography as typographyBase, withAlpha } from '../constants/theme';
import { tipBandHue, tipBandWash } from '../constants/tipBand';
import { listIndexFor, realIndexFor, wrapTarget } from '../constants/carousel';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Matches the rendered band (two-line title), so the skeleton doesn't resize when slides land. */
const SKELETON_H = 72;
/** Room under the copy for the dashes, which overlay the slides so each sits on its own colour. */
const SEGMENT_SPACE = 10;
const CLONE = /__(head|tail)$/;

export type HomeTip = {
  id: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  eyebrow: string;
  title: string;
  cta: string;
  target?: [string, object?];
  action?: string;
  actionLabel?: string;
};

type Props = {
  tips: HomeTip[];
  onPressTip: (tip: HomeTip) => void;
  loading?: boolean;
  /** The host's horizontal padding, broken out of so the band spans the screen. */
  bleed?: number;
};

export default function TipStrip({ tips, onPressTip, loading = false, bleed = 0 }: Props) {
  const theme = useTheme() as any;
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(1);
  const listRef = useRef<FlatList<HomeTip>>(null);

  const count = tips.length;
  // One ink set per slide, each measured on that slide's wash.
  const inks = useMemo(() => tips.map((_, i) => {
    const hue = tipBandHue(theme.primary, i);
    const band = tipBandWash(theme.primary, i, theme.card);
    return {
      band,
      title: readableOn(band, theme.textPrimary),
      eyebrow: readableOn(band, theme.textSecondary),
      icon: readableOn(theme.card, hue, 3),
      action: readableOn(band, hue),
      chevron: readableOn(band, theme.textMuted, 3),
    };
  }), [tips, theme.primary, theme.card, theme.textPrimary, theme.textSecondary, theme.textMuted]);

  const canLoop = count > 1;
  const data = useMemo(() => (canLoop
    ? [{ ...tips[count - 1], id: `${tips[count - 1].id}__tail` }, ...tips, { ...tips[0], id: `${tips[0].id}__head` }]
    : tips), [tips, canLoop, count]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const getItemLayout = useCallback(
    (_: unknown, i: number) => ({ length: width, offset: i * width, index: i }), [width]);

  // Settling on a clone jumps, unanimated, to the slide it copies — so swiping
  // past the last slide lands on the first, and back from the first on the last.
  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const at = Math.round(e.nativeEvent.contentOffset.x / width);
    const target = wrapTarget(at, count, canLoop);
    if (target != null) listRef.current?.scrollToOffset({ offset: target * width, animated: false });
    setIndex(target ?? at);
  }, [width, count, canLoop]);

  if (loading) return <CardSkeleton height={SKELETON_H} lines={[0.3, 0.8]} label="Loading tips" />;
  if (count === 0) return null;
  const active = canLoop ? realIndexFor(index, count, true) : 0;
  const gutter = bleed || spacing.lg;

  const renderItem = ({ index: listIndex, item }: { index: number; item: HomeTip }) => {
    // A clone wears its original's colour, so the wrap can't be seen.
    const ink = inks[realIndexFor(listIndex, count, canLoop)];
    return (
    <Pressable
      onPress={() => onPressTip({ ...item, id: item.id.replace(CLONE, '') })}
      accessibilityRole="button"
      accessibilityLabel={`${item.eyebrow}. ${item.title}. ${item.cta}`}
      style={({ pressed }) => [
        styles.slide,
        { width, paddingHorizontal: gutter, backgroundColor: ink.band },
        canLoop && { paddingBottom: styles.slide.paddingBottom + SEGMENT_SPACE },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.iconChip, { backgroundColor: theme.card }]}>
        <Ionicons name={item.icon} size={16} color={ink.icon} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: ink.eyebrow }]} numberOfLines={1}>
          {item.eyebrow.toUpperCase()}
        </Text>
        <Text style={[styles.title, { color: ink.title }]} numberOfLines={2}>{item.title}</Text>
      </View>
      {item.actionLabel ? (
        <Text style={[styles.action, { color: ink.action }]}>{item.actionLabel}</Text>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={ink.chevron} />
      )}
    </Pressable>
    );
  };

  return (
    <FixedTextScale>
      <View
        onLayout={onLayout}
        style={[
          { backgroundColor: inks[active].band },
          bleed ? { marginHorizontal: -bleed } : null,
          width === 0 && { minHeight: SKELETON_H },
        ]}
      >
        {width > 0 && (
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(t) => t.id}
            renderItem={renderItem}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEnabled={canLoop}
            initialScrollIndex={listIndexFor(0, canLoop)}
            getItemLayout={getItemLayout}
            onMomentumScrollEnd={onMomentumEnd}
            nestedScrollEnabled
          />
        )}

        {canLoop && (
          <View
            style={[styles.segments, { left: gutter, right: gutter }]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {tips.map((t, i) => (
              <View
                key={t.id}
                style={[styles.segment, { backgroundColor: withAlpha(theme.textPrimary, i === active ? 0.55 : 0.12) }]}
              />
            ))}
          </View>
        )}
      </View>
    </FixedTextScale>
  );
}

const styles = StyleSheet.create({
  slide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs + 2,
  },
  pressed: { opacity: 0.7 },
  iconChip: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  eyebrow: { ...typography.tiny, fontWeight: '700', letterSpacing: 0.8, marginBottom: 2 },
  title: { ...typography.small, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  action: { ...typography.small, fontWeight: '700' },
  // Decorative, over a slide colour that changes mid-swipe — so translucent ink rather than a measured one.
  segments: { position: 'absolute', bottom: spacing.sm, flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 2, borderRadius: 1 },
});
