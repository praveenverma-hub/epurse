// Lightweight AsyncStorage wrapper used by the Zustand store for persistence.
// AsyncStorage is free, on-device, and ships with Expo — no backend required.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@ePurse:';

export const Storage = {
  async get(key, fallback = null) {
    try {
      const raw = await AsyncStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.warn('Storage.get failed', key, e);
      return fallback;
    }
  },
  async set(key, value) {
    try {
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage.set failed', key, e);
    }
  },
  async remove(key) {
    try {
      await AsyncStorage.removeItem(PREFIX + key);
    } catch (e) {
      console.warn('Storage.remove failed', key, e);
    }
  },
  async clearAll() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const ours = keys.filter((k) => k.startsWith(PREFIX));
      await AsyncStorage.multiRemove(ours);
    } catch (e) {
      console.warn('Storage.clearAll failed', e);
    }
  },
  /**
   * "Delete Account & Data"'s storage half — deliberately NOT `clearAll()`,
   * which only removes keys starting with `PREFIX`. That convention isn't
   * actually followed everywhere: `useNotificationStore`'s persist key is
   * `'ePurse_notifications_v1'` (underscore, no colon), which `clearAll()`
   * would silently leave behind. This app has no third-party AsyncStorage
   * usage to preserve — it's the only thing writing to it — so for a
   * deletion, the bulletproof answer is everything, not a prefix match that
   * can drift out of sync with what a future store actually names its key.
   */
  async wipeEverything() {
    try {
      await AsyncStorage.clear();
    } catch (e) {
      console.warn('Storage.wipeEverything failed', e);
    }
  },
};

export const STORAGE_KEYS = {
  ACCOUNTS: 'accounts',
  TRANSACTIONS: 'transactions',
  CATEGORIES: 'categories',
  LENT_BORROWED: 'lent_borrowed',
};
