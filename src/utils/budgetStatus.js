// =============================================================================
// budgetStatus — pace verdict + plain-language advice for a budget line
// (the overall total, or a single category). Shared by BudgetScreen's hero
// card and BudgetCategoryDetailScreen so the two screens can never disagree
// about what "on track" means for the same numbers.
// =============================================================================
import { colors } from '../constants/theme';
import { formatCompact } from './format';

export function computeBudgetStatus(pct, daysElapsedPct, hasCap) {
  if (!hasCap)                    return { key: 'neutral', label: 'No total cap',  color: colors.textMuted,      emoji: '·' };
  if (pct >= 100)                 return { key: 'over',     label: 'Over budget',   color: colors.budgetOver,      emoji: '🚨' };
  if (pct > daysElapsedPct + 10)  return { key: 'overPace',  label: 'Over pace',     color: colors.budgetOver,      emoji: '⚠' };
  if (pct > daysElapsedPct + 5)   return { key: 'slow',      label: 'Slow down',     color: colors.budgetNearLimit, emoji: '⚠' };
  return                                  { key: 'on',       label: 'On track',      color: colors.budgetRemaining, emoji: '✅' };
}

/**
 * Heading + one-line suggestion for the status a category is in. Powers the
 * explained status band on BudgetCategoryDetailScreen's hero card.
 */
export function budgetStatusAdvice(status, { remaining = 0, overshoot = 0, daysLeftInMonth = 0 } = {}) {
  const dayRate = daysLeftInMonth > 0 ? Math.round(Math.max(0, remaining) / daysLeftInMonth) : 0;
  switch (status.key) {
    case 'over':
      return {
        heading: 'Over Budget',
        detail: `You've gone ${formatCompact(overshoot)} over this category's cap. Ease off here for the rest of the month to recover.`,
      };
    case 'overPace':
      return {
        heading: 'Over Pace',
        detail: daysLeftInMonth > 0
          ? `You're spending much faster than planned. Keep it under ${formatCompact(dayRate)}/day to land within budget.`
          : `You're spending much faster than planned for this stage of the month.`,
      };
    case 'slow':
      return {
        heading: 'Slow Down',
        detail: daysLeftInMonth > 0
          ? `You're a little ahead of pace. Try to keep it under ${formatCompact(dayRate)}/day for the rest of the month.`
          : `You're a little ahead of pace for this stage of the month.`,
      };
    case 'on':
      return {
        heading: 'On Track',
        detail: daysLeftInMonth > 0
          ? `You're pacing well — you can spend up to ${formatCompact(dayRate)}/day and stay within budget.`
          : `You're pacing well against this category's cap.`,
      };
    default:
      return {
        heading: 'No Cap Set',
        detail: 'Add a cap for this category in your plan to track pace and get suggestions.',
      };
  }
}
