import { create } from 'zustand';
import type { AutoModalId } from '../constants/autoModals';

// An app session lasts for this JS process; tab switches and foregrounding do
// not reset its popup allowance. Pending content remains in the durable stores.
export const usePresentationSession = create<{
  automaticShown: boolean;
  request: { modal: AutoModalId; monthKey?: string } | null;
  /** A screen a notification tap asked for — AppNavigator navigates once it's ready. */
  routeRequest: { name: string; params?: Record<string, unknown> } | null;
  claimAutomatic: () => boolean;
  requestModal: (modal: AutoModalId, monthKey?: string) => void;
  clearRequest: () => void;
  requestRoute: (name: string, params?: Record<string, unknown>) => void;
  clearRouteRequest: () => void;
}>((set, get) => ({
  automaticShown: false,
  request: null,
  routeRequest: null,
  claimAutomatic: () => {
    if (get().automaticShown) return false;
    set({ automaticShown: true });
    return true;
  },
  requestModal: (modal, monthKey) => set({ request: { modal, monthKey } }),
  clearRequest: () => set({ request: null }),
  requestRoute: (name, params) => set({ routeRequest: { name, params } }),
  clearRouteRequest: () => set({ routeRequest: null }),
}));
