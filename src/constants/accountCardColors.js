// =============================================================================
// accountCardColors — the closed set of gradient swatches an account's detail
// screen hero card can use. Promoted out of AccountDetailsScreen.tsx's own
// private `BANK_GRADIENTS` once AccountFormScreen needed the SAME set to
// offer as a manual "Card Color" picker — one shared source instead of a
// second hand-copied list that could drift from the one actually rendered.
//
// Each key is also what a user's manual pick gets stored as (`account.colorKey`)
// — a closed, named set, never a free-form hex, so the picker and the render
// side can never disagree on what a key means.
// =============================================================================

// Spread deliberately around the hue wheel (red → orange → amber → green →
// teal → blue → indigo → violet → magenta → cyan → rose → bronze → slate) —
// the original set clustered 3 near-identical navy blues (HDFC/SBI/YES) and
// 3 near-identical dark reds (ICICI/AXIS/KOTAK), which read as duplicates in
// the picker's flat-shade swatches. RBL is now a violet that echoes the
// app's own brand primary (`colors.primary` #5B3CC4 / `colors.primaryLight`
// #7B4DFF in theme.js) — picking it deliberately reads as "this app's own
// color," not an arbitrary bank tone like the others. BOB/CANARA/INDUSIND/
// FEDERAL added later purely to widen the variant count — real (if
// less-common) bank names, not made-up colour labels, so a bank-name
// auto-match can never accidentally fire off a generic word like "rose".
// The gradient END (lighter) stop was a Tailwind "300/400" tier — read as
// washed-out/pastel against the hero card's white text. Pulled every one in
// to a "500" tier instead: still visibly lighter than its own dark stop, but
// no longer pale.
/** key → [gradientStart, gradientEnd]. Keys double as short display labels. */
export const BANK_GRADIENTS = {
  ICICI:    ['#961717', '#EF4444'], // red
  KOTAK:    ['#9d350b', '#F97316'], // orange
  AXIS:     ['#97480b', '#F59E0B'], // amber
  PNB:      ['#0d7332', '#22C55E'], // green
  SBI:      ['#0F766E', '#14B8A6'], // teal
  HDFC:     ['#13389f', '#3B82F6'], // blue
  YES:      ['#372da7', '#6366F1'], // indigo
  RBL:      ['#470da5', '#8B5CF6'], // violet — the app's own brand family
  IDFC:     ['#7A1B5C', '#A83289'], // magenta
  BOB:      ['#0e718a', '#06B6D4'], // cyan
  CANARA:   ['#920f2f', '#F43F5E'], // rose
  INDUSIND: ['#78350F', '#B45309'], // bronze
  FEDERAL:  ['#334155', '#64748B'], // slate
};

/** Stable render/iteration order for the picker UI. */
export const BANK_GRADIENT_KEYS = Object.keys(BANK_GRADIENTS);
