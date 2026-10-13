// =============================================================================
// Realtime pokes (docs/SHARED_GROUP_SYNC.md §7a). While the app is open, one private
// channel per live group, `group:<serverId>`; the server broadcasts `{ seq }` after
// every new event (trigger in 20261015000000_realtime_push.sql) and only members may
// listen. A poke carries nothing else — the phone pulls as usual.
//
// Never signs in by itself: with no session yet there is nothing to listen to.
// =============================================================================

import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEPurseStore } from '../store/ePurseStore';
import type { Group } from '../types/group';
import { isSyncEnabled } from './config';
import type * as TClient from './client';

const client = () => require('./client') as typeof TClient;

/** A burst of pokes (a batch from another phone) pulls once. */
const POKE_DEBOUNCE_MS = 400;

const channels = new Map<string, RealtimeChannel>();  // server group id → channel
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let open = false;
let pulling: (localId: string) => void = () => {};

const liveGroups = (): Group[] =>
  ((useEPurseStore.getState() as any).groups as Group[])
    .filter((g) => g.shared && g.shared.status === 'active' && g.shared.myMemberId);

function onPoke(remoteId: string, seq: unknown) {
  const group = liveGroups().find((g) => g.shared!.remoteId === remoteId);
  if (!group || typeof seq !== 'number' || seq <= group.shared!.fold.seq) return;  // already have it (often my own)
  clearTimeout(timers.get(remoteId));
  timers.set(remoteId, setTimeout(() => { timers.delete(remoteId); pulling(group.id); }, POKE_DEBOUNCE_MS));
}

let reconciling: Promise<void> = Promise.resolve();

/** Listens on exactly the live groups' channels while the app is open; none otherwise. */
export function reconcileRealtime(): Promise<void> {
  reconciling = reconciling.then(doReconcile, doReconcile);
  return reconciling;
}

async function doReconcile() {
  const want = new Set(open && isSyncEnabled() ? liveGroups().map((g) => g.shared!.remoteId) : []);
  if (!want.size && !channels.size) return;  // never loads supabase-js for users who don't share
  const sb = client().getSupabase();
  for (const [id, ch] of channels) {
    if (!want.has(id)) { channels.delete(id); void sb.removeChannel(ch); }
  }
  const missing = [...want].filter((id) => !channels.has(id));
  if (!missing.length) return;
  const { data } = await sb.auth.getSession();
  if (!data.session) return;
  await sb.realtime.setAuth();  // from the session, so it follows token refreshes
  for (const id of missing) {
    const ch = sb.channel(`group:${id}`, { config: { private: true } })
      .on('broadcast', { event: 'poke' }, (msg) => onPoke(id, msg?.payload?.seq))
      .subscribe();
    channels.set(id, ch);
  }
}

/** App foregrounded (true) or backgrounded (false). `pull` = what a poke runs. */
export function setRealtimeOpen(isOpen: boolean, pull?: (localId: string) => void): Promise<void> {
  open = isOpen;
  if (pull) pulling = pull;
  return reconcileRealtime();
}
