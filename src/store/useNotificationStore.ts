// =============================================================================
// useNotificationStore.ts — in-app activity feed for the header bell.
// -----------------------------------------------------------------------------
// Persisted Zustand slice that records events the user should know about:
//   • cc_due                — bank-issued credit-card bill reminders
//   • aware_check_in        — daily Aware Run check-in reward
//   • aware_streak_reset    — Aware Run broken / new streak started
//   • aware_savings_claimed — zero-spend bonus actually credited
//   • level_up              — Profile Level advanced
//
// Rules:
//   1. Each entry has a `dedupeKey`; adding a new entry with an existing key
//      REPLACES the older one (so banks resending updated bill totals just
//      refresh the existing chip).
//   2. Entries older than 15 calendar days are pruned on hydrate and on add.
//   3. Hard cap of 80 entries to keep AsyncStorage lean.
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ──────────────────────────────────────────────────────────────────

export type NotificationKind =
  | 'cc_due'
  | 'aware_check_in'
  | 'aware_streak_reset'
  | 'aware_savings_claimed'
  | 'level_up';

export interface NotificationEntry {
  id:        string;
  kind:      NotificationKind;
  title:     string;
  body:      string;
  /** Stable key used to dedupe (e.g. `cc_due:8907`, `aware_check_in:2026-05-23`). */
  dedupeKey: string;
  /** Epoch ms. */
  createdAt: number;
  isRead:    boolean;
  meta?:     Record<string, unknown>;
}

export interface AddPayload {
  kind:      NotificationKind;
  title:     string;
  body:      string;
  dedupeKey: string;
  meta?:     Record<string, unknown>;
}

interface State {
  entries: NotificationEntry[];

  add:         (p: AddPayload) => void;
  markAllRead: () => void;
  markRead:    (id: string) => void;
  dismiss:     (id: string) => void;
  clearAll:    () => void;
  pruneStale:  () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES     = 80;

// ─── Helpers ────────────────────────────────────────────────────────────────

const newId = (): string =>
  `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const dropStale = (entries: NotificationEntry[]): NotificationEntry[] => {
  const cutoff = Date.now() - FIFTEEN_DAYS_MS;
  return entries.filter((e) => e.createdAt >= cutoff);
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useNotificationStore = create<State>()(
  persist(
    (set, get) => ({
      entries: [],

      add: (p) => {
        const next: NotificationEntry = {
          id:        newId(),
          kind:      p.kind,
          title:     p.title,
          body:      p.body,
          dedupeKey: p.dedupeKey,
          meta:      p.meta,
          createdAt: Date.now(),
          isRead:    false,
        };
        const filtered = dropStale(get().entries)
          .filter((e) => e.dedupeKey !== p.dedupeKey);
        const trimmed  = [next, ...filtered].slice(0, MAX_ENTRIES);
        set({ entries: trimmed });
      },

      markAllRead: () =>
        set({
          entries: get().entries.map((e) => (e.isRead ? e : { ...e, isRead: true })),
        }),

      markRead: (id) =>
        set({
          entries: get().entries.map((e) =>
            e.id === id && !e.isRead ? { ...e, isRead: true } : e,
          ),
        }),

      dismiss: (id) =>
        set({ entries: get().entries.filter((e) => e.id !== id) }),

      clearAll: () => set({ entries: [] }),

      pruneStale: () => set({ entries: dropStale(get().entries) }),
    }),
    {
      name:    'ePurse_notifications_v1',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.pruneStale();
      },
    },
  ),
);

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectNotificationEntries = (s: State): NotificationEntry[] => s.entries;

export const selectHasUnreadNotifications = (s: State): boolean =>
  s.entries.some((e) => !e.isRead);

export const selectUnreadNotificationCount = (s: State): number =>
  s.entries.reduce((n, e) => (e.isRead ? n : n + 1), 0);
