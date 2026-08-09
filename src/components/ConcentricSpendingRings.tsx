// =============================================================================
// ConcentricSpendingRings.tsx — Skia concentric category-spending rings
//
// Renders up to 4 nested rings (outermost = largest category by volume).
// Each ring sweeps from 0 to its target %% on mount using withSpring. Tap a
// ring to scale it up, fade the others, and reveal an inline detail card with
// child sub-categories + recent transactions.
//
// All arc geometry is Skia <Path /> primitives (hardware accelerated). Tip
// emojis are RN <Animated.View>s positioned via a useAnimatedStyle hook so
// they ride the sweep on the UI thread without waking JS.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ProgressBar from './ProgressBar';
import {
  Canvas,
  Group,
  Path,
  Shadow,
  Skia,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import Animated, {
  Easing,
  FadeInUp,
  FadeOutDown,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { formatCurrency } from '../utils/format';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChildBreakdown {
  childCategory: string;
  amount: number;
}

export interface RecentTxn {
  id: string;
  merchant: string;
  amount: number;
  timestamp?: string;
}

export interface RingData {
  /** Parent category label, e.g. "Food & Dining". */
  parentCategory: string;
  /** Emoji shown at the tip of the active arc and in the detail card. */
  emoji: string;
  /** Neon stroke colour (hex). */
  color: string;
  /** Total spend in the parent category. */
  amount: number;
  /** Optional budget cap (rendered as a secondary tick in the detail card). */
  cap?: number;
  /** Fill percentage 0..100+. Clamped to 100 visually; >100 flags an "over" pill. */
  pct: number;
  /** Sub-category breakdown shown when the ring is expanded. */
  children?: ChildBreakdown[];
  /** Recent transactions shown in the detail card. */
  recent?: RecentTxn[];
}

interface Props {
  /** 1–4 rings sorted largest first. Extra rings are ignored. */
  rings: RingData[];
  /** Center caption (e.g. "Total spent"). */
  centerLabel?: string;
  /** Override the chart side (default 280). */
  size?: number;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

const DEFAULT_SIZE   = 280;
const STROKE         = 14;
const RING_GAP       = 8;             // visual gap between adjacent rings
const RING_STEP      = STROKE + RING_GAP; // 22
const MAX_RINGS      = 4;
const TIP_BADGE_SIZE = 26;
const TRACK_OPACITY  = '22';          // hex alpha suffix for soft track tint

function radiusFor(size: number, index: number): number {
  const outerInset = STROKE / 2 + 6; // breathing room for glow + scale
  const outerR = size / 2 - outerInset;
  return outerR - index * RING_STEP;
}

// ─── Ring (single) ───────────────────────────────────────────────────────────

interface RingProps {
  data: RingData;
  index: number;
  size: number;
  isSelected: boolean;
  anySelected: boolean;
}

const Ring: React.FC<RingProps> = ({ data, index, size, isSelected, anySelected }) => {
  const center = size / 2;
  const r      = radiusFor(size, index);
  const targetSweep = Math.min(100, Math.max(0, data.pct)) * 3.6; // → 0..360°

  // ── Shared values
  const sweep   = useSharedValue(0);
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(1);

  // Mount sweep — staggered per ring for a cascading reveal
  React.useEffect(() => {
    sweep.value = withDelay(
      index * 90,
      withSpring(targetSweep, { damping: 22, stiffness: 70, mass: 1 }),
    );
  }, [targetSweep]);

  // Selection: scale + opacity transition
  React.useEffect(() => {
    scale.value = withSpring(isSelected ? 1.05 : 1.0, {
      damping: 22,
      stiffness: 220,
    });
    opacity.value = withTiming(
      anySelected && !isSelected ? 0.22 : 1.0,
      { duration: 280, easing: Easing.out(Easing.quad) },
    );
  }, [isSelected, anySelected]);

  // Static background track (full circle)
  const trackPath = useMemo<SkPath>(() => {
    const p    = Skia.Path.Make();
    const rect = Skia.XYWHRect(center - r, center - r, r * 2, r * 2);
    p.addArc(rect, -90, 360);
    return p;
  }, [center, r]);

  // Animated active arc — rebuilt on UI thread
  const arcPath = useDerivedValue<SkPath>(() => {
    const p    = Skia.Path.Make();
    const rect = Skia.XYWHRect(center - r, center - r, r * 2, r * 2);
    const s    = Math.max(0.0001, sweep.value); // tiny floor for strokeCap
    p.addArc(rect, -90, s);
    return p;
  });

  const groupTransform = useDerivedValue(() => [{ scale: scale.value }]);

  return (
    <Group
      origin={vec(center, center)}
      transform={groupTransform}
      opacity={opacity}
    >
      <Path
        path={trackPath}
        style="stroke"
        strokeWidth={STROKE}
        strokeCap="round"
        color={data.color + TRACK_OPACITY}
      />
      <Path
        path={arcPath}
        style="stroke"
        strokeWidth={STROKE}
        strokeCap="round"
        color={data.color}
      >
        <Shadow dx={0} dy={0} blur={6} color={data.color + 'AA'} />
      </Path>
    </Group>
  );
};

// ─── DetailCard ──────────────────────────────────────────────────────────────

interface DetailCardProps {
  ring: RingData;
  onClose: () => void;
}

const DetailCard: React.FC<DetailCardProps> = ({ ring, onClose }) => {
  const childMax = useMemo(
    () => Math.max(1, ...(ring.children?.map((c) => c.amount) ?? [0])),
    [ring.children],
  );

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(20).stiffness(180)}
      exiting={FadeOutDown.duration(180)}
      style={[styles.detailCard, { borderColor: ring.color + '44' }]}
    >
      {/* Header */}
      <View style={styles.detailHeader}>
        <View
          style={[styles.detailEmojiCircle, { backgroundColor: ring.color + '18' }]}
        >
          <Text style={styles.detailEmoji}>{ring.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.detailParent}>{ring.parentCategory}</Text>
          <Text style={[styles.detailAmount, { color: ring.color }]}>
            {formatCurrency(ring.amount)}
            {ring.cap != null ? (
              <Text style={styles.detailCap}>
                {' '}of {formatCurrency(ring.cap)}
              </Text>
            ) : null}
          </Text>
        </View>
        <Pressable hitSlop={12} onPress={onClose}>
          <Text style={styles.detailClose}>×</Text>
        </Pressable>
      </View>

      {/* Over-budget pill */}
      {ring.pct > 100 ? (
        <View style={styles.overPill}>
          <Text style={styles.overPillText}>
            ⚠  {Math.round(ring.pct - 100)}% over budget
          </Text>
        </View>
      ) : null}

      {/* Sub-category breakdown */}
      {ring.children && ring.children.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailSectionLabel}>Sub-categories</Text>
          {ring.children.map((c) => {
            const w = Math.max(4, (c.amount / childMax) * 100);
            return (
              <View key={c.childCategory} style={styles.childRow}>
                <Text style={styles.childLabel}>{c.childCategory}</Text>
                <ProgressBar progress={w / 100} color={ring.color} height={5} style={styles.childBarTrack} />
                <Text style={styles.childAmount}>{formatCurrency(c.amount)}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Recent transactions */}
      {ring.recent && ring.recent.length > 0 ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailSectionLabel}>Recent</Text>
          {ring.recent.slice(0, 4).map((t) => (
            <View key={t.id} style={styles.recentRow}>
              <Text style={styles.recentMerchant} numberOfLines={1}>
                {t.merchant}
              </Text>
              <Text style={styles.recentAmount}>
                −{formatCurrency(t.amount)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
};

// ─── ConcentricSpendingRings ─────────────────────────────────────────────────

const ConcentricSpendingRings: React.FC<Props> = ({
  rings,
  centerLabel = 'Total spent',
  size = DEFAULT_SIZE,
}) => {
  const center  = size / 2;
  const visible = useMemo(() => rings.slice(0, MAX_RINGS), [rings]);
  const total   = useMemo(
    () => visible.reduce((acc, r) => acc + (r.amount || 0), 0),
    [visible],
  );

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // ── Hit test on tap — pick ring closest to the touch radius
  const handleTap = useCallback(
    (x: number, y: number) => {
      const dx = x - center;
      const dy = y - center;
      const d  = Math.sqrt(dx * dx + dy * dy);

      let hit = -1;
      let bestDelta = Infinity;
      for (let i = 0; i < visible.length; i++) {
        const r     = radiusFor(size, i);
        const delta = Math.abs(d - r);
        if (delta < STROKE + 6 && delta < bestDelta) {
          hit       = i;
          bestDelta = delta;
        }
      }
      setSelectedIndex((prev) => (hit === prev ? null : hit === -1 ? null : hit));
    },
    [center, size, visible.length],
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((e, success) => {
          if (success) runOnJS(handleTap)(e.x, e.y);
        }),
    [handleTap],
  );

  const selectedRing =
    selectedIndex != null && selectedIndex < visible.length
      ? visible[selectedIndex]
      : null;

  const centerAmount  = selectedRing ? selectedRing.amount : total;
  const centerHeading = selectedRing ? selectedRing.parentCategory : centerLabel;
  const centerColor   = selectedRing ? selectedRing.color : '#1C1C1E';

  return (
    <View style={styles.container}>
      <GestureDetector gesture={tapGesture}>
        <View style={{ width: size, height: size }}>
          <Canvas style={{ width: size, height: size }}>
            {visible.map((ringData, i) => (
              <Ring
                key={ringData.parentCategory}
                data={ringData}
                index={i}
                size={size}
                isSelected={selectedIndex === i}
                anySelected={selectedIndex != null}
              />
            ))}
          </Canvas>

          {/* Tip badges are rendered by the <Ring /> components via portal-like overlay.
              They sit absolutely inside this wrapping View thanks to the absoluteFillObject style. */}
          <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
            {visible.map((ringData, i) => (
              <RingTipOverlay
                key={`tip-${ringData.parentCategory}`}
                data={ringData}
                index={i}
                size={size}
                isSelected={selectedIndex === i}
                anySelected={selectedIndex != null}
              />
            ))}
          </View>

          {/* Centre label */}
          <View
            style={[StyleSheet.absoluteFillObject, styles.centerOverlay]}
            pointerEvents="none"
          >
            <Text style={styles.centerLabel}>{centerHeading}</Text>
            <Text style={[styles.centerAmount, { color: centerColor }]}>
              {formatCurrency(centerAmount)}
            </Text>
            {selectedRing ? (
              <Text style={styles.centerHint}>tap again to close</Text>
            ) : (
              <Text style={styles.centerHint}>tap a ring</Text>
            )}
          </View>
        </View>
      </GestureDetector>

      {/* Inline detail card */}
      {selectedRing ? (
        <DetailCard
          key={selectedRing.parentCategory}
          ring={selectedRing}
          onClose={() => setSelectedIndex(null)}
        />
      ) : null}
    </View>
  );
};

export default ConcentricSpendingRings;

// ─── RingTipOverlay (RN badge that rides the arc tip) ────────────────────────
// Same sweep animation as Ring's <Path>, but rendered in RN so the emoji
// stays sharp and crisp without needing Skia font loading.

interface RingTipOverlayProps {
  data: RingData;
  index: number;
  size: number;
  isSelected: boolean;
  anySelected: boolean;
}

const RingTipOverlay: React.FC<RingTipOverlayProps> = ({
  data,
  index,
  size,
  isSelected,
  anySelected,
}) => {
  const center = size / 2;
  const r      = radiusFor(size, index);
  const targetSweep = Math.min(100, Math.max(0, data.pct)) * 3.6;

  const sweep   = useSharedValue(0);
  const scale   = useSharedValue(1);
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    sweep.value = withDelay(
      index * 90,
      withSpring(targetSweep, { damping: 22, stiffness: 70, mass: 1 }),
    );
  }, [targetSweep]);

  React.useEffect(() => {
    scale.value = withSpring(isSelected ? 1.18 : 1.0, {
      damping: 18,
      stiffness: 220,
    });
    opacity.value = withTiming(
      anySelected && !isSelected ? 0.22 : 1.0,
      { duration: 280 },
    );
  }, [isSelected, anySelected]);

  const tipStyle = useAnimatedStyle(() => {
    const angleDeg = -90 + sweep.value;
    const angleRad = (angleDeg * Math.PI) / 180;
    const tx = center + r * Math.cos(angleRad) - TIP_BADGE_SIZE / 2;
    const ty = center + r * Math.sin(angleRad) - TIP_BADGE_SIZE / 2;
    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scale: scale.value },
      ],
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.tipBadge,
        {
          width: TIP_BADGE_SIZE,
          height: TIP_BADGE_SIZE,
          borderRadius: TIP_BADGE_SIZE / 2,
          backgroundColor: data.color,
          shadowColor: data.color,
        },
        tipStyle,
      ]}
    >
      <Text style={styles.tipEmoji}>{data.emoji}</Text>
    </Animated.View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },

  // Center overlay
  centerOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: 4,
  },
  centerAmount: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  centerHint: {
    fontSize: 10,
    fontWeight: '600',
    color: '#C1C5CC',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
  },

  // Tip badge
  tipBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  tipEmoji: {
    fontSize: 14,
    lineHeight: 16,
  },

  // Detail card
  detailCard: {
    marginTop: 16,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  detailEmojiCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailEmoji: { fontSize: 20 },
  detailParent: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  detailAmount: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  detailCap: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9CA3AF',
    letterSpacing: 0,
  },
  detailClose: {
    fontSize: 26,
    color: '#9CA3AF',
    fontWeight: '300',
    paddingHorizontal: 6,
  },

  overPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEE2E2',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  overPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B91C1C',
  },

  detailSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  detailSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },

  // Child row
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  childLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1C1C1E',
    width: 110,
  },
  childBarTrack: { flex: 1 },
  childAmount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1C1C1E',
    minWidth: 70,
    textAlign: 'right',
  },

  // Recent transaction row
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  recentMerchant: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1C1C1E',
    flex: 1,
    marginRight: 12,
  },
  recentAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1C1C1E',
  },
});
