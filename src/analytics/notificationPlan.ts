// =============================================================================
// notificationPlan — the pushes the app schedules AHEAD of time. Pure: facts in,
// dated requests (with their copy) out; `planPushes` in notificationPolicy then
// applies the cap / quiet hours / back-off. The store re-plans on every open and
// close, cancelling the previous plan, so a resolved condition simply stops
// being requested.
// =============================================================================

import type { NotificationKind, PushRequest } from '../constants/notificationPolicy';
import { budgetMissingFact, goalsBehindPlan, reviewReminderFact, type GoalMonthFact } from './nudgeFacts';

/** Calendar nudges are planned this far ahead, so a user away for weeks still gets them. */
export const PLAN_HORIZON_DAYS = 31;

export const AT = {
  monthlyRecap: { day: 1, h: 9, m: 30 },
  budgetPlan: { day: 3, h: 19, m: 0 },
  midmonthNudge: { day: 15, h: 10, m: 0 },
  weeklyRecap: { h: 9, m: 30 },
  goalBehind: { h: 19, m: 0 },
  ccCycleHeadsUp: { h: 10, m: 0 },
  reviewReminder: { h: 19, m: 0 },
} as const;

export interface PlannedPush extends PushRequest {
  title: string;
  body: string;
  /** Read by NotificationTapBoot (e.g. `{ type: 'monthly_recap', monthKey }`). */
  data?: Record<string, unknown>;
  channel: 'payments' | 'budget';
  /** Kept with the plan entry — the review cooldown needs the count it was sent at. */
  meta?: { count?: number };
}

export interface PlanFacts {
  now: number;
  /** Any non-ignored transaction in the last 30 days — nobody wants a recap of nothing. */
  hasRecentActivity: boolean;
  monthlyRecapOn: boolean;
  /** `recapMonthHandled` — the recap already shown for this month key. */
  recapMonthHandled: string | null;
  weeklyRecapOn: boolean;
  /** `weeklyRecapHandled` — week-start key `${y}-${m}-${d}` (1-based month). */
  weeklyRecapHandled: string | null;
  /** monthKey of the CURRENT budget, or null. */
  budgetMonthKey: string | null;
  /** Month of a plan worth keeping when there's no current budget (`carryableBudgetPlan`). */
  lastPlanMonthKey: string | null;
  lastMidmonthNudgeMonth: string | null;
  /** This month's goal facts (see nudgeFacts). */
  goals: GoalMonthFact[];
  reviewQueue: Array<{ createdAt: string | number }>;
  reviewLast: { at: number; count: number } | null;
  /** The user's review reminder time, minutes after midnight. Default `AT.reviewReminder`. */
  reviewAtMin?: number;
  /** Credit cards with a learned statement day. */
  cards: Array<{ id: string; label: string; statementDay: number; notifiedMonth: string | null }>;
}

const mk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long' });
const atTime = (y: number, mo: number, day: number, h: number, m: number) => new Date(y, mo, day, h, m, 0, 0).getTime();
const daysIn = (y: number, mo: number) => new Date(y, mo + 1, 0).getDate();
const dateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** This month's and next month's occurrence of a fixed day, if still ahead and inside the horizon. */
const monthlyAt = (now: number, horizon: number, day: number, h: number, m: number) => {
  const d = new Date(now);
  return [0, 1]
    .map((add) => {
      const y = d.getFullYear() + Math.floor((d.getMonth() + add) / 12);
      const mo = (d.getMonth() + add) % 12;
      return atTime(y, mo, Math.min(day, daysIn(y, mo)), h, m);
    })
    .filter((t) => t > now && t <= horizon);
};

/** Today at h:m if still ahead, else tomorrow. */
const nextAt = (now: number, h: number, m: number) => {
  const d = new Date(now);
  const today = atTime(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
  return today > now ? today : atTime(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m);
};

const req = (kind: NotificationKind, key: string, fireAt: number, rest: Omit<PlannedPush, 'kind' | 'key' | 'fireAt'>): PlannedPush =>
  ({ kind, key, fireAt, ...rest });

export function buildPlannedPushes(f: PlanFacts): PlannedPush[] {
  const out: PlannedPush[] = [];
  const horizon = f.now + PLAN_HORIZON_DAYS * 24 * 60 * 60 * 1000;

  // 1st — the month that just closed.
  if (f.monthlyRecapOn && f.hasRecentActivity) {
    for (const t of monthlyAt(f.now, horizon, AT.monthlyRecap.day, AT.monthlyRecap.h, AT.monthlyRecap.m)) {
      const closed = new Date(new Date(t).getFullYear(), new Date(t).getMonth() - 1, 1);
      const closedKey = mk(closed);
      if (f.recapMonthHandled === closedKey) continue;
      out.push(req('monthlyRecap', `recap:${closedKey}`, t, {
        title: `📊 Your ${monthLabel(closed)} recap is ready`,
        body: 'See where your money went last month.',
        data: { type: 'monthly_recap', monthKey: closedKey },
        channel: 'budget',
      }));
    }
  }

  // 3rd — still no budget. Next month starts without one (the rollover clears
  // it), so this month's plan counts as "the last plan" from there.
  for (const t of monthlyAt(f.now, horizon, AT.budgetPlan.day, AT.budgetPlan.h, AT.budgetPlan.m)) {
    const target = mk(new Date(t));
    const hasBudget = f.budgetMonthKey === target;
    const lastPlan = f.budgetMonthKey && f.budgetMonthKey < target ? f.budgetMonthKey : f.lastPlanMonthKey;
    const fact = budgetMissingFact({ hasBudget, lastPlanMonthKey: lastPlan, now: t });
    if (!fact || !lastPlan) continue;
    const [ly, lm] = lastPlan.split('-').map(Number);
    out.push(req('budgetPlan', `budget_missing:${target}`, t, {
      title: `📋 Plan ${monthLabel(new Date(t))}'s budget`,
      body: `Keep ${monthLabel(new Date(ly, lm - 1, 1))}'s plan in one tap, or adjust it.`,
      channel: 'budget',
    }));
  }

  // 15th — only for a month that already has a budget, so only this month.
  if (f.budgetMonthKey === mk(new Date(f.now)) && f.lastMidmonthNudgeMonth !== f.budgetMonthKey) {
    const d = new Date(f.now);
    const t = atTime(d.getFullYear(), d.getMonth(), AT.midmonthNudge.day, AT.midmonthNudge.h, AT.midmonthNudge.m);
    if (t > f.now) {
      out.push(req('midmonthNudge', `midmonth:${f.budgetMonthKey}`, t, {
        title: `🧭 Halfway through ${monthLabel(d)}`,
        body: 'See how your spending pace looks against your budget.',
        channel: 'budget',
      }));
    }
  }

  // Mondays — the week that just ended.
  if (f.weeklyRecapOn && f.hasRecentActivity) {
    const d = new Date(f.now);
    const toMonday = (8 - d.getDay()) % 7;
    for (let w = 0; w < 5; w++) {
      const t = atTime(d.getFullYear(), d.getMonth(), d.getDate() + toMonday + w * 7, AT.weeklyRecap.h, AT.weeklyRecap.m);
      if (t <= f.now || t > horizon) continue;
      const lastWeek = dateKey(t - 7 * 24 * 60 * 60 * 1000);
      if (f.weeklyRecapHandled === lastWeek) continue;
      out.push(req('weeklyRecap', `weekly:${lastWeek}`, t, {
        title: '📅 Your week in spending',
        body: 'See last week’s spending and progress.',
        data: { type: 'weekly_recap' },
        channel: 'budget',
      }));
    }
  }

  // Goal behind plan — the worst one, on its own check day. State-based, so
  // only planned within the current month.
  {
    const d = new Date(f.now);
    const endOfMonth = atTime(d.getFullYear(), d.getMonth(), daysIn(d.getFullYear(), d.getMonth()), 23, 59);
    const candidates = f.goals
      .map((g) => {
        const behindOn = (day: number) => goalsBehindPlan([g], atTime(d.getFullYear(), d.getMonth(), day, 12, 0))[0];
        const b = behindOn(daysIn(d.getFullYear(), d.getMonth()));
        if (!b) return null;
        const checkAt = atTime(d.getFullYear(), d.getMonth(), b.checkDay, AT.goalBehind.h, AT.goalBehind.m);
        return { ...b, fireAt: checkAt > f.now ? checkAt : nextAt(f.now, AT.goalBehind.h, AT.goalBehind.m) };
      })
      .filter((g): g is NonNullable<typeof g> => !!g && g.fireAt <= endOfMonth)
      .sort((a, b) => b.shortfall - a.shortfall);
    const g = candidates[0];
    if (g) {
      out.push(req('goalBehind', `goal_behind:${g.id}:${mk(d)}`, g.fireAt, {
        title: `${g.emoji ? `${g.emoji} ` : ''}${g.name} needs ₹${Math.round(g.shortfall).toLocaleString('en-IN')} more`,
        body: `₹${Math.round(g.funded).toLocaleString('en-IN')} of ₹${Math.round(g.planned).toLocaleString('en-IN')} set aside this month.`,
        channel: 'budget',
      }));
    }
  }

  // Statement day — the cycle just closed.
  for (const c of f.cards) {
    for (const t of monthlyAt(f.now, horizon, c.statementDay, AT.ccCycleHeadsUp.h, AT.ccCycleHeadsUp.m)) {
      const month = mk(new Date(t));
      if (c.notifiedMonth === month) continue;
      out.push(req('ccCycleHeadsUp', `cc_cycle:${c.id}:${month}`, t, {
        title: `💳 ${c.label} cycle closed`,
        body: 'A new statement should arrive soon.',
        channel: 'payments',
      }));
    }
  }

  // Review — the queue as it stood when the app last ran.
  {
    const min = f.reviewAtMin ?? AT.reviewReminder.h * 60 + AT.reviewReminder.m;
    const fireAt = nextAt(f.now, Math.floor(min / 60), min % 60);
    const fact = reviewReminderFact({ queue: f.reviewQueue, now: fireAt, lastSent: f.reviewLast });
    if (fact) {
      out.push(req('reviewReminder', `review:${dateKey(fireAt)}`, fireAt, {
        title: `${fact.count} ${fact.count === 1 ? 'spend needs' : 'spends need'} a category`,
        body: 'A quick sort keeps your monthly reports accurate.',
        channel: 'budget',
        meta: { count: fact.count },
      }));
    }
  }

  return out;
}
