// Small key-value cache (remote config etc.) on encrypted MMKV (`storage/appKv.ts`).
// A key not yet in MMKV is read once from AsyncStorage, where it lived before
// Oct-2026, and copied across. Async API kept so callers didn't change.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAppKv, wipeAppKvs } from '../storage/appKv';
import { wipeAppStorage } from '../storage/appStorage';

const PREFIX = '@ePurse:';

export const Storage = {
  async get(key, fallback = null) {
    try {
      const kv = getAppKv();
      let raw = kv.getString(PREFIX + key);
      if (raw === undefined) {
        raw = await AsyncStorage.getItem(PREFIX + key);
        if (raw == null) return fallback;
        kv.set(PREFIX + key, raw);
      }
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Storage.get failed', key, e);
      return fallback;
    }
  },
  async set(key, value) {
    try {
      getAppKv().set(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage.set failed', key, e);
    }
  },
  async remove(key) {
    try {
      getAppKv().remove(PREFIX + key);
      await AsyncStorage.removeItem(PREFIX + key);
    } catch (e) {
      console.warn('Storage.remove failed', key, e);
    }
  },
  async clearAll() {
    try {
      const kv = getAppKv();
      kv.getAllKeys().filter((k) => k.startsWith(PREFIX)).forEach((k) => kv.remove(k));
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith(PREFIX)));
    } catch (e) {
      console.warn('Storage.clearAll failed', e);
    }
  },
  /**
   * "Delete Account & Data"'s storage half: every AsyncStorage key (not just this
   * prefix — `useNotificationStore` once used `'ePurse_notifications_v1'`) AND every
   * MMKV value, after emptying the SQLite database (freed pages scrubbed).
   */
  async wipeEverything() {
    try {
      await wipeAppStorage();
    } catch (e) {
      console.warn('Storage.wipeEverything (SQLite) failed', e);
    }
    try {
      await AsyncStorage.clear();
    } catch (e) {
      console.warn('Storage.wipeEverything failed', e);
    }
    try {
      wipeAppKvs();
    } catch (e) {
      console.warn('Storage.wipeEverything (MMKV) failed', e);
    }
  },
};
