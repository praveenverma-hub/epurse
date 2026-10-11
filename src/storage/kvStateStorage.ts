// =============================================================================
// A zustand StateStorage (string in, string out — wrap with createJSONStorage) on a
// DeviceKv (MMKV), that copies its value from AsyncStorage the first time.
// For the small stores: rewards, notification feed. PURE — reader and kv injected.
//
// Once a key is in MMKV, reads are synchronous, so hydration completes before the
// first render. The one-time copy is verified (read back equal) before it's marked;
// if anything fails, this session uses the AsyncStorage value as-is and the copy is
// retried next launch. The AsyncStorage value is never deleted here.
// =============================================================================

import type { DeviceKv } from './deviceKv';

export const KV_MIGRATED_PREFIX = 'migrated:';

export type StateStorage = {
  getItem(name: string): string | null | Promise<string | null>;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
};

export function createMigratingStateStorage(
  kv: DeviceKv,
  readLegacy: (name: string) => Promise<string | null>,
  onError?: (event: string, e: unknown) => void,
): StateStorage {
  // Keys whose AsyncStorage value couldn't be read: the store is running on DEFAULTS,
  // and writing them would shadow the real value forever. Skip until the next launch.
  const blocked = new Set<string>();
  return {
    getItem(name) {
      const v = kv.getString(name);
      if (v !== undefined) return v;
      if (kv.getString(KV_MIGRATED_PREFIX + name) !== undefined) return null;
      return readLegacy(name).then(
        (legacy) => {
          try {
            if (legacy != null) {
              kv.set(name, legacy);
              if (kv.getString(name) !== legacy) throw new Error('read-back mismatch');
            }
            kv.set(KV_MIGRATED_PREFIX + name, new Date().toISOString());
          } catch (e) {
            // Never leave a bad copy behind: the next launch would read it instead of retrying.
            try { kv.remove(name); } catch { /* retried next launch either way */ }
            onError?.('kv-migration-failed', e);
          }
          return legacy;
        },
        (e) => { blocked.add(name); onError?.('kv-legacy-read-failed', e); return null; },
      );
    },
    setItem(name, value) {
      if (blocked.has(name)) return;
      try { kv.set(name, value); } catch (e) { onError?.('kv-write-failed', e); }
    },
    removeItem(name) {
      try { kv.remove(name); } catch (e) { onError?.('kv-remove-failed', e); }
    },
  };
}
