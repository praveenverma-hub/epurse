// =============================================================================
// StreakFlameEmitter.tsx — Gamified streak badge with Skia flame + particles
//
//  Tier 1 ( 1–3 days )  : compact orange flicker, no particles
//  Tier 2 ( 4–13 days ) : 1.4× scale, blue/purple core, ember stream
//  Tier 3 ( 14+ days )  : neon-cyan plasma, pulsating, rotating aura,
//                         rapid spark stream, brighter "star" particles
//
// Particles are pooled: a fixed-size array of SharedValue bundles created once
// via makeMutable() and recycled in place. No allocations happen inside the
// frame callback. The flame path is rebuilt per frame on the UI thread for
// flicker; React/JS is never woken.
//
// Tap → 15-spark 360° burst + medium haptic thud.
// =============================================================================

import React, { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, Text, Vibration, View } from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  Skia,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  Easing,
  makeMutable,
  runOnJS,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

// ─── Tier config ─────────────────────────────────────────────────────────────

type Tier = 1 | 2 | 3;

function tierFromStreak(streak: number): Tier {
  if (streak >= 14) return 3;
  if (streak >= 4)  return 2;
  return 1;
}

interface TierConfig {
  flameScale:        number;  // multiplier on base flame height
  flameOuter1:       string;  // top of outer gradient
  flameOuter2:       string;  // bottom of outer gradient
  flameCore1:        string;  // top of inner core gradient
  flameCore2:        string;  // bottom of inner core gradient
  glow:              string;  // halo color
  glowOpacity:       number;
  particleEmitRate:  number;  // particles per second
  particleColor:     string;
  particleRadiusMin: number;
  particleRadiusMax: number;
  flickerSpeed:      number;  // flicker rate (Hz)
  hasInnerCore:      boolean;
  hasPulse:          boolean;
  hasRotatingAura:   boolean;
}

const TIERS: Record<Tier, TierConfig> = {
  1: {
    flameScale:        1.0,
    flameOuter1:       '#FFB547',
    flameOuter2:       '#FF6B1A',
    flameCore1:        '#FFE7A0',
    flameCore2:        '#FF9D2E',
    glow:              '#FF7A1A',
    glowOpacity:       0.35,
    particleEmitRate:  0,
    particleColor:     '#FBBF24',
    particleRadiusMin: 1.0,
    particleRadiusMax: 2.0,
    flickerSpeed:      7,
    hasInnerCore:      false,
    hasPulse:          false,
    hasRotatingAura:   false,
  },
  2: {
    flameScale:        1.4,
    flameOuter1:       '#A78BFA',
    flameOuter2:       '#4338CA',
    flameCore1:        '#E0F2FE',
    flameCore2:        '#3B82F6',
    glow:              '#6366F1',
    glowOpacity:       0.5,
    particleEmitRate:  14,
    particleColor:     '#FBBF24',
    particleRadiusMin: 1.5,
    particleRadiusMax: 2.6,
    flickerSpeed:      11,
    hasInnerCore:      true,
    hasPulse:          false,
    hasRotatingAura:   false,
  },
  3: {
    flameScale:        1.55,
    flameOuter1:       '#67E8F9',
    flameOuter2:       '#0E7490',
    flameCore1:        '#FFFFFF',
    flameCore2:        '#22D3EE',
    glow:              '#22D3EE',
    glowOpacity:       0.85,
    particleEmitRate:  26,
    particleColor:     '#A5F3FC',
    particleRadiusMin: 1.8,
    particleRadiusMax: 3.0,
    flickerSpeed:      16,
    hasInnerCore:      true,
    hasPulse:          true,
    hasRotatingAura:   true,
  },
};

// ─── Geometry ────────────────────────────────────────────────────────────────

const W = 150;
const H = 190;
const FLAME_BASE_X = W / 2;
const FLAME_BASE_Y = 150;       // bottom of the flame
const FLAME_TIP_Y_BASE = 70;    // tip of the flame at scale 1.0
const FLAME_HALF_WIDTH_BASE = 18;

const POOL_SIZE  = 36;
const BURST_SIZE = 15;

// ─── Particle pool ───────────────────────────────────────────────────────────

interface Particle {
  baseX:      SharedValue<number>;
  x:          SharedValue<number>;
  y:          SharedValue<number>;
  vx:         SharedValue<number>;   // burst-mode horizontal velocity
  vy:         SharedValue<number>;   // px/sec upward (or radial)
  driftAmp:   SharedValue<number>;
  driftFreq:  SharedValue<number>;
  driftPhase: SharedValue<number>;
  life:       SharedValue<number>;   // 0..1; ≥1 means dead/free
  lifespan:   SharedValue<number>;   // seconds
  radius:     SharedValue<number>;
  baseRadius: SharedValue<number>;
  opacity:    SharedValue<number>;
  burst:      SharedValue<number>;   // 0 = ember (sine drift), 1 = burst (radial)
}

function createParticle(): Particle {
  return {
    baseX:      makeMutable(0),
    x:          makeMutable(0),
    y:          makeMutable(0),
    vx:         makeMutable(0),
    vy:         makeMutable(0),
    driftAmp:   makeMutable(0),
    driftFreq:  makeMutable(0),
    driftPhase: makeMutable(0),
    life:       makeMutable(1),
    lifespan:   makeMutable(1),
    radius:     makeMutable(0),
    baseRadius: makeMutable(0),
    opacity:    makeMutable(0),
    burst:      makeMutable(0),
  };
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  /** Current consecutive-day streak. */
  streak: number;
  /** Fired after a tap (after the burst + haptic trigger). */
  onTap?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

const StreakFlameEmitter: React.FC<Props> = ({ streak, onTap }) => {
  const tier  = tierFromStreak(streak);
  const cfg   = TIERS[tier];

  // ── Particle pool (created once, mutated forever) ──────────────────────────
  const particles = useRef<Particle[]>(
    Array.from({ length: POOL_SIZE }, createParticle),
  ).current;

  // ── Per-tier dynamic config exposed to worklets via shared values ──────────
  const emitRate = useSharedValue(cfg.particleEmitRate);
  const rMin     = useSharedValue(cfg.particleRadiusMin);
  const rMax     = useSharedValue(cfg.particleRadiusMax);
  React.useEffect(() => {
    emitRate.value = withTiming(cfg.particleEmitRate, { duration: 400 });
    rMin.value     = withTiming(cfg.particleRadiusMin, { duration: 400 });
    rMax.value     = withTiming(cfg.particleRadiusMax, { duration: 400 });
  }, [cfg.particleEmitRate, cfg.particleRadiusMin, cfg.particleRadiusMax]);

  // ── Flame animation state ──────────────────────────────────────────────────
  const flicker   = useSharedValue(0); // phase, advances every frame
  const flameScale = useSharedValue(cfg.flameScale);
  const pulse      = useSharedValue(1);
  const auraRotate = useSharedValue(0);
  const haloOpacity = useSharedValue(cfg.glowOpacity);

  React.useEffect(() => {
    flameScale.value = withTiming(cfg.flameScale, { duration: 500, easing: Easing.inOut(Easing.cubic) });
    haloOpacity.value = withTiming(cfg.glowOpacity, { duration: 500 });
  }, [cfg.flameScale, cfg.glowOpacity]);

  React.useEffect(() => {
    if (cfg.hasPulse) {
      pulse.value = withRepeat(
        withTiming(1.08, { duration: 800, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
    } else {
      pulse.value = withTiming(1, { duration: 300 });
    }
  }, [cfg.hasPulse]);

  React.useEffect(() => {
    if (cfg.hasRotatingAura) {
      auraRotate.value = withRepeat(
        withTiming(Math.PI * 2, { duration: 8000, easing: Easing.linear }),
        -1,
        false,
      );
    }
  }, [cfg.hasRotatingAura]);

  // ── Burst trigger (incremented by tap; worklet diffs against lastBurst) ────
  const burstTrigger = useSharedValue(0);
  const lastBurst    = useSharedValue(0);

  // Spawn cadence counter (UI-thread only)
  const spawnTimer = useSharedValue(0);

  // ── Single frame callback drives the entire particle pool ──────────────────
  useFrameCallback((info) => {
    'worklet';
    const dtRaw = info.timeSincePreviousFrame ?? 16;
    const dt    = Math.min(dtRaw, 32) / 1000; // clamp big stutters
    flicker.value += dt;

    // ── Burst spawn (radial) ───────────────────────────────────────────
    if (burstTrigger.value !== lastBurst.value) {
      lastBurst.value = burstTrigger.value;
      let spawned = 0;
      for (let i = 0; i < POOL_SIZE && spawned < BURST_SIZE; i++) {
        const p = particles[i];
        if (p.life.value < 1) continue;
        const angle = (spawned / BURST_SIZE) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 110 + Math.random() * 70;
        const r     = 2 + Math.random() * 2.2;
        p.baseX.value      = FLAME_BASE_X;
        p.x.value          = FLAME_BASE_X;
        p.y.value          = FLAME_TIP_Y_BASE + 8;
        p.vx.value         = Math.cos(angle) * speed;
        p.vy.value         = Math.sin(angle) * speed;
        p.life.value       = 0;
        p.lifespan.value   = 0.75 + Math.random() * 0.25;
        p.radius.value     = r;
        p.baseRadius.value = r;
        p.opacity.value    = 1;
        p.burst.value      = 1;
        p.driftAmp.value   = 0;
        spawned++;
      }
    }

    // ── Steady-state emission (embers / sparks) ────────────────────────
    if (emitRate.value > 0) {
      spawnTimer.value -= dt;
      // Use a `while` so that catching up after a stall still spawns
      let spawnGuard = 4; // never spawn more than 4 per frame to avoid bursts
      while (spawnTimer.value <= 0 && spawnGuard > 0) {
        spawnTimer.value += 1 / emitRate.value;
        spawnGuard -= 1;
        for (let i = 0; i < POOL_SIZE; i++) {
          const p = particles[i];
          if (p.life.value < 1) continue;
          const offsetX = (Math.random() - 0.5) * 22;
          const r       = rMin.value + Math.random() * (rMax.value - rMin.value);
          p.baseX.value      = FLAME_BASE_X + offsetX;
          p.x.value          = p.baseX.value;
          p.y.value          = FLAME_TIP_Y_BASE + (Math.random() - 0.5) * 10;
          p.vx.value         = 0;
          p.vy.value         = 50 + Math.random() * 35;
          p.driftAmp.value   = 5 + Math.random() * 9;
          p.driftFreq.value  = 2.4 + Math.random() * 1.8;
          p.driftPhase.value = Math.random() * Math.PI * 2;
          p.life.value       = 0;
          p.lifespan.value   = 1.3 + Math.random() * 0.7;
          p.radius.value     = r;
          p.baseRadius.value = r;
          p.opacity.value    = 1;
          p.burst.value      = 0;
          break;
        }
      }
      // Cap spawnTimer when emitRate is high so it doesn't accumulate negatively
      if (spawnTimer.value < -0.25) spawnTimer.value = 0;
    } else {
      spawnTimer.value = 0;
    }

    // ── Update every particle in the pool ──────────────────────────────
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = particles[i];
      if (p.life.value >= 1) continue;

      const dLife = dt / p.lifespan.value;
      p.life.value += dLife;
      if (p.life.value >= 1) {
        // Mark dead — values will be re-used on next spawn
        p.opacity.value = 0;
        p.radius.value  = 0;
        continue;
      }

      if (p.burst.value > 0) {
        // Radial spread with mild upward bias and decel
        const drag = Math.exp(-1.2 * dt);
        p.vx.value *= drag;
        p.vy.value *= drag;
        p.x.value += p.vx.value * dt;
        p.y.value += p.vy.value * dt;
      } else {
        // Sine-drift upward ember
        const tSinceSpawn = p.life.value * p.lifespan.value;
        const drift =
          p.driftAmp.value *
          Math.sin(p.driftFreq.value * tSinceSpawn + p.driftPhase.value);
        p.x.value = p.baseX.value + drift;
        p.y.value -= p.vy.value * dt;
      }

      // Decay
      const lifeT = p.life.value;
      p.radius.value  = p.baseRadius.value * (1 - lifeT * lifeT * 0.9);
      p.opacity.value = Math.max(0, 1 - lifeT * 1.15);
    }
  });

  // ── Flame path (rebuilt on UI thread for flicker) ──────────────────────────
  const outerFlamePath = useDerivedValue<SkPath>(() => {
    const scale = flameScale.value * pulse.value;
    const tipY  = FLAME_TIP_Y_BASE - (1 - 1 / scale) * 70; // rises as scale grows
    const halfW = FLAME_HALF_WIDTH_BASE * scale;
    // Flicker: tiny vertical breath synced to `flicker.value`
    const f     = Math.sin(flicker.value * cfg.flickerSpeed);
    const tipJ  = tipY - 4 * f;
    const wJ    = halfW + 1.4 * f;

    const p = Skia.Path.Make();
    p.moveTo(FLAME_BASE_X, FLAME_BASE_Y);
    p.cubicTo(
      FLAME_BASE_X - wJ * 1.4, FLAME_BASE_Y - 24,
      FLAME_BASE_X - wJ * 1.7, FLAME_BASE_Y - 56,
      FLAME_BASE_X - wJ * 0.5, FLAME_BASE_Y - 78,
    );
    p.cubicTo(
      FLAME_BASE_X - wJ * 0.9, FLAME_BASE_Y - 96,
      FLAME_BASE_X - wJ * 0.3, FLAME_BASE_Y - 108,
      FLAME_BASE_X,            tipJ,
    );
    p.cubicTo(
      FLAME_BASE_X + wJ * 0.3, FLAME_BASE_Y - 108,
      FLAME_BASE_X + wJ * 0.9, FLAME_BASE_Y - 96,
      FLAME_BASE_X + wJ * 0.5, FLAME_BASE_Y - 78,
    );
    p.cubicTo(
      FLAME_BASE_X + wJ * 1.7, FLAME_BASE_Y - 56,
      FLAME_BASE_X + wJ * 1.4, FLAME_BASE_Y - 24,
      FLAME_BASE_X,            FLAME_BASE_Y,
    );
    p.close();
    return p;
  });

  const innerFlamePath = useDerivedValue<SkPath>(() => {
    const scale = flameScale.value * pulse.value * 0.62;
    const halfW = FLAME_HALF_WIDTH_BASE * scale;
    const f     = Math.sin(flicker.value * (cfg.flickerSpeed + 4));
    const tipJ  = FLAME_TIP_Y_BASE + 16 - 3 * f;
    const wJ    = halfW + 1.0 * f;

    const p = Skia.Path.Make();
    p.moveTo(FLAME_BASE_X, FLAME_BASE_Y - 14);
    p.cubicTo(
      FLAME_BASE_X - wJ * 1.4, FLAME_BASE_Y - 28,
      FLAME_BASE_X - wJ * 1.5, FLAME_BASE_Y - 56,
      FLAME_BASE_X,            tipJ,
    );
    p.cubicTo(
      FLAME_BASE_X + wJ * 1.5, FLAME_BASE_Y - 56,
      FLAME_BASE_X + wJ * 1.4, FLAME_BASE_Y - 28,
      FLAME_BASE_X,            FLAME_BASE_Y - 14,
    );
    p.close();
    return p;
  });

  // ── Halo glow (static circle whose opacity pulses on tier 3) ───────────────
  const haloOpacityDerived = useDerivedValue(() => haloOpacity.value);

  // ── Rotating aura (tier 3 only) ────────────────────────────────────────────
  const auraTransform = useDerivedValue(() => [{ rotate: auraRotate.value }]);

  // ── Tap → burst + haptic ───────────────────────────────────────────────────
  const fireBurst = useCallback(() => {
    Vibration.vibrate(20); // medium-short thud (RN built-in; expo-haptics not installed)
    onTap?.();
  }, [onTap]);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .onEnd((_e, success) => {
          if (!success) return;
          burstTrigger.value = burstTrigger.value + 1;
          runOnJS(fireBurst)();
        }),
    [fireBurst],
  );

  // ── Tier label ─────────────────────────────────────────────────────────────
  const tierLabel = tier === 3 ? 'SUPER STREAK' : tier === 2 ? 'ON FIRE' : 'STREAK';
  const tierColor = tier === 3 ? '#22D3EE' : tier === 2 ? '#A78BFA' : '#FB923C';

  return (
    <GestureDetector gesture={tapGesture}>
      <View style={[styles.container, { borderColor: tierColor + '55' }]}>
        <Canvas style={{ width: W, height: H }}>
          {/* Rotating aura (tier 3) — six shards arranged around the flame */}
          {cfg.hasRotatingAura ? (
            <Group origin={vec(FLAME_BASE_X, FLAME_BASE_Y - 36)} transform={auraTransform}>
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const angle = (i / 6) * Math.PI * 2;
                const rx = FLAME_BASE_X + Math.cos(angle) * 42;
                const ry = FLAME_BASE_Y - 36 + Math.sin(angle) * 42;
                return (
                  <Circle
                    key={i}
                    cx={rx}
                    cy={ry}
                    r={4 + (i % 2) * 2}
                    color={cfg.glow}
                    opacity={0.35}
                  />
                );
              })}
            </Group>
          ) : null}

          {/* Halo behind flame */}
          <Circle
            cx={FLAME_BASE_X}
            cy={FLAME_BASE_Y - 38}
            r={46}
            color={cfg.glow}
            opacity={haloOpacityDerived}
          />

          {/* Outer flame */}
          <Path path={outerFlamePath}>
            <LinearGradient
              start={vec(FLAME_BASE_X, FLAME_TIP_Y_BASE - 8)}
              end={vec(FLAME_BASE_X, FLAME_BASE_Y)}
              colors={[cfg.flameOuter1, cfg.flameOuter2]}
            />
          </Path>

          {/* Inner core */}
          {cfg.hasInnerCore ? (
            <Path path={innerFlamePath}>
              <LinearGradient
                start={vec(FLAME_BASE_X, FLAME_TIP_Y_BASE + 18)}
                end={vec(FLAME_BASE_X, FLAME_BASE_Y - 14)}
                colors={[cfg.flameCore1, cfg.flameCore2]}
              />
            </Path>
          ) : null}

          {/* Particles */}
          <Group>
            {particles.map((p, i) => (
              <Circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={p.radius}
                opacity={p.opacity}
                color={cfg.particleColor}
              />
            ))}
          </Group>
        </Canvas>

        {/* RN overlay — streak number + tier badge */}
        <View pointerEvents="none" style={styles.overlay}>
          <Text style={[styles.tierLabel, { color: tierColor }]}>{tierLabel}</Text>
          <View style={styles.numberRow}>
            <Text style={styles.streakNumber}>{streak}</Text>
            <Text style={styles.streakUnit}>day{streak === 1 ? '' : 's'}</Text>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
};

export default StreakFlameEmitter;

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: W,
    height: H,
    borderRadius: 22,
    backgroundColor: '#0B1220',
    borderWidth: 1.5,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  overlay: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  tierLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  streakNumber: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  streakUnit: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
