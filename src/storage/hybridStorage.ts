// =============================================================================
// hybridStorage — a zustand PersistStorage for useEPurseStore.
//
// persist hands setItem the partialized state OBJECT after every set. We diff it by
// REFERENCE against what was last durably written and send only what changed:
//   • backed-up user data   → RecordStore (SQLite), ONE transaction per flush
//   • STORE_KEYS_EXCLUDED   → DeviceKv (MMKV), written immediately
// Flushes are coalesced (flushDelayMs) and serialised. See docs/STORAGE_MIGRATION.md §4–5.
//
// Two rules the store must keep (and the freeze option enforces in tests/dev):
//   1. Never mutate a stored object in place — a changed row must be a new object.
//   2. Rows are matched by reference first, then by `id`, so a changed row keeps its
//      database row (rid) and position.
// PURE — no expo imports; the device wiring passes in the SQL store and MMKV.
// =============================================================================

import { STORE_KEYS_EXCLUDED } from '../backup/payload';
import { ROW_COLLECTIONS, MAP_COLLECTIONS, type RowCollection, type MapCollection } from './schema';
import type { RecordStore, ChangeSet, Row } from './recordStore';
import type { DeviceKv } from './deviceKv';

type State = Record<string, unknown>;
export type StoredValue = { state: State; version?: number };

const DEVICE_KEYS = new Set<string>(STORE_KEYS_EXCLUDED);
const ROW_KEYS = new Set<string>(ROW_COLLECTIONS);
const MAP_KEYS = new Set<string>(MAP_COLLECTIONS);
export const DEVICE_PREFIX = 'store.';
const VERSION_META = 'storeVersion';

type RowEntry = { rid: string; seq: number; id: string | null };
type RowBase = { arr: unknown; byRef: Map<unknown, RowEntry> };
type Base = {
  rows: Map<RowCollection, RowBase>;
  maps: Map<MapCollection, Record<string, unknown>>;
  kv: Map<string, unknown>;
  version: number | undefined;
};

const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null;
const idOf = (v: unknown): string | null => {
  const id = isObj(v) ? (v as { id?: unknown }).id : undefined;
  return id == null ? null : String(id);
};

export function deepFreeze<T>(v: T): T {
  if (!isObj(v) || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  return v;
}

const emptyBase = (): Base => ({
  rows: new Map(ROW_COLLECTIONS.map((c) => [c, { arr: undefined, byRef: new Map() }])),
  maps: new Map(MAP_COLLECTIONS.map((c) => [c, {}])),
  kv: new Map(),
  version: undefined,
});

// ── Row diff ────────────────────────────────────────────────────────────────

export function diffRows(base: RowBase, nextIn: unknown): { upsert: Row[]; remove: string[]; next: RowBase } {
  const next = Array.isArray(nextIn) ? nextIn : [];
  if (nextIn === base.arr) return { upsert: [], remove: [], next: base };

  const n = next.length;
  const kept: (RowEntry | null)[] = new Array(n).fill(null);
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const e = isObj(next[i]) ? base.byRef.get(next[i]) : undefined;
    // The same object twice in one array: the second copy is a separate row.
    if (e && !seen.has(e.rid)) { kept[i] = e; seen.add(e.rid); }
  }

  // Old rows not kept as-is: either changed (same id, new object) or removed.
  const freedById = new Map<string | null, RowEntry[]>();
  const allRids = new Set<string>();
  for (const e of base.byRef.values()) {
    allRids.add(e.rid);
    if (seen.has(e.rid)) continue;
    const list = freedById.get(e.id) ?? [];
    list.push(e);
    freedById.set(e.id, list);
  }

  const taken = new Set<string>(allRids);
  const rids: string[] = new Array(n);
  const reused = new Set<string>();
  for (let i = 0; i < n; i++) {
    if (kept[i]) { rids[i] = kept[i]!.rid; continue; }
    const id = idOf(next[i]);
    const pool = id != null ? freedById.get(id) : undefined;
    if (pool && pool.length) {
      rids[i] = pool.shift()!.rid; // a changed row keeps its database row
      reused.add(rids[i]);
      continue;
    }
    // Fresh rid: never one still in the table, so an upsert can't collide with a delete.
    const stem = id ?? 'row';
    let rid = stem;
    for (let k = 1; taken.has(rid); k++) rid = `${stem}~${k}`;
    taken.add(rid);
    rids[i] = rid;
  }

  // Positions: kept rows keep their seq; new/changed rows slot in between neighbours.
  const seqs: number[] = new Array(n);
  let renumber = false;
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!kept[i]) continue;
    if (kept[i]!.seq <= last) { renumber = true; break; }
    last = kept[i]!.seq;
  }
  if (!renumber) {
    let i = 0;
    while (i < n) {
      if (kept[i]) { seqs[i] = kept[i]!.seq; i++; continue; }
      let j = i;
      while (j < n && !kept[j]) j++;
      const lo = i > 0 ? seqs[i - 1] : -Infinity;
      const hi = j < n ? kept[j]!.seq : Infinity;
      const k = j - i;
      for (let t = 0; t < k; t++) {
        let v: number;
        if (lo === -Infinity && hi === Infinity) v = t;
        else if (lo === -Infinity) v = hi - (k - t);
        else if (hi === Infinity) v = lo + 1 + t;
        else v = lo + ((hi - lo) * (t + 1)) / (k + 1);
        const prev = t === 0 ? lo : seqs[i + t - 1];
        if (!(v > prev && v < hi)) { renumber = true; break; } // float gap exhausted
        seqs[i + t] = v;
      }
      if (renumber) break;
      i = j;
    }
  }
  if (renumber) for (let i = 0; i < n; i++) seqs[i] = i;

  const upsert: Row[] = [];
  const byRef = new Map<unknown, RowEntry>();
  for (let i = 0; i < n; i++) {
    const entry = { rid: rids[i], seq: seqs[i], id: idOf(next[i]) };
    if (renumber || !kept[i]) upsert.push({ rid: entry.rid, seq: entry.seq, value: next[i] });
    if (isObj(next[i]) && !byRef.has(next[i])) byRef.set(next[i], entry);
  }
  const remove: string[] = [];
  for (const list of freedById.values()) for (const e of list) if (!reused.has(e.rid)) remove.push(e.rid);
  return { upsert, remove, next: { arr: nextIn, byRef } };
}

// ── Whole-state diff ────────────────────────────────────────────────────────

export function diffState(base: Base, value: StoredValue): { changes: ChangeSet; next: Base; empty: boolean } {
  const state = value.state || {};
  const changes: ChangeSet = { rows: {}, maps: {}, kv: { upsert: [], remove: [] } };
  const next: Base = { rows: new Map(base.rows), maps: new Map(base.maps), kv: new Map(base.kv), version: base.version };
  let empty = true;

  for (const c of ROW_COLLECTIONS) {
    const d = diffRows(base.rows.get(c)!, state[c]);
    next.rows.set(c, d.next);
    if (d.upsert.length || d.remove.length) { changes.rows![c] = { upsert: d.upsert, remove: d.remove }; empty = false; }
  }
  for (const c of MAP_COLLECTIONS) {
    const prev = base.maps.get(c)!;
    const cur = isObj(state[c]) ? (state[c] as Record<string, unknown>) : {};
    if (cur === prev) continue;
    const upsert = Object.keys(cur).filter((k) => cur[k] !== prev[k] && cur[k] !== undefined).map((k) => ({ key: k, value: cur[k] }));
    const remove = Object.keys(prev).filter((k) => cur[k] === undefined);
    next.maps.set(c, cur);
    if (upsert.length || remove.length) { changes.maps![c] = { upsert, remove }; empty = false; }
  }
  const keys = new Set<string>([...Object.keys(state), ...base.kv.keys()]);
  for (const k of keys) {
    if (ROW_KEYS.has(k) || MAP_KEYS.has(k) || DEVICE_KEYS.has(k)) continue;
    const cur = state[k];
    if (cur === base.kv.get(k)) continue;
    if (cur === undefined) { changes.kv!.remove.push(k); next.kv.delete(k); }
    else { changes.kv!.upsert.push({ key: k, value: cur }); next.kv.set(k, cur); }
    empty = false;
  }
  if (typeof value.version === 'number' && value.version !== base.version) {
    changes.meta = { [VERSION_META]: String(value.version) };
    next.version = value.version;
    empty = false;
  }
  return { changes, next, empty };
}

// ── The PersistStorage ──────────────────────────────────────────────────────

export type HybridStorageOptions = {
  records: RecordStore;
  device: DeviceKv;
  flushDelayMs?: number;
  /** Deep-freeze stored values (tests/dev): an in-place mutation throws instead of never persisting. */
  freeze?: boolean;
  onError?: (e: unknown) => void;
};

export type HybridStorage = {
  getItem(name: string): Promise<StoredValue | null>;
  setItem(name: string, value: StoredValue): void;
  removeItem(name: string): Promise<void>;
  /** Write everything pending now (AppState background, tests). Resolves false if the write failed. */
  flush(): Promise<boolean>;
  isHydrated(): boolean;
};

export function createHybridStorage(opts: HybridStorageOptions): HybridStorage {
  const { records, device, flushDelayMs = 100, freeze = false, onError } = opts;
  let base = emptyBase();
  let deviceBase = new Map<string, unknown>();
  let hydrated = false;
  let latest: StoredValue | null = null;
  let written: StoredValue | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<boolean> = Promise.resolve(true);

  const freezeValue = (v: unknown) => { if (freeze) deepFreeze(v); };

  const writeDevice = (state: State) => {
    for (const k of DEVICE_KEYS) {
      const cur = state[k];
      if (cur === deviceBase.get(k)) continue;
      if (cur === undefined) device.remove(DEVICE_PREFIX + k);
      else device.set(DEVICE_PREFIX + k, JSON.stringify(cur));
      deviceBase.set(k, cur);
    }
  };

  const doFlush = async (): Promise<boolean> => {
    const target = latest;
    if (!target || target === written) return true;
    const { changes, next, empty } = diffState(base, target);
    if (!empty) {
      try {
        await records.apply(changes);
      } catch (e) {
        onError?.(e); // base unchanged → the next flush retries everything still pending
        return false;
      }
      if (freeze) {
        for (const ch of Object.values(changes.rows ?? {})) ch?.upsert.forEach((r) => freezeValue(r.value));
        for (const ch of Object.values(changes.maps ?? {})) ch?.upsert.forEach((m) => freezeValue(m.value));
        changes.kv?.upsert.forEach((u) => freezeValue(u.value));
      }
    }
    base = next;
    written = target;
    return true;
  };

  const flush = (): Promise<boolean> => {
    if (timer) { clearTimeout(timer); timer = null; }
    chain = chain.then(doFlush, doFlush);
    return chain;
  };

  return {
    async getItem() {
      const snap = await records.load();
      const state: State = {};
      base = emptyBase();
      for (const c of ROW_COLLECTIONS) {
        const arr = snap.rows[c].map((r) => r.value);
        const byRef = new Map<unknown, RowEntry>();
        snap.rows[c].forEach((r) => { if (isObj(r.value)) byRef.set(r.value, { rid: r.rid, seq: r.seq, id: idOf(r.value) }); });
        state[c] = arr;
        base.rows.set(c, { arr, byRef });
      }
      for (const c of MAP_COLLECTIONS) { state[c] = snap.maps[c]; base.maps.set(c, snap.maps[c]); }
      for (const [k, v] of Object.entries(snap.kv)) { state[k] = v; base.kv.set(k, v); }
      deviceBase = new Map();
      let anyDevice = false;
      for (const k of DEVICE_KEYS) {
        const raw = device.getString(DEVICE_PREFIX + k);
        if (raw === undefined) continue;
        state[k] = JSON.parse(raw);
        deviceBase.set(k, state[k]);
        anyDevice = true;
      }
      const v = snap.meta[VERSION_META];
      base.version = v === undefined ? undefined : Number(v);
      if (freeze) Object.values(state).forEach(freezeValue);
      hydrated = true;
      const anyRecord = Object.keys(snap.kv).length > 0 || ROW_COLLECTIONS.some((c) => snap.rows[c].length > 0);
      if (base.version === undefined && !anyRecord && !anyDevice) return null; // fresh install
      return { state, version: base.version };
    },

    setItem(_name, value) {
      // Before hydration persist reports the INITIAL (empty) state; writing it would
      // overwrite the stored data with defaults. Hydration replaces it anyway.
      if (!hydrated) return;
      latest = value;
      writeDevice(value.state || {});
      if (!timer) timer = setTimeout(() => { timer = null; flush(); }, flushDelayMs);
    },

    async removeItem() {
      if (timer) { clearTimeout(timer); timer = null; }
      await chain;
      await records.wipe();
      for (const k of DEVICE_KEYS) device.remove(DEVICE_PREFIX + k);
      base = emptyBase();
      deviceBase = new Map();
      latest = written = null;
    },

    flush,
    isHydrated: () => hydrated,
  };
}
