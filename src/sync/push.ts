// =============================================================================
// Push for shared groups (docs/SHARED_GROUP_SYNC.md §7a). The SERVER sends it (trigger
// in 20261015000000_realtime_push.sql, via Expo's push service) with generic text;
// this phone only registers its Expo push token while it wants one:
//   sharing on · Settings → Notifications → Shared Group Activity on · a live group ·
//   notification permission already granted (never asked for here) · a session.
// Otherwise the token is removed from the server, so the switch really stops them.
//
// A build without Firebase's google-services.json can't get a token: that's skipped quietly.
// =============================================================================

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

import { useEPurseStore } from '../store/ePurseStore';
import { pushEnabled } from '../constants/notificationPolicy';
import { DAY_MS } from '../constants/retention';
import { getMmkvDeviceKv } from '../storage/mmkvDeviceKv';
import type { Group } from '../types/group';
import { isSyncConfigured, isSyncEnabled } from './config';
import { hasSyncSession, rpcRegisterPushToken, rpcUnregisterPushToken } from './api';

const KV_ID = 'epurse.sync.push';
const KV_KEY = 'token';
/** Re-register this often while sharing; the server forgets a token unseen for 60 days. */
const REFRESH_MS = DAY_MS;

type Saved = { token: string; at: number };

const kv = () => getMmkvDeviceKv(KV_ID);
const readSaved = (): Saved | null => {
  try {
    const raw = kv().getString(KV_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
};

function wanted(): boolean {
  const s = useEPurseStore.getState() as any;
  return isSyncEnabled()
    && pushEnabled(s.notificationPrefs, 'sharedGroupActivity')
    && (s.groups as Group[]).some((g) => g.shared && g.shared.status !== 'ended');
}

async function deviceToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId || !(await Notifications.getPermissionsAsync()).granted) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;  // no FCM config in this build, or no Play services
  }
}

async function doSync(): Promise<void> {
  if (Platform.OS === 'web' || !isSyncConfigured()) return;
  const saved = readSaved();
  if (!wanted()) {
    if (saved) await unregister(saved.token);
    return;
  }
  if (!(await hasSyncSession())) return;
  const token = await deviceToken();
  if (!token) return;
  if (saved?.token === token && Date.now() - saved.at < REFRESH_MS) return;
  if (saved && saved.token !== token) await unregister(saved.token);
  await rpcRegisterPushToken(token);
  kv().set(KV_KEY, JSON.stringify({ token, at: Date.now() } satisfies Saved));
}

async function unregister(token: string): Promise<void> {
  try {
    if (await hasSyncSession()) await rpcUnregisterPushToken(token);
  } catch {
    // Offline: the server drops it after 60 days unseen.
  }
  kv().remove(KV_KEY);
}

let chain: Promise<void> = Promise.resolve();
const queue = (job: () => Promise<void>) => (chain = chain.then(job, job).catch(() => {}));

/** Registers or removes this phone's push token to match the current settings. Safe to call often. */
export const syncPushRegistration = (): Promise<void> => queue(doSync);

/** Sign-out: stop pushes to this phone while the session can still say so. */
export const unregisterPush = (): Promise<void> => queue(async () => {
  const saved = readSaved();
  if (saved) await unregister(saved.token);
});
