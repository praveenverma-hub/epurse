// =============================================================================
// goalHistory — a goal's closed months and the numbers summarising them. Pure,
// tested in test:goalHistory; GoalDetailScreen's History tab renders it.
//
// A month is "met" when funded ≥ planned. A month with no plan (pure auto-fund)
// counts toward funded totals but not toward met/missed, so it can't pad or
// break the hit rate and streak.
// =============================================================================

export interface GoalMonth {
  monthKey: string;
  planned: number;
  funded: number;
}

export interface GoalHistorySummary {
  months: number;
  planMonths: number;
  metMonths: number;
  /** Consecutive met months, newest first; unplanned months are skipped. */
  streak: number;
  avgFunded: number;
  best: GoalMonth | null;
}

type Snapshot = { perGoal?: Record<string, { planned?: number; funded?: number }> };

/** Closed months for one goal, newest first. */
export function goalMonths(history: Record<string, Snapshot> | null | undefined, goalId: string, currentMonthKey: string): GoalMonth[] {
  return Object.entries(history || {})
    .filter(([mk, snap]) => mk !== currentMonthKey && snap?.perGoal?.[goalId])
    .map(([monthKey, snap]) => ({
      monthKey,
      planned: Number(snap.perGoal![goalId].planned) || 0,
      funded: Number(snap.perGoal![goalId].funded) || 0,
    }))
    .sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
}

export const isMet = (m: GoalMonth) => m.planned > 0 && m.funded >= m.planned;

export function summarizeGoalMonths(months: GoalMonth[]): GoalHistorySummary {
  const planned = months.filter((m) => m.planned > 0);
  let streak = 0;
  for (const m of planned) {
    if (!isMet(m)) break;
    streak++;
  }
  const total = months.reduce((sum, m) => sum + m.funded, 0);
  return {
    months: months.length,
    planMonths: planned.length,
    metMonths: planned.filter(isMet).length,
    streak,
    avgFunded: months.length ? Math.round(total / months.length) : 0,
    best: months.reduce<GoalMonth | null>((b, m) => (m.funded > 0 && (!b || m.funded > b.funded) ? m : b), null),
  };
}
