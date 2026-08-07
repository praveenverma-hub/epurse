import React, { useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path, G } from 'react-native-svg';
import Animated, {
  Easing,
  SharedValue,
  cancelAnimation,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/**
 * A 240° gauge with a CONTINUOUS colour sweep that fills from 0 → `value` on mount,
 * a knob that rides the fill in the gradient's own colour, and a soft glow beneath.
 *
 * Why it's built from many small arcs
 * -----------------------------------
 * React Native has no CSS `conic-gradient`, and react-native-svg has no angular /
 * sweep gradient either — its `LinearGradient` only runs along a straight axis, so
 * wrapping one around a ring gives banding, not a smooth sweep. The ring is therefore
 * stroked as `SEGMENTS` short arcs whose colour is LERPed between the stops below,
 * which reads as one continuous gradient.
 *
 * Why the fill is per-segment opacity and NOT an SVG <Mask>
 * --------------------------------------------------------
 * The obvious way to reveal a gradient ring is to draw it twice (dim + full) and clip
 * the bright copy with a `<Mask>` holding one arc whose `strokeDashoffset` animates —
 * one animated node for the whole fill. That version is what this replaces: on device
 * the mask does not re-rasterise per frame when a Reanimated prop changes inside it, so
 * the gauge simply appeared at its final value with no sweep. Instead each segment owns
 * a tiny `opacity` animation driven off the SAME shared value, so the reveal really does
 * run on the UI thread. The boundary segment takes a FRACTIONAL opacity, which is what
 * keeps the leading edge smooth instead of stepping segment-by-segment.
 */

// ── Geometry: 0° = 3 o'clock, clockwise. The sweep opens downward (a 120° gap at
//    the bottom), so it reads as a gauge rather than a full ring.
// Taken off the Figma source: its arc endpoints sit at 152.3° and 27.7° about the
// centre, leaving a 124.6° gap centred on 6 o'clock.
const GAUGE_START = 152.3;
const GAUGE_SWEEP = 235.4;

/**
 * Colour stops along the sweep, `t` = 0 (start) → 1 (end).
 *
 * Palette + spacing are lifted from the Figma source's conic gradient. That token is
 * `conic-gradient(from 90deg, …)` over a 235.4° arc, so gradient-degrees map 1:1 onto
 * the sweep and each of its plateaus reduces to a single `t` at the plateau's midpoint:
 *
 *     design 357–395°  #1ABC46 green   → t 0.00
 *     design 339–350°  #15D649 green   → t 0.18
 *     design 318–331°  #FFCC00 yellow  → t 0.27
 *     design 282–307°  #FF9500 orange  → t 0.40
 *     design 155–265°  #FF4747 red     → t 0.76  (the design's long red plateau)
 *
 * Midpoints, NOT the plateau edges — holding each colour flat and snapping between them
 * is exactly the banded look that got rejected; interpolating between the midpoints
 * keeps the design's palette and weighting while reading as one continuous sweep.
 *
 * DIRECTION IS DELIBERATELY REVERSED from the design, which runs red at the start →
 * green at the end (a score meter: more is better). This gauge shows a percentage
 * CONSUMED, so an empty gauge must be the healthy state and a full one the alarming
 * one. Reversing the gradient — rather than feeding the component an inverted value —
 * is what keeps the pointer honest: it always sits at the percentage the caller passed
 * in, so it can't disagree with a number printed next to it. Flip this array to match
 * the design's direction if the gauge is ever reused for a score.
 */
const STOPS: { t: number; color: string }[] = [
  { t: 0.0,  color: '#1ABC46' }, // green
  { t: 0.18, color: '#15D649' }, // brighter green
  { t: 0.27, color: '#FFCC00' }, // yellow
  { t: 0.40, color: '#FF9500' }, // orange
  { t: 0.76, color: '#FF4747' }, // red — flat from here to the end, as in the design
];
/** Pre-split for `interpolateColor`, which wants parallel input/output arrays. */
const STOP_POSITIONS = STOPS.map((s) => s.t);
const STOP_COLORS = STOPS.map((s) => s.color);

/**
 * Arcs used to fake the sweep. Each one is a Reanimated node, so this is the
 * gradient-smoothness ⇄ per-frame-cost dial. 60 over 240° = one every 4°, which reads
 * as continuous (each pair of colour stops still gets ~10 steps) while keeping the
 * node count sane. Each segment costs one animated node plus a handful of static paths
 * (its dim copy and its bloom stack), so this number multiplies by ~5 in total paths.
 */
const SEGMENTS = 60;
/** Opacity of the not-yet-reached remainder — the design's own `opacity="0.2"` track. */
const DIM_OPACITY = 0.2;
/**
 * Ring stroke width as a fraction of the gauge's diameter. The Figma source strokes
 * 9.71px (outer r 180.26, inner r 170.55) on a 360.5px circle — a notably fine ring.
 * Expressed as a ratio so the gauge holds the design's proportions at any size.
 */
const RING_RATIO = 9.71 / 360.5;
/**
 * Centre disc radius as a fraction of the ring's OUTER radius (design: r 145 inside an
 * outer radius of 180.26). The gap this leaves above the ring's inner edge is the
 * `rimColor` band.
 */
const DISC_RATIO = 145 / 180.26;
/**
 * The bloom around the ring, each arc glowing in its OWN gradient colour — so the halo
 * carries the same green→red sweep as the ring rather than sitting on top as one flat
 * tint. Same soft-coloured-light quality as `shadows.fab`, but wrapped all the way
 * around the stroke rather than cast downward.
 *
 * It is ONE static layer over the whole sweep at `GLOW_OPACITY`, independent of the
 * fill — the bloom is fully present the entire way round from the first frame and never
 * animates. Only the ring dims beyond the value (`DIM_OPACITY`); the light does not.
 *
 * react-native-svg 14 has no filter primitives, so there's no `feGaussianBlur` /
 * `feDropShadow` to lean on. The blur is faked with progressively wider copies of the
 * arc — the classic stacked-stroke trick. Widths are ratios of `thickness`, so the
 * bloom scales with the gauge; the thin `RING_RATIO` stroke leaves room to spread it
 * well past the ring without crowding anything.
 *
 * `opacity` here is a RELATIVE weight within the stack, scaled by the group's
 * `GLOW_OPACITY`. The innermost layer is exactly 1, so the brightest pixel of the bloom
 * lands on `GLOW_OPACITY` and no higher. A wide falloff is what separates "light coming
 * off the stroke" from "a fatter stroke" — an early version was a single 1.9× halo at a
 * flat 0.26 and it read as thickness, not glow.
 *
 * Generated rather than hand-listed because the layer COUNT is the smoothness dial: with
 * three, the alpha steps between them are visible as concentric rings. A quadratic
 * falloff over enough layers is what makes it read as a blur instead of as bands.
 */
const GLOW_LAYER_COUNT = 5;
const GLOW_MIN_SCALE = 1.7;
const GLOW_MAX_SCALE = 5.0;
const GLOW_LAYERS = Array.from({ length: GLOW_LAYER_COUNT }, (_, k) => ({
  // k counts OUTWARD from the stroke: k=0 is the tight bright core, k=N-1 the broadest
  // veil. Scale spans the full range, but the falloff divides by COUNT rather than
  // COUNT-1 so the outermost layer keeps a small non-zero alpha — divide by COUNT-1 and
  // it computes to exactly 0, paying for the widest ring's inset to draw nothing.
  scale: GLOW_MIN_SCALE + (k / (GLOW_LAYER_COUNT - 1)) * (GLOW_MAX_SCALE - GLOW_MIN_SCALE),
  opacity: (1 - k / GLOW_LAYER_COUNT) ** 2,
})).reverse(); // widest first — later (narrower) layers paint on top
/**
 * Overall strength of the bloom, and the single dial for how present it is. Always
 * applied — it does not track the fill. The brightest pixel of the glow lands exactly
 * here (the innermost layer's relative weight is 1), so this reads as a real ceiling.
 */
const GLOW_OPACITY = 0.07;
// (`GLOW_INSET` used to live here — the widest bloom's half-width, subtracted from the
//  radius. That made the ring smaller than `size`; the overhang is now added to the SVG
//  canvas instead. See `glowPad` in the component.)
/**
 * Arcs per glow layer. Far coarser than `SEGMENTS`: the bloom is diffuse, so it doesn't
 * need the ring's colour resolution, and it's paid for `GLOW_LAYER_COUNT` times over.
 */
const GLOW_SEGMENTS = 30;
const ENTER_MS = 1500;
/** Knob diameter as a fraction of the gauge's diameter. */
const POINTER_RATIO = 0.085;

const AnimatedG = Animated.createAnimatedComponent(G);

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Colour at position `t` (0..1) along the sweep, linearly interpolated between stops. */
function colorAt(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const first = STOPS[0];
  const last = STOPS[STOPS.length - 1];
  // Outside the stop range there's nothing to interpolate BETWEEN — hold the end colour.
  // Without this the loop below finds no bracketing pair, falls back to lo=first/hi=last
  // and extrapolates: at t=1 against a last stop of 0.76 that's k≈1.32, which overshoots
  // red to rgb(327,34,71). The channel is out of gamut, so the top of the gauge rendered
  // a hotter, pinker red than the palette actually contains.
  if (clamped <= first.t) return first.color;
  if (clamped >= last.t) return last.color;
  let lo = first;
  let hi = last;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (clamped >= STOPS[i].t && clamped <= STOPS[i + 1].t) {
      lo = STOPS[i];
      hi = STOPS[i + 1];
      break;
    }
  }
  const span = hi.t - lo.t;
  const k = span <= 0 ? 0 : (clamped - lo.t) / span;
  const a = hexToRgb(lo.color);
  const b = hexToRgb(hi.color);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `rgb(${mix(a.r, b.r)},${mix(a.g, b.g)},${mix(a.b, b.b)})`;
}

/**
 * The gauge's colour at a 0-100 value — i.e. the colour the knob comes to rest in.
 *
 * Exported so a caller can tint the label it puts inside the gauge with the exact same
 * colour, off the exact same stops. Anything that recomputes "green/amber/red" from its
 * own thresholds will eventually disagree with the ring it's sitting in.
 *
 * Clamps and treats non-finite input as 0, matching the component.
 */
export function gaugeColorAt(value?: number): string {
  const v = Number.isFinite(value) ? Math.min(100, Math.max(0, value as number)) : 0;
  return colorAt(v / 100);
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc `d` from startAngle to endAngle (degrees, clockwise from 3 o'clock). */
function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

/** One arc's ring stroke — identical geometry wherever it's drawn. */
function Arc({ d, color, thickness }: { d: string; color: string; thickness: number }) {
  return <Path d={d} stroke={color} strokeWidth={thickness} strokeLinecap="round" fill="none" />;
}

type Seg = { d: string; color: string };

/**
 * Chop an arc span into `count` colour-interpolated pieces.
 *
 * The 1.35 overlap hides the hairline seams between neighbours. It's only safe because
 * every consumer draws a run of these inside ONE group and applies opacity to the GROUP:
 * the pieces are opaque relative to each other, so an overlap just paints over instead
 * of compounding alpha. Give the individual paths a strokeOpacity and the overlaps turn
 * into a beaded chain of bright spots.
 */
function buildSegments(
  cx: number, cy: number, r: number, start: number, sweep: number, count: number,
): Seg[] {
  const step = sweep / count;
  return Array.from({ length: count }, (_, i) => {
    const a0 = start + i * step;
    const a1 = Math.min(start + sweep, a0 + step * 1.35);
    return { d: describeArc(cx, cy, r, a0, a1), color: colorAt(i / (count - 1)) };
  });
}

type SegmentProps = {
  d: string;
  color: string;
  index: number;
  progress: SharedValue<number>;
  thickness: number;
};

/**
 * One lit arc. Its own opacity is how much of it the fill has reached: 1 fully behind
 * the head, 0 ahead of it, fractional for the single segment the head is crossing —
 * that fraction is what keeps the leading edge smooth instead of stepping arc by arc.
 * Only the ring stroke is in here — the bloom is a separate static layer that doesn't
 * track the fill, so a segment stays one animated node wrapping one path.
 */
function Segment({ d, color, index, progress, thickness }: SegmentProps) {
  const animatedProps = useAnimatedProps(() => {
    const reached = progress.value * SEGMENTS - index;
    return { opacity: Math.min(1, Math.max(0, reached)) };
  });
  return (
    <AnimatedG animatedProps={animatedProps}>
      <Arc d={d} color={color} thickness={thickness} />
    </AnimatedG>
  );
}

export type GaugeProgressProps = {
  /**
   * 0-100, the percentage CONSUMED. The gauge fills from the start and the sweep runs
   * GREEN → yellow → RED, so 0 = empty + green and 100 = full + red. Pass the number
   * you'd print next to it (e.g. "% of budget used") — never an inverted one, or the
   * pointer will contradict the label. Non-finite values are treated as 0.
   */
  value?: number;
  size?: number;
  /**
   * Ring stroke width. Defaults to the Figma source's proportion — its ring is 9.7px
   * on a 360px circle, i.e. `RING_RATIO` of the diameter — so the gauge stays visually
   * identical to the design at any `size` unless a caller deliberately overrides it.
   */
  thickness?: number;
  /** Soft halo behind the ring. */
  glow?: boolean;
  showPointer?: boolean;
  /** Fill of the punched-out centre — match the surface the gauge sits on. */
  discColor?: string;
  /**
   * The band between the ring and the centre disc. The design tucks a faint
   * `#F7F8FA` rim in there rather than running the disc up to the stroke; pass
   * `discColor` here to collapse it.
   */
  rimColor?: string;
  /** Set false to render at `value` immediately (no 0 → value sweep). */
  animate?: boolean;
  /**
   * Change this to replay the 0 → `value` sweep without the value itself changing.
   * A screen kept mounted by a navigator only animates once otherwise; bump this on
   * focus (see BudgetScreen) so the gauge fills again each time it's actually seen.
   */
  replayKey?: number | string;
  children?: React.ReactNode;
};

export default function GaugeProgress({
  value = 68,
  size = 260,
  thickness = size * RING_RATIO,
  glow = true,
  showPointer = true,
  discColor = '#ffffff',
  rimColor = '#F7F8FA',
  animate = true,
  replayKey,
  children,
}: GaugeProgressProps) {
  // NaN / undefined / Infinity would poison `progress` and blank the whole ring
  // (0/0 shows up easily here — e.g. spent÷cap with no cap set).
  const target = Number.isFinite(value) ? Math.min(100, Math.max(0, value as number)) : 0;

  // `size` is the RING's outer diameter, exactly as it is for a plain stroked circle —
  // so a gauge and the classic ring it can replace occupy the same footprint.
  //
  // The bloom still needs room, but taking it out of the radius (an earlier version)
  // shrinks the ring: at size 140 the glow's half-width left an outer ⌀ of 125 against
  // the classic ring's 140, and switching the widget on visibly shrank the hero. So the
  // SVG canvas is grown by the overhang instead and pulled back by the same amount, and
  // the glow spills outside the component's box rather than eating into the ring.
  const glowPad = glow ? Math.max(0, (thickness * GLOW_MAX_SCALE) / 2 - thickness / 2) : 0;
  const svgSize = size + 2 * glowPad;
  // SVG-space centre (the canvas is bigger than the box) vs the box's own centre, which
  // is what the RN-side disc and knob position against. Mixing these up offsets the
  // centre label from the ring by exactly `glowPad`.
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const boxCenter = size / 2;
  // A thickness large relative to size would drive the radius negative, which makes
  // describeArc emit an arc SVG can't resolve (it renders as a straight line or not
  // at all). Clamp so the component degrades to a thin ring instead of breaking.
  const ringRadius = Math.max(1, size / 2 - thickness / 2);
  // The rim fills everything inside the stroke; the disc sits within it, leaving the
  // design's faint band between the two. `Math.min` so a caller's odd size/thickness
  // combination can't put the disc outside the ring it's supposed to be punched into.
  const rimSize = Math.max(0, 2 * (ringRadius - thickness / 2));
  const discSize = Math.min(rimSize, 2 * (ringRadius + thickness / 2) * DISC_RATIO);
  // The rim is drawn as an ARC that tracks the fill, not as a full circle, so it reads
  // as an inner shadow of the progress rather than a permanent grey ring. Stroke it down
  // its band's centreline at the band's own width.
  const rimBand = (rimSize - discSize) / 2;
  const rimRadius = (rimSize + discSize) / 4;
  // Scaled off the gauge, not the stroke: the design's ring is fine enough that a knob
  // sized from `thickness` would be a dot. A floor keeps it tappable-looking on small
  // gauges, and the border tracks the knob so it never swallows the tint.
  const pointerSize = Math.max(10, size * POINTER_RATIO);
  const pointerBorder = Math.max(2, pointerSize * 0.2);

  // 0 → 1 fill progress. Starts at 0 so the gauge sweeps up on mount.
  const progress = useSharedValue(animate ? 0 : target / 100);

  useEffect(() => {
    if (!animate) {
      progress.value = target / 100;
      return;
    }
    // Restart from empty every time, so a replay reads as a fill and not as a nudge
    // from wherever the previous run happened to stop.
    progress.value = 0;
    progress.value = withTiming(target / 100, {
      duration: ENTER_MS,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(progress);
  }, [target, animate, replayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Knob rides the same shared value, so it can never disagree with the fill — and it
  // is tinted with the gradient's colour AT its own position, so it reads as the head
  // of the sweep rather than a separate marker sitting on top of it.
  const pointerStyle = useAnimatedStyle(() => {
    const rad = ((GAUGE_START + progress.value * GAUGE_SWEEP) * Math.PI) / 180;
    const tint = interpolateColor(progress.value, STOP_POSITIONS, STOP_COLORS);
    return {
      backgroundColor: tint,
      // Tinted like the knob itself — the same trick `shadows.fab` plays with the
      // theme's primary, so the knob sits on the ring with the same sense of lift.
      shadowColor: tint,
      // Translate ONLY. A rotate would be applied about the knob's own centre (RN's
      // transform origin), which makes the composed position depend on the knob size.
      transform: [
        { translateX: Math.cos(rad) * ringRadius - pointerSize / 2 },
        { translateY: Math.sin(rad) * ringRadius - pointerSize / 2 },
      ],
    };
  });

  /**
   * The rim follows the ARC rather than being a full circle, but spans the whole 0→100
   * sweep and doesn't track the value — it's part of the track's shape, not part of the
   * fill. Static, so one plain path.
   */
  const rimArcD = useMemo(
    () => describeArc(cx, cy, rimRadius, GAUGE_START, GAUGE_START + GAUGE_SWEEP),
    [cx, cy, rimRadius],
  );

  // Static geometry — only recomputed when the ring's dimensions change.
  const segments = useMemo(
    () => buildSegments(cx, cy, ringRadius, GAUGE_START, GAUGE_SWEEP, SEGMENTS),
    [cx, cy, ringRadius],
  );

  /**
   * The bloom, one entry per layer. Each layer's span is pulled IN at both ends so its
   * round cap finishes level with the ring's own cap instead of ballooning past it: a
   * 5×-thickness stroke has a cap ~2.5×thickness deep, which on a fine ring reads as two
   * blobs hanging off the gauge's ends. Trimming by the cap-depth difference, converted
   * to degrees at this radius, is what lets the glow fade out flush with the arc.
   */
  const glowLayers = useMemo(
    () =>
      GLOW_LAYERS.map((layer) => {
        const capOverhang = (thickness * layer.scale) / 2 - thickness / 2;
        const trimDeg = Math.min(
          GAUGE_SWEEP / 2 - 1, // never let the trim collapse the span
          (capOverhang / ringRadius) * (180 / Math.PI),
        );
        return {
          ...layer,
          segs: buildSegments(
            cx, cy, ringRadius,
            GAUGE_START + trimDeg,
            GAUGE_SWEEP - 2 * trimDeg,
            GLOW_SEGMENTS,
          ),
        };
      }),
    [cx, cy, ringRadius, thickness],
  );

  return (
    // The box is exactly `size`; the oversized SVG below is pulled back by `glowPad` so
    // the bloom overhangs it. `overflow: visible` is load-bearing — Android clips an
    // out-of-bounds child without it, which would crop the glow at the box edge and
    // undo the whole point of growing the canvas.
    <View style={{ width: size, height: size, overflow: 'visible' }}>
      <Svg
        width={svgSize}
        height={svgSize}
        style={{ position: 'absolute', top: -glowPad, left: -glowPad }}
      >
        {/* 1 — the bloom: one STATIC layer over the full sweep, at full GLOW_OPACITY
            whether or not the fill has reached it. It's the gauge's ambient light, so it
            deliberately does NOT follow the value the way the ring does. */}
        {glow && (
          <G opacity={GLOW_OPACITY}>
            {glowLayers.map((layer, li) => (
              // Opacity on the LAYER, never the path: the arcs inside overlap, and
              // per-path alpha would compound there into a beaded chain of bright spots.
              <G key={`gl-${li}`} opacity={layer.opacity}>
                {layer.segs.map((s, i) => (
                  <Path
                    key={i}
                    d={s.d}
                    stroke={s.color}
                    strokeWidth={thickness * layer.scale}
                    strokeLinecap="round"
                    fill="none"
                  />
                ))}
              </G>
            ))}
          </G>
        )}

        {/* 2 — the ring's unreached state: the full sweep at DIM_OPACITY. Group opacity
            (not per-path) so the segment overlaps don't compound into bright bands. */}
        <G opacity={DIM_OPACITY}>
          {segments.map((s, i) => (
            <Arc key={`dim-${i}`} d={s.d} color={s.color} thickness={thickness} />
          ))}
        </G>

        {/* 3 — the same sweep at full strength, revealed segment by segment. Identical
            geometry to the dim copy, so the fill head is a change in brightness, never
            in width. */}
        {segments.map((s, i) => (
          <Segment
            key={`lit-${i}`}
            d={s.d}
            color={s.color}
            index={i}
            progress={progress}
            thickness={thickness}
          />
        ))}

        {/* 4 — the rim: the band between the ring and the centre disc. It follows the
            arc across the full sweep rather than closing into a circle, so it never
            appears across the gap at the bottom where there's no gauge. */}
        {rimBand > 0.5 && (
          <Path
            d={rimArcD}
            stroke={rimColor}
            strokeWidth={rimBand}
            strokeLinecap="butt"
            fill="none"
          />
        )}
      </Svg>

      {/* Centre disc — carries the label. Shadowed, so it reads as sitting in the rim. */}
      <View
        style={[
          styles.centerFill,
          styles.centerDisc,
          {
            backgroundColor: discColor,
            width: discSize,
            height: discSize,
            borderRadius: discSize / 2,
            top: boxCenter - discSize / 2,
            left: boxCenter - discSize / 2,
          },
        ]}
        pointerEvents="none"
      >
        {children}
      </View>

      {/* Progress knob — anchored at the centre, pushed out along the swept axis. */}
      {showPointer && (
        <Animated.View
          style={[styles.pointerAnchor, { top: boxCenter, left: boxCenter }]}
          pointerEvents="none"
        >
          <Animated.View
            style={[
              styles.pointer,
              {
                width: pointerSize,
                height: pointerSize,
                borderRadius: pointerSize / 2,
                borderWidth: pointerBorder,
              },
              pointerStyle,
            ]}
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerFill: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerDisc: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  // Zero-size anchor at the gauge's centre; the knob is offset out from here so a
  // single translate positions it anywhere on the ring.
  pointerAnchor: { position: 'absolute', width: 0, height: 0 },
  pointer: {
    position: 'absolute',
    // Size, radius and border width scale with the gauge (see `pointerSize`);
    // backgroundColor + shadowColor come from the gradient at the knob's position
    // (see pointerStyle). Only what's genuinely fixed lives here.
    borderColor: '#ffffff',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
});
