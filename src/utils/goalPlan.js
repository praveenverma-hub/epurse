// =============================================================================
// goalPlan.js — the maths behind a monthly Goals plan.
//
// Pure functions only, and deliberately in JS (not TS) for the same reason
// `split.js` is: the zero-dependency `.mjs` test runner imports this directly,
// so it must not pull in anything native. Presentation data (templates, labels,
// icons) lives in `constants/goals.ts`; nothing here knows about React.
//
// The model in one line: a plan splits ONE salary figure across N allocations,
// and whatever is left over is free. Every helper below preserves that identity
// — a plan can never allocate more than the salary, and moving money between
// two goals never changes the total.
// =============================================================================

/**
 * Granularity of every allocation. Drags and steppers both snap to this, so a
 * plan is always made of round numbers a person would actually say out loud.
 */
export const ALLOCATION_STEP = 500;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Round to the nearest step, never below zero.
 *
 * JS-thread only. This was briefly marked `'worklet'` so AllocationBar's drag
 * could call it on the UI thread — it CRASHED the app. A worklet may only call
 * worklets, and a cross-FILE worklet reference is not reliably serialised by
 * the Reanimated 3.6 babel plugin, so the first frame of a drag hit a
 * non-worklet on the UI thread and took the process with it. The bar now owns a
 * tiny local worklet for the preview and commits back through `rebalancePair`
 * here, which re-snaps — so this file is still what produces every stored
 * number. Do not put `'worklet'` back on these.
 */
export const snapAmount = (value, step = ALLOCATION_STEP) => {
  const s = step > 0 ? step : 1;
  return Math.max(0, Math.round(num(value) / s) * s);
};

/** Sum of every allocation in the plan. */
export const allocatedTotal = (allocations) =>
  Object.values(allocations || {}).reduce((a, n) => a + num(n), 0);

/**
 * Salary minus everything allocated. NEGATIVE when a plan is over-committed —
 * callers show that as an error state rather than clamping, because silently
 * hiding an over-allocation is how a plan starts lying.
 */
export const freeAmount = (salary, allocations) => num(salary) - allocatedTotal(allocations);

/**
 * Move money across ONE divider: `nextLeft` is what the left side should become,
 * and the right side absorbs the difference. The pair's combined value is
 * invariant, which is what makes the allocation bar honest — a goal can only
 * grow by taking from its neighbour.
 */
export const rebalancePair = (leftValue, rightValue, nextLeft, step = ALLOCATION_STEP) => {
  const pool = Math.max(0, num(leftValue) + num(rightValue));
  const left = Math.max(0, Math.min(pool, snapAmount(nextLeft, step)));
  return { left, right: pool - left };
};

/**
 * Change ONE goal's allocation, taking from (or giving back to) the free pool.
 * Returns the clamped amount — never more than salary allows.
 */
export const allocationWithinSalary = (salary, allocations, goalId, nextValue) => {
  const others = { ...(allocations || {}) };
  delete others[goalId];
  const room = num(salary) - allocatedTotal(others);
  return Math.max(0, Math.min(Math.max(0, room), snapAmount(nextValue)));
};

/**
 * What you must put aside each month to land a lifetime target on time.
 * Returns 0 once the target is met, and null when there is no deadline to
 * divide by — the caller shows "no deadline" rather than a fake number.
 */
export const requiredMonthly = (target, saved, monthsLeft) => {
  const remaining = num(target) - num(saved);
  if (remaining <= 0) return 0;
  const m = Math.floor(num(monthsLeft));
  if (m <= 0) return null;
  return remaining / m;
};

/**
 * How many whole months of `perMonth` it takes to close the gap. null when the
 * contribution is zero — an infinite answer is not worth rendering.
 */
export const monthsToTarget = (target, saved, perMonth) => {
  const remaining = num(target) - num(saved);
  if (remaining <= 0) return 0;
  const rate = num(perMonth);
  if (rate <= 0) return null;
  return Math.ceil(remaining / rate);
};

/**
 * Pace for ONE goal this month, judged against how far through the month we
 * are — funding ₹5,000 of ₹10,000 is fine on the 14th and behind on the 28th.
 *
 * 'funded'  — the month's allocation is fully met
 * 'ahead'   — more than a whole day's worth in front of the expected line
 * 'on_track'— within a day's worth of it
 * 'behind'  — short
 */
export const paceStatus = (funded, planned, dayOfMonth, daysInMonth) => {
  const plan = num(planned);
  if (plan <= 0) return 'funded';
  const got = num(funded);
  if (got >= plan) return 'funded';

  const days = Math.max(1, num(daysInMonth));
  const day = Math.max(1, Math.min(days, num(dayOfMonth)));
  const expected = plan * (day / days);
  const oneDay = plan / days;

  if (got >= expected + oneDay) return 'ahead';
  if (got >= expected - oneDay) return 'on_track';
  return 'behind';
};

/** 0..100, clamped. A plan of 0 reads as complete, not as a divide-by-zero. */
export const fundedPct = (funded, planned) => {
  const plan = num(planned);
  if (plan <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((num(funded) / plan) * 100)));
};

/**
 * Scale a previous month's allocations to a new salary, preserving each goal's
 * SHARE rather than its rupee amount. Used when prefilling next month after a
 * raise or a pay cut — keeping the old rupee figures against a smaller salary
 * would silently over-commit the plan.
 *
 * Same salary → the exact same numbers back (the common case, so it must be
 * an identity, not an approximation).
 */
export const rescaleAllocations = (allocations, fromSalary, toSalary) => {
  const from = num(fromSalary);
  const to = num(toSalary);
  const out = {};
  if (from <= 0 || to <= 0 || from === to) {
    Object.entries(allocations || {}).forEach(([k, v]) => { out[k] = snapAmount(v); });
    return out;
  }
  const ratio = to / from;
  Object.entries(allocations || {}).forEach(([k, v]) => { out[k] = snapAmount(num(v) * ratio); });
  return out;
};

// =============================================================================
// Auto-funding rules — which real transactions COUNT toward a goal.
// -----------------------------------------------------------------------------
// A goal can name the spend it is made of: parent categories, specific
// sub-categories, and merchant keywords. Categorising a transaction into one of
// them funds the goal with no second act of logging, which is the whole point —
// the goals people abandon are the ones that need manual upkeep.
//
// The rule is an OR across all three dimensions: a row counts if its parent
// matches, OR its category matches, OR its merchant contains one of the
// keywords. Narrowing (an AND) would make "Zerodha under Investments" silently
// stop counting the month the user filed one under Other.
// =============================================================================

/**
 * Merchant strings arrive as "SWIGGY*ORDER", "Zerodha Broking Ltd", "UPI-ZERODHA".
 * Comparing them raw never matches, so both sides are folded to lowercase words
 * before a substring test.
 */
export const merchantKey = (value) =>
  String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const list = (v) => (Array.isArray(v) ? v.filter((x) => x != null && String(x).trim() !== '') : []);

/**
 * A goal's auto-funding rule in one normalised shape, whatever it was stored as.
 *
 * `autoParentId` is the phase-1 field (one parent, nothing else) and is still
 * read here rather than migrated away in the maths layer: the store's migration
 * moves it, but a goal restored from an older backup must not quietly stop
 * funding itself while the two shapes coexist.
 */
export const goalAutoRule = (goal) => {
  const rule = goal?.autoRule || {};
  const parentIds = list(rule.parentIds).map(String);
  if (goal?.autoParentId && !parentIds.includes(goal.autoParentId)) parentIds.push(String(goal.autoParentId));
  return {
    parentIds,
    categoryIds: list(rule.categoryIds).map(String),
    merchants: list(rule.merchants).map(merchantKey).filter(Boolean),
  };
};

/** True when the goal funds itself from real spend rather than typed entries. */
export const hasAutoRule = (goal) => {
  const r = goalAutoRule(goal);
  return r.parentIds.length > 0 || r.categoryIds.length > 0 || r.merchants.length > 0;
};

/**
 * Does this transaction fund this rule? `parentId` is the caller's resolved
 * first-level category (the store owns that mapping), so this stays pure.
 */
export const ruleMatchesTxn = (rule, { parentId, categoryId, merchant } = {}) => {
  if (!rule) return false;
  if (parentId && rule.parentIds.includes(String(parentId))) return true;
  if (categoryId && rule.categoryIds.includes(String(categoryId))) return true;
  if (rule.merchants.length > 0) {
    const m = merchantKey(merchant);
    if (m && rule.merchants.some((k) => m.includes(k))) return true;
  }
  return false;
};

/**
 * Has a lifetime target been reached? Targetless goals are never "achieved" —
 * an open-ended emergency fund has no finish line to celebrate, and inventing
 * one would fire a congratulation the user never asked for.
 */
export const goalIsAchieved = (target, saved) => {
  const t = num(target);
  if (t <= 0) return false;
  return num(saved) >= t;
};

/** 0..100 of the way to the lifetime target. 0 when there is no target. */
export const lifetimePct = (target, saved) => {
  const t = num(target);
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num(saved) / t) * 100)));
};
