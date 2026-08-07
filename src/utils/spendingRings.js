// =============================================================================
// spendingRings.js — transactions → RingData[] for ConcentricSpendingRings
//
// The rings widget wants parent-level spend with an emoji, a colour, a child
// breakdown and a few recent transactions. Nothing in the store produces that
// shape: `getCategoryBreakdown` is FLAT (legacy category ids, no children) and
// `getBudgetChildBreakdown` is scoped to one parent at a time. This is the
// adapter between them.
//
// Kept as a pure, dependency-free module (no react-native imports) so the
// zero-dep .mjs test runner can import it — same reason `split.js` and
// `utils/location.js` live outside their react-facing counterparts.
//
// SPEND SEMANTICS: this must agree with `getCategoryBreakdown` or the rings
// will disagree with the chart directly above them on the same screen:
//   • ignored / non-spend / group-excluded rows never count (caller pre-filters
//     for group exclusion; see the groups skill §3 — this helper has no access
//     to `groups`, so it CANNOT do that itself)
//   • refunds keep their category and net it DOWN (spendContribution)
//   • a category that nets negative is clamped to 0, never shown negative
// =============================================================================

import { countsForSpend, spendContribution } from './split';

/** Rings the widget can actually draw. Extra parents are folded away, not dropped. */
export const MAX_RINGS = 4;

/**
 * Roll transactions up to parent categories and shape them for the rings widget.
 *
 * @param txns        transactions ALREADY filtered for isIgnored + group exclusion
 * @param opts.tree   ParentCat[] from useCategoryTree (carries custom categories)
 * @param opts.maps   CategoryMaps from useCategoryMaps
 * @param opts.parentCatIdForTxn  resolver, injected so this module stays free of
 *                    the TS constants file (which pulls in react-native types)
 * @param opts.nonSpendIds  Set of category ids that are never spend
 * @param opts.caps   optional { [parentId]: cap } from the budget plan
 * @param opts.limit  max rings (default MAX_RINGS)
 * @returns RingData[] sorted largest first
 */
export function buildSpendingRings(txns, opts = {}) {
  const {
    tree = [],
    maps,
    parentCatIdForTxn,
    nonSpendIds = new Set(),
    caps = {},
    limit = MAX_RINGS,
  } = opts;

  if (!Array.isArray(txns) || typeof parentCatIdForTxn !== 'function') return [];

  const metaById = new Map(tree.map((p) => [p.id, p]));
  const byParent = new Map();

  for (const t of txns) {
    if (!t || t.isIgnored) continue;
    if (!countsForSpend(t)) continue;
    if (nonSpendIds.has(t.categoryId)) continue;

    const pid = parentCatIdForTxn(t, maps) || 'other';
    if (nonSpendIds.has(pid)) continue;

    let bucket = byParent.get(pid);
    if (!bucket) {
      bucket = { amount: 0, children: new Map(), recent: [] };
      byParent.set(pid, bucket);
    }

    const delta = spendContribution(t);
    bucket.amount += delta;

    // Child rows use the txn's own two-tier label when it has one. Falling back to
    // the parent's label would render a child row identical to its parent, which
    // reads as a bug in the detail card.
    const childLabel = t.childCategory || null;
    if (childLabel) {
      bucket.children.set(childLabel, (bucket.children.get(childLabel) || 0) + delta);
    }

    // Only real outflows belong in "Recent" — a refund credit in that list looks
    // like a charge, since the card renders every row as "−amount".
    if (delta > 0) bucket.recent.push(t);
  }

  const rows = [];
  for (const [pid, bucket] of byParent) {
    // Refunds can push a category negative; clamp rather than draw a negative arc.
    const amount = Math.max(0, bucket.amount);
    if (amount <= 0) continue;

    const meta = metaById.get(pid);
    const children = [...bucket.children.entries()]
      .map(([childCategory, amt]) => ({ childCategory, amount: Math.max(0, amt) }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const recent = bucket.recent
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 4)
      .map((t) => ({
        id: String(t.id),
        merchant: t.merchant || meta?.label || 'Transaction',
        amount: spendContribution(t),
        timestamp: t.createdAt,
      }));

    rows.push({
      parentCategory: meta?.label || pid,
      emoji: meta?.emoji || '💸',
      color: meta?.color || '#8E8E93',
      amount,
      cap: caps[pid] > 0 ? caps[pid] : undefined,
      children: children.length ? children : undefined,
      recent: recent.length ? recent : undefined,
    });
  }

  rows.sort((a, b) => b.amount - a.amount);
  const top = rows.slice(0, Math.max(0, limit));

  // `pct` is share-of-the-drawn-total, so the rings are comparable to each other
  // and the largest always reads as a full sweep. Percent-of-grand-total would
  // make every ring a thin sliver once spend is spread across many categories.
  const drawnTotal = top.reduce((s, r) => s + r.amount, 0);
  return top.map((r) => ({
    ...r,
    pct: drawnTotal > 0 ? (r.amount / drawnTotal) * 100 : 0,
  }));
}

/**
 * The Budget-screen variant: rings for budgeted categories, filled against their CAP.
 *
 * Deliberately NOT `buildSpendingRings` with different inputs — `pct` means something
 * different here and that difference is the whole point of the screen:
 *   • Analytics → pct = share of the drawn rings ("where did the money go")
 *   • Budget    → pct = actual / cap, so >100 is real and the widget's "over" pill
 *                 fires ("how close am I to blowing this category")
 * Collapsing the two would silently turn an over-budget ring back into a share.
 *
 * @param rows  getBudgetUsage().perCategory flattened to
 *              [{ catId, cap, actual, pct, over, overshoot, remaining }]
 * @param opts.meta         (catId) => { name/label, emoji, color } | undefined
 * @param opts.childrenFor  (catId) => [{ label, total }] for the expanded card
 * @param opts.limit        max rings (default MAX_RINGS)
 */
export function buildBudgetRings(rows, opts = {}) {
  const { meta, childrenFor, limit = MAX_RINGS } = opts;
  if (!Array.isArray(rows)) return [];

  const drawn = rows
    // A category budgeted but untouched has nothing to draw — an all-zero ring reads
    // as a rendering failure rather than as "you haven't spent here".
    .filter((r) => r && r.actual > 0)
    // Most-consumed first: on a budget screen the at-risk category is the headline,
    // and it matches the order of the list this replaces.
    .sort((a, b) => (b.pct || 0) - (a.pct || 0))
    .slice(0, Math.max(0, limit));

  return drawn.map((r) => {
    const m = typeof meta === 'function' ? meta(r.catId) : undefined;
    const label = m?.name || m?.label || r.catId;
    const kids = typeof childrenFor === 'function' ? childrenFor(r.catId) || [] : [];
    const children = kids
      // A child row carrying the PARENT's own name is spend tagged to the parent with
      // no sub-category set. Rendering "Food & Dining" inside Food & Dining reads as a
      // bug, so it's dropped here rather than in each caller (the drill sheet applies
      // the same rule; this keeps the two from drifting).
      .filter((c) => c && c.total > 0 && c.label !== label)
      .map((c) => ({ childCategory: c.label, amount: c.total }))
      .sort((a, b) => b.amount - a.amount);

    return {
      parentCategory: label,
      emoji: m?.emoji || '💸',
      color: m?.color || '#8E8E93',
      amount: r.actual,
      cap: r.cap > 0 ? r.cap : undefined,
      // Uncapped category: no denominator, so there's no meaningful fill. Zero keeps
      // the ring present (its amount still counts toward the centre total) without
      // inventing a percentage.
      pct: r.cap > 0 ? (r.actual / r.cap) * 100 : 0,
      children: children.length ? children : undefined,
    };
  });
}
