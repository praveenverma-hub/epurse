// Home tip-strip slide colours. Pure data + maths, outside TipStrip so the
// headless suite can measure every theme × variant (homeTips.test.mjs).
//
// LIGHT on purpose: a deep band below the header was the heaviest thing on a page
// of white cards and read as a second header (the carousel learned the same, see
// HomeCarousel). Each slide is a light WASH of a tonal variant of the accent — a
// ≤ ±12° hue nudge (wider left the family: orange → olive, Carbon's mint → "income"
// green) and its own wash depth — so slides still differ, calmly.
import { mix, rotateHue } from './theme';

export const TIP_BAND_VARIANTS = [
  { hue: 0,   wash: 0.12 },
  { hue: -12, wash: 0.15 },
  { hue: 10,  wash: 0.09 },
  { hue: -6,  wash: 0.14 },
  { hue: 6,   wash: 0.10 },
];

const variant = (i) => {
  const n = TIP_BAND_VARIANTS.length;
  return TIP_BAND_VARIANTS[((i % n) + n) % n];
};

/** Slide `i`'s own hue — the accent nudged; inks for the icon / action derive from it. */
export const tipBandHue = (primary, i) => rotateHue(primary, variant(i).hue);

/** Slide `i`'s surface: a light wash of its hue over `base` (the card surface). */
export const tipBandWash = (primary, i, base) => mix(tipBandHue(primary, i), variant(i).wash, base);
