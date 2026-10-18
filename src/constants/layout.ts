// =============================================================================
// layout — sizing that has to hold across phones (320dp → 430dp wide, any
// system font size).
// -----------------------------------------------------------------------------
// dp already absorbs pixel density, so fonts and spacing stay plain numbers
// from `theme.js`. Only SHAPES that must keep a proportion (bank cards, grid
// tiles) are derived from width here. Pure, so `layout.test.mjs` runs headless.
// =============================================================================

/**
 * Ceiling on the OS font-size setting (Android Font size, iOS Dynamic Type).
 * Uncapped, the largest setting is ~2×: banners grew near-square and labels
 * overflowed their cards. 1.2 still honours the setting. Applied by
 * `components/AppText`, which every screen imports instead of react-native.
 */
export const FONT_SCALE_MAX = 1.2;

/**
 * For text inside a box whose size doesn't follow its content: the tab bar,
 * carousel cards, the bank card. Applied by `FixedTextScale` (AppText).
 */
export const FONT_SCALE_FIXED = 1;

/** Bank card face: 300×170, its look at the usual (max) width, kept on narrower phones. */
export const ACCOUNT_CARD_RATIO = 300 / 170;

/** Height that keeps `width : height = ratio`, clamped to [min, max]. */
export const ratioHeight = (
  width: number,
  ratio: number,
  { min = 0, max = Infinity }: { min?: number; max?: number } = {},
): number => Math.round(Math.min(max, Math.max(min, width / ratio)));

/**
 * Width of one tile in an N-column row. Floored: a rounded-up tile overflows
 * the row by a pixel and wraps the last one.
 */
export const gridItemWidth = (containerW: number, columns: number, gap: number): number =>
  Math.floor((containerW - gap * (columns - 1)) / columns);
