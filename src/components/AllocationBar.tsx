// =============================================================================
// AllocationBar — one salary, split across goals, dragged by hand.
//
// The whole month's income is ONE bar. Spending (owned by Budget) sits in it as
// a locked segment, so the split reads in a glance: this much leaves, this much
// stays. Everything to its right is the user's to move.
//
// The interaction's one rule: a divider moves money between its TWO neighbours
// and nobody else. The pair's total is invariant (see rebalancePair), so the bar
// can be dragged freely without ever needing a reconciliation step — a goal only
// grows because the one beside it shrank. That honesty is the point; a set of
// independent sliders would let someone allocate 140% of their salary and only
// find out at the end.
//
// Values snap to ALLOCATION_STEP, so `onChangePair` fires only when the snapped
// amount actually changes — a handful of times per drag, not once per frame.
// That is what lets the committed value live in the store (the single source of
// truth) instead of being mirrored into shared values and reconciled after.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import type { TextStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { ALLOCATION_STEP, rebalancePair } from '../utils/goalPlan';
import { hapticLight, hapticSuccess } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Bar height. Tall enough that a segment reads as a surface, not a progress line. */
const BAR_H = 62;
/** Touch width of a divider. Wider than it looks — 26 is well under a 44pt target
 *  on its own, but the handles sit shoulder to shoulder, so a wider hit area
 *  would steal from its neighbour. Keyboard/stepper paths cover precision. */
const HANDLE_W = 28;
/** Below this share of the bar a segment can't show its glyph without clipping. */
const GLYPH_MIN_PCT = 7;

export interface AllocationSegment {
  id: string;
  label: string;
  /** A goal's own emoji is DATA (the icons rule allows it), so it renders as-is. */
  emoji: string;
  color: string;
  value: number;
  /** Spending: visible because it's true, immovable because Budget owns it. */
  locked?: boolean;
}

interface Props {
  salary: number;
  segments: AllocationSegment[];
  /** Commit one divider's move. Both sides always arrive together. */
  onChangePair: (leftId: string, leftValue: number, rightId: string, rightValue: number) => void;
  /** Id used for the implicit remainder segment in `onChangePair`. */
  freeId?: string;
  disabled?: boolean;
}

const AllocationBar: React.FC<Props> = ({
  salary,
  segments,
  onChangePair,
  freeId = '__free__',
  disabled = false,
}) => {
  const theme = useTheme();
  const [barWidth, setBarWidth] = useState(0);

  const allocated = segments.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const freeValue = Math.max(0, salary - allocated);

  /** Segments plus the remainder, which is a real part of the bar rather than a
   *  number in a corner — so dragging the last divider visibly eats into it. */
  const parts = useMemo(
    () => [...segments, { id: freeId, label: 'Unallocated', emoji: '', color: 'free', value: freeValue }],
    [segments, freeValue, freeId],
  );

  const pct = useCallback(
    (v: number) => (salary > 0 ? Math.max(0, (v / salary) * 100) : 0),
    [salary],
  );

  const commit = useCallback(
    (leftId: string, leftValue: number, rightId: string, rightValue: number, filled: boolean) => {
      onChangePair(leftId, leftValue, rightId, rightValue);
      if (filled) hapticSuccess();
      else hapticLight();
    },
    [onChangePair],
  );

  return (
    <View>
      <View
        style={[styles.bar, { backgroundColor: theme.cardAlt }]}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        accessible={false}
      >
        {parts.map((p) => {
          const w = pct(p.value);
          const isFree = p.id === freeId;
          return (
            <View
              key={p.id}
              style={[
                styles.seg,
                { width: `${w}%` },
                isFree
                  ? { backgroundColor: theme.cardAlt, borderWidth: 1.5, borderColor: theme.inputBorder }
                  : p.locked
                    ? { backgroundColor: theme.textMuted }
                    : { backgroundColor: p.color },
              ]}
            >
              {w >= GLYPH_MIN_PCT ? (
                isFree ? (
                  <Text style={[styles.freeGlyph, { color: theme.textMuted }]} numberOfLines={1}>
                    FREE
                  </Text>
                ) : (
                  <Text style={styles.glyph} allowFontScaling={false}>{p.emoji}</Text>
                )
              ) : null}
            </View>
          );
        })}

        {/* Dividers sit on top, one between each adjacent pair. */}
        {parts.map((left, i) => {
          const right = parts[i + 1];
          if (!right) return null;
          const offset = parts.slice(0, i + 1).reduce((a, s) => a + pct(s.value), 0);
          const immovable = disabled || !!left.locked || !!right.locked || barWidth === 0;
          return (
            <Divider
              key={`${left.id}-${right.id}`}
              leftPct={offset}
              left={left}
              right={right}
              salary={salary}
              barWidth={barWidth}
              disabled={immovable}
              tint={theme.card}
              onCommit={commit}
            />
          );
        })}
      </View>
    </View>
  );
};

// ─── Divider ─────────────────────────────────────────────────────────────────

interface DividerProps {
  leftPct: number;
  left: AllocationSegment | { id: string; value: number; label: string; locked?: boolean };
  right: AllocationSegment | { id: string; value: number; label: string; locked?: boolean };
  salary: number;
  barWidth: number;
  disabled: boolean;
  tint: string;
  onCommit: (leftId: string, leftValue: number, rightId: string, rightValue: number, filled: boolean) => void;
}

const Divider: React.FC<DividerProps> = ({
  leftPct, left, right, salary, barWidth, disabled, tint, onCommit,
}) => {
  /**
   * The pair's values at gesture start. Captured on begin rather than read from
   * props during the move: props update as we commit, so accumulating against
   * the live value would apply each delta twice and the handle would run away
   * from the finger.
   */
  const [origin, setOrigin] = useState({ left: 0, right: 0 });

  const apply = useCallback(
    (translationX: number, startLeft: number, startRight: number) => {
      if (barWidth <= 0 || salary <= 0) return;
      const deltaValue = (translationX / barWidth) * salary;
      const next = rebalancePair(startLeft, startRight, startLeft + deltaValue, ALLOCATION_STEP);
      if (next.left === left.value && next.right === right.value) return;  // still inside the step
      const filled = right.id === '__free__' && next.right === 0;
      onCommit(left.id, next.left, right.id, next.right, filled);
    },
    [barWidth, salary, left.value, left.id, right.value, right.id, onCommit],
  );

  const begin = useCallback(() => {
    setOrigin({ left: left.value, right: right.value });
  }, [left.value, right.value]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetX([-4, 4])          // let a vertical scroll win
        .onBegin(() => { runOnJS(begin)(); })
        .onUpdate((e) => { runOnJS(apply)(e.translationX, origin.left, origin.right); }),
    [disabled, begin, apply, origin.left, origin.right],
  );

  const body = (
    <View
      style={[
        styles.handle,
        { left: `${leftPct}%` },
      ]}
      pointerEvents={disabled ? 'none' : 'auto'}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={
        disabled
          ? `${left.label} is set in Budget and can't be moved here`
          : `Move money between ${left.label} and ${right.label}`
      }
      accessibilityValue={{ text: `${left.label} ${Math.round(left.value)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        const next = rebalancePair(left.value, right.value, left.value + dir * ALLOCATION_STEP);
        onCommit(left.id, next.left, right.id, next.right, right.id === '__free__' && next.right === 0);
        AccessibilityInfo.announceForAccessibility?.(`${left.label} ${Math.round(next.left)}`);
      }}
    >
      <View
        style={[
          styles.grip,
          { backgroundColor: tint, opacity: disabled ? 0.5 : 1 },
          disabled && styles.gripLocked,
        ]}
      />
    </View>
  );

  if (disabled) return body;
  return <GestureDetector gesture={gesture}>{body}</GestureDetector>;
};

const styles = StyleSheet.create({
  bar: {
    height: BAR_H,
    borderRadius: radius.md,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  seg: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  glyph: { fontSize: 17 },
  freeGlyph: { ...typography.tiny, fontWeight: '800', letterSpacing: 0.6 },

  handle: {
    position: 'absolute',
    top: 0,
    height: BAR_H,
    width: HANDLE_W,
    marginLeft: -HANDLE_W / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: {
    width: 4,
    height: 26,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.28,
    shadowRadius: 3,
    elevation: 2,
  },
  gripLocked: { height: 18, width: 3 },

  spacer: { height: spacing.xs },
});

export default AllocationBar;
