// =============================================================================
// useRewardStore.ts — gamification state (coins + inventory of premium widgets)
//
// Separate from ePurseStore by design: rewards are a player-progression layer
// on top of financial state, with its own persistence namespace. XP itself
// continues to live in ePurseStore (single source of truth — already wired
// into markReviewed); this store only owns currency + unlocks + toggles.
//
// Inter-store contract: ePurseStore.markReviewed() awards coins here.
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WidgetId = 'liquid_wave' | 'concentric_rings' | 'particle_flame';

export interface InventoryItem {
  id:                   WidgetId;
  name:                 string;
  description:          string;
  emoji:                string;
  cost:                 number;
  minLevelRequirement:  number;
  isUnlocked:           boolean;
  isActive:             boolean;
}

export type PurchaseFailure =
  | 'unknown_item'
  | 'already_owned'
  | 'level_locked'
  | 'insufficient_coins';

export interface PurchaseResult {
  ok:      boolean;
  reason?: PurchaseFailure;
}

interface RewardState {
  coins:      number;
  inventory:  InventoryItem[];

  awardCoins:        (amount: number) => void;
  purchaseItem:      (id: WidgetId, currentLevel: number) => PurchaseResult;
  toggleItemActive:  (id: WidgetId) => void;
  resetRewards:      () => void;
}

// ─── Static config ───────────────────────────────────────────────────────────

export const XP_PER_LEVEL = 1000;

export const DEFAULT_INVENTORY: InventoryItem[] = [
  {
    id:                  'liquid_wave',
    name:                'Fluid Liquid Wave',
    description:         'Living capsule that visualises your daily budget as a flowing wave.',
    emoji:               '🌊',
    cost:                800,
    minLevelRequirement: 3,
    isUnlocked:          false,
    isActive:            false,
  },
  {
    id:                  'concentric_rings',
    name:                'Concentric Spending Rings',
    description:         'Tap-to-expand nested rings for your top 4 categories.',
    emoji:               '🎯',
    cost:                1200,
    minLevelRequirement: 5,
    isUnlocked:          false,
    isActive:            false,
  },
  {
    id:                  'particle_flame',
    name:                'Plasma Streak Flame',
    description:         'Particle-emitting flame badge that evolves with your streak.',
    emoji:               '🔥',
    cost:                1500,
    minLevelRequirement: 7,
    isUnlocked:          false,
    isActive:            false,
  },
];

// ─── Store ───────────────────────────────────────────────────────────────────

export const useRewardStore = create<RewardState>()(
  persist(
    (set, get) => ({
      coins:     0,
      inventory: DEFAULT_INVENTORY,

      awardCoins: (amount) => {
        const n = Math.max(0, Math.floor(amount));
        if (n === 0) return;
        set((s) => ({ coins: s.coins + n }));
      },

      purchaseItem: (id, currentLevel) => {
        const item = get().inventory.find((i) => i.id === id);
        if (!item)                              return { ok: false, reason: 'unknown_item' };
        if (item.isUnlocked)                    return { ok: false, reason: 'already_owned' };
        if (currentLevel < item.minLevelRequirement)
                                                return { ok: false, reason: 'level_locked' };
        if (get().coins < item.cost)            return { ok: false, reason: 'insufficient_coins' };

        set((s) => ({
          coins:     s.coins - item.cost,
          inventory: s.inventory.map((i) =>
            i.id === id ? { ...i, isUnlocked: true, isActive: true } : i,
          ),
        }));
        return { ok: true };
      },

      toggleItemActive: (id) =>
        set((s) => ({
          inventory: s.inventory.map((i) =>
            i.id === id && i.isUnlocked ? { ...i, isActive: !i.isActive } : i,
          ),
        })),

      resetRewards: () => set({ coins: 0, inventory: DEFAULT_INVENTORY }),
    }),
    {
      name:    '@ePurse:rewards',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      migrate: (state: any, version: number) => {
        if (!state || typeof state !== 'object') return state;
        if (version < 2 && Array.isArray(state.inventory)) {
          const rename: Record<string, WidgetId> = {
            spending_rings: 'concentric_rings',
            streak_flame:   'particle_flame',
          };
          state.inventory = state.inventory.map((i: any) =>
            i && rename[i.id] ? { ...i, id: rename[i.id] } : i,
          );
        }
        return state;
      },
      // Ensure inventory always contains the latest static slots (so adding a
      // new shop item in a future release becomes visible without resetting
      // the user's unlocks).
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<RewardState>) ?? {};
        const persistedById = new Map<WidgetId, InventoryItem>();
        (persisted.inventory ?? []).forEach((i) => persistedById.set(i.id, i));
        return {
          ...currentState,
          ...persisted,
          inventory: DEFAULT_INVENTORY.map((slot) => {
            const saved = persistedById.get(slot.id);
            if (!saved) return slot;
            return {
              ...slot,                         // latest name/cost/level/desc
              isUnlocked: !!saved.isUnlocked,  // preserve user state
              isActive:   !!saved.isActive,
            };
          }),
        };
      },
    },
  ),
);

// ─── Pure helpers ────────────────────────────────────────────────────────────

export function levelFromXp(xp: number): number {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL) + 1;
}

export function xpInCurrentLevel(xp: number): number {
  return Math.max(0, xp) % XP_PER_LEVEL;
}

export function xpForNextLevel(xp: number): number {
  return levelFromXp(xp) * XP_PER_LEVEL;
}

export function levelProgressPct(xp: number): number {
  return xpInCurrentLevel(xp) / XP_PER_LEVEL;
}

const LEVEL_TITLES: Array<{ minLevel: number; title: string }> = [
  { minLevel: 12, title: 'Financial Oracle'   },
  { minLevel: 9,  title: 'Wealth Architect'   },
  { minLevel: 7,  title: 'Money Sage'         },
  { minLevel: 5,  title: 'Budgeting Master'   },
  { minLevel: 3,  title: 'Cash Strategist'    },
  { minLevel: 2,  title: 'Habit Builder'      },
  { minLevel: 1,  title: 'Penny Curious'      },
];

export function levelTitle(level: number): string {
  return LEVEL_TITLES.find((t) => level >= t.minLevel)?.title ?? 'Penny Curious';
}

// ─── Selector convenience for components ────────────────────────────────────

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
