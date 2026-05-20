// =============================================================================
// PiggySvg.tsx — SVG piggy bank from src/assets/piggy-aware-run.svg
//
// Renders the piggy with a frosted-glass look. The body is filled with a
// translucent gradient so Skia crystals rendered on top show through the belly.
// Outline color, glass tint, and halo are driven by props so CrystalPiggyVault
// can swap them per tier without touching geometry.
// =============================================================================

import React from 'react';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  ClipPath,
  G,
} from 'react-native-svg';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PiggySvgProps {
  size:          number;
  /** Stroke color for the outer piggy outline. */
  outlineColor:  string;
  /** Second stroke color — used for a subtle inner sheen. */
  outlineColor2: string;
  /** Base tint applied to the glass body fill (RGBA, low alpha). */
  tintColor:     string;
}

// ─── SVG path data (verbatim from piggy-aware-run.svg) ───────────────────────

// viewBox: -5 -10 110 135  →  content sits in a ~110×125 user-unit space.
// We render the SVG into a square of `size` dp using xMidYMid meet.

const SLOT_PATH =
  'M57.781 25.031H43.719c-0.859 0-1.563 0.703-1.563 1.563s0.703 1.563 1.563 1.563H57.781c0.859 0 1.563-0.703 1.563-1.563s-0.703-1.563-1.563-1.563z';

const EYE_PATH =
  'M26.531 40.656c0 4.168-6.25 4.168-6.25 0s6.25-4.168 6.25 0';

const BODY_PATH =
  'M94.938 38.125c-0.547-0.672-1.531-0.781-2.203-0.234s-0.781 1.531-0.234 2.203c0.563 0.688 1.453 2.047 1.234 3.469-0.313 1.984-2.859 3.953-6.344 4.156-0.813-16.078-14.109-28.906-30.391-28.906H41.375c-3.172 0-6.25 0.484-9.188 1.406-5.047-7.25-14.797-6.141-15.234-6.094-0.453 0.063-0.859 0.313-1.109 0.688s-0.328 0.859-0.203 1.297l3.531 12.313c-3.297 3.5-5.703 7.703-7.047 12.266H7.75c-2.578 0-4.688 2.109-4.688 4.688v10.609c0 1.859 1.078 3.531 2.75 4.266 1.703 0.766 4.438 1.734 8.031 2.125 2.047 4.297 5.063 8.047 8.844 10.969l-1.547 6.969c-0.313 1.391 0.016 2.828 0.906 3.953 0.891 1.109 2.219 1.75 3.656 1.75h6.109c2.203 0 4.078-1.516 4.578-3.672l0.641-2.906c1.438 0.203 2.891 0.344 4.313 0.344H57.969c0.938 0 1.875-0.063 2.797-0.141l0.609 2.734c0.5 2.156 2.375 3.672 4.563 3.672h6.109c1.438 0 2.766-0.641 3.656-1.75s1.219-2.547 0.906-3.938l-1.344-6c1.516-1.047 2.953-2.203 4.234-3.484 5.391-5.375 8.484-12.422 8.859-20 4.828-0.219 8.844-3 9.438-6.781 0.406-2.609-1.016-4.813-1.891-5.906zM29.156 21.344c-2.656 1.172-5.156 2.719-7.406 4.625l-2.531-8.828c2.531 0.063 7.063 0.703 9.953 4.188zm47.172 47.25c-1.375 1.375-2.922 2.625-4.609 3.703l-0.031 0.031c-0.094 0.063-0.172 0.156-0.25 0.25-0.063 0.063-0.125 0.109-0.172 0.188s-0.078 0.172-0.125 0.266c-0.031 0.094-0.094 0.188-0.109 0.281-0.016 0.078 0 0.156 0 0.25 0 0.125-0.016 0.25 0 0.359v0.031l1.563 7c0.109 0.469 0 0.938-0.297 1.313s-0.734 0.578-1.219 0.578H65.97c-0.734 0-1.359-0.516-1.516-1.234l-0.906-4.078c-0.016-0.078-0.078-0.156-0.109-0.234-0.047-0.094-0.063-0.203-0.125-0.281-0.047-0.078-0.125-0.141-0.188-0.219-0.078-0.078-0.141-0.156-0.219-0.219-0.078-0.047-0.156-0.078-0.234-0.109-0.109-0.047-0.203-0.094-0.313-0.125-0.094-0.016-0.188 0-0.281 0s-0.172-0.031-0.266 0c-1.234 0.172-2.516 0.266-3.797 0.266H42.594c-1.734 0-3.484-0.172-5.234-0.5H37.11c-0.125 0-0.25-0.016-0.359 0-0.063 0-0.125 0.047-0.188 0.078-0.125 0.047-0.25 0.078-0.359 0.156-0.078 0.047-0.125 0.125-0.188 0.188-0.078 0.078-0.172 0.141-0.234 0.234s-0.094 0.188-0.125 0.297c-0.031 0.078-0.094 0.156-0.109 0.25l-0.953 4.313c-0.172 0.734-0.797 1.234-1.531 1.234h-6.109c-0.484 0-0.922-0.219-1.219-0.578-0.172-0.219-0.438-0.672-0.297-1.313l1.766-7.938v-0.109c0.031-0.172 0.031-0.344 0-0.516-0.016-0.094-0.063-0.172-0.094-0.25-0.031-0.109-0.063-0.203-0.125-0.313-0.094-0.141-0.203-0.25-0.328-0.359-0.031-0.031-0.047-0.063-0.078-0.094-3.953-2.844-7.078-6.703-9.031-11.156-0.031-0.063-0.078-0.109-0.125-0.172-0.063-0.094-0.109-0.188-0.188-0.266-0.063-0.078-0.156-0.125-0.234-0.188s-0.156-0.125-0.25-0.156c-0.094-0.047-0.203-0.063-0.297-0.078-0.078-0.016-0.141-0.063-0.219-0.063-3.609-0.281-6.281-1.219-7.906-1.953-0.547-0.25-0.906-0.781-0.906-1.422V44.813c0-0.859 0.703-1.563 1.563-1.563h5.547s0.078-0.016 0.125-0.031c0.109 0 0.203-0.031 0.297-0.063s0.203-0.063 0.281-0.109 0.156-0.094 0.234-0.156 0.156-0.125 0.234-0.203c0.063-0.078 0.109-0.156 0.156-0.234 0.063-0.094 0.109-0.188 0.141-0.297 0-0.047 0.047-0.063 0.047-0.109 1.188-4.766 3.672-9.156 7.203-12.688 5.156-5.172 12.016-8.016 19.328-8.016H57.97c15.078 0 27.344 12.266 27.344 27.344 0 7.313-2.844 14.188-8.016 19.344z';

// ─── Component ───────────────────────────────────────────────────────────────

const PiggySvg: React.FC<PiggySvgProps> = ({
  size,
  outlineColor,
  outlineColor2,
  tintColor,
}) => {
  const strokeW = Math.max(1.2, size * 0.028);

  return (
    <Svg
      width={size}
      height={size}
      viewBox="-5 -10 110 135"
      preserveAspectRatio="xMidYMid meet"
    >
      <Defs>
        {/* Glass body fill — diagonal sweep from bright top-left to transparent */}
        <LinearGradient id="glassBody" x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset="0"   stopColor="#FFFFFF" stopOpacity="0.28" />
          <Stop offset="0.4" stopColor="#FFFFFF" stopOpacity="0.10" />
          <Stop offset="1"   stopColor="#FFFFFF" stopOpacity="0.04" />
        </LinearGradient>

        {/* Tinted glass overlay — tier color at very low opacity */}
        <LinearGradient id="glassTint" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={tintColor} stopOpacity="0.18" />
          <Stop offset="1" stopColor={tintColor} stopOpacity="0.06" />
        </LinearGradient>

        {/* Outline gradient — tier palette */}
        <LinearGradient id="outlineGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={outlineColor}  stopOpacity="1" />
          <Stop offset="1" stopColor={outlineColor2} stopOpacity="1" />
        </LinearGradient>

        {/* Inner specular highlight — bright zone in upper-left belly */}
        <RadialGradient
          id="glassSheen"
          cx="0.32"
          cy="0.38"
          r="0.38"
          fx="0.28"
          fy="0.32"
          gradientUnits="objectBoundingBox"
        >
          <Stop offset="0"   stopColor="#FFFFFF" stopOpacity="0.45" />
          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.12" />
          <Stop offset="1"   stopColor="#FFFFFF" stopOpacity="0"    />
        </RadialGradient>

        {/* Clip to body shape so fills don't bleed outside */}
        <ClipPath id="bodyClip">
          <Path d={BODY_PATH} />
        </ClipPath>
      </Defs>

      {/* ── 1. Glass tint fill (tier color wash) ── */}
      <Path d={BODY_PATH} fill="url(#glassTint)" />

      {/* ── 2. White gradient fill (glass base) ── */}
      <Path d={BODY_PATH} fill="url(#glassBody)" />

      {/* ── 3. Inner specular sheen (glass highlight) ── */}
      <Path d={BODY_PATH} fill="url(#glassSheen)" />

      {/* ── 4. Piggy outline stroke ── */}
      <Path
        d={BODY_PATH}
        fill="none"
        stroke="url(#outlineGrad)"
        strokeWidth={strokeW}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* ── 5. Coin slot ── */}
      <Path
        d={SLOT_PATH}
        fill={outlineColor}
        fillOpacity={0.9}
      />

      {/* ── 6. Eye ── */}
      <Path
        d={EYE_PATH}
        fill={outlineColor2}
        fillOpacity={0.85}
      />
    </Svg>
  );
};

export default PiggySvg;
