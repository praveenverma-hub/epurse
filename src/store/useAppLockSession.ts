import { create } from 'zustand';

// Session-only: authentication must never survive an app restart in storage.
export const useAppLockSession = create<{
  unlocked: boolean;
  setUnlocked: (unlocked: boolean) => void;
}>((set) => ({
  unlocked: false,
  setUnlocked: (unlocked) => set({ unlocked }),
}));
