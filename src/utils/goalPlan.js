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

/** Round to the nearest step, never below zero. */
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
