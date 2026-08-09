// =============================================================================
// Feature-banner treatments (Dashboard carousel).
//
// Pure data, deliberately NOT inside FeatureCarousel: that component imports
// react-native, so it can't be loaded by the headless test runner — and the one
// thing here that must be verified is a colour invariant across every theme
// (see themeContrast.test.mjs).
//
// `tint` is how far each card's wash travels from white toward the accent, and
// `bubbles` are the translucent circles behind the copy. Three treatments so a
// row of five banners doesn't read as one repeated card; they differ by bubble
// ARRANGEMENT, not by how loud the colour is.
//
// Keep `tint` low. Pushing it darker is tempting and actively harmful: body
// text loses contrast as the wash deepens, and at ~0.22 the surface luminance
// matches `colors.background` exactly — which is what made these cards look
// transparent in the first place. Presence comes from elevation (shadows.card),
// not from more colour.
// =============================================================================


// `tint` is how far the wash travels from white toward the accent. Kept LOW on
// purpose — see the note below on why "darker" has to come from elevation
// rather than from more colour.
/**
 * A decorative circle behind the copy.
 * Typed explicitly: without it TS infers the union of the literals actually
 * written, so a variant that happens to use only `right`/`bottom` makes `left`
 * "not exist" at the call site — the same JSDoc trap as `@returns { a, b }`.
 * @typedef {{ size: number, alpha: number, top?: number, bottom?: number, left?: number, right?: number }} Bubble
 * @typedef {{ tint: number, bubbles: Bubble[] }} BannerStyle
 */

/** @type {BannerStyle[]} */
export const BANNER_STYLES = [
  // TWO bubbles, not three, and both anchored to a corner so they bleed off the
  // edge. Three mid-card circles at similar sizes read as random blobs rather
  // than as depth — which is how the first version looked on device.
  { tint: 0.13, bubbles: [
    { size: 132, alpha: 0.11, bottom: -52, right: -34 },
    { size: 46,  alpha: 0.09, top: -14, right: 62 },
  ] },
  { tint: 0.16, bubbles: [
    { size: 104, alpha: 0.11, top: -36, right: -26 },
    { size: 62,  alpha: 0.08, bottom: -26, right: 70 },
  ] },
  { tint: 0.11, bubbles: [
    { size: 118, alpha: 0.10, bottom: -46, right: -8 },
    { size: 40,  alpha: 0.09, top: 12, right: 104 },
  ] },
];
