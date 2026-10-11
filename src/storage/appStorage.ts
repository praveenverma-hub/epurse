// =============================================================================
// appStorage — the PersistStorage useEPurseStore actually uses. Picks a backend
// once, on first hydration (docs/STORAGE_MIGRATION.md §6):
//
//   hybrid      SQLite (SQLCipher) + MMKV. Migrates from AsyncStorage first if needed.
//   legacy      AsyncStorage, exactly as before. Only while data has NOT moved yet:
//               SQLite failed to open, or the migration didn't verify. Retried next launch.
//   unavailable Data HAS moved but SQLite won't open (e.g. key lost). Memory only,
//               so nothing is overwritten — and never the stale AsyncStorage copy.
//
// Mock-data mode: memory for both, so it never touches the real files.
// Device only — the Node suites stub this module (see _store-hook.mjs).
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJSONStorage } from 'zustand/middleware';
import { MOCK_DATA_ENABLED } from '../config/mockData';
import { createHybridStorage, type HybridStorage } from './hybridStorage';
import { createSqlRecordStore, createMemoryRecordStore, type RecordStore } from './recordStore';
import { createMemoryDeviceKv, type DeviceKv } from './deviceKv';
import { migrateFromLegacy, MIGRATED_META } from './legacyMigration';
import { openExpoSqlDriver, setAsideDatabase } from './expoSqlDriver';
import { getMmkvDeviceKv } from './mmkvDeviceKv';
import { getDbKey, type StorageKey } from './keys';
import { report, msg } from './report';
import { STORE_KV_ID } from './appKv';

export type StorageMode = 'hybrid' | 'legacy' | 'unavailable';


// Mirrors the SQLite migration mark, so "data has moved" is known even when SQLite won't open.
const DEVICE_MIGRATED = 'storage.migratedAt';

type Backend = {
  getItem(name: string): unknown;
  setItem(name: string, value: any): unknown;
  removeItem(name: string): unknown;
};

let mode: StorageMode | null = null;
let backend: Backend | null = null;
let hybrid: HybridStorage | null = null;
let records: RecordStore | null = null;
let ready: Promise<void> | null = null;
let loadFailed = false;
let recovery: StorageRecovery | null = null;

/** Set when this phone's data couldn't be unlocked and was set aside (see init). */
export type StorageRecovery = { at: string; file: string };
const RECOVERY_META = 'storageRecovery';


async function init(name: string): Promise<void> {
  if (MOCK_DATA_ENABLED) {
    records = createMemoryRecordStore();
    hybrid = createHybridStorage({ records, device: createMemoryDeviceKv() });
    backend = hybrid; mode = 'hybrid';
    return;
  }

  let device: DeviceKv;
  try { device = getMmkvDeviceKv(STORE_KV_ID); } catch (e) {
    report('mmkv-open-failed', { message: msg(e) });
    device = createMemoryDeviceKv(); // device-local prefs won't persist this session; user data is unaffected
  }

  const openSql = async (keyHex: string) => {
    const store = createSqlRecordStore(await openExpoSqlDriver(keyHex));
    await store.readMeta();
    return store;
  };
  let sql: RecordStore | null = null;
  let keyLost = false;
  let dbKey: StorageKey | null = null;
  try {
    dbKey = getDbKey();
    sql = await openSql(dbKey.value);
  } catch (e) {
    report('sqlite-open-failed', { message: msg(e) });
    sql = null;
    // A NEW key, yet a non-empty database that won't open: the key that encrypted it is
    // gone (Keystore reset, phone-to-phone copy), so it can never be read again. Set it
    // aside — never delete — and start a fresh database. The old AsyncStorage copy is
    // NOT used: it's from before the move, so it would show the user stale data.
    if (dbKey?.created) {
      try {
        const file = await setAsideDatabase();
        if (file) {
          keyLost = true;
          sql = await openSql(dbKey.value);
          const at = new Date().toISOString();
          await sql.apply({ meta: { [MIGRATED_META]: at, [RECOVERY_META]: JSON.stringify({ at, file }) } });
          report('key-lost-set-aside', { file });
        }
      } catch (e2) {
        report('set-aside-failed', { message: msg(e2) });
        sql = null;
      }
    }
  }

  const legacy = createJSONStorage(() => AsyncStorage) as unknown as Backend;
  if (!sql) {
    if (keyLost || device.getString(DEVICE_MIGRATED)) {
      report('unavailable');
      records = createMemoryRecordStore();
      hybrid = createHybridStorage({ records, device: createMemoryDeviceKv() });
      backend = hybrid; mode = 'unavailable';
    } else {
      backend = legacy; mode = 'legacy';
    }
    return;
  }

  const res = await migrateFromLegacy({ readLegacy: () => AsyncStorage.getItem(name), records: sql, device });
  if (res.status === 'failed') {
    report('migration-failed', { reason: res.reason });
    backend = legacy; mode = 'legacy';
    return;
  }
  if (res.status === 'migrated') report('migrated', { counts: res.counts }, 'info');
  if (!device.getString(DEVICE_MIGRATED)) device.set(DEVICE_MIGRATED, new Date().toISOString());

  records = sql;
  const rec = (await sql.readMeta())[RECOVERY_META];
  try { recovery = rec ? JSON.parse(rec) : null; } catch { recovery = null; }
  hybrid = createHybridStorage({ records, device, onError: (e) => report('flush-failed', { message: msg(e) }) });
  backend = hybrid; mode = 'hybrid';
}

const ensure = (name: string) => (ready ??= init(name).catch((e) => {
  // Never leave hydration hanging: an unexpected init error falls back to AsyncStorage.
  report('init-failed', { message: msg(e) });
  backend = createJSONStorage(() => AsyncStorage) as unknown as Backend; mode = 'legacy';
}));

export function createAppStorage() {
  return {
    getItem: async (name: string) => {
      await ensure(name);
      try {
        return await backend!.getItem(name);
      } catch (e) {
        // A throw here would leave zustand never "hydrated" — the app stuck on the
        // splash for good. Start empty instead; saves stay blocked (the storage never
        // finished loading), so nothing stored is overwritten.
        report('load-failed', { mode, message: msg(e) });
        loadFailed = true;
        return null;
      }
    },
    // Before the backend is chosen this is the pre-hydration default state — drop it.
    // After a failed load the store holds defaults: never save them over the real data.
    setItem: (name: string, value: any) => { if (backend && !loadFailed) return backend.setItem(name, value); },
    removeItem: async (name: string) => { await ensure(name); return backend!.removeItem(name); },
  };
}

/** Write anything pending now — call when the app goes to the background. */
export async function flushAppStorage(): Promise<void> {
  if (hybrid) await hybrid.flush();
}

export const getStorageMode = (): StorageMode | null => mode;

/**
 * Non-null when the data saved on this phone couldn't be unlocked and the app started
 * fresh. Onboarding uses it to say why, beside its Restore link. A wipe clears it.
 */
export const getStorageRecovery = (): StorageRecovery | null => recovery;

// ── Documents kept beside the store (e.g. the pre-restore snapshot) ─────────
// SQLite meta once the store has moved; AsyncStorage while still in legacy mode.
const ASIDE = 'aside:';

export async function writeAside(key: string, value: string): Promise<void> {
  if (records) await records.apply({ meta: { [ASIDE + key]: value } });
  else await AsyncStorage.setItem(key, value);
}

export async function readAside(key: string): Promise<string | null> {
  if (records) {
    const v = (await records.readMeta())[ASIDE + key];
    if (v !== undefined) return v;
  }
  return AsyncStorage.getItem(key); // also finds one written before the move
}

export async function removeAside(key: string): Promise<void> {
  if (records) await records.apply({ meta: { [ASIDE + key]: null } });
  await AsyncStorage.removeItem(key);
}

/**
 * Delete Account: empty the database (scrubbing freed pages) and this store's MMKV
 * keys. Call AFTER the store has been reset (deleteAllUserData + flushAppStorage).
 * The schema and encryption keys stay — they protect an empty database.
 */
export async function wipeAppStorage(): Promise<void> {
  if (!hybrid || !records) return;
  await hybrid.removeItem('');
  recovery = null;
  // Re-mark as moved: otherwise, if clearing AsyncStorage then failed, the next launch
  // would copy the old AsyncStorage data back over the deleted account.
  await records.apply({ meta: { [MIGRATED_META]: new Date().toISOString() } });
}
