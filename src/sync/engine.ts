// =============================================================================
// The sync engine: one store subscription that turns ANY change to a live group's
// expenses, settlements or people into queued events (sync/expenses.ts planOutgoing), and the
// timers that send them. Installed once by SharedSyncBoot (App.js) AFTER the store
// has loaded — before that, transactions read as empty, and every server expense
// would look deleted.
// =============================================================================

import { AppState } from 'react-native';
import { useEPurseStore } from '../store/ePurseStore';
import type { Group } from '../types/group';
import { planOutgoing } from './expenses';
import { BUILT_IN_CATEGORIES, flushGroup, isRetryable, newSyncId, syncAllSharedGroups } from './groupSync';
import { reconcileRealtime, setRealtimeOpen } from './realtime';
import { syncPushRegistration } from './push';
import { autoLinkGroupMembers, contactLinkedMembers, unlinkedMembers } from './contactLink';

/** Wait this long after a change before sending, so a burst (an edit, SMS ingest) goes as one. */
const SEND_DEBOUNCE_MS = 1500;
/** Then, while it keeps failing and the app is open: about this long between tries (± half, so phones don't retry in step). */
const RETRY_MS = [5_000, 15_000, 60_000, 5 * 60_000];

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const failures = new Map<string, number>();
const scheduleFlush = (groupId: string, delay = SEND_DEBOUNCE_MS) => {
  clearTimeout(timers.get(groupId));
  timers.set(groupId, setTimeout(() => {
    timers.delete(groupId);
    flushGroup(groupId).then(() => { failures.delete(groupId); }, (e) => {
      // In the background it waits for the app to open again (that syncs everything).
      if (!isRetryable(e) || AppState.currentState !== 'active') return;
      const n = failures.get(groupId) ?? 0;
      failures.set(groupId, n + 1);
      const base = RETRY_MS[Math.min(n, RETRY_MS.length - 1)];
      scheduleFlush(groupId, base / 2 + Math.random() * base);
    });
  }, delay));
};

let installed = false;

export function installSharedSync(): void {
  if (installed) return;
  installed = true;

  let busy = false;
  const check = (s: any, prev: any) => {
    if (busy || (s.transactions === prev?.transactions && s.groups === prev?.groups && s.lentBorrowed === prev?.lentBorrowed
      && s.userPhones === prev?.userPhones)) return;
    busy = true;
    try {
      const at = new Date().toISOString();
      for (const g of s.groups as Group[]) {
        if (!g.shared || g.shared.status === 'ended') continue;
        const now = useEPurseStore.getState() as any;
        const plan = planOutgoing(g, now.transactions, newSyncId, BUILT_IN_CATEGORIES, at, now.lentBorrowed, now.userPhones?.[0] ?? null);
        if (!plan) continue;
        const ops = Object.entries(plan.flags).map(([txnId, syncRejected]) => ({ kind: 'flag' as const, txnId, syncRejected }));
        now.setSharedGroupState(g.id, plan.shared, { syncIds: plan.syncIds, lbSyncIds: plan.lbSyncIds, ops });
        if ((plan.shared.outbox ?? []).length) scheduleFlush(g.id);
      }
    } finally {
      busy = false;
    }
  };

  useEPurseStore.subscribe(check);
  check(useEPurseStore.getState(), null);  // anything queued while the app was closed

  // Realtime channels + push token follow the SET of live groups and the push switch —
  // not every sync write, which also replaces `groups`.
  let liveKey = '';
  const followLive = (s: any) => {
    const key = (s.groups as Group[])
      .filter((g) => g.shared && g.shared.status === 'active' && g.shared.myMemberId)
      .map((g) => g.shared!.remoteId).sort().join(',') + `|${s.notificationPrefs?.sharedGroupActivity}`;
    if (key === liveKey) return;
    liveKey = key;
    void reconcileRealtime();
    void syncPushRegistration();
  };
  useEPurseStore.subscribe(followLive);

  // People link to my contacts as soon as their fingerprint arrives — not only when the group
  // is opened — so Home cards and Lent/Borrowed show my contact names too. Keyed per group so
  // ordinary sync writes don't rescan; autoLink itself never asks for contacts permission.
  const linkKeys = new Map<string, string>();
  const followLinks = (s: any) => {
    for (const g of s.groups as Group[]) {
      if (!g.shared) continue;
      const key = `${Object.keys(g.shared.fold.phoneKeys || {}).length}|${unlinkedMembers(g).length}|${contactLinkedMembers(g).length}`;
      if (linkKeys.get(g.id) === key) continue;
      linkKeys.set(g.id, key);
      if ((Object.keys(g.shared.fold.phoneKeys || {}).length && unlinkedMembers(g).length) || contactLinkedMembers(g).length) {
        void autoLinkGroupMembers(g.id);
      }
    }
  };
  useEPurseStore.subscribe(followLinks);
  followLinks(useEPurseStore.getState());

  const pull = (localId: string) => scheduleFlush(localId, 0);
  void setRealtimeOpen(AppState.currentState === 'active', pull);
  followLive(useEPurseStore.getState());
  // A group whose sync failed retries on its own timer, not only on the next change.
  const retryFailed = () => {
    for (const g of (useEPurseStore.getState() as any).groups as Group[]) {
      if (g.shared?.syncFailedAt && g.shared.status !== 'ended' && !timers.has(g.id)) scheduleFlush(g.id, RETRY_MS[0]);
    }
  };
  syncAllSharedGroups().catch(() => {}).finally(retryFailed);
  AppState.addEventListener('change', (state) => {
    void setRealtimeOpen(state === 'active');
    if (state !== 'active') return;
    failures.clear();
    syncAllSharedGroups().catch(() => {}).finally(retryFailed);
    void syncPushRegistration();  // daily refresh, and permission may have just been granted
  });
}
