// =============================================================================
// nudgeFacts — WHEN a nudge-worthy condition is true. One definition each, read
// by both the carousel (homeCards.js) and the push planner, so a card and a push
// about the same thing can never disagree. Takes plain facts, never the store.
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

const monthKeyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const monthsBetween = (fromMk: string, toMk: string): number => {
  const [fy, fm] = fromMk.split('-').map(Number);
  const [ty, tm] = toMk.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
};

// ── Budget not planned for this month ───────────────────────────────────────

/** Months in a row without a plan after which we stop asking — they've chosen. */
export const BUDGET_PLAN_STOP_AFTER_SKIPPED = 2;

/**
 * `lastPlanMonthKey` = the month of a plan worth keeping (pass null when there's
 * none — a user who never budgeted is never asked).
 */
export function budgetMissingFact(input: {
  hasBudget: boolean;
  lastPlanMonthKey: string | null;
  now: number;
}): { monthKey: string; skippedMonths: number } | null {
  if (input.hasBudget || !input.lastPlanMonthKey) return null;
  const monthKey = monthKeyOf(input.now);
  const gap = monthsBetween(input.lastPlanMonthKey, monthKey);
  if (gap < 1) return null;
  const skippedMonths = gap - 1;
  if (skippedMonths >= BUDGET_PLAN_STOP_AFTER_SKIPPED) return null;
  return { monthKey, skippedMonths };
}

// ── Goal behind this month's plan ───────────────────────────────────────────

export const GOAL_FALLBACK_CHECK_DAY = 25;
/** Days after the goal's usual funding day before calling it behind. */
export const GOAL_CHECK_DELAY_DAYS = 3;

/**
 * The day of month a goal's money usually lands: per month, the day of its
 * largest contribution; then the median of the most recent 3 months.
 * `months` is oldest → newest. null when there's no history.
 */
export function usualFundingDay(months: Array<Array<{ day: number; amount: number }>>): number | null {
  const days = months
    .map((m) => [...m].filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount)[0]?.day)
    .filter((d): d is number => typeof d === 'number')
    .slice(-3)
    .sort((a, b) => a - b);
  if (days.length === 0) return null;
  const mid = Math.floor(days.length / 2);
  return days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
}

export const goalCheckDay = (usualDay: number | null | undefined, daysInMonth: number): number =>
  Math.min(usualDay ? usualDay + GOAL_CHECK_DELAY_DAYS : GOAL_FALLBACK_CHECK_DAY, daysInMonth);

export interface GoalMonthFact {
  id: string;
  name: string;
  emoji?: string;
  /** This month's planned figure; 0 = no plan, so never "behind". */
  planned: number;
  funded: number;
  inactive?: boolean;
  usualFundingDay?: number | null;
}

/** Underfunded goals past their check day, largest shortfall first. */
export function goalsBehindPlan(goals: GoalMonthFact[], now: number) {
  const d = new Date(now);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return goals
    .filter((g) => !g.inactive && g.planned > 0 && g.funded < g.planned)
    .map((g) => ({ ...g, shortfall: g.planned - g.funded, checkDay: goalCheckDay(g.usualFundingDay, daysInMonth) }))
    .filter((g) => d.getDate() >= g.checkDay)
    .sort((a, b) => b.shortfall - a.shortfall);
}

// ── One-time goal close to its target ───────────────────────────────────────

export const GOAL_NEAR_RATIO = 0.9;

export function goalsNearTarget(goals: Array<{
  id: string; name: string; emoji?: string; target: number; saved: number; achieved?: boolean; inactive?: boolean;
}>) {
  return goals
    .filter((g) => !g.inactive && !g.achieved && g.target > 0 && g.saved < g.target && g.saved / g.target >= GOAL_NEAR_RATIO)
    .map((g) => ({ ...g, remaining: g.target - g.saved }))
    .sort((a, b) => a.remaining - b.remaining);
}

// ── Review queue worth a reminder ───────────────────────────────────────────

export const REVIEW_MIN_COUNT = 5;
export const REVIEW_STALE_DAYS = 3;
export const REVIEW_COOLDOWN_DAYS = 3;

/**
 * A small queue only counts once it's gone stale. After a reminder, the same
 * queue waits out the cooldown unless it has at least doubled since.
 */
export function reviewReminderFact(input: {
  queue: Array<{ createdAt: string | number }>;
  now: number;
  lastSent?: { at: number; count: number } | null;
}): { count: number; oldestDays: number } | null {
  const count = input.queue.length;
  if (count === 0) return null;
  const oldest = Math.min(...input.queue.map((t) => new Date(t.createdAt).getTime()));
  const ageMs = input.now - oldest;
  if (count < REVIEW_MIN_COUNT && ageMs <= REVIEW_STALE_DAYS * DAY_MS) return null;
  const last = input.lastSent;
  if (last && input.now - last.at < REVIEW_COOLDOWN_DAYS * DAY_MS && count < last.count * 2) return null;
  return { count, oldestDays: Math.floor(ageMs / DAY_MS) };
}
