// =============================================================================
// MMKV for the small stores (rewards, notification feed) and the utils/storage
// cache. One encrypted instance, `epurse-app`, separate from the ePurse store's
// device keys (`epurse-store`). Copies each key from AsyncStorage once.
// Mock-data mode: memory, never the real files. Device only — the Node suites stub this module.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOCK_DATA_ENABLED } from '../config/mockData';
import { createMemoryDeviceKv, type DeviceKv } from './deviceKv';
import { createMigratingStateStorage, type StateStorage } from './kvStateStorage';
import { getMmkvDeviceKv } from './mmkvDeviceKv';
import { report, msg } from './report';

export const APP_KV_ID = 'epurse-app';
export const STORE_KV_ID = 'epurse-store';

let appKv: DeviceKv | null = null;
let stateStorage: StateStorage | null = null;

export function getAppKv(): DeviceKv {
  if (appKv) return appKv;
  if (MOCK_DATA_ENABLED) return (appKv = createMemoryDeviceKv());
  try { appKv = getMmkvDeviceKv(APP_KV_ID); } catch (e) {
    report('mmkv-open-failed', { id: APP_KV_ID, message: msg(e) });
    appKv = createMemoryDeviceKv();
  }
  return appKv;
}

/** For `createJSONStorage(() => appStateStorage())`. */
export function appStateStorage(): StateStorage {
  return (stateStorage ??= createMigratingStateStorage(
    getAppKv(),
    (name) => (MOCK_DATA_ENABLED ? Promise.resolve(null) : AsyncStorage.getItem(name)),
    (event, e) => report(event, { message: msg(e) }),
  ));
}

/** Delete Account: every MMKV value, both instances. */
export function wipeAppKvs(): void {
  getAppKv().clearAll();
  if (MOCK_DATA_ENABLED) return;
  try { getMmkvDeviceKv(STORE_KV_ID).clearAll(); } catch (e) { report('mmkv-wipe-failed', { message: msg(e) }); }
}
