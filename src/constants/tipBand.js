// Home tip-strip slide colours. Pure data + maths, outside TipStrip so the
// headless suite can measure every theme × variant (homeTips.test.mjs).
//
// Each slide is a TONAL variation of the accent sunk into the dark base: mostly a
// different depth (`share`), with at most a ±12° hue nudge. Wider rotations were
// tried and left the family (orange → olive, Carbon's mint → "income" green).
import { contrastRatio, mix, rotateHue } from './theme';
import { DARK_NEUTRALS } from './themes';

export const TIP_BAND_VARIANTS = [
  { hue: 0,   share: 0.40 },
  { hue: -12, share: 0.54 },
  { hue: 10,  share: 0.30 },
  { hue: -6,  share: 0.47 },
  { hue: 6,   share: 0.35 },
];

/** White on every slide clears this; a bright accent (Carbon's mint) gets its share pulled back to reach it. */
export const TIP_BAND_MIN_WHITE = 5;

/** The surface for slide `i` (cycles through the variants). */
export const tipBandShade = (primary, i) => {
  const n = TIP_BAND_VARIANTS.length;
  const v = TIP_BAND_VARIANTS[((i % n) + n) % n];
  const hue = rotateHue(primary, v.hue);
  let share = v.share;
  let shade = mix(hue, share, DARK_NEUTRALS.background);
  while (share > 0.1 && contrastRatio('#FFFFFF', shade) < TIP_BAND_MIN_WHITE) {
    share -= 0.02;
    shade = mix(hue, share, DARK_NEUTRALS.background);
  }
  return shade;
};
