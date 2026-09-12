// =============================================================================
// ProgressRing — the app's static circular progress arc.
//
// Extracted when GoalCard needed a fifth copy of the same 30 lines. The
// implementation is BudgetSummary's, unchanged, and the reasons it is built
// this way are load-bearing (ui-consistency §5b):
//
//   • a STATIC `strokeDashoffset` with the rotation applied to the Circle
//     itself — never `<G rotation>` + `useAnimatedProps`. That was the one ring
//     built the other way, and the only one that rendered EMPTY on device while
//     its own "%" label showed the right number. Reanimated props on an SVG
//     child inside a transformed <G> don't reliably reach the native view.
//   • non-finite input is guarded: a NaN dashoffset blanks the arc entirely
//     rather than degrading to "empty", so a bad number would look exactly like
//     0%.
//   • the track is the fill's own colour, tinted (`progressTrack`), so
//     "remaining" reads as the same quantity as "done" — never a neutral grey.
//
// If a ring must ANIMATE, drive it with RN-core `Animated` and make the resting
// state static (see ClassicProgressRing), or use GaugeProgress. Don't animate
// this one.
// =============================================================================

import React from 'react';
import Svg, { Circle } from 'react-native-svg';

import { progressTrack } from '../constants/theme';

export interface ProgressRingProps {
  /** 0..1. Clamped, and treated as 0 if it isn't a finite number. */
  progress: number;
  size: number;
  strokeWidth: number;
  /** The arc's colour. The track is derived from it. */
  color: string;
  /** Override the derived track — only for a bespoke surface. */
  trackColor?: string;
}

const ProgressRing: React.FC<ProgressRingProps> = ({
  progress, size, strokeWidth, color, trackColor,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const dashOffset = circumference * (1 - safe);

  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={trackColor ?? progressTrack(color)}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
};

export default ProgressRing;
