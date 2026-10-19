// =============================================================================
// homeTips — the slides in Home's tip strip, and in what order.
// Pure, like homeCards.js: the Dashboard gathers the facts, this decides which
// earn a slide. A slide only exists when its fact is real.
// =============================================================================

import { formatCompact } from '../utils/format';

export const HOME_TIP_LIMIT = 7;

/** The trim the savings slide models. */
export const SAVE_TRIM = 0.1;
/** Below this yearly saving the slide isn't worth the slot. */
export const SAVE_MIN_YEARLY = 1000;

const monthName = (mk) => {
  const [y, m] = String(mk).split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long' });
};

const goalCarryTip = (carry) => {
  if (!carry?.monthKey) return null;
  return {
    id: 'tip_goal_carry',
    icon: 'flag-outline',
    eyebrow: 'New month',
    title: `${monthName(carry.monthKey)}'s goal split is ready to reuse`,
    cta: "Keep Last Month's Plan",
    action: 'keepGoalPlan',
    /** Shown in the slide's trailing slot, so a tap that WRITES never looks like a link. */
    actionLabel: 'Keep',
  };
};

const saveTip = (top) => {
  if (!top?.name || !(top.total > 0)) return null;
  const yearly = Math.round(top.total * SAVE_TRIM) * 12;
  if (yearly < SAVE_MIN_YEARLY) return null;
  return {
    id: 'tip_save',
    icon: 'trending-down-outline',
    eyebrow: 'Save more',
    title: `Spending 10% less on ${top.name} saves ${formatCompact(yearly)} a year`,
    cta: 'See Insights',
    target: ['Insights'],
  };
};

const lastMonthTip = (lm) => {
  if (!lm?.monthKey || !(lm.spent > 0)) return null;
  const month = monthName(lm.monthKey);
  let vs = '';
  if (lm.prevSpent > 0) {
    const pct = Math.round(((lm.spent - lm.prevSpent) / lm.prevSpent) * 100);
    const [y, m] = lm.monthKey.split('-').map(Number);
    const prev = monthName(`${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`);
    vs = pct === 0 ? `, same as ${prev}` : `, ${Math.abs(pct)}% ${pct < 0 ? 'less' : 'more'} than ${prev}`;
  }
  return {
    id: 'tip_last_month',
    icon: 'calendar-outline',
    eyebrow: 'Last month',
    title: `${month}: ${formatCompact(lm.spent)} spent${vs}`,
    cta: 'See Recap',
    target: ['MonthlyRecapSummary', { monthKey: lm.monthKey }],
  };
};

const subscriptionsTip = (subs) => {
  const list = subs || [];
  const monthly = list.reduce((sum, x) => sum + (x.amount || 0), 0);
  if (list.length === 0 || monthly <= 0) return null;
  return {
    id: 'tip_subscriptions',
    icon: 'repeat-outline',
    eyebrow: 'Subscriptions',
    title: `${list.length} ${list.length === 1 ? 'subscription takes' : 'subscriptions take'} ${formatCompact(monthly)} every month`,
    cta: 'See Insights',
    target: ['Insights'],
  };
};

const rewardsTip = (r) => {
  if (!r || !(r.toNext > 0) || !(r.perReview > 0)) return null;
  return {
    id: 'tip_rewards',
    icon: 'sparkles-outline',
    eyebrow: 'Rewards',
    title: `${r.toNext} RP to Level ${r.nextLevel} — each review earns ${r.perReview}`,
    cta: 'See Rewards',
    target: ['Profile'],
  };
};

/**
 * @param {object} facts
 * @param {{monthKey: string}|null} facts.goalCarry last month's goal plan, when it can be kept
 * @param {{name: string, total: number}|null} facts.lastMonthTop last month's top spend category
 * @param {{monthKey: string, spent: number, prevSpent: number}|null} facts.lastMonth null while Home shows the recap card
 * @param {object[]} facts.subscriptions detectSubscriptions() output
 * @param {{toNext: number, nextLevel: number, perReview: number}|null} facts.rewards
 * @param {string[]} facts.carouselIds ids the carousel is showing — a promo there isn't repeated here
 * @param {object[]} promos PROMO_CARDS; each needs a `tip` line
 */
export function buildHomeTips(facts = {}, promos = [], limit = HOME_TIP_LIMIT) {
  const shown = new Set(facts.carouselIds || []);
  // Facts that change month to month. Rewards and feature tips are fillers: true
  // every day, so on their own they'd keep the strip up permanently, saying the same thing.
  const live = [
    goalCarryTip(facts.goalCarry),
    lastMonthTip(facts.lastMonth),
    saveTip(facts.lastMonthTop),
    shown.has('subscriptions') ? null : subscriptionsTip(facts.subscriptions),
  ].filter(Boolean);
  if (live.length === 0) return [];
  const features = promos
    .filter((p) => p.tip && !shown.has(p.id))
    .map((p) => ({
      id: `tip_${p.id}`,
      icon: p.icon,
      eyebrow: p.eyebrow,
      title: p.tip,
      cta: p.cta,
      target: p.target,
    }));
  return [...live, rewardsTip(facts.rewards), ...features].filter(Boolean).slice(0, limit);
}
