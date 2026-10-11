// =============================================================================
// Storage encryption keys — one for SQLite (SQLCipher), one for MMKV.
//
// Random per install, kept in SecureStore (Android Keystore), never inside the
// stores they unlock. Read synchronously so MMKV can open before first render.
//
// `created: true` means no key existed. If encrypted files already exist at that
// point the old key is gone (Keystore reset, phone-to-phone transfer): those files
// are unreadable and must be set aside, never overwritten — see
// docs/STORAGE_MIGRATION.md §7.
// =============================================================================

import * as SecureStore from 'expo-secure-store';
import { randomBytes } from '../backup/random';
import { DB_KEY_BYTES, KV_KEY_BYTES, bytesToHex, bytesToKvKey, isDbKey, isKvKey } from './keyFormat';

const DB_KEY_NAME = 'epurse_storage_db_key';
const KV_KEY_NAME = 'epurse_storage_kv_key';

export type StorageKey = { value: string; created: boolean };

const cache = new Map<string, StorageKey>();

function getOrCreate(name: string, isValid: (k: unknown) => boolean, make: () => string): StorageKey {
  const hit = cache.get(name);
  if (hit) return hit;
  const existing = SecureStore.getItem(name);
  let key: StorageKey;
  if (existing != null) {
    // A malformed key is NOT replaced: a new one would orphan everything it encrypted.
    if (!isValid(existing)) throw new Error(`Storage key ${name} is malformed.`);
    key = { value: existing, created: false };
  } else {
    key = { value: make(), created: true };
    SecureStore.setItem(name, key.value);
  }
  cache.set(name, key);
  return key;
}

export const getDbKey = (): StorageKey =>
  getOrCreate(DB_KEY_NAME, isDbKey, () => bytesToHex(randomBytes(DB_KEY_BYTES)));

export const getKvKey = (): StorageKey =>
  getOrCreate(KV_KEY_NAME, isKvKey, () => bytesToKvKey(randomBytes(KV_KEY_BYTES)));

/** Delete Account: the keys go with the data they protected. */
export async function deleteStorageKeys(): Promise<void> {
  cache.clear();
  await Promise.all([SecureStore.deleteItemAsync(DB_KEY_NAME), SecureStore.deleteItemAsync(KV_KEY_NAME)]);
}
