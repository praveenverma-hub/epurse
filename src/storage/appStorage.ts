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
import * as Sentry from '@sentry/react-native';
import { createJSONStorage } from 'zustand/middleware';
import { MOCK_DATA_ENABLED } from '../config/mockData';
import { createHybridStorage, type HybridStorage } from './hybridStorage';
import { createSqlRecordStore, createMemoryRecordStore, type RecordStore } from './recordStore';
import { createMemoryDeviceKv, type DeviceKv } from './deviceKv';
import { migrateFromLegacy } from './legacyMigration';
import { openExpoSqlDriver } from './expoSqlDriver';
import { getMmkvDeviceKv } from './mmkvDeviceKv';
import { getDbKey } from './keys';

export type StorageMode = 'hybrid' | 'legacy' | 'unavailable';

const STORE_KV_ID = 'epurse-store';
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
let ready: Promise<void> | null = null;

/** Counts and reasons only — never stored data. */
function report(event: string, extra?: Record<string, unknown>, level: 'error' | 'info' = 'error') {
  try { Sentry.captureMessage(`storage: ${event}`, { level, tags: { storage: event }, extra }); } catch { /* best effort */ }
}
const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);

async function init(name: string): Promise<void> {
  if (MOCK_DATA_ENABLED) {
    hybrid = createHybridStorage({ records: createMemoryRecordStore(), device: createMemoryDeviceKv() });
    backend = hybrid; mode = 'hybrid';
    return;
  }

  let device: DeviceKv;
  try { device = getMmkvDeviceKv(STORE_KV_ID); } catch (e) {
    report('mmkv-open-failed', { message: msg(e) });
    device = createMemoryDeviceKv(); // device-local prefs won't persist this session; user data is unaffected
  }

  let records: RecordStore | null = null;
  try {
    records = createSqlRecordStore(await openExpoSqlDriver(getDbKey().value));
    await records.readMeta();
  } catch (e) {
    report('sqlite-open-failed', { message: msg(e) });
    records = null;
  }

  const legacy = createJSONStorage(() => AsyncStorage) as unknown as Backend;
  if (!records) {
    if (device.getString(DEVICE_MIGRATED)) {
      report('unavailable');
      hybrid = createHybridStorage({ records: createMemoryRecordStore(), device: createMemoryDeviceKv() });
      backend = hybrid; mode = 'unavailable';
    } else {
      backend = legacy; mode = 'legacy';
    }
    return;
  }

  const res = await migrateFromLegacy({ readLegacy: () => AsyncStorage.getItem(name), records, device });
  if (res.status === 'failed') {
    report('migration-failed', { reason: res.reason });
    backend = legacy; mode = 'legacy';
    return;
  }
  if (res.status === 'migrated') report('migrated', { counts: res.counts }, 'info');
  if (!device.getString(DEVICE_MIGRATED)) device.set(DEVICE_MIGRATED, new Date().toISOString());

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
    getItem: async (name: string) => { await ensure(name); return backend!.getItem(name); },
    // Before the backend is chosen this is the pre-hydration default state — drop it.
    setItem: (name: string, value: any) => { if (backend) return backend.setItem(name, value); },
    removeItem: async (name: string) => { await ensure(name); return backend!.removeItem(name); },
  };
}

/** Write anything pending now — call when the app goes to the background. */
export async function flushAppStorage(): Promise<void> {
  if (hybrid) await hybrid.flush();
}

export const getStorageMode = (): StorageMode | null => mode;
