// =============================================================================
// carousel — shared geometry and feel for the app's snap carousels.
// -----------------------------------------------------------------------------
// Two carousels now use this: `HomeCarousel` (Dashboard) and
// `GroupInsightCarousel` (Analytics). They render completely different content,
// but the MECHANICS — where a snapped card sits, how far its neighbours peek, how
// much smaller they are — are the part a user reads as "the app's carousels", and
// the part that silently drifts if each screen picks its own numbers.
//
// Pure and dependency-free so `carouselGeometry.test.mjs` can pin the centring
// invariant headlessly.
// =============================================================================

/**
 * Gap between cards. Smaller than it looks like it should be because the
 * neighbour SCALE already separates the cards visually — a full 12pt gutter plus
 * a scale step reads as two different spacings fighting.
 */
export const CARD_GAP = 8;

/**
 * How much of the viewport each side reserves, which is exactly how far the
 * neighbouring cards peek in. This is the whole reason a centred card is
 * narrower than its container.
 *
 * 28 is a measured compromise, not a taste call: the visible sliver is
 * `SIDE_PEEK − CARD_GAP − (1 − NEIGHBOUR_SCALE) × cardW / 2` ≈ 12pt, which reads
 * clearly, while a bigger peek narrows the card enough to start truncating the
 * two-line body copy (see CARD_BODY_MAX_CHARS).
 */
export const SIDE_PEEK = 28;

/** Scale/opacity of the cards either side of the snapped one. */
export const NEIGHBOUR_SCALE = 0.94;
export const NEIGHBOUR_OPACITY = 0.82;

/**
 * Where a snapped card sits and how far one swipe travels.
 *
 * `sidePad` is exactly `(boxW − cardW) / 2` — no gutter correction. That's what
 * makes the maths close: with this padding, the list's MAXIMUM scroll offset
 * equals `(count − 1) × snap` precisely, so the last card can reach dead centre.
 * Subtract anything (an earlier version here shaved `gap / 2`) and the final card
 * parks slightly off-centre with no way to nudge it — the horizontal twin of the
 * "last card can never snap flush" bug that `paddingRight` used to fix.
 *
 * @param {number} boxW  measured width of the carousel's container
 * @param {number} cardW width of one card
 * @param {number} gap   gap between cards
 * @returns {{ snap: number, sidePad: number }}
 */
export const carouselMetrics = (boxW, cardW, gap = CARD_GAP) => ({
  snap: cardW + gap,
  sidePad: Math.max(0, (boxW - cardW) / 2),
});

/**
 * Card width for a carousel whose cards fill the viewport minus both peeks.
 * (`GroupInsightCarousel` clamps its own width instead — its cards are content-
 * sized, not full-bleed — so it passes `cardW` to `carouselMetrics` directly.)
 */
export const fullBleedCardW = (boxW, sidePeek = SIDE_PEEK) =>
  Math.max(0, boxW - 2 * sidePeek);

// ── Copy budgets ────────────────────────────────────────────────────────────
// A centred card is narrower than a left-aligned one, so the copy has to fit a
// smaller column. These are CONSERVATIVE character counts for the ~190pt text
// column that `SIDE_PEEK` leaves, at the card's type sizes (~6.2pt per body
// character at 13px, ~8.2pt per title character at 17px bold).
//
// Approximations, deliberately: exact text measurement isn't available where the
// copy is authored, and the failure mode of guessing generously is a mid-word
// ellipsis, which reads as broken rather than trimmed. `homeCards.test.mjs`
// enforces them so a new card can't ship truncated.
/** Body is `numberOfLines={2}`. */
export const CARD_BODY_MAX_CHARS = 58;
/** Title is `numberOfLines={2}`; promos hard-wrap with \n, so this is PER LINE. */
export const CARD_TITLE_MAX_CHARS_PER_LINE = 22;

// ── Endless loop indexing ───────────────────────────────────────────────────
// A centred carousel clones a card at BOTH ends:
//
//   [ clone(last) , …cards… , clone(first) ]
//     list 0         1 … n        n + 1
//
// so every real card has a neighbour peeking on each side — including the first,
// which otherwise showed bare page to its left. The cost is that list index no
// longer equals card index, and every mapping between them is an off-by-one
// waiting to happen. They live here, pure and tested, rather than inline in the
// component where they can only be checked by swiping.

/** Where real card `i` sits in the looped list. */
export const listIndexFor = (i, canLoop) => (canLoop ? i + 1 : i);

/**
 * List index → card index. BOTH clones map back to the card they duplicate, so a
 * clone is styled and announced as its original — without this the banner
 * treatment changes at the silent jump and the wrap becomes visible.
 */
export const realIndexFor = (listIndex, count, canLoop) => {
  if (!canLoop || count <= 0) return Math.max(0, listIndex);
  return ((listIndex - 1) % count + count) % count;
};

/**
 * Where to teleport after a scroll settles, or `null` to stay put.
 *
 * Settling on the TRAILING clone jumps to the real first card, and on the LEADING
 * clone to the real last — both with no animation, which is what makes the strip
 * feel endless in either direction.
 */
export const wrapTarget = (settledAt, count, canLoop) => {
  if (!canLoop || count <= 0) return null;
  if (settledAt > count) return listIndexFor(0, true);
  if (settledAt < 1) return listIndexFor(count - 1, true);
  return null;
};
