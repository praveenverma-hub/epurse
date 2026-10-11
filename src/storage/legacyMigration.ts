// =============================================================================
// One-time move of the ePurse store from AsyncStorage to SQLite + MMKV.
// docs/STORAGE_MIGRATION.md §6. PURE — the reader and both stores are injected.
//
//   1. Copy the AsyncStorage value AS-IS (not migrated — the normal persist
//      `migrate` runs on hydration, like any upgrade).
//   2. Re-load it through a fresh storage and require EXACT equality. Equal state
//      means every selector gives the same answer.
//   3. Only then mark it done. Any failure wipes the partial copy and reports
//      `failed`; the caller keeps using AsyncStorage and retries next launch.
// The AsyncStorage value is never deleted here.
// =============================================================================

import { createHybridStorage, DEVICE_PREFIX, type StoredValue } from './hybridStorage';
import { ROW_COLLECTIONS, MAP_COLLECTIONS } from './schema';
import type { RecordStore } from './recordStore';
import type { DeviceKv } from './deviceKv';

export const LEGACY_STORE_KEY = '@ePurse:store';
export const MIGRATED_META = 'migratedFromAsyncStorageAt';

export type MigrationResult =
  | { status: 'already' }
  | { status: 'fresh' }
  | { status: 'migrated'; counts: Record<string, number> }
  | { status: 'failed'; reason: string };

// Key-order-independent JSON; `undefined` dropped, as JSON storage drops it.
const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
    : val));

/** What the new storage SHOULD give back: every collection present, empty if missing. */
function expectedState(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...state };
  for (const c of ROW_COLLECTIONS) if (!Array.isArray(out[c])) out[c] = [];
  for (const c of MAP_COLLECTIONS) if (!out[c] || typeof out[c] !== 'object' || Array.isArray(out[c])) out[c] = {};
  return out;
}

async function clearNewStorage(records: RecordStore, device: DeviceKv) {
  await records.wipe();
  for (const k of device.getAllKeys()) if (k.startsWith(DEVICE_PREFIX)) device.remove(k);
}

export async function migrateFromLegacy(opts: {
  readLegacy: () => Promise<string | null>;
  records: RecordStore;
  device: DeviceKv;
  now?: () => string;
}): Promise<MigrationResult> {
  const { readLegacy, records, device, now = () => new Date().toISOString() } = opts;
  const meta = await records.readMeta();
  if (meta[MIGRATED_META]) return { status: 'already' };

  let raw: string | null;
  try { raw = await readLegacy(); } catch (e) { return { status: 'failed', reason: `read: ${(e as Error)?.message}` }; }
  if (raw == null) {
    await records.apply({ meta: { [MIGRATED_META]: now() } });
    return { status: 'fresh' };
  }

  let value: StoredValue;
  try {
    value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !value.state || typeof value.state !== 'object') throw new Error('no state');
  } catch (e) {
    // Today's app would fail to hydrate this too — stay on it, don't guess.
    return { status: 'failed', reason: `parse: ${(e as Error)?.message}` };
  }

  try {
    // A previous attempt may have died midway: start from empty.
    await clearNewStorage(records, device);
    const writer = createHybridStorage({ records, device, flushDelayMs: 0 });
    await writer.getItem(LEGACY_STORE_KEY);
    writer.setItem(LEGACY_STORE_KEY, value);
    if (!(await writer.flush())) throw new Error('write failed');

    const back = await createHybridStorage({ records, device }).getItem(LEGACY_STORE_KEY);
    const want = expectedState(value.state);
    if (!back || stable(back.state) !== stable(want)) {
      const got = back ? JSON.parse(stable(back.state)) : {};
      const exp = JSON.parse(stable(want));
      // Key NAMES only — never values (this reason is reported to Sentry).
      const diff = Object.keys({ ...got, ...exp }).filter((k) => stable(got[k]) !== stable(exp[k]));
      throw new Error(`verify mismatch: ${diff.join(', ') || 'state'}`);
    }
    if (typeof value.version === 'number' && back.version !== value.version) throw new Error('verify mismatch: version');

    await records.apply({ meta: { [MIGRATED_META]: now(), legacyVersion: String(value.version ?? '') } });
    const counts: Record<string, number> = {};
    for (const c of ROW_COLLECTIONS) counts[c] = (back.state[c] as unknown[]).length;
    return { status: 'migrated', counts };
  } catch (e) {
    try { await clearNewStorage(records, device); } catch { /* best effort; next launch wipes again */ }
    return { status: 'failed', reason: String((e as Error)?.message ?? e) };
  }
}
