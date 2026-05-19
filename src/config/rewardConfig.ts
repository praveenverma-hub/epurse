// =============================================================================
// rewardConfig.ts — ONE place for every tunable knob in the Aware Run economy.
//
// Every magic number that defines the gamification loop lives here. To rebalance
// the economy, change values in this file — nothing else.
//
// Naming guide:
//   AWARE_RUN   — the daily-check-in streak (replaces "XP streak")
//   RP          — Reality Points (lifetime progress, drives Level)
//   EPC         — ePurse Coins (spendable currency for shop unlocks)
//   MULTIPLIER  — streak-based earnings booster
//   CAP         — anti-grind ceiling so heavy SMS days don't break the curve
// =============================================================================

import type { ImageSourcePropType } from 'react-native';

// ─── Widget IDs (used as primary key throughout the codebase) ────────────────

export type WidgetId =
  | 'liquid_wave'
  | 'concentric_rings'
  | 'particle_flame';

// ─── Multiplier tier definition ──────────────────────────────────────────────

export interface MultiplierTier {
  /** Inclusive lower bound (day count). */
  minDay:     number;
  /** Inclusive upper bound; use Infinity for the top tier. */
  maxDay:     number;
  /** Earnings booster applied to base RP / EPC awards. */
  multiplier: number;
  /** Short label shown next to the streak chip ("Steady", "Hot", "Veteran"). */
  label:      string;
}

// ─── Inventory item static definition ────────────────────────────────────────

export interface ShopItemConfig {
  id:                  WidgetId;
  name:                string;
  description:         string;
  emoji:               string;
  /** EPC required to purchase. */
  cost:                number;
  /** Profile level required to even see the Buy CTA. */
  minLevelRequirement: number;
  /** Reserved for future image-based shop tiles. */
  thumbnail?:          ImageSourcePropType;
}

// ─── ECONOMY ─────────────────────────────────────────────────────────────────

export const REWARD_CONFIG = {
  // Aware Run engine ─────────────────────────────────────────────────────────
  /** Baseline streak on a fresh install. Spec mandates 1, not 0. */
  STREAK_BASELINE: 1,

  /** Streak multiplier ladder. First match wins (top-down on increasing day). */
  MULTIPLIER_TIERS: [
    { minDay: 1,  maxDay: 5,        multiplier: 1.0, label: 'Warming up' },
    { minDay: 6,  maxDay: 15,       multiplier: 1.2, label: 'Steady'     },
    { minDay: 16, maxDay: Infinity, multiplier: 1.5, label: 'Veteran'    },
  ] as readonly MultiplierTier[],

  // Per-review earning ──────────────────────────────────────────────────────
  /** Base RP awarded per reviewed transaction (before multiplier). */
  REVIEW_RP_BASE:  10,
  /** Base EPC awarded per reviewed transaction (before multiplier). */
  REVIEW_EPC_BASE: 1,

  /** Hard ceiling on rewarded reviews per calendar day. */
  DAILY_REVIEW_CAP: 20,

  // Zero-transaction savings victory ────────────────────────────────────────
  /** Flat RP bonus on a check-in day with zero queued transactions. */
  SAVINGS_RP_BASE:  50,
  /** Flat EPC bonus on a check-in day with zero queued transactions. */
  SAVINGS_EPC_BASE: 5,

  // Level math ──────────────────────────────────────────────────────────────
  /** RP required to advance one level. Level = floor(RP / RP_PER_LEVEL) + 1. */
  RP_PER_LEVEL: 1000,

  // Shop catalogue ──────────────────────────────────────────────────────────
  SHOP_ITEMS: [
    {
      id:                  'liquid_wave',
      name:                'Fluid Liquid Wave',
      description:         'Living capsule that visualises your daily budget as a flowing wave.',
      emoji:               '🌊',
      cost:                600,
      minLevelRequirement: 2,
    },
    {
      id:                  'concentric_rings',
      name:                'Concentric Spending Rings',
      description:         'Tap-to-expand nested rings for your top 4 categories.',
      emoji:               '🎯',
      cost:                1000,
      minLevelRequirement: 4,
    },
    {
      id:                  'particle_flame',
      name:                'Plasma Streak Flame',
      description:         'Particle-emitting flame badge that evolves with your streak.',
      emoji:               '🔥',
      cost:                1200,
      minLevelRequirement: 6,
    },
  ] as readonly ShopItemConfig[],

  // UI tier thresholds ──────────────────────────────────────────────────────
  /** AwareChip switches from horizontal capsule → compact square at this day. */
  CHIP_TIER2_DAYS: 3,

  // Animation cadence ───────────────────────────────────────────────────────
  /** Floating check-in banner hold time before slide-out. */
  BANNER_VISIBLE_MS:   2500,
  /** AwareChip cross-fade dwell on each face (flame ↔ number). */
  CHIP_PHASE_MS:       3000,
  CHIP_FADE_MS:        450,
  /** Welcome modal dwell on screen before auto-slide-down. */
  WELCOME_DWELL_MS:    4500,
} as const;

// ─── COPY (user-facing strings — never hard-coded in components) ─────────────

export const REWARD_COPY = {
  WELCOME_HEADLINE:    '🚀 Day 1 Aware Run Ignited!',
  WELCOME_DESCRIPTION:
    'Welcome to ePurse. Your spending awareness journey begins today. Keep ' +
    'your Review Queue clean every day to earn Reality Points (RP), level ' +
    'up your profile, and unlock beautiful live widgets and custom styles!',
  WELCOME_CTA:         'Got it',

  CAP_HEADLINE:        '🏆 The Mindful Tracking Cap',
  CAP_DESCRIPTION:
    'To ensure sustainable financial habit building and control data ' +
    'inflation, earning is capped at 20 transactions per day. You can ' +
    'continue reviewing items to clear your layout clutter, and your ' +
    'earning capacity resets tomorrow morning!',

  /** Built dynamically: `Day ${n} Locked In! +${rp} RP / +${epc} EPC` */
  BANNER_STREAK_PREFIX:  '✨ Day',
  BANNER_STREAK_SUFFIX:  'Locked In!',
  BANNER_SAVINGS_PREFIX: '🛡️ Zero-Spending Day!',
  BANNER_SAVINGS_SUFFIX: 'Savings Bonus Added',
  BANNER_RESET:          '🌅 New Aware Run started — back to Day 1.',

  CAP_REACHED_HINT:    'Daily earning cap reached — review keeps clearing!',

  // ─── In-shop definitions (tapped via the (i) icons in the hero card) ────
  RP_TITLE:       'Reality Points',
  RP_EYEBROW:     'RP · Lifetime progress',
  RP_BODY:
    'Reality Points measure your lifetime financial-awareness progress. ' +
    'Every reviewed transaction adds RP, and every 1 000 RP unlocks the ' +
    'next Profile Level. Levels gate which premium widgets you can buy.',
  RP_BULLET_EARN_LABEL:  'How you earn it',
  RP_BULLET_EARN_VALUE:  '+10 RP per reviewed transaction · scales with your Aware Run multiplier.',
  RP_BULLET_LEVEL_LABEL: 'Level math',
  RP_BULLET_LEVEL_VALUE: 'Level = floor(Total RP / 1 000) + 1.',

  EPC_TITLE:      'ePurse Coins',
  EPC_EYEBROW:    'EPC · Spendable currency',
  EPC_BODY:
    'ePurse Coins are the currency you spend in the shop to unlock premium ' +
    'widgets. They build slower than RP, so the choice of which widget to ' +
    'buy actually matters.',
  EPC_BULLET_EARN_LABEL:  'How you earn it',
  EPC_BULLET_EARN_VALUE:  '+1 EPC per reviewed transaction · multiplier-boosted at Day 6+ and Day 16+.',
  EPC_BULLET_SAVE_LABEL:  'Bonus path',
  EPC_BULLET_SAVE_VALUE:  '+5 EPC on Zero-Spending check-in days (no SMS queue means a mindful day).',
} as const;

// ─── Derived helpers (pure, side-effect free) ────────────────────────────────

/**
 * Compute the active multiplier for a given streak day.
 * Returns 1.0x if no tier matches (defensive default).
 */
export const multiplierForStreak = (day: number): number => {
  const safe = Math.max(0, Math.floor(day));
  for (const tier of REWARD_CONFIG.MULTIPLIER_TIERS) {
    if (safe >= tier.minDay && safe <= tier.maxDay) return tier.multiplier;
  }
  return 1.0;
};

/**
 * Compute the human label for a given streak day's tier.
 */
export const labelForStreak = (day: number): string => {
  const safe = Math.max(0, Math.floor(day));
  for (const tier of REWARD_CONFIG.MULTIPLIER_TIERS) {
    if (safe >= tier.minDay && safe <= tier.maxDay) return tier.label;
  }
  return REWARD_CONFIG.MULTIPLIER_TIERS[0].label;
};

/**
 * Profile level from cumulative RP.
 * Spec: Level = floor(Total RP / 1000) + 1.
 */
export const levelFromRP = (rp: number): number =>
  Math.floor(Math.max(0, rp) / REWARD_CONFIG.RP_PER_LEVEL) + 1;

/** RP earned within the current level (0 .. RP_PER_LEVEL-1). */
export const rpInCurrentLevel = (rp: number): number =>
  Math.max(0, rp) % REWARD_CONFIG.RP_PER_LEVEL;

/** RP threshold to reach the next level. */
export const rpForNextLevel = (rp: number): number =>
  levelFromRP(rp) * REWARD_CONFIG.RP_PER_LEVEL;

/** Fractional progress (0..1) toward next level. */
export const levelProgressPct = (rp: number): number =>
  rpInCurrentLevel(rp) / REWARD_CONFIG.RP_PER_LEVEL;

// ─── Date helpers (calendar-day boundary, local timezone) ────────────────────

/** Local YYYY-MM-DD for a Date (defaults to now). */
export const toCalendarDate = (d: Date = new Date()): string => {
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Number of calendar days between two YYYY-MM-DD strings.
 * Positive = `b` is later than `a`. Safe to call with null `a`.
 */
export const calendarDaysBetween = (a: string | null, b: string): number => {
  if (!a) return Infinity;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ams = Date.UTC(ay, am - 1, ad);
  const bms = Date.UTC(by, bm - 1, bd);
  return Math.round((bms - ams) / (24 * 60 * 60 * 1000));
};
