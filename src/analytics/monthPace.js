// =============================================================================
// monthPace — the tab bar's top edge, as information instead of decoration.
//
// The bar's 0.5pt hairline was a divider and nothing more. It is the one piece of
// chrome present on EVERY tab, at the edge of every screen, which makes it the
// cheapest possible place to answer the question this app exists to answer: how
// much of this month's budget is gone, and is that ahead of the month itself?
//
// So it becomes a 3pt track: a fill for budget used, and a NOTCH at where the
// month has got to. Fill past the notch means you're spending faster than the
// month is passing. Costs no height, no tap target, no screen real estate.
//
// Two restraint decisions, both deliberate:
//   • NO budget → it renders as the plain hairline it always was. The app never
//     nags a user into planning a budget (that's what the Home banner is for),
//     and a track showing 0-of-0 would be a lie.
//   • Being AHEAD of the month does not change the colour. Anyone who pays rent
//     on the 1st is ahead all month, and a warning tone for four weeks is noise.
//     The notch already says it; only genuinely exceeding the cap recolours.
//
// Pure: no store, no theme, no Date.now() — the caller passes `nowMs`, so every
// boundary below is testable. Colours are chosen by the component, because they
// have to be measured against the bar's surface.
// =============================================================================

/** Height of the informative strip, and of the plain hairline it replaces. */
export const PACE_STRIP_H = 3;
export const PACE_HAIRLINE_H = 0.5;

/** Width of the month marker cut into the track. */
export const PACE_NOTCH_W = 2;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * @param usage the result of the store's `getBudgetUsage()` — `null` when the
 *   user has no budget. Deliberately taken as an argument rather than read here:
 *   that selector is the single source for every exclusion rule (ignored, refund
 *   netting, NON_SPEND_CATS, spendExcluded, per-parent rollup) and this module
 *   must not grow a second opinion about what counts as spend.
 * @param nowMs
 * @returns `null` when there is nothing honest to draw, else
 *   `{ ratio, fill, elapsed, over, ahead }` where `fill`/`elapsed` are 0–1.
 */
export const monthPace = (usage, nowMs) => {
  const cap = Number(usage?.total?.cap) || 0;
  // No plan, or a plan of zero: nothing to measure against.
  if (cap <= 0) return null;

  const rawActual = Number(usage?.total?.actual);
  // `getBudgetUsage` already floors its own totals at 0, but a NaN here would
  // silently render a full bar, so the guard is repeated rather than assumed.
  const actual = Number.isFinite(rawActual) && rawActual > 0 ? rawActual : 0;

  const now = new Date(nowMs);
  if (Number.isNaN(now.getTime())) return null;
  // Day 0 of next month === last day of this one, so this is the true length
  // including February and leap years.
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const ratio = actual / cap;
  // Day-of-month over its length: the 1st reads as just-started rather than 0,
  // which is right — some of the first day has already passed.
  const elapsed = clamp01(now.getDate() / daysInMonth);

  return {
    ratio,
    fill: clamp01(ratio),
    elapsed,
    over: ratio > 1,
    ahead: ratio > elapsed,
  };
};
