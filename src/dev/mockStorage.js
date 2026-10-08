import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOCK_DATA_ENABLED } from '../config/mockData';

// Deliberately ephemeral: never reads, overwrites or deletes the real ledger.
const memory = new Map();
export const mockStorage = {
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => { memory.set(key, value); },
  removeItem: async (key) => { memory.delete(key); },
};
export default MOCK_DATA_ENABLED ? mockStorage : AsyncStorage;
