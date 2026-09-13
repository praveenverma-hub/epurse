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
 * `monthsToTarget`'s count turned into the actual calendar month it lands on
 * — "does not provide much clarity" (Sep-14-26): a bare "18 MONTHS TO GO"
 * makes the reader do the arithmetic themselves to find out what month that
 * actually is, and its own text WIDTH grows with how far away the goal is (a
 * tight tile ribbon already truncated it once). An absolute month needs no
 * mental math, reads the same whether checked today or six months from now,
 * and is flat-width regardless of distance — "Sep '27" is no longer than
 * "Sep '26".
 *
 * `short: true` gives the tile-ribbon grain ("Sep '27"); the default gives
 * the full-room grain a detail screen can afford ("September 2027").
 */
export const projectedMonthLabel = (monthsLeft, { short = false, from = new Date() } = {}) => {
  const d = new Date(from.getFullYear(), from.getMonth() + Math.max(0, Math.round(num(monthsLeft))), 1);
  if (!short) return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const mon = d.toLocaleDateString('en-IN', { month: 'short' });
  return `${mon} '${String(d.getFullYear()).slice(-2)}`;
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
    // id/merchant-key -> ISO date it was ADDED to an existing goal. An entry
    // that was there from creation has none and always applies; see `activeAt`.
    addedAt: (rule.addedAt && typeof rule.addedAt === 'object') ? rule.addedAt : {},
  };
};

/**
 * Is this rule entry in force for a transaction dated `at`?
 *
 * Entries the goal was CREATED with have no `addedAt` and always apply. Entries
 * added to an existing goal carry the date they were added and only count from
 * then on — which is what makes widening a live goal safe: the goal's past stays
 * exactly what it was measured as, and the user is told the new category counts
 * from today rather than silently gaining months of backdated spend.
 *
 * A transaction with no usable date is treated as in force, so a malformed row
 * can never be silently dropped from a goal it genuinely matches.
 */
const activeAt = (rule, key, at) => {
  const from = rule?.addedAt?.[key];
  if (!from) return true;
  const fromMs = Date.parse(from);
  const atMs = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(fromMs) || !Number.isFinite(atMs)) return true;
  return atMs >= fromMs;
};

/** True when the goal funds itself from real spend rather than typed entries. */
export const hasAutoRule = (goal) => {
  const r = goalAutoRule(goal);
  return r.parentIds.length > 0 || r.categoryIds.length > 0 || r.merchants.length > 0;
};

/**
 * Does this transaction fund this rule? `parentId` and `childId` are the
 * caller's RESOLVED tree ids (the store owns those mappings), so this stays pure.
 *
 * `categoryIds` is matched against two things, and deliberately holds both kinds
 * of id rather than growing a second field:
 *
 *   • `categoryId` — the flat legacy category on the row. This is how a
 *     sub-category that the PARSER can detect on its own matches (Groceries has
 *     its own legacy id, so a grocery SMS lands on it with no help).
 *   • `childId` — the tree child the row was actually categorised into, from its
 *     `childCategory`. This is how every OTHER sub-category matches: the app
 *     cannot tell Restaurants from Food Delivery in an SMS, but the user can, and
 *     the review queue exists precisely so they do. Once they pick, the goal
 *     reads that choice.
 *
 * `at` is the transaction's date, and gates entries ADDED to a live goal: they
 * count only from the day they were added (see `activeAt`), so widening a goal
 * never backdates spend into it.
 *
 * The two id spaces don't collide in a harmful way — where a child id and a
 * legacy id are the same string (`groceries`, `self`, `lent`, `borrowed`) they
 * mean the same category, so a rule holding it matches a row tagged either way.
 * That is also why no migration was needed: a goal saved as
 * `categoryIds: ['groceries']` keeps working exactly as before.
 */
export const ruleMatchesTxn = (rule, { parentId, categoryId, childId, merchant, at } = {}) => {
  if (!rule) return false;
  const on = (key) => activeAt(rule, key, at);
  const p = parentId && String(parentId);
  if (p && rule.parentIds.includes(p) && on(p)) return true;
  const c = categoryId && String(categoryId);
  if (c && rule.categoryIds.includes(c) && on(c)) return true;
  const ch = childId && String(childId);
  if (ch && rule.categoryIds.includes(ch) && on(ch)) return true;
  if (rule.merchants.length > 0) {
    const m = merchantKey(merchant);
    if (m && rule.merchants.some((k) => m.includes(k) && on(k))) return true;
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
