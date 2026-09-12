// =============================================================================
// AllocationBar — one salary, split across goals, dragged by hand.
//
// The whole month's income is ONE bar. Spending (owned by Budget) sits in it as
// a locked segment, so the split reads in a glance: this much leaves, this much
// stays. Everything to its right is the user's to move.
//
// The interaction's one rule (Sep-12-26): a divider adjusts the segment to its
// LEFT against the free pool, and nobody else — never its immediate right
// neighbour. Increasing goal 2 in a 4-goal bar takes from Unallocated; goals 3
// and 4 keep their own rupee figures and simply shift position as goal 2 grows.
// Before this, a divider rebalanced its two adjacent segments directly (see
// `rebalancePair`), so dragging goal 2 wider silently ATE INTO goal 3 — the same
// bug the row steppers never had, since `allocationWithinSalary` already only
// ever trades against free. The pair's total is still invariant (left + free),
// so the bar can be dragged freely without a reconciliation step, and a plan can
// never exceed salary; a set of independent sliders would let someone allocate
// 140% of their salary and only find out at the end.
//
// ── The drag runs on the UI THREAD (Sep-11-26) ───────────────────────────────
// Phase 1 called `runOnJS` on every `onUpdate` frame, which meant a React state
// update — and a re-render of the whole screen — per frame of the drag. A slow
// drag queued hundreds, so the bar kept moving after the finger stopped and
// settled seconds later. Reported as "it keeps updating for a very long time".
//
// Now every part's value lives in ONE shared array (`values`), the gesture
// rewrites two entries of it in a worklet, and segment widths are animated
// styles reading from it. JavaScript learns the new numbers exactly ONCE, in
// `onEnd` — so the bar follows the finger at display rate and the store is
// written where the finger lifts. Haptics still fire per snapped step: they
// cross to JS but change no state, so they cost nothing to render.
//
// ⚠ THE GESTURE MUST NOT CALL ANYTHING IMPORTED. The first version of this had
// `'worklet'` on goalPlan's `snapAmount`/`rebalancePair` and called them from
// `onUpdate` — the app CRASHED on the first frame of a drag. A worklet may only
// call worklets, and a cross-FILE worklet reference is not reliably serialised
// to the UI runtime by the Reanimated 3.6 babel plugin, so it hit a plain JS
// function on the UI thread and took the process down. `snapWithin` below is
// local, and deliberately so.
//
// The maths still has ONE home: the preview only ever snaps and clamps, and the
// commit in `onEnd` runs the result back through `rebalancePair` on the JS
// thread. That re-snap is what guarantees the stored number is produced by
// `goalPlan.js` even if the local preview ever drifted.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, AccessibilityInfo } from 'react-native';
import type { TextStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { ALLOCATION_STEP, rebalancePair } from '../utils/goalPlan';
import { hapticLight, hapticSuccess } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/**
 * Snap `next` to the step and clamp it into `[0, pool]`. LOCAL, and a worklet
 * defined in the same file it is called from — see the warning above before
 * "de-duplicating" this against goalPlan.js.
 */
function snapWithin(pool: number, next: number, step: number): number {
  'worklet';

  const s = step > 0 ? step : 1;
  const n = Number(next);
  const v = Number.isFinite(n) ? n : 0;
  const snapped = Math.max(0, Math.round(v / s) * s);
  return Math.max(0, Math.min(pool, snapped));
}


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
  /** Commit one divider's move. Both sides always arrive together, on release. */
  onChangePair: (leftId: string, leftValue: number, rightId: string, rightValue: number) => void;
  /** Id used for the implicit remainder segment in `onChangePair`. */
  freeId?: string;
  disabled?: boolean;
}

type Part = AllocationSegment;

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
  const parts: Part[] = useMemo(
    () => [...segments, { id: freeId, label: 'Unallocated', emoji: '', color: 'free', value: freeValue }],
    [segments, freeValue, freeId],
  );

  // ── the one source the UI thread draws from ────────────────────────────────
  const values = useSharedValue<number[]>(parts.map((p) => Number(p.value) || 0));
  /** Index of the divider under a finger, or -1. Guards the mirror below. */
  const draggingAt = useSharedValue(-1);

  // Mirror committed props into the shared array. Keyed on the VALUES, not the
  // array identity, so an unrelated re-render doesn't touch the UI thread — and
  // skipped mid-drag, where props are by definition behind the finger.
  const valueKey = parts.map((p) => `${p.id}:${p.value}`).join('|');
  useEffect(() => {
    if (draggingAt.value !== -1) return;
    values.value = parts.map((p) => Number(p.value) || 0);
    // `parts` is rebuilt every render; valueKey is what actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueKey, values, draggingAt]);

  const commit = useCallback(
    (leftId: string, leftValue: number, rightId: string, rightValue: number, filled: boolean) => {
      onChangePair(leftId, leftValue, rightId, rightValue);
      if (filled) hapticSuccess();
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
        {parts.map((p, i) => (
          <Segment
            key={p.id}
            part={p}
            index={i}
            values={values}
            salary={salary}
            isFree={p.id === freeId}
            isFirst={i === 0}
            isLast={i === parts.length - 1}
            theme={theme}
          />
        ))}

        {/* Dividers sit on top, one at the right edge of each real segment.
            Each one only ever trades its OWN segment (`left`) against the
            free pool at `freeIndex` — never the segment drawn just after it. */}
        {parts.map((left, i) => {
          const right = parts[i + 1];
          if (!right) return null;
          const immovable = disabled || !!left.locked || barWidth === 0 || salary <= 0;
          return (
            <Divider
              key={`${left.id}-${right.id}`}
              index={i}
              left={left}
              freeIndex={parts.length - 1}
              freeValue={freeValue}
              values={values}
              draggingAt={draggingAt}
              salary={salary}
              barWidth={barWidth}
              disabled={immovable}
              tint={theme.card}
              freeId={freeId}
              onCommit={commit}
            />
          );
        })}
      </View>
    </View>
  );
};

// ─── Segment ─────────────────────────────────────────────────────────────────
// Its own component so each one owns its animated style: the number of parts
// changes as goals are added, and hooks can't live in a map that grows.

interface SegmentProps {
  part: Part;
  index: number;
  values: SharedValue<number[]>;
  salary: number;
  isFree: boolean;
  /** First / last in the row — they carry the bar's own end radii. */
  isFirst: boolean;
  isLast: boolean;
  theme: any;
}

const Segment: React.FC<SegmentProps> = ({
  part, index, values, salary, isFree, isFirst, isLast, theme,
}) => {
  const widthStyle = useAnimatedStyle(() => {
    const v = values.value[index] ?? 0;
    const pct = salary > 0 ? Math.max(0, Math.min(100, (v / salary) * 100)) : 0;
    return { width: `${pct}%` };
  }, [index, salary]);

  // The glyph fades rather than unmounting — a segment crossing the threshold
  // mid-drag must not cause a React render.
  const glyphStyle = useAnimatedStyle(() => {
    const v = values.value[index] ?? 0;
    const pct = salary > 0 ? (v / salary) * 100 : 0;
    return { opacity: pct >= GLYPH_MIN_PCT ? 1 : 0 };
  }, [index, salary]);

  // The bar clips to its own radius, which is enough for a SOLID fill — but the
  // free segment is drawn with a BORDER, and a square-cornered stroke sitting
  // under a rounded clip gets sliced off at the ends: the outline stopped short
  // of the curve instead of following it. An end segment carries the bar's
  // radius itself so its stroke bends with the bar.
  const endRadius = {
    borderTopLeftRadius: isFirst ? radius.md : 0,
    borderBottomLeftRadius: isFirst ? radius.md : 0,
    borderTopRightRadius: isLast ? radius.md : 0,
    borderBottomRightRadius: isLast ? radius.md : 0,
  };

  return (
    <Animated.View
      style={[
        styles.seg,
        widthStyle,
        endRadius,
        isFree
          ? { backgroundColor: theme.cardAlt, borderWidth: 1.5, borderColor: theme.inputBorder }
          : part.locked
            ? { backgroundColor: theme.textMuted }
            : { backgroundColor: part.color },
      ]}
    >
      <Animated.View style={glyphStyle} pointerEvents="none">
        {isFree ? (
          <Text style={[styles.freeGlyph, { color: theme.textMuted }]} numberOfLines={1}>
            FREE
          </Text>
        ) : (
          <Text style={styles.glyph} allowFontScaling={false}>{part.emoji}</Text>
        )}
      </Animated.View>
    </Animated.View>
  );
};

// ─── Divider ─────────────────────────────────────────────────────────────────

interface DividerProps {
  index: number;
  left: Part;
  /** Index of the free part in `values` — always the LAST entry. Every
   *  divider trades against this one part, whichever segment it visually
   *  sits next to. */
  freeIndex: number;
  /** Free part's current committed value — a plain prop (not the shared
   *  array) since the accessibility path runs on JS and wants the settled
   *  number, not whatever a concurrent drag has mid-flight. */
  freeValue: number;
  values: SharedValue<number[]>;
  draggingAt: SharedValue<number>;
  salary: number;
  barWidth: number;
  disabled: boolean;
  tint: string;
  freeId: string;
  onCommit: (leftId: string, leftValue: number, rightId: string, rightValue: number, filled: boolean) => void;
}

const Divider: React.FC<DividerProps> = ({
  index, left, freeIndex, freeValue, values, draggingAt, salary, barWidth, disabled, tint, freeId, onCommit,
}) => {
  /** `left` + free totals captured on `onBegin`, so each frame is measured
   *  from where the finger LANDED. Accumulating against the live value
   *  applies every delta twice and the handle runs away from the finger. */
  const startLeft = useSharedValue(0);
  const startFree = useSharedValue(0);

  /** Haptic per snapped step, and only that — nothing here touches React. */
  const stepped = useRef(() => hapticLight()).current;

  const finish = useCallback(
    (leftValue: number, freeValue: number) => {
      // The committed numbers go through the same pure helper the rest of the
      // app uses. The drag already snapped and clamped, so this is an identity
      // — it is here so the STORE never receives a number the maths module
      // didn't produce.
      const next = rebalancePair(leftValue, freeValue, leftValue);
      onCommit(left.id, next.left, freeId, next.right, next.right === 0);
    },
    [left.id, freeId, onCommit],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .activeOffsetX([-4, 4])          // let a vertical scroll win
        .onBegin(() => {
          startLeft.value = values.value[index] ?? 0;
          startFree.value = values.value[freeIndex] ?? 0;
          draggingAt.value = index;
        })
        .onUpdate((e) => {
          if (barWidth <= 0 || salary <= 0) return;
          const pool = startLeft.value + startFree.value;
          const deltaValue = (e.translationX / barWidth) * salary;
          const nextLeft = snapWithin(pool, startLeft.value + deltaValue, ALLOCATION_STEP);
          const current = values.value;
          if (nextLeft === current[index]) return;   // still inside the step
          const out = [...current];
          out[index] = nextLeft;
          out[freeIndex] = pool - nextLeft;
          values.value = out;
          runOnJS(stepped)();
        })
        .onEnd(() => {
          const current = values.value;
          runOnJS(finish)(current[index] ?? 0, current[freeIndex] ?? 0);
        })
        // Every path out of the gesture — cancel and fail included — must clear
        // this, or the mirror above stops accepting props for the rest of the
        // session and the bar silently stops reflecting the plan.
        .onFinalize(() => { draggingAt.value = -1; }),
    [disabled, index, freeIndex, barWidth, salary, values, draggingAt, startLeft, startFree, finish, stepped],
  );

  const posStyle = useAnimatedStyle(() => {
    if (salary <= 0) return { left: '0%' };
    let sum = 0;
    for (let i = 0; i <= index; i += 1) sum += values.value[i] ?? 0;
    return { left: `${Math.max(0, Math.min(100, (sum / salary) * 100))}%` };
  }, [index, salary]);

  const body = (
    <Animated.View
      style={[styles.handle, posStyle]}
      pointerEvents={disabled ? 'none' : 'auto'}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={
        disabled
          ? `${left.label} is set in Budget and can't be moved here`
          : `Move money between ${left.label} and Unallocated`
      }
      accessibilityValue={{ text: `${left.label} ${Math.round(left.value)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (disabled) return;
        const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
        const next = rebalancePair(left.value, freeValue, left.value + dir * ALLOCATION_STEP);
        onCommit(left.id, next.left, freeId, next.right, next.right === 0);
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
    </Animated.View>
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
