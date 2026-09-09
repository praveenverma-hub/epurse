// =============================================================================
// goals.ts — what a goal can BE: its kinds, its starter templates, its palette.
//
// Data only. The maths lives in `utils/goalPlan.js` (plain JS so the headless
// test runner can import it); this file is the presentation layer's vocabulary.
//
// Goal categories are deliberately their OWN namespace, not the two-tier spend
// tree. "Emergency Fund" is not a sibling of "Food" — folding them together
// would put savings buckets into the category picker every transaction uses.
// The one crossing point is `autoParentId`, which names a spend parent whose
// debits COUNT TOWARD a goal (a SIP debit funds the SIP goal) — a read, never a
// merge.
// =============================================================================

import type { Ionicons } from '@expo/vector-icons';

export const GOAL_KINDS = {
  SAVING: 'saving',
  INVESTMENT: 'investment',
  LENDING: 'lending',
} as const;

export type GoalKind = typeof GOAL_KINDS[keyof typeof GOAL_KINDS];

type IonIcon = React.ComponentProps<typeof Ionicons>['name'];

interface KindMeta {
  label: string;
  /** Icon for the kind itself (a goal's own emoji is data and wins on the card). */
  icon: IonIcon;
  /** One line explaining the kind when the user is choosing between them. */
  hint: string;
}

export const GOAL_KIND_META: Record<GoalKind, KindMeta> = {
  saving: {
    label: 'Savings',
    icon: 'wallet-outline',
    hint: 'Money set aside — a fund, a trip, a purchase',
  },
  investment: {
    label: 'Investment',
    icon: 'trending-up-outline',
    hint: 'SIPs, stocks, anything you expect to grow',
  },
  lending: {
    label: 'To lend',
    icon: 'people-outline',
    hint: 'Set aside now to lend to someone later',
  },
};

/**
 * Colours a goal can wear. Every one is already used somewhere in the app
 * (investments teal, group indigo, debit-card sky, warning amber…), so a goal
 * never introduces a colour the rest of the app doesn't speak.
 */
export const GOAL_COLORS = [
  '#14B8A6', // teal    — investments
  '#6366F1', // indigo  — groups
  '#0EA5E9', // sky     — debit card
  '#F59E0B', // amber   — warning
  '#F43F5E', // rose
  '#8B5CF6', // violet  — credit card
  '#059669', // emerald — lent
  '#EC4899', // pink
];

export interface GoalTemplate {
  name: string;
  emoji: string;
  kind: GoalKind;
  color: string;
  /** Share of salary to pre-fill when the user taps this template. */
  suggestedPct: number;
  /** Spend parent whose debits auto-fund this goal, when one applies. */
  autoParentId?: string;
}

/**
 * The empty state's launchpad. A blank "name your goal" form asks someone to
 * invent a savings plan from nothing; six named starts with sensible shares
 * turn it into a pick.
 *
 * Percentages are conventional Indian personal-finance starting points, not
 * advice — the user drags them the moment they land on the bar.
 */
export const GOAL_TEMPLATES: GoalTemplate[] = [
  { name: 'Emergency Fund',  emoji: '🛟', kind: 'saving',     color: '#14B8A6', suggestedPct: 15 },
  { name: 'Mutual Fund SIP', emoji: '📈', kind: 'investment', color: '#6366F1', suggestedPct: 10, autoParentId: 'investments' },
  { name: 'Travel',          emoji: '✈️', kind: 'saving',     color: '#0EA5E9', suggestedPct: 5 },
  { name: 'Family Support',  emoji: '🤝', kind: 'lending',    color: '#F59E0B', suggestedPct: 5 },
  { name: 'Home Deposit',    emoji: '🏠', kind: 'saving',     color: '#F43F5E', suggestedPct: 10 },
  { name: 'Education',       emoji: '🎓', kind: 'saving',     color: '#8B5CF6', suggestedPct: 5 },
];

/** Fallback glyph for a goal the user names without picking an emoji. */
export const DEFAULT_GOAL_EMOJI = '🎯';

/** Ceiling on active goals. Past this the bar's segments stop being draggable. */
export const MAX_ACTIVE_GOALS = 8;
