// =============================================================================
// CrystalPiggyVault.tsx — premium Skia asset that visualises Aware Run progress
// -----------------------------------------------------------------------------
// Three evolutionary states, all rendered in the same component by tier:
//
//   • 'base'    — Days 1–2.  Frosted-gray line-art piggy outline. One single
//                 low-saturation teal diamond resting calmly in the belly.
//                 Compact, peaceful, daily-presence vibe.
//
//   • 'streak'  — Days 3–15.  Outline gains a crisp sky-blue metallic gradient.
//                 Three to four cyan / ice-blue diamond shards stack inside,
//                 filling the vault about half-way. A soft halo bleed implies
//                 "building momentum".
//
//   • 'premium' — Days 16+.   Outline transforms into a polished matte-gold
//                 line-art profile. The vault is fully packed with a tight
//                 cluster of emerald-mint + crystalline-gold prisms. A slow
//                 specular sweep traces across the cluster every few seconds.
//
// All geometry is normalised to a [0..1] space and scaled by the `size` prop,
// so the same component renders crisply at 44px in a header AND at 120px in
// a focus modal. Animation graph lives entirely on the UI thread via
// Reanimated v3 shared values + Skia's useDerivedValue / useFrameCallback.
// =============================================================================

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

import type { VaultTier } from '../config/rewardConfig';

// ─── Public props ───────────────────────────────────────────────────────────

export interface CrystalPiggyVaultProps {
  /** Visual tier — usually derived from the user's Aware Run streak. */
  tier:     VaultTier;
  /** Side of the square canvas in DP. Default 44 (header chip size). */
  size?:    number;
  /** When false, the per-frame UI-thread callback is paused. Default true. */
  animated?: boolean;
}

// ─── Palette per tier ───────────────────────────────────────────────────────
// Hand-tuned for the design brief: low-saturation teal calm → cyan momentum
// → emerald-gold milestone. Each palette also exposes a halo colour used by
// the BlurMask "aura" rendered behind the outline.

interface Palette {
  /** Outline stroke gradient (start, end). */
  outline:    [string, string];
  /** Crystal facet fill gradient (start, end). */
  crystal:    [string, string];
  /** Optional second-tier accent crystal (premium only). */
  accent?:    [string, string];
  /** Halo bleed colour. Empty string = no halo. */
  halo:       string;
  /** Specular highlight tint. */
  specular:   string;
}

const PALETTES: Record<VaultTier, Palette> = {
  base: {
    outline:  ['#D1D5DB', '#C7CBD2'],
    crystal:  ['#5EEAD4', '#2DD4BF'],
    halo:     '',
    specular: 'rgba(255,255,255,0.42)',
  },
  streak: {
    outline:  ['#BAE6FD', '#0EA5E9'],
    crystal:  ['#A5F3FC', '#06B6D4'],
    halo:     'rgba(125, 211, 252, 0.32)',
    specular: 'rgba(255,255,255,0.62)',
  },
  premium: {
    outline:  ['#FCD34D', '#D4AF37'],
    crystal:  ['#6EE7B7', '#10B981'],
    accent:   ['#FDE68A', '#F59E0B'],
    halo:     'rgba(252, 211, 77, 0.30)',
    specular: 'rgba(255, 248, 220, 0.85)',
  },
};

// ─── Static geometry — built once per `size`, reused every frame ────────────

/**
 * The piggy-bank silhouette as a single stroked Path. Drawn in normalised
 * [0..1] coordinates and scaled to `size`. Faces right; the snout sits on
 * the right side of the body, an ear pokes up on the top-left, two legs
 * descend below the body.
 *
 * Path is intentionally drawn as one continuous outline so a single stroke
 * pass produces clean geometric line-art.
 */
const buildPiggyOutline = (size: number): SkPath => {
  const p = Skia.Path.Make();
  const X = (v: number) => v * size;
  const Y = (v: number) => v * size;

  // --- Body (rounded rectangle traced manually so we can branch the ear/snout)
  // Top-left corner (start) → up over ear → across top to snout-out point →
  // around snout → back along bottom to right leg → leg down/up/over to left
  // leg → leg down/up → back up to start.

  // Start at lower-left of body curve
  p.moveTo(X(0.10), Y(0.55));
  // Left side up to ear base (left)
  p.cubicTo(X(0.10), Y(0.42), X(0.12), Y(0.34), X(0.18), Y(0.30));
  // Ear: up to tip then back down to the body top-left
  p.lineTo(X(0.22), Y(0.30));
  p.lineTo(X(0.30), Y(0.16));
  p.lineTo(X(0.38), Y(0.30));
  // Continue along the top of the body, curving toward the snout
  p.cubicTo(X(0.46), Y(0.26), X(0.58), Y(0.26), X(0.66), Y(0.30));
  // Up and around the snout (slight protrusion on top-right)
  p.lineTo(X(0.66), Y(0.42));
  p.cubicTo(X(0.74), Y(0.42), X(0.90), Y(0.44), X(0.90), Y(0.54));
  p.cubicTo(X(0.90), Y(0.64), X(0.74), Y(0.66), X(0.66), Y(0.66));
  // Back to body right-curve
  p.cubicTo(X(0.66), Y(0.72), X(0.66), Y(0.74), X(0.62), Y(0.76));
  // Right leg down
  p.lineTo(X(0.62), Y(0.86));
  p.lineTo(X(0.52), Y(0.86));
  p.lineTo(X(0.52), Y(0.78));
  // Across belly bottom to left leg
  p.cubicTo(X(0.44), Y(0.80), X(0.34), Y(0.80), X(0.26), Y(0.78));
  // Left leg down
  p.lineTo(X(0.26), Y(0.86));
  p.lineTo(X(0.16), Y(0.86));
  p.lineTo(X(0.16), Y(0.76));
  // Back up the left flank to the start
  p.cubicTo(X(0.12), Y(0.72), X(0.10), Y(0.66), X(0.10), Y(0.55));
  p.close();
  return p;
};

/**
 * The coin-slot mark — small horizontal rounded line on top of the body,
 * drawn as a fillable thin rounded rect so the stroke comes out crisp.
 */
const buildCoinSlot = (size: number): SkPath => {
  const p = Skia.Path.Make();
  const rx = 1.5;
  // Tiny rounded rect centered on the head/back
  p.addRRect(
    Skia.RRectXY(
      Skia.XYWHRect(0.34 * size, 0.27 * size, 0.18 * size, 0.024 * size),
      rx,
      rx,
    ),
  );
  return p;
};

/**
 * A single diamond crystal facet, centered at (cx, cy) with a given radius.
 * Returns a closed kite-shaped Path (slightly wider than tall for elegance).
 */
const buildDiamond = (
  cx:    number,
  cy:    number,
  r:     number,
  size:  number,
): SkPath => {
  const p  = Skia.Path.Make();
  const x  = (v: number) => v * size;
  const y  = (v: number) => v * size;
  p.moveTo(x(cx),            y(cy - r));
  p.lineTo(x(cx + r * 0.85), y(cy));
  p.lineTo(x(cx),            y(cy + r));
  p.lineTo(x(cx - r * 0.85), y(cy));
  p.close();
  return p;
};

/**
 * Per-tier crystal layout. Coordinates and radii are in normalised body
 * space — tweaked by hand to look like loose stacks (base, streak) or
 * tightly clustered (premium).
 */
interface CrystalSpec {
  cx:        number;
  cy:        number;
  r:         number;
  /** When true, paint with `accent` palette instead of `crystal`. */
  accent?:   boolean;
}

const CRYSTAL_LAYOUTS: Record<VaultTier, CrystalSpec[]> = {
  base: [
    { cx: 0.42, cy: 0.56, r: 0.10 },
  ],
  streak: [
    { cx: 0.30, cy: 0.60, r: 0.075 },
    { cx: 0.46, cy: 0.62, r: 0.085 },
    { cx: 0.40, cy: 0.50, r: 0.075 },
  ],
  premium: [
    { cx: 0.40, cy: 0.56, r: 0.10,  accent: false },
    { cx: 0.27, cy: 0.58, r: 0.07,  accent: true  },
    { cx: 0.52, cy: 0.58, r: 0.07,  accent: true  },
    { cx: 0.34, cy: 0.46, r: 0.06,  accent: false },
    { cx: 0.46, cy: 0.46, r: 0.06,  accent: true  },
    { cx: 0.40, cy: 0.65, r: 0.055, accent: false },
  ],
};

// ─── Component ──────────────────────────────────────────────────────────────

const CrystalPiggyVault: React.FC<CrystalPiggyVaultProps> = ({
  tier,
  size     = 44,
  animated = true,
}) => {
  const palette = PALETTES[tier];

  // Static geometry — recomputed only when size changes.
  const outlinePath  = useMemo(() => buildPiggyOutline(size), [size]);
  const slotPath     = useMemo(() => buildCoinSlot(size),    [size]);
  const crystalPaths = useMemo(
    () =>
      CRYSTAL_LAYOUTS[tier].map((c) => ({
        path:   buildDiamond(c.cx, c.cy, c.r, size),
        accent: !!c.accent,
      })),
    [tier, size],
  );

  // Stroke width scales gently with size so 44px and 120px both read crisp.
  const stroke      = Math.max(1, size * 0.035);
  const innerStroke = Math.max(0.5, size * 0.018);

  // ── Animation clock — single seconds-since-mount value on UI thread ─────
  const t = useSharedValue<number>(0);
  useFrameCallback((info) => {
    if (!animated) return;
    t.value += (info.timeSincePreviousFrame ?? 16) / 1000;
  }, true);

  // Subtle breathing — applied to crystal opacity for a calm pulse.
  // (Premium tier uses a sharper pulse to feel more alive.)
  const breath = useDerivedValue(() => {
    const amp = tier === 'premium' ? 0.18 : tier === 'streak' ? 0.12 : 0.08;
    const base = tier === 'premium' ? 0.92 : 0.88;
    return base + Math.sin(t.value * 1.8) * amp;
  }, [tier]);

  // Specular sweep — a thin bright stroke that travels across the crystals.
  // We render it as a stroked diamond whose vertical position tracks `sweepY`.
  // Streak/premium tiers only; base tier gets a tiny static glint instead.
  const sweepY = useDerivedValue(() => {
    if (tier === 'base') return 0;
    // Loop from 0.35 → 0.70 over ~4 seconds, then jump back (linear is fine
    // for a specular glint — eye doesn't notice the snap because opacity
    // also drops off at the edges).
    const cycle = 4.0;
    const phase = (t.value % cycle) / cycle; // 0..1
    return 0.35 + phase * 0.35;
  }, [tier]);
  const sweepOpacity = useDerivedValue(() => {
    if (tier === 'base') return 0.0;
    const cycle = 4.0;
    const phase = (t.value % cycle) / cycle; // 0..1
    // Bell curve so the sweep fades in/out rather than snapping
    return Math.max(0, Math.sin(phase * Math.PI)) * (tier === 'premium' ? 0.95 : 0.7);
  }, [tier]);

  // Sweep path — a thin wide diamond running across the middle of the body
  const sweepPath = useDerivedValue(() => {
    const p = Skia.Path.Make();
    const cy = sweepY.value;
    const cx = 0.40;
    const w  = 0.20;
    const h  = 0.022;
    const X = (v: number) => v * size;
    const Y = (v: number) => v * size;
    p.moveTo(X(cx - w), Y(cy));
    p.lineTo(X(cx),     Y(cy - h));
    p.lineTo(X(cx + w), Y(cy));
    p.lineTo(X(cx),     Y(cy + h));
    p.close();
    return p;
  }, [size]);

  // Halo radius — soft bloom behind streak/premium outlines
  const haloBlur = Math.max(2, size * 0.16);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        {/* ── Halo: bloom behind the outline (streak / premium only) ── */}
        {palette.halo ? (
          <Path path={outlinePath} color={palette.halo} style="stroke" strokeWidth={stroke * 2.2}>
            <BlurMask blur={haloBlur} style="solid" />
          </Path>
        ) : null}

        {/* ── Crystal cluster (rendered BEFORE outline so the line-art reads
            on top of the gems, not behind them) ── */}
        <Group opacity={breath}>
          {crystalPaths.map((c, i) => {
            const grad = c.accent && palette.accent ? palette.accent : palette.crystal;
            return (
              <Group key={`crystal-${i}`}>
                {/* Soft fill */}
                <Path path={c.path}>
                  <LinearGradient
                    start={vec(0, 0)}
                    end={vec(size * 0.6, size * 0.9)}
                    colors={grad}
                  />
                </Path>
                {/* Thin crisp outline for that diamond-cut facet feel */}
                <Path
                  path={c.path}
                  style="stroke"
                  strokeWidth={innerStroke}
                  color={grad[1]}
                  opacity={0.85}
                />
              </Group>
            );
          })}
        </Group>

        {/* ── Specular sweep (streak + premium) ── */}
        {tier !== 'base' ? (
          <Path
            path={sweepPath}
            color={palette.specular}
            opacity={sweepOpacity}
          >
            <BlurMask blur={Math.max(1, size * 0.04)} style="solid" />
          </Path>
        ) : null}

        {/* ── Piggy outline (stroked, with gradient for sheen) ── */}
        <Path path={outlinePath} style="stroke" strokeWidth={stroke}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(size, size)}
            colors={palette.outline}
          />
        </Path>

        {/* ── Coin slot detail (filled then masked) ── */}
        <Path path={slotPath}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(size, 0)}
            colors={palette.outline}
          />
        </Path>

        {/* ── Static glint dot (base tier only — calm, no animation) ── */}
        {tier === 'base' ? (
          <Path
            path={(() => {
              const p = Skia.Path.Make();
              p.addCircle(size * 0.39, size * 0.50, size * 0.013);
              return p;
            })()}
            color="rgba(255,255,255,0.85)"
          />
        ) : null}
      </Canvas>
    </View>
  );
};

export default CrystalPiggyVault;

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrap: {
    alignItems:     'center',
    justifyContent: 'center',
  },
});
