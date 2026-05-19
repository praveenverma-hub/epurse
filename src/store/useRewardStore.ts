// =============================================================================
// useRewardStore.ts — the ePurse Aware Run economy (production grade).
//
// State surfaces:
//   • Aware Run (streak) — auto check-in engine, multiplier ladder
//   • Reality Points (RP) — lifetime cumulative progress → drives Profile Level
//   • ePurse Coins (EPC)  — spendable currency for shop unlocks
//   • Daily Review Cap   — anti-grind ceiling, resets on new calendar day
//   • Inventory          — premium widget unlock/toggle state
//   • First-launch flag  — gates the welcome celebration overlay
//
// Architectural rules:
//   1. ALL tunable values come from src/config/rewardConfig.ts. Never inline.
//   2. Date boundaries use local-time calendar days via toCalendarDate().
//   3. Check-in is idempotent within a calendar day (re-launching the app
//      does NOT re-award). It is also hands-free (no user UI required).
//   4. Reviews always succeed for layout-clear purposes; the cap only gates
//      the RP/EPC payout, not the queue-clearance behavior.
//   5. The store persists ALL economy fields except lastCheckInResult (which
//      is transient/ephemeral — used only to surface the on-launch banner).
//   6. resetProgressForNewBuild() exists for migration nukes when shipping
//      this update over an older XP/Coin build.
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  REWARD_CONFIG,
  REWARD_COPY,
  type ShopItemConfig,
  type WidgetId,
  calendarDaysBetween,
  levelFromRP,
  multiplierForStreak,
  toCalendarDate,
} from '../config/rewardConfig';

// ─── Public types ───────────────────────────────────────────────────────────

export type { WidgetId } from '../config/rewardConfig';

export interface InventoryItem extends ShopItemConfig {
  isUnlocked: boolean;
  isActive:   boolean;
}

export type CheckInType =
  | 'SAME_DAY'      // already checked in today — no-op
  | 'NEW_DAY'       // first launch on a new day (consecutive)
  | 'SAVINGS'       // new day AND queue was empty → savings victory
  | 'STREAK_RESET'; // gap > 1 day → streak reset to 1

export interface CheckInResult {
  type:        CheckInType;
  rpAwarded:   number;
  epcAwarded:  number;
  /** Streak value AFTER this check-in. */
  newStreak:   number;
  multiplier:  number;
  /** Pre-formatted banner copy ready for direct display. */
  message:     string;
  /**
   * Optional descriptive line shown beneath the title. When present, the
   * banner uses this instead of the auto-computed RP/EPC earnings tail —
   * useful for non-award banners like the Aware Run intro tap.
   */
  subtitle?:   string;
  /** Timestamp the check-in was recorded (ms since epoch). */
  ts:          number;
}

export interface ReviewResult {
  /** True if this review counted toward earnings (within daily cap). */
  counted:      boolean;
  rpAwarded:    number;
  epcAwarded:   number;
  /** Daily counter AFTER this review. */
  reviewedToday: number;
  /** Convenience copy: "Cap reached — keep clearing!" when counted=false. */
  message?:     string;
}

export type PurchaseFailure =
  | 'unknown_item'
  | 'already_owned'
  | 'level_locked'
  | 'insufficient_funds';

export interface PurchaseResult {
  ok:      boolean;
  reason?: PurchaseFailure;
}

interface RewardState {
  // ── Economy (persisted) ───────────────────────────────────────────────
  awareStreak:        number;
  lastCheckedInDate:  string | null;
  totalRP:            number;
  epcBalance:         number;
  dailyReviewedCount: number;
  lastCapResetDate:   string | null;
  inventory:          InventoryItem[];
  isFirstLaunch:      boolean;

  // ── Transient (NOT persisted) ─────────────────────────────────────────
  lastCheckInResult:  CheckInResult | null;

  // ── Actions ───────────────────────────────────────────────────────────
  checkIn:                  (queuedTransactionCount: number) => CheckInResult;
  recordReview:             () => ReviewResult;
  purchaseItem:             (id: WidgetId) => PurchaseResult;
  toggleItemActive:         (id: WidgetId) => void;
  setFirstLaunchDone:       () => void;
  clearLastCheckInResult:   () => void;
  resetProgressForNewBuild: () => void;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const buildDefaultInventory = (): InventoryItem[] =>
  REWARD_CONFIG.SHOP_ITEMS.map((cfg) => ({
    ...cfg,
    isUnlocked: false,
    isActive:   false,
  }));

const initialState = (): Omit<
  RewardState,
  | 'checkIn'
  | 'recordReview'
  | 'purchaseItem'
  | 'toggleItemActive'
  | 'setFirstLaunchDone'
  | 'clearLastCheckInResult'
  | 'resetProgressForNewBuild'
> => ({
  awareStreak:        REWARD_CONFIG.STREAK_BASELINE,
  lastCheckedInDate:  null,
  totalRP:            0,
  epcBalance:         0,
  dailyReviewedCount: 0,
  lastCapResetDate:   null,
  inventory:          buildDefaultInventory(),
  isFirstLaunch:      true,
  lastCheckInResult:  null,
});

// ─── Store ──────────────────────────────────────────────────────────────────

export const useRewardStore = create<RewardState>()(
  persist(
    (set, get) => ({
      ...initialState(),

      // ─── Check-in engine ─────────────────────────────────────────────
      // Called once on Dashboard mount / app foreground. Idempotent within
      // a calendar day. Decides whether to:
      //   (a) no-op (already checked in today),
      //   (b) increment streak (gap of exactly 1 day),
      //   (c) reset streak to 1 (gap > 1 day),
      //   (d) award the SAVINGS bonus on top of (b)/(c) if queue empty.
      checkIn: (queuedTransactionCount) => {
        const state = get();
        const today = toCalendarDate();
        const gap   = calendarDaysBetween(state.lastCheckedInDate, today);

        // ── Same calendar day → idempotent no-op
        if (gap === 0) {
          const result: CheckInResult = {
            type:       'SAME_DAY',
            rpAwarded:  0,
            epcAwarded: 0,
            newStreak:  state.awareStreak,
            multiplier: multiplierForStreak(state.awareStreak),
            message:    '',
            ts:         Date.now(),
          };
          return result;
        }

        // ── New calendar day: compute new streak value
        const newStreak = gap === 1
          ? state.awareStreak + 1
          : REWARD_CONFIG.STREAK_BASELINE;

        const multiplier = multiplierForStreak(newStreak);
        const isReset    = gap > 1;
        const isSavings  = queuedTransactionCount === 0;

        // ── Compute awards (savings bonus stacks ON TOP of the base check-in)
        let rpAwarded  = 0;
        let epcAwarded = 0;
        let type: CheckInType = isReset ? 'STREAK_RESET' : 'NEW_DAY';

        if (isSavings) {
          rpAwarded  = Math.round(REWARD_CONFIG.SAVINGS_RP_BASE  * multiplier);
          epcAwarded = Math.round(REWARD_CONFIG.SAVINGS_EPC_BASE * multiplier);
          type = 'SAVINGS';
        }

        // ── Banner copy
        let message = '';
        if (type === 'SAVINGS') {
          message =
            `${REWARD_COPY.BANNER_SAVINGS_PREFIX} +${rpAwarded} RP ` +
            `${REWARD_COPY.BANNER_SAVINGS_SUFFIX}`;
        } else if (type === 'STREAK_RESET') {
          message = REWARD_COPY.BANNER_RESET;
        } else {
          // Standard new-day check-in — no auto award; show streak lock-in.
          message =
            `${REWARD_COPY.BANNER_STREAK_PREFIX} ${newStreak} ` +
            `${REWARD_COPY.BANNER_STREAK_SUFFIX}`;
        }

        const result: CheckInResult = {
          type,
          rpAwarded,
          epcAwarded,
          newStreak,
          multiplier,
          message,
          ts: Date.now(),
        };

        // ── Commit state: streak, date, balances, daily counters reset.
        set({
          awareStreak:        newStreak,
          lastCheckedInDate:  today,
          totalRP:            state.totalRP    + rpAwarded,
          epcBalance:         state.epcBalance + epcAwarded,
          dailyReviewedCount: 0,
          lastCapResetDate:   today,
          lastCheckInResult:  result,
        });

        return result;
      },

      // ─── Record a single transaction review ──────────────────────────
      // Always returns; caller can decide whether to render a +RP/+EPC drift.
      // When the daily cap is hit, returns counted:false with zero awards
      // (the queue card still clears on the caller side — that's not our job).
      recordReview: () => {
        const state = get();
        const today = toCalendarDate();

        // ── Defensive: cap counter may not have been reset if checkIn() was
        // skipped (e.g., review fires before mount). Sync on the fly.
        const counterIsStale = state.lastCapResetDate !== today;
        const baseCount      = counterIsStale ? 0 : state.dailyReviewedCount;
        const nextCount      = baseCount + 1;

        // ── Over the daily cap: clear the card, award nothing.
        if (nextCount > REWARD_CONFIG.DAILY_REVIEW_CAP) {
          set({
            dailyReviewedCount: nextCount,
            lastCapResetDate:   today,
          });
          return {
            counted:       false,
            rpAwarded:     0,
            epcAwarded:    0,
            reviewedToday: nextCount,
            message:       REWARD_COPY.CAP_REACHED_HINT,
          };
        }

        // ── Within cap: apply multiplier to base awards.
        const multiplier = multiplierForStreak(state.awareStreak);
        const rpAwarded  = Math.round(REWARD_CONFIG.REVIEW_RP_BASE  * multiplier);
        const epcAwarded = Math.max(
          1,
          Math.round(REWARD_CONFIG.REVIEW_EPC_BASE * multiplier),
        );

        set({
          totalRP:            state.totalRP    + rpAwarded,
          epcBalance:         state.epcBalance + epcAwarded,
          dailyReviewedCount: nextCount,
          lastCapResetDate:   today,
        });

        return {
          counted:       true,
          rpAwarded,
          epcAwarded,
          reviewedToday: nextCount,
        };
      },

      // ─── Shop purchase ───────────────────────────────────────────────
      // Validates both level AND coin requirements before spending EPC.
      purchaseItem: (id) => {
        const state = get();
        const item  = state.inventory.find((i) => i.id === id);

        if (!item)                                                      return { ok: false, reason: 'unknown_item' };
        if (item.isUnlocked)                                            return { ok: false, reason: 'already_owned' };

        const currentLevel = levelFromRP(state.totalRP);
        if (currentLevel < item.minLevelRequirement)                    return { ok: false, reason: 'level_locked' };
        if (state.epcBalance < item.cost)                               return { ok: false, reason: 'insufficient_funds' };

        set({
          epcBalance: state.epcBalance - item.cost,
          inventory:  state.inventory.map((i) =>
            i.id === id ? { ...i, isUnlocked: true, isActive: true } : i,
          ),
        });
        return { ok: true };
      },

      toggleItemActive: (id) =>
        set((s) => ({
          inventory: s.inventory.map((i) =>
            i.id === id && i.isUnlocked ? { ...i, isActive: !i.isActive } : i,
          ),
        })),

      setFirstLaunchDone: () => set({ isFirstLaunch: false }),

      clearLastCheckInResult: () => set({ lastCheckInResult: null }),

      /**
       * Hard wipe — used as the install-time migration nuke when shipping
       * this build over an older XP/Coin format. Preserves nothing.
       */
      resetProgressForNewBuild: () => set({ ...initialState() }),
    }),
    {
      name:    '@ePurse:rewards',
      storage: createJSONStorage(() => AsyncStorage),
      version: 3,
      // Major schema rebuild from v2 → v3 (xp/coins → RP/EPC/Aware Run).
      // We can't safely migrate the old shape; nuke and start fresh.
      migrate: (_persisted, version) => {
        if (version < 3) return initialState();
        return _persisted as RewardState;
      },
      // Strip the transient field on rehydrate, and ensure the inventory
      // always has every current shop slot (so adding items in future
      // releases doesn't require a wipe).
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<RewardState>) ?? {};
        const byId      = new Map<WidgetId, InventoryItem>();
        (persisted.inventory ?? []).forEach((i) => byId.set(i.id, i));

        return {
          ...currentState,
          ...persisted,
          lastCheckInResult: null, // always transient
          inventory: buildDefaultInventory().map((slot) => {
            const saved = byId.get(slot.id);
            if (!saved) return slot;
            return {
              ...slot,                       // latest cost/level/name/desc
              isUnlocked: !!saved.isUnlocked, // preserve user progress
              isActive:   !!saved.isActive,
            };
          }),
        };
      },
      partialize: (state) => ({
        awareStreak:        state.awareStreak,
        lastCheckedInDate:  state.lastCheckedInDate,
        totalRP:            state.totalRP,
        epcBalance:         state.epcBalance,
        dailyReviewedCount: state.dailyReviewedCount,
        lastCapResetDate:   state.lastCapResetDate,
        inventory:          state.inventory,
        isFirstLaunch:      state.isFirstLaunch,
      }) as any,
    },
  ),
);

// ─── Selectors (use these to avoid re-rendering on unrelated changes) ───────

export const selectAwareStreak  = (s: RewardState) => s.awareStreak;
export const selectTotalRP      = (s: RewardState) => s.totalRP;
export const selectEpcBalance   = (s: RewardState) => s.epcBalance;
export const selectFirstLaunch  = (s: RewardState) => s.isFirstLaunch;
export const selectLastCheckIn  = (s: RewardState) => s.lastCheckInResult;
export const selectDailyCount   = (s: RewardState) => s.dailyReviewedCount;
export const selectLevel        = (s: RewardState) => levelFromRP(s.totalRP);

export const selectWidgetActive =
  (id: WidgetId) =>
  (s: RewardState): boolean => {
    const item = s.inventory.find((i) => i.id === id);
    return !!(item?.isUnlocked && item.isActive);
  };

export const selectInventoryItem =
  (id: WidgetId) =>
  (s: RewardState): InventoryItem | undefined =>
    s.inventory.find((i) => i.id === id);

// ─── Re-exports for legacy callsites still importing from this module ───────

export {
  levelFromRP,
  multiplierForStreak,
} from '../config/rewardConfig';

// ─── Backwards-compatibility shims (TEMPORARY) ───────────────────────────────
// Some screens still import these legacy names. Forward to the new helpers so
// nothing breaks while the rename rolls out. Remove once all callsites move.

import {
  levelProgressPct as levelProgressPctFromRP,
  rpForNextLevel,
} from '../config/rewardConfig';

export const levelFromXp        = levelFromRP;
export const xpForNextLevel     = rpForNextLevel;
export const levelProgressPct   = levelProgressPctFromRP;
export const XP_PER_LEVEL       = REWARD_CONFIG.RP_PER_LEVEL;

const LEVEL_TITLES: Array<{ minLevel: number; title: string }> = [
  { minLevel: 12, title: 'Financial Oracle'   },
  { minLevel: 9,  title: 'Wealth Architect'   },
  { minLevel: 7,  title: 'Money Sage'         },
  { minLevel: 5,  title: 'Budgeting Master'   },
  { minLevel: 3,  title: 'Cash Strategist'    },
  { minLevel: 2,  title: 'Habit Builder'      },
  { minLevel: 1,  title: 'Penny Curious'      },
];

export const levelTitle = (level: number): string =>
  LEVEL_TITLES.find((t) => level >= t.minLevel)?.title ?? 'Penny Curious';
