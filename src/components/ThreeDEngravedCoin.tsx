// =============================================================================
// ThreeDEngravedCoin — premium gold coin with engraved "eP" 3D text.
//
// Pure SVG, no animation. Designed for reuse anywhere a celebratory EPC
// asset is needed (claim sheet, reward dialogs, header glyphs, etc.). The
// engraved-text effect is faked with two stacked texts — a bright highlight
// peeking from below a dark "carved" letter — giving the illusion that the
// glyph is pressed into the metal surface.
// =============================================================================

import React from 'react';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Circle,
  G,
  Line,
  Text as SvgText,
} from 'react-native-svg';

type Props = {
  /** Outer diameter in pixels. Defaults to 128. */
  size?: number;
  /** Hide the upper-left specular highlight (for darker placements). */
  gleam?: boolean;
};

const ThreeDEngravedCoin: React.FC<Props> = ({ size = 128, gleam = true }) => {
  // ── Edge ribbing (the tiny serrations around a real coin's perimeter) ──
  const ribCount = 56;
  const ribbing = React.useMemo(() => {
    const ribs: React.ReactNode[] = [];
    for (let i = 0; i < ribCount; i++) {
      const angle = (i / ribCount) * Math.PI * 2;
      const x1 = 64 + Math.cos(angle) * 60;
      const y1 = 64 + Math.sin(angle) * 60;
      const x2 = 64 + Math.cos(angle) * 56;
      const y2 = 64 + Math.sin(angle) * 56;
      ribs.push(
        <Line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="#7E5A1A"
          strokeWidth={0.6}
          strokeOpacity={0.55}
        />,
      );
    }
    return ribs;
  }, []);

  return (
    <Svg width={size} height={size} viewBox="0 0 128 128">
      <Defs>
        {/* Outer rim: dark-light-dark band to look like a polished edge */}
        <LinearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%"  stopColor="#FFE89A" />
          <Stop offset="35%" stopColor="#E6B958" />
          <Stop offset="65%" stopColor="#A0782A" />
          <Stop offset="100%" stopColor="#6E4D14" />
        </LinearGradient>

        {/* Inner face: radial light from upper-left, deep gold falloff */}
        <RadialGradient id="face" cx="35%" cy="28%" r="85%">
          <Stop offset="0%"   stopColor="#FFF3C0" />
          <Stop offset="35%"  stopColor="#F2CE6E" />
          <Stop offset="75%"  stopColor="#C99830" />
          <Stop offset="100%" stopColor="#7E5A1A" />
        </RadialGradient>

        {/* Soft specular gleam in the upper-left quadrant */}
        <RadialGradient id="gleam" cx="32%" cy="22%" r="26%">
          <Stop offset="0%"   stopColor="#FFFFFF" stopOpacity="0.85" />
          <Stop offset="55%"  stopColor="#FFFFFF" stopOpacity="0.25" />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>

        {/* Inset shadow on the inner face — sits behind the engraved text */}
        <RadialGradient id="inset" cx="50%" cy="62%" r="55%">
          <Stop offset="0%"   stopColor="#5A3E10" stopOpacity="0" />
          <Stop offset="78%"  stopColor="#5A3E10" stopOpacity="0" />
          <Stop offset="100%" stopColor="#3D2A0A" stopOpacity="0.22" />
        </RadialGradient>
      </Defs>

      {/* Outer disc — the polished rim */}
      <Circle cx="64" cy="64" r="62" fill="url(#rim)" />

      {/* Ribbed perimeter (under inner face so only the rim shows) */}
      <G>{ribbing}</G>

      {/* Inner medallion face */}
      <Circle
        cx="64"
        cy="64"
        r="52"
        fill="url(#face)"
        stroke="#5A3E10"
        strokeWidth={1.4}
      />

      {/* Subtle inset shadow ring (depth at the medallion edge) */}
      <Circle cx="64" cy="64" r="52" fill="url(#inset)" />

      {/* Engraved "eP" — bright highlight peeking from below dark letter */}
      <SvgText
        x={65}
        y={84}
        textAnchor="middle"
        fontSize={44}
        fontWeight="900"
        fill="#FFF3C8"
        fillOpacity={0.55}
      >
        eP
      </SvgText>
      <SvgText
        x={64}
        y={82}
        textAnchor="middle"
        fontSize={44}
        fontWeight="900"
        fill="#3A2708"
      >
        eP
      </SvgText>

      {/* Upper-left specular gleam (rendered on top so it lays over text edge) */}
      {gleam ? <Circle cx="64" cy="64" r="62" fill="url(#gleam)" /> : null}
    </Svg>
  );
};

export default ThreeDEngravedCoin;
