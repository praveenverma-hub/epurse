// =============================================================================
// HabitLeakMatrix — animated bubble scatter matrix
// Bubbles are absolute-positioned Animated.Views (not SVG circles) for touch
// and spring animation. SVG behind them provides the quadrant grid.
// =============================================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
} from 'react-native';
import Svg, { Line, Text as SvgText, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { colors, spacing, radius, typography, shadows } from '../constants/theme';
import { formatCurrency } from '../utils/format';

const SCREEN_W = Dimensions.get('window').width;
const MATRIX_SIZE = SCREEN_W - spacing.lg * 4;
const INNER_PAD = 32;
const PLOT_SIZE = MATRIX_SIZE - INNER_PAD * 2;
const BUBBLE_MIN_R = 8;
const BUBBLE_MAX_R = 28;

const PALETTE = [
  '#6D28D9',
  '#F59E0B',
  '#10B981',
  '#EF4444',
  '#3B82F6',
  '#EC4899',
  '#14B8A6',
  '#F97316',
  '#8B5CF6',
  '#06B6D4',
];

// ---------------------------------------------------------------------------
// BubbleItem — individual animated bubble
// ---------------------------------------------------------------------------
// Pure visual — taps are handled at the plot level (nearest-bubble), so overlapping
// bubbles stay individually reachable. Expanded bubble is raised above its neighbours
// (zIndex) and gets a white ring so it reads clearly out of a cluster.
const BubbleItem = ({ b, x, y, r, color, isExpanded }) => {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isExpanded) {
      scale.value = withSpring(1.18, { damping: 10, stiffness: 180 });
    } else {
      scale.value = withSpring(1, { damping: 14 });
    }
  }, [isExpanded]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          left: x - r,
          top: y - r,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          zIndex: isExpanded ? 20 : 1,
          borderWidth: isExpanded ? 2 : 1,
          borderColor: isExpanded ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
        },
        animStyle,
      ]}
    >
      <Text
        numberOfLines={2}
        style={styles.bubbleText}
      >
        {b.name}
      </Text>
    </Animated.View>
  );
};

// ---------------------------------------------------------------------------
// HabitLeakMatrix
// ---------------------------------------------------------------------------
const HabitLeakMatrix = ({ bubbles }) => {
  const [expandedKey, setExpandedKey] = useState(null);

  if (!bubbles || bubbles.length < 3) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          Make at least 2 transactions each at 3+ merchants this month to see patterns.
        </Text>
      </View>
    );
  }

  const maxFreq = Math.max(...bubbles.map((b) => b.frequency));
  const maxVol = Math.max(...bubbles.map((b) => b.volume));

  // Medians
  const sortedFreqs = [...bubbles.map((b) => b.frequency)].sort((a, b) => a - b);
  const sortedVols = [...bubbles.map((b) => b.volume)].sort((a, b) => a - b);
  const medianFreq = sortedFreqs[Math.floor(sortedFreqs.length / 2)];
  const medianVol = sortedVols[Math.floor(sortedVols.length / 2)];

  const toX = (freq) => INNER_PAD + (freq / maxFreq) * PLOT_SIZE;
  const toY = (vol) => INNER_PAD + (1 - vol / maxVol) * PLOT_SIZE;
  const toR = (vol) =>
    BUBBLE_MIN_R + Math.sqrt(vol / maxVol) * (BUBBLE_MAX_R - BUBBLE_MIN_R);

  const divX = toX(medianFreq);
  const divY = toY(medianVol);

  const expandedBubble = expandedKey
    ? bubbles.find((b) => b.key === expandedKey)
    : null;

  // Precompute every bubble's screen geometry once so the tap handler can resolve
  // the nearest one (see handleMatrixPress).
  const positions = bubbles.map((b) => ({
    key: b.key,
    x: toX(b.frequency),
    y: toY(b.volume),
    r: toR(b.volume),
  }));

  const handleBubblePress = (key) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  };

  // A single plot-level tap resolves to the NEAREST bubble instead of relying on each
  // bubble's own hit box — so 2-3 clustered/overlapping bubbles are all reachable by
  // aiming at (or toward) their centre. A tap inside a bubble always wins over a far
  // one; otherwise the closest centre within a small margin is selected.
  const handleMatrixPress = (evt) => {
    const { locationX, locationY } = evt.nativeEvent;
    let best = null;
    let bestScore = Infinity;
    positions.forEach((p) => {
      const dx = p.x - locationX;
      const dy = p.y - locationY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Inside the bubble → strongly preferred (negative); else distance to centre.
      const score = dist <= p.r ? dist - p.r * 2 : dist;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    });
    // Ignore taps in empty space far from any bubble (collapses the detail card).
    if (!best) return;
    if (bestScore > 0 && bestScore > BUBBLE_MAX_R * 1.5) {
      setExpandedKey(null);
      return;
    }
    handleBubblePress(best.key);
  };

  return (
    <View>
      <View style={[styles.matrixContainer, { width: MATRIX_SIZE, height: MATRIX_SIZE }]}>
        {/* SVG grid behind bubbles */}
        <Svg
          width={MATRIX_SIZE}
          height={MATRIX_SIZE}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          {/* Habit-leak quadrant highlight (bottom-right: high freq, low vol) */}
          <Rect
            x={divX}
            y={divY}
            width={MATRIX_SIZE - divX - INNER_PAD}
            height={MATRIX_SIZE - divY - INNER_PAD}
            fill="#FEE2E2"
            opacity={0.4}
          />

          {/* Divider lines */}
          <Line
            x1={divX}
            y1={INNER_PAD}
            x2={divX}
            y2={MATRIX_SIZE - INNER_PAD}
            stroke={colors.divider}
            strokeWidth={1}
            strokeDasharray="4,3"
          />
          <Line
            x1={INNER_PAD}
            y1={divY}
            x2={MATRIX_SIZE - INNER_PAD}
            y2={divY}
            stroke={colors.divider}
            strokeWidth={1}
            strokeDasharray="4,3"
          />

          {/* Quadrant labels */}
          <SvgText
            x={INNER_PAD + 6}
            y={INNER_PAD + 14}
            fontSize={10}
            fill={colors.textMuted}
          >
            Big Spends
          </SvgText>
          <SvgText
            x={divX + 6}
            y={MATRIX_SIZE - INNER_PAD - 6}
            fontSize={10}
            fill="#DC2626"
            fontWeight="700"
          >
            ⚡ Habit Leaks
          </SvgText>
          <SvgText
            x={INNER_PAD + 6}
            y={MATRIX_SIZE - INNER_PAD - 6}
            fontSize={10}
            fill={colors.textMuted}
          >
            Occasional
          </SvgText>
          <SvgText
            x={divX + 6}
            y={INNER_PAD + 14}
            fontSize={10}
            fill={colors.textMuted}
          >
            Regular Bigs
          </SvgText>

          {/* Axis labels */}
          <SvgText
            x={INNER_PAD}
            y={MATRIX_SIZE - 6}
            fontSize={9}
            fill={colors.textMuted}
          >
            Low freq
          </SvgText>
          <SvgText
            x={MATRIX_SIZE - INNER_PAD - 60}
            y={MATRIX_SIZE - 6}
            fontSize={9}
            fill={colors.textMuted}
          >
            High freq →
          </SvgText>
          <SvgText
            x={10}
            y={INNER_PAD + 20}
            fontSize={9}
            fill={colors.textMuted}
            rotation="-90"
            origin={`${10}, ${INNER_PAD + 20}`}
            translateX={-(INNER_PAD + 20 - 10)}
            translateY={0}
          >
            ↑ High vol
          </SvgText>
          <SvgText
            x={10}
            y={MATRIX_SIZE - INNER_PAD - 10}
            fontSize={9}
            fill={colors.textMuted}
            rotation="-90"
            origin={`${10}, ${MATRIX_SIZE - INNER_PAD - 10}`}
            translateX={-(MATRIX_SIZE - INNER_PAD - 10 - 10)}
            translateY={0}
          >
            Low vol
          </SvgText>
        </Svg>

        {/* Bubbles (pure visuals — tap handled by the overlay below) */}
        {bubbles.map((b, index) => {
          const x = toX(b.frequency);
          const y = toY(b.volume);
          const r = toR(b.volume);
          const isHabitLeak = b.frequency >= medianFreq && b.volume <= medianVol;
          const color = isHabitLeak ? '#EF4444' : PALETTE[index % PALETTE.length];
          const isExpanded = expandedKey === b.key;

          return (
            <BubbleItem
              key={b.key}
              b={b}
              x={x}
              y={y}
              r={r}
              color={color}
              isExpanded={isExpanded}
            />
          );
        })}

        {/* Transparent tap layer on top — routes every tap to the nearest bubble so
            clustered dots are all selectable. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleMatrixPress}
          accessibilityRole="adjustable"
          accessibilityLabel="Merchant bubble chart — tap a bubble for details"
        />
      </View>

      {/* Detail card */}
      {expandedBubble && (
        <View style={styles.detailCard}>
          <Text style={styles.detailMerchant}>{expandedBubble.name}</Text>
          <View style={styles.detailStats}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{expandedBubble.frequency}×</Text>
              <Text style={styles.statLabel}>visits</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatCurrency(expandedBubble.volume)}</Text>
              <Text style={styles.statLabel}>total</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatCurrency(expandedBubble.avgAmount)}</Text>
              <Text style={styles.statLabel}>avg/visit</Text>
            </View>
          </View>
          {expandedBubble.frequency >= medianFreq && expandedBubble.volume <= medianVol && (
            <View style={styles.insightBar}>
              <Text style={styles.insightText}>
                {`💡 You visited here ${expandedBubble.frequency} times this month. That's ${formatCurrency(expandedBubble.volume)} in micro-transactions!`}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  emptyContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  matrixContainer: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
  },
  bubbleText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 2,
  },
  detailCard: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.card,
  },
  detailMerchant: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  detailStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statValue: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.tiny,
    color: colors.textSecondary,
    marginTop: 2,
  },
  insightBar: {
    marginTop: spacing.sm,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  insightText: {
    ...typography.small,
    color: '#92400E',
    lineHeight: 18,
  },
});

export default HabitLeakMatrix;
