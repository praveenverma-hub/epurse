// =============================================================================
// splitShares — the ONE place the add-form split pages (plain + group) get their
// share arithmetic from: even / full-owed presets, "are these equal?", and what
// is left to allocate. Pure, so it is unit-tested (npm run test:splitShares) and
// both pages stay identical by construction.
//
// Store-side maths (what actually gets booked) lives in split.js; this is the
// editing-time helper that fills the inputs a user then confirms.
// =============================================================================

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** `count` rupee amounts summing exactly to `total`; the LAST absorbs the rounding. */
export function evenAmounts(total: number, count: number): number[] {
  if (count <= 0) return [];
  const each = r2((Number(total) || 0) / count);
  const out: number[] = Array(count).fill(each);
  out[count - 1] = r2((Number(total) || 0) - each * (count - 1));
  return out;
}

/** `count` whole percents summing to 100; the FIRST (You) absorbs the remainder. */
export function evenPercents(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  return Array.from({ length: count }, (_, i) => (i === 0 ? 100 - base * (count - 1) : base));
}

/**
 * "Full owed": the payer covers the whole bill and takes 0; everyone else owes an
 * equal share of it. `units` is the whole (100 for percent, the ₹ total for amount).
 * Returns one value per person, `payerIdx` getting 0. A lone payer (nobody else)
 * keeps everything — there is no one to owe.
 */
export function fullOwedShares(
  units: number,
  count: number,
  payerIdx: number,
  { whole = false }: { whole?: boolean } = {},
): number[] {
  if (count <= 0) return [];
  const others = Array.from({ length: count }, (_, i) => i).filter((i) => i !== payerIdx);
  if (others.length === 0) return Array.from({ length: count }, (_, i) => (i === payerIdx ? units : 0));
  const parts = whole
    ? (() => {
        const base = Math.floor(units / others.length);
        return others.map((_, k) => (k === 0 ? units - base * (others.length - 1) : base));
      })()
    : evenAmounts(units, others.length);
  const out: number[] = Array(count).fill(0);
  others.forEach((idx, k) => { out[idx] = parts[k]; });
  return out;
}

/** True when every value is within `tolerance` of the others (34/33/33 → equal). */
export function isEqualShares(values: number[], tolerance = 1): boolean {
  return values.length > 1 && Math.max(...values) - Math.min(...values) <= tolerance;
}

/** What's left of `target` after `sum`, rounded; negative = over-allocated. */
export function leftToAllocate(sum: number, target: number): number {
  return r2((Number(target) || 0) - (Number(sum) || 0));
}

/** Whether `sum` fills `target` (percent tolerates half a point; rupees a paisa). */
export function isFullyAllocated(sum: number, target: number, unit: 'percent' | 'amount'): boolean {
  return Math.abs(leftToAllocate(sum, target)) <= (unit === 'percent' ? 0.5 : 0.01);
}
