// =============================================================================
// DailyBudgetLiquidWave.tsx — Skia liquid-capsule budget visualisation
//
// Renders a vertical capsule clipped via a Skia path. Inside, a continuous
// sine-wave path is rebuilt every frame on the UI thread via useFrameCallback,
// so the React JS thread is never woken up while the wave undulates.
//
// Three states drive colour, frequency, amplitude, and glow:
//   safe     ( pct ≥ 30 )  — calm teal, slow wave
//   warning  ( 0 ≤ pct < 30 ) — amber, faster slosh, lower fill
//   bleeding ( pct < 0 )   — neon red, fastest wave, critical floor, pulsing aura
// =============================================================================

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  BlurMask,
  Canvas,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

// ─── Types ───────────────────────────────────────────────────────────────────

type LiquidState = 'safe' | 'warning' | 'bleeding';

interface Props {
  /**
   * 0..100+ — remaining budget percentage.
   *  • ≥ 30  → safe (calm teal)
   *  • 0..30 → warning (sloshing amber)
   *  • < 0   → bleeding (neon red, pulsing)
   */
  remainingPct: number;
  /** Caption shown above the capsule (e.g. "Daily Budget"). */
  label?: string;
  /** Sub-caption shown below the capsule (e.g. "₹450 of ₹1,200"). */
  caption?: string;
  /** Override default width (default 160). */
  width?: number;
  /** Override default height (default 240). */
  height?: number;
}

// ─── State config ────────────────────────────────────────────────────────────

interface StateConfig {
  fillTop:   string; // gradient top
  fillBot:   string; // gradient bottom
  fillBack:  string; // background wave layer
  glow:      string;
  freq:      number; // rad/s — sine phase advance rate
  amp:       number; // px — wave amplitude
  glowMax:   number; // peak glow opacity
}

const CFG: Record<LiquidState, StateConfig> = {
  safe: {
    fillTop:  '#67E8F9',
    fillBot:  '#0E7490',
    fillBack: '#0891B2',
    glow:     '#06B6D4',
    freq:     1.4,
    amp:      5,
    glowMax:  0.25,
  },
  warning: {
    fillTop:  '#FCD34D',
    fillBot:  '#D97706',
    fillBack: '#F59E0B',
    glow:     '#F59E0B',
    freq:     3.4,
    amp:      9,
    glowMax:  0.5,
  },
  bleeding: {
    fillTop:  '#FB7185',
    fillBot:  '#991B1B',
    fillBack: '#DC2626',
    glow:     '#EF4444',
    freq:     6.4,
    amp:      14,
    glowMax:  0.95,
  },
};

const SAFE_THRESHOLD = 30;

// ─── Component ───────────────────────────────────────────────────────────────

const DEFAULT_W = 160;
const DEFAULT_H = 240;
const SEGMENTS  = 32;            // sine-wave resolution per frame
const CEIL_FRAC = 0.10;          // 100% pct → wave at this fraction down
const FLOOR_FRAC = 0.92;         // 0% pct → wave at this fraction down

export const DailyBudgetLiquidWave: React.FC<Props> = ({
  remainingPct,
  label,
  caption,
  width = DEFAULT_W,
  height = DEFAULT_H,
}) => {
  // ── Derive state from pct ──────────────────────────────────────────────────
  const pct = Number.isFinite(remainingPct) ? remainingPct : 100;
  const state: LiquidState =
    pct < 0 ? 'bleeding' :
    pct < SAFE_THRESHOLD ? 'warning' : 'safe';
  const cfg = CFG[state];

  // ── Compute target liquid level Y ─────────────────────────────────────────
  const targetLevelY = useMemo(() => {
    if (state === 'bleeding') return height * (FLOOR_FRAC + 0.03); // critical floor
    const clamped = Math.max(0, Math.min(100, pct));
    return height * (CEIL_FRAC + (FLOOR_FRAC - CEIL_FRAC) * (1 - clamped / 100));
  }, [pct, state, height]);

  // ── Animated values ────────────────────────────────────────────────────────
  const level = useSharedValue(targetLevelY);
  const amp   = useSharedValue(cfg.amp);
  const freq  = useSharedValue(cfg.freq);
  const phase = useSharedValue(0);
  const glow  = useSharedValue(cfg.glowMax);

  // Transition level / amp / freq when state or pct changes
  useEffect(() => {
    level.value = withTiming(targetLevelY, { duration: 700, easing: Easing.inOut(Easing.cubic) });
    amp.value   = withTiming(cfg.amp,      { duration: 500, easing: Easing.inOut(Easing.cubic) });
    freq.value  = withTiming(cfg.freq,     { duration: 500, easing: Easing.inOut(Easing.cubic) });
  }, [targetLevelY, cfg.amp, cfg.freq]);

  // Pulse glow in bleeding state; steady otherwise
  useEffect(() => {
    if (state === 'bleeding') {
      glow.value = withRepeat(
        withSequence(
          withTiming(cfg.glowMax, { duration: 380, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.30,        { duration: 380, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    } else {
      glow.value = withTiming(cfg.glowMax, { duration: 450, easing: Easing.inOut(Easing.quad) });
    }
  }, [state, cfg.glowMax]);

  // ── 60/120fps phase advance — UI thread only ──────────────────────────────
  useFrameCallback((info) => {
    'worklet';
    const dt = (info.timeSincePreviousFrame ?? 16) / 1000;
    phase.value = phase.value + freq.value * dt;
  });

  // ── Wave paths (derived every frame on UI thread) ─────────────────────────
  const wavelenFront = width * 0.85;
  const wavelenBack  = width * 1.20;

  const wavePathFront = useDerivedValue(() => {
    const p   = Skia.Path.Make();
    const k   = (2 * Math.PI) / wavelenFront;
    const a   = amp.value;
    const lv  = level.value;
    const ph  = phase.value;
    p.moveTo(0, lv + a * Math.sin(ph));
    for (let i = 1; i <= SEGMENTS; i++) {
      const x = (width * i) / SEGMENTS;
      p.lineTo(x, lv + a * Math.sin(k * x + ph));
    }
    p.lineTo(width, height);
    p.lineTo(0, height);
    p.close();
    return p;
  });

  const wavePathBack = useDerivedValue(() => {
    const p   = Skia.Path.Make();
    const k   = (2 * Math.PI) / wavelenBack;
    const a   = amp.value * 0.7;
    const lv  = level.value + 5;           // slightly below front wave
    const ph  = phase.value + Math.PI / 1.4;
    p.moveTo(0, lv + a * Math.sin(ph));
    for (let i = 1; i <= SEGMENTS; i++) {
      const x = (width * i) / SEGMENTS;
      p.lineTo(x, lv + a * Math.sin(k * x + ph));
    }
    p.lineTo(width, height);
    p.lineTo(0, height);
    p.close();
    return p;
  });

  // Thin highlight ribbon along the very top of the liquid — sells the "surface"
  const surfacePath = useDerivedValue(() => {
    const p   = Skia.Path.Make();
    const k   = (2 * Math.PI) / wavelenFront;
    const a   = amp.value;
    const lv  = level.value;
    const ph  = phase.value;
    p.moveTo(0, lv + a * Math.sin(ph));
    for (let i = 1; i <= SEGMENTS; i++) {
      const x = (width * i) / SEGMENTS;
      p.lineTo(x, lv + a * Math.sin(k * x + ph));
    }
    return p;
  });

  // ── Static paths ──────────────────────────────────────────────────────────
  const capsulePath = useMemo(() => {
    const p     = Skia.Path.Make();
    const rrect = Skia.RRectXY(Skia.XYWHRect(0, 0, width, height), width / 2, width / 2);
    p.addRRect(rrect);
    return p;
  }, [width, height]);

  // ── Render ────────────────────────────────────────────────────────────────
  const displayPct = Math.max(0, Math.round(pct));
  const overshoot  = pct < 0 ? Math.round(-pct) : 0;
  const canvasH    = height + 56; // room for outer glow blur

  return (
    <View style={styles.container}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      <View style={[styles.canvasWrap, { width, height }]}>
        <Canvas style={{ width: width + 60, height: canvasH, marginLeft: -30, marginTop: -28 }}>
          <Group transform={[{ translateX: 30 }, { translateY: 28 }]}>
            {/* Outer glow aura — drawn beneath the capsule */}
            <Path path={capsulePath} color={cfg.glow} opacity={glow}>
              <BlurMask blur={26} style="outer" />
            </Path>

            {/* Capsule body — clip everything inside to the capsule shape */}
            <Group clip={capsulePath}>
              {/* Dark base behind liquid */}
              <Path path={capsulePath} color="#0F172A" />

              {/* Back wave (lighter tint, lower amplitude) */}
              <Path path={wavePathBack} color={cfg.fillBack} opacity={0.55} />

              {/* Front wave with vertical gradient */}
              <Path path={wavePathFront}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, height)}
                  colors={[cfg.fillTop, cfg.fillBot]}
                />
              </Path>

              {/* Surface highlight ribbon */}
              <Path
                path={surfacePath}
                style="stroke"
                strokeWidth={1.5}
                color="#FFFFFF"
                opacity={0.45}
              />
            </Group>

            {/* Capsule outline */}
            <Path
              path={capsulePath}
              style="stroke"
              strokeWidth={2}
              color={cfg.fillBot}
              opacity={0.55}
            />
          </Group>
        </Canvas>

        {/* Percentage overlay (RN text — avoids Skia font loading) */}
        <View style={styles.textOverlay} pointerEvents="none">
          <Text style={[styles.pctText, { color: state === 'safe' ? '#FFFFFF' : cfg.fillTop }]}>
            {state === 'bleeding' ? `−${overshoot}%` : `${displayPct}%`}
          </Text>
          <Text style={styles.pctSub}>
            {state === 'bleeding' ? 'over budget' : 'left today'}
          </Text>
        </View>
      </View>

      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
};

export default DailyBudgetLiquidWave;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: 10,
  },
  caption: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 12,
    fontWeight: '500',
  },
  canvasWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  textOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pctText: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  pctSub: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    opacity: 0.85,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginTop: 2,
  },
});
