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
};

export const STORAGE_KEYS = {
  ACCOUNTS: 'accounts',
  TRANSACTIONS: 'transactions',
  CATEGORIES: 'categories',
  LENT_BORROWED: 'lent_borrowed',
};
