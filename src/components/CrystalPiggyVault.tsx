// =============================================================================
// CrystalPiggyVault.tsx
// -----------------------------------------------------------------------------
// Two-layer rendering:
//   Layer 1 (PiggySvg)   — real piggy silhouette styled as frosted glass
//   Layer 2 (Skia Canvas) — animated crystal cluster + halo + specular sweep,
//                            clipped to the piggy belly so nothing bleeds outside
//
// The SVG viewBox is "-5 -10 110 135" rendered xMidYMid meet into a size×size
// square. Crystal positions and the belly clip oval are pre-mapped to that layout.
// An optional `day` prop renders a tier-coloured "Xd Aware" pill below the piggy.
// =============================================================================

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import PiggySvg from './PiggySvg';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CrystalPiggyVaultProps {
  tier:      VaultTier;
  size?:     number;
  animated?: boolean;
  /** When provided, shows a "Xd Aware" label pill below the piggy. */
  day?:      number;
}

// ─── Palette ─────────────────────────────────────────────────────────────────

interface Palette {
  outline:   [string, string];
  crystal:   [string, string];
  accent?:   [string, string];
  halo:      string;
  specular:  string;
  tint:      string;
  labelText: string;
  labelBg:   string;
}

const PALETTES: Record<VaultTier, Palette> = {
  base: {
    outline:   ['#D1D5DB', '#C7CBD2'],
    crystal:   ['#5EEAD4', '#2DD4BF'],
    halo:      '',
    specular:  'rgba(255,255,255,0.42)',
    tint:      '#5EEAD4',
    labelText: '#d8fcf9',
    labelBg:   'rgb(234, 250, 247)',
  },
  streak: {
    outline:   ['#BAE6FD', '#0EA5E9'],
    crystal:   ['#A5F3FC', '#06B6D4'],
    halo:      'rgba(125, 211, 252, 0.32)',
    specular:  'rgba(255,255,255,0.62)',
    tint:      '#0EA5E9',
    labelText: '#c6ebff',
    labelBg:   'rgba(231, 236, 238)',
  },
  premium: {
    outline:   ['#FCD34D', '#D4AF37'],
    crystal:   ['#6EE7B7', '#10B981'],
    accent:    ['#FDE68A', '#F59E0B'],
    halo:      'rgba(252, 211, 77, 0.30)',
    specular:  'rgba(255, 248, 220, 0.85)',
    tint:      '#FCD34D',
    labelText: '#fee2d0',
    labelBg:   'rgb(248, 225, 149)',
  },
};

// ─── Crystal layouts ─────────────────────────────────────────────────────────
// Positions normalised to [0..1] of the size×size canvas, mapped to the belly
// of the SVG piggy.
//
// SVG viewBox "-5 -10 110 135" → xMidYMid meet in size×size:
//   scale  = size / 135
//   xOff   = (size − 110·scale) / 2  →  0.0926·size
//   norm_x = 0.0926 + (svgX + 5) / 135
//   norm_y = (svgY + 10) / 135

interface CrystalSpec { cx: number; cy: number; r: number; accent?: boolean }

const CRYSTAL_LAYOUTS: Record<VaultTier, CrystalSpec[]> = {
  base: [
    { cx: 0.50, cy: 0.46, r: 0.09 },
  ],
  streak: [
    { cx: 0.38, cy: 0.50, r: 0.070 },
    { cx: 0.53, cy: 0.52, r: 0.080 },
    { cx: 0.46, cy: 0.40, r: 0.068 },
  ],
  premium: [
    { cx: 0.48, cy: 0.46, r: 0.090, accent: false },
    { cx: 0.35, cy: 0.49, r: 0.065, accent: true  },
    { cx: 0.61, cy: 0.49, r: 0.065, accent: true  },
    { cx: 0.41, cy: 0.37, r: 0.055, accent: false },
    { cx: 0.55, cy: 0.37, r: 0.055, accent: true  },
    { cx: 0.48, cy: 0.57, r: 0.050, accent: false },
  ],
};

// ─── Skia path helpers ───────────────────────────────────────────────────────

const buildDiamond = (cx: number, cy: number, r: number, size: number): SkPath => {
  const p = Skia.Path.Make();
  const x = (v: number) => v * size;
  const y = (v: number) => v * size;
  p.moveTo(x(cx),            y(cy - r));
  p.lineTo(x(cx + r * 0.85), y(cy));
  p.lineTo(x(cx),            y(cy + r));
  p.lineTo(x(cx - r * 0.85), y(cy));
  p.close();
  return p;
};

// ─── Component ───────────────────────────────────────────────────────────────

const CrystalPiggyVault: React.FC<CrystalPiggyVaultProps> = ({
  tier,
  size     = 40,
  animated = true,
  day,
}) => {
  const palette = PALETTES[tier];

  const crystalPaths = useMemo(
    () =>
      CRYSTAL_LAYOUTS[tier].map((c) => ({
        path:   buildDiamond(c.cx, c.cy, c.r, size),
        accent: !!c.accent,
      })),
    [tier, size],
  );

  const innerStroke = Math.max(0.5, size * 0.018);
  const haloBlur    = Math.max(2,   size * 0.16);

  // ── Belly clip oval — keeps all crystal/sweep pixels inside the piggy body ─
  // Derived from SVG body bounds: x≈3–87, y≈19–88 in SVG user space,
  // mapped to canvas and inset slightly to hide any edge artefacts.
  const bellyClip = useMemo(() => {
    const p = Skia.Path.Make();
    p.addOval(Skia.XYWHRect(
      size * 0.17,  // left  — inset from body left edge
      size * 0.23,  // top   — inset from body top (below ear/slot)
      size * 0.57,  // width — covers snout side to left flank
      size * 0.48,  // height— top of body to belly bottom (above legs)
    ));
    return p;
  }, [size]);

  // ── Halo path (shown OUTSIDE the clip, behind SVG outline) ──────────────
  const haloPath = useMemo(() => {
    const p = Skia.Path.Make();
    p.addOval(Skia.XYWHRect(size * 0.10, size * 0.18, size * 0.72, size * 0.62));
    return p;
  }, [size]);

  // ── Animation ────────────────────────────────────────────────────────────
  const t = useSharedValue<number>(0);
  useFrameCallback((info) => {
    if (!animated) return;
    t.value += (info.timeSincePreviousFrame ?? 16) / 1000;
  }, true);

  const breath = useDerivedValue(() => {
    const amp  = tier === 'premium' ? 0.18 : tier === 'streak' ? 0.12 : 0.08;
    const base = tier === 'premium' ? 0.92 : 0.88;
    return base + Math.sin(t.value * 1.8) * amp;
  }, [tier]);

  const sweepY = useDerivedValue(() => {
    if (tier === 'base') return 0;
    const phase = (t.value % 4.0) / 4.0;
    return 0.28 + phase * 0.30;
  }, [tier]);

  const sweepOpacity = useDerivedValue(() => {
    if (tier === 'base') return 0;
    const phase = (t.value % 4.0) / 4.0;
    return Math.max(0, Math.sin(phase * Math.PI)) * (tier === 'premium' ? 0.95 : 0.7);
  }, [tier]);

  const sweepPath = useDerivedValue(() => {
    const p  = Skia.Path.Make();
    const cy = sweepY.value;
    const cx = 0.47; const w = 0.16; const h = 0.018;
    const X = (v: number) => v * size;
    const Y = (v: number) => v * size;
    p.moveTo(X(cx - w), Y(cy));
    p.lineTo(X(cx),     Y(cy - h));
    p.lineTo(X(cx + w), Y(cy));
    p.lineTo(X(cx),     Y(cy + h));
    p.close();
    return p;
  }, [size]);

  return (
    <View style={styles.wrap}>
      {/* ── Piggy square ───────────────────────────────────────────────── */}
      <View style={{ width: size, height: size }}>

        {/* Layer 1: SVG frosted-glass piggy */}
        <PiggySvg
          size={size}
          outlineColor={palette.outline[0]}
          outlineColor2={palette.outline[1]}
          tintColor={palette.tint}
        />

        {/* Layer 2: Skia animated crystal overlay */}
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">

          {/* Halo bloom — outside belly clip so it glows around the whole outline */}
          {palette.halo ? (
            <Path path={haloPath} color={palette.halo}>
              <BlurMask blur={haloBlur} style="solid" />
            </Path>
          ) : null}

          {/* Everything below is clipped to the belly oval */}
          <Group clip={bellyClip}>

            {/* Crystal cluster with breathing opacity */}
            <Group opacity={breath}>
              {crystalPaths.map((c, i) => {
                const grad = c.accent && palette.accent ? palette.accent : palette.crystal;
                return (
                  <Group key={`crystal-${i}`}>
                    <Path path={c.path}>
                      <LinearGradient
                        start={vec(0, 0)}
                        end={vec(size * 0.55, size * 0.85)}
                        colors={grad}
                      />
                    </Path>
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

            {/* Specular sweep (streak + premium) */}
            {tier !== 'base' ? (
              <Path
                path={sweepPath}
                color={palette.specular}
                opacity={sweepOpacity}
              >
                <BlurMask blur={Math.max(1, size * 0.04)} style="solid" />
              </Path>
            ) : null}

            {/* Static glint dot (base only) */}
            {tier === 'base' ? (
              <Path
                path={(() => {
                  const p = Skia.Path.Make();
                  p.addCircle(size * 0.44, size * 0.42, size * 0.012);
                  return p;
                })()}
                color="rgba(255,255,255,0.85)"
              />
            ) : null}

          </Group>
        </Canvas>
      </View>

      {/* ── "Xd Aware" label pill ───────────────────────────────────────── */}
      {day !== undefined ? (
        <Text style={[styles.labelText, { color: palette.labelText }]}>
          {day}d{'\n'}Aware
        </Text>
      ) : null}
    </View>
  );
};

export default CrystalPiggyVault;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  labelText: {
    fontSize:      8,
    fontWeight:    '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    lineHeight:    11,
  },
});
