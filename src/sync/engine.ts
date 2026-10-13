// =============================================================================
// The sync engine: one store subscription that turns ANY change to a live group's
// expenses or people into queued events (sync/expenses.ts planOutgoing), and the
// timers that send them. Installed once by SharedSyncBoot (App.js) AFTER the store
// has loaded — before that, transactions read as empty, and every server expense
// would look deleted.
// =============================================================================

import { AppState } from 'react-native';
import { useEPurseStore } from '../store/ePurseStore';
import type { Group } from '../types/group';
import { planOutgoing } from './expenses';
import { BUILT_IN_CATEGORIES, flushGroup, newSyncId, syncAllSharedGroups } from './groupSync';

/** Wait this long after a change before sending, so a burst (an edit, SMS ingest) goes as one. */
const SEND_DEBOUNCE_MS = 1500;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const scheduleFlush = (groupId: string) => {
  clearTimeout(timers.get(groupId));
  timers.set(groupId, setTimeout(() => {
    timers.delete(groupId);
    flushGroup(groupId).catch(() => {});  // offline: it stays queued for the next trigger
  }, SEND_DEBOUNCE_MS));
};

let installed = false;

export function installSharedSync(): void {
  if (installed) return;
  installed = true;

  let busy = false;
  const check = (s: any, prev: any) => {
    if (busy || (s.transactions === prev?.transactions && s.groups === prev?.groups)) return;
    busy = true;
    try {
      const at = new Date().toISOString();
      for (const g of s.groups as Group[]) {
        if (!g.shared || g.shared.status === 'ended') continue;
        const plan = planOutgoing(g, useEPurseStore.getState().transactions, newSyncId, BUILT_IN_CATEGORIES, at);
        if (!plan) continue;
        (useEPurseStore.getState() as any).setSharedGroupState(g.id, plan.shared, { syncIds: plan.syncIds });
        if ((plan.shared.outbox ?? []).length) scheduleFlush(g.id);
      }
    } finally {
      busy = false;
    }
  };

  useEPurseStore.subscribe(check);
  check(useEPurseStore.getState(), null);  // anything queued while the app was closed

  syncAllSharedGroups().catch(() => {});
  AppState.addEventListener('change', (state) => {
    if (state === 'active') syncAllSharedGroups().catch(() => {});
  });
}
