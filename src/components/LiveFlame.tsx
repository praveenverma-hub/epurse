// =============================================================================
// LiveFlame.tsx — Skia micro-canvas teardrop flame with organic UI-thread flicker
//
// Two stacked vector layers:
//   • Outer envelope — soft warm orange, translucent
//   • Inner core     — bright gold/yellow, sits at the floor of the outer shape
//
// Bezier control points are rebuilt every frame on the UI thread via
// useFrameCallback + useDerivedValue. Three phase-shifted sine waves of
// different frequency drive the deformation, so the flame never repeats
// perceptibly — it sways, stretches and flickers organically.
//
// Animation never wakes the JS thread; useFrameCallback ticks on the UI
// thread and Skia consumes the rebuilt SkPath directly.
// =============================================================================

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  Group,
  BlurMask,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface LiveFlameProps {
  /** Side of the square canvas in DP. Default 28. */
  size?:           number;
  /** Outer envelope fill colour. Default warm orange. */
  outerColor?:     string;
  /** Inner core fill colour. Default gold. */
  innerColor?:     string;
  /** When false the per-frame callback is paused (saves battery). Default true. */
  animated?:       boolean;
}

// ─── Path builders (UI-thread safe) ─────────────────────────────────────────

/**
 * Build a teardrop flame path on the UI thread.
 *
 *      apex (top)
 *        ▲
 *      /   \
 *     /     \
 *    (       )
 *     \     /
 *      \   /
 *       ‿     ← rounded base
 *
 * Coordinates are normalised to a [0..1] x [0..1] grid; the Skia transform
 * scales them up to the requested size. Control-point offsets fed in from
 * the shared animation state cause the apex to lean, the shoulders to
 * widen/narrow, and the base to subtly bob.
 *
 * @param sway       horizontal apex offset, range ≈ [-0.08, 0.08]
 * @param stretch    vertical apex offset, range ≈ [-0.05, 0.05] (negative = taller)
 * @param shoulder   shoulder bulge factor, range ≈ [-0.06, 0.06]
 * @param scale      overall vertical squash, range ≈ [0.95, 1.05]
 * @param size       output dimension (px)
 */
const buildFlamePath = (
  sway:     number,
  stretch:  number,
  shoulder: number,
  scale:    number,
  size:     number,
): SkPath => {
  'worklet';
  const p = Skia.Path.Make();

  // Floor mid + flame apex
  const cx     = 0.5 + sway * 0.5;          // apex drift
  const apexY  = 0.05 + stretch;            // apex Y (smaller = taller)
  const baseY  = 0.95;                      // floor Y
  const leftX  = 0.18 - shoulder;
  const rightX = 0.82 + shoulder;
  const midY   = 0.55 * scale;

  const X = (v: number) => v * size;
  const Y = (v: number) => v * size;

  // Start at left floor anchor, sweep up the left flank to apex, then back
  // down the right flank, closing across the rounded base.
  p.moveTo(X(0.5), Y(baseY));
  p.cubicTo(
    X(leftX),       Y(baseY - 0.05),
    X(leftX - 0.05), Y(midY),
    X(cx - 0.06),    Y(apexY + 0.04),
  );
  p.cubicTo(
    X(cx - 0.03), Y(apexY + 0.01),
    X(cx + 0.03), Y(apexY + 0.01),
    X(cx + 0.06), Y(apexY + 0.04),
  );
  p.cubicTo(
    X(rightX + 0.05), Y(midY),
    X(rightX),        Y(baseY - 0.05),
    X(0.5),           Y(baseY),
  );
  p.close();
  return p;
};

/**
 * Inner core teardrop — shorter and narrower, parked on the floor of the
 * outer shape. Shares the same phase so the wobble feels coherent.
 */
const buildCorePath = (
  sway:    number,
  stretch: number,
  scale:   number,
  size:    number,
): SkPath => {
  'worklet';
  const p     = Skia.Path.Make();
  const cx    = 0.5 + sway * 0.35;
  const apexY = 0.30 + stretch * 0.7;
  const baseY = 0.92;
  const midY  = 0.65 * scale;

  const X = (v: number) => v * size;
  const Y = (v: number) => v * size;

  p.moveTo(X(0.5), Y(baseY));
  p.cubicTo(
    X(0.34), Y(baseY - 0.04),
    X(0.30), Y(midY),
    X(cx - 0.04), Y(apexY + 0.03),
  );
  p.cubicTo(
    X(cx - 0.02), Y(apexY),
    X(cx + 0.02), Y(apexY),
    X(cx + 0.04), Y(apexY + 0.03),
  );
  p.cubicTo(
    X(0.70), Y(midY),
    X(0.66), Y(baseY - 0.04),
    X(0.50), Y(baseY),
  );
  p.close();
  return p;
};

// ─── Component ──────────────────────────────────────────────────────────────

const LiveFlame: React.FC<LiveFlameProps> = ({
  size       = 28,
  outerColor = '#FB923C',
  innerColor = '#FCD34D',
  animated   = true,
}) => {
  // Single monotonically-increasing seconds clock, advanced on the UI thread.
  const phase = useSharedValue(0);

  useFrameCallback((info) => {
    if (!animated) return;
    // info.timeSincePreviousFrame is ms; convert to seconds.
    phase.value += (info.timeSincePreviousFrame ?? 16) / 1000;
  }, true);

  // Three phase-shifted sine bands at distinct frequencies produce a flicker
  // that never aliases into a repeating loop the eye can lock onto.
  const outerPath = useDerivedValue<SkPath>(() => {
    const t        = phase.value;
    const sway     = Math.sin(t * 2.4)          * 0.06
                   + Math.sin(t * 5.7 + 1.3)    * 0.02;
    const stretch  = Math.sin(t * 3.1 + 0.8)    * 0.035
                   + Math.sin(t * 7.9 + 2.1)    * 0.015;
    const shoulder = Math.sin(t * 1.7 + 2.5)    * 0.05;
    const scale    = 1 + Math.sin(t * 4.3) * 0.04;
    return buildFlamePath(sway, stretch, shoulder, scale, size);
  }, [size]);

  const corePath = useDerivedValue<SkPath>(() => {
    const t       = phase.value;
    const sway    = Math.sin(t * 2.4 + 0.4)     * 0.045
                  + Math.sin(t * 6.2)           * 0.018;
    const stretch = Math.sin(t * 3.1 + 1.2)     * 0.025;
    const scale   = 1 + Math.sin(t * 4.3 + 0.6) * 0.05;
    return buildCorePath(sway, stretch, scale, size);
  }, [size]);

  // Soft halo blur radius is tied to flame size so small chips stay crisp.
  const haloBlur = useMemo(() => Math.max(2, size * 0.18), [size]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        {/* Outer warm halo — bloom effect */}
        <Group>
          <Path path={outerPath} color={outerColor} opacity={0.55}>
            <BlurMask blur={haloBlur} style="solid" />
          </Path>
          {/* Outer envelope (translucent) */}
          <Path path={outerPath} color={outerColor} opacity={0.85} />
          {/* Inner gold core */}
          <Path path={corePath} color={innerColor} opacity={0.95} />
        </Group>
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems:     'center',
    justifyContent: 'center',
  },
});

export default LiveFlame;
