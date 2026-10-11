// =============================================================================
// RecordStore — where ePurse user data is durably kept. Two implementations with
// ONE contract (the Node suite runs the same checks against both):
//   • createSqlRecordStore(driver) — SQLite (device: expo-sqlite + SQLCipher)
//   • createMemoryRecordStore()    — headless tests
//
// It knows nothing about zustand. The layer above diffs store state into a
// ChangeSet; `apply` writes it in ONE transaction, so a flush is all-or-nothing.
// PURE — no expo imports.
// =============================================================================

import {
  SCHEMA_VERSION, SCHEMA_V1, ROW_TABLES, ROW_COLLECTIONS, MAP_KINDS, MAP_COLLECTIONS, EXTRA_COLUMNS,
  type RowCollection, type MapCollection,
} from './schema';
import type { SqlDriver, SqlParam } from './sqlDriver';

export type Row = { rid: string; seq: number; value: unknown };
type Changes<T> = { upsert: T[]; remove: string[] };

export type ChangeSet = {
  rows?: Partial<Record<RowCollection, Changes<Row>>>;
  maps?: Partial<Record<MapCollection, Changes<{ key: string; value: unknown }>>>;
  kv?: Changes<{ key: string; value: unknown }>;
  meta?: Record<string, string>;
};

export type Snapshot = {
  /** Ordered by seq. */
  rows: Record<RowCollection, Row[]>;
  maps: Record<MapCollection, Record<string, unknown>>;
  kv: Record<string, unknown>;
  meta: Record<string, string>;
};

export interface RecordStore {
  load(): Promise<Snapshot>;
  apply(changes: ChangeSet): Promise<void>;
  /** Bookkeeping only (store version, migration marks) — cheap, no rows loaded. */
  readMeta(): Promise<Record<string, string>>;
  /** Delete Account: every record gone, schema kept. */
  wipe(): Promise<void>;
}

const emptySnapshot = (): Snapshot => ({
  rows: Object.fromEntries(ROW_COLLECTIONS.map((c) => [c, []])) as unknown as Snapshot['rows'],
  maps: Object.fromEntries(MAP_COLLECTIONS.map((c) => [c, {}])) as unknown as Snapshot['maps'],
  kv: {},
  meta: {},
});

/** JSON.stringify, but `undefined` (which it silently drops) is an error, not a lost row. */
const toDoc = (value: unknown, what: string): string => {
  const doc = JSON.stringify(value);
  if (doc === undefined) throw new Error(`Cannot store ${what}: value is not serialisable.`);
  return doc;
};

// ── SQLite ──────────────────────────────────────────────────────────────────

export async function migrateSchema(driver: SqlDriver): Promise<void> {
  const [{ user_version: v } = { user_version: 0 }] =
    await driver.all<{ user_version: number }>('PRAGMA user_version;');
  if (v >= SCHEMA_VERSION) return;
  await driver.transaction(async (tx) => {
    if (v < 1) for (const stmt of SCHEMA_V1) await tx.run(stmt);
    await tx.run(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  });
}

export function createSqlRecordStore(driver: SqlDriver): RecordStore {
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= migrateSchema(driver));

  return {
    async load() {
      await init();
      const snap = emptySnapshot();
      for (const c of ROW_COLLECTIONS) {
        const rows = await driver.all<{ rid: string; seq: number; doc: string }>(
          `SELECT rid, seq, doc FROM ${ROW_TABLES[c]} ORDER BY seq;`);
        snap.rows[c] = rows.map((r) => ({ rid: r.rid, seq: r.seq, value: JSON.parse(r.doc) }));
      }
      const maps = await driver.all<{ kind: string; month: string; doc: string }>(
        'SELECT kind, month, doc FROM month_doc ORDER BY kind, month;');
      const byKind = Object.fromEntries(MAP_COLLECTIONS.map((c) => [MAP_KINDS[c], c])) as Record<string, MapCollection>;
      for (const m of maps) {
        const c = byKind[m.kind];
        if (c) snap.maps[c][m.month] = JSON.parse(m.doc);
      }
      for (const r of await driver.all<{ key: string; doc: string }>('SELECT key, doc FROM kv;')) {
        snap.kv[r.key] = JSON.parse(r.doc);
      }
      for (const r of await driver.all<{ key: string; value: string }>('SELECT key, value FROM meta;')) {
        snap.meta[r.key] = r.value;
      }
      return snap;
    },

    async readMeta() {
      await init();
      const meta: Record<string, string> = {};
      for (const r of await driver.all<{ key: string; value: string }>('SELECT key, value FROM meta;')) meta[r.key] = r.value;
      return meta;
    },

    async apply(changes) {
      await init();
      await driver.transaction(async (tx) => {
        for (const c of ROW_COLLECTIONS) {
          const ch = changes.rows?.[c];
          if (!ch) continue;
          const table = ROW_TABLES[c];
          const extra = EXTRA_COLUMNS[c];
          if (ch.upsert.length) {
            const cols = ['rid', 'seq', 'id', 'doc', ...extra.names];
            const st = await tx.prepare(
              `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')});`);
            try {
              for (const r of ch.upsert) {
                const rec = (r.value ?? {}) as Record<string, any>;
                const params: SqlParam[] = [r.rid, r.seq, rec.id == null ? null : String(rec.id),
                  toDoc(r.value, `${c} row ${r.rid}`), ...extra.of(rec)];
                await st.run(params);
              }
            } finally { await st.finalize(); }
          }
          for (const rid of ch.remove) await tx.run(`DELETE FROM ${table} WHERE rid = ?;`, [rid]);
        }
        for (const c of MAP_COLLECTIONS) {
          const ch = changes.maps?.[c];
          if (!ch) continue;
          for (const { key, value } of ch.upsert) {
            await tx.run('INSERT OR REPLACE INTO month_doc (kind, month, doc) VALUES (?, ?, ?);',
              [MAP_KINDS[c], key, toDoc(value, `${c}.${key}`)]);
          }
          for (const key of ch.remove) {
            await tx.run('DELETE FROM month_doc WHERE kind = ? AND month = ?;', [MAP_KINDS[c], key]);
          }
        }
        for (const { key, value } of changes.kv?.upsert ?? []) {
          await tx.run('INSERT OR REPLACE INTO kv (key, doc) VALUES (?, ?);', [key, toDoc(value, key)]);
        }
        for (const key of changes.kv?.remove ?? []) await tx.run('DELETE FROM kv WHERE key = ?;', [key]);
        for (const [key, value] of Object.entries(changes.meta ?? {})) {
          await tx.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?);', [key, value]);
        }
      });
    },

    async wipe() {
      await init();
      await driver.transaction(async (tx) => {
        for (const c of ROW_COLLECTIONS) await tx.run(`DELETE FROM ${ROW_TABLES[c]};`);
        for (const t of ['month_doc', 'kv', 'meta']) await tx.run(`DELETE FROM ${t};`);
      });
    },
  };
}

// ── Memory ──────────────────────────────────────────────────────────────────
// Stores JSON strings, not objects, so it fails on unserialisable values exactly
// like SQLite would and never hands back a shared reference.

export function createMemoryRecordStore(): RecordStore {
  let rows = new Map<RowCollection, Map<string, { seq: number; doc: string }>>();
  let maps = new Map<MapCollection, Map<string, string>>();
  let kv = new Map<string, string>();
  let meta = new Map<string, string>();
  const reset = () => {
    rows = new Map(ROW_COLLECTIONS.map((c) => [c, new Map()]));
    maps = new Map(MAP_COLLECTIONS.map((c) => [c, new Map()]));
    kv = new Map();
    meta = new Map();
  };
  reset();

  return {
    async load() {
      const snap = emptySnapshot();
      for (const c of ROW_COLLECTIONS) {
        snap.rows[c] = [...rows.get(c)!.entries()]
          .sort((a, b) => a[1].seq - b[1].seq)
          .map(([rid, r]) => ({ rid, seq: r.seq, value: JSON.parse(r.doc) }));
      }
      for (const c of MAP_COLLECTIONS) {
        for (const k of [...maps.get(c)!.keys()].sort()) snap.maps[c][k] = JSON.parse(maps.get(c)!.get(k)!);
      }
      for (const [k, v] of kv) snap.kv[k] = JSON.parse(v);
      for (const [k, v] of meta) snap.meta[k] = v;
      return snap;
    },

    async readMeta() { return Object.fromEntries(meta); },

    async apply(changes) {
      // Stage on copies and swap at the end: a throw midway leaves the store untouched.
      const nRows = new Map([...rows].map(([c, m]) => [c, new Map(m)]));
      const nMaps = new Map([...maps].map(([c, m]) => [c, new Map(m)]));
      const nKv = new Map(kv);
      const nMeta = new Map(meta);
      for (const c of ROW_COLLECTIONS) {
        const ch = changes.rows?.[c];
        if (!ch) continue;
        for (const r of ch.upsert) nRows.get(c)!.set(r.rid, { seq: r.seq, doc: toDoc(r.value, `${c} row ${r.rid}`) });
        for (const rid of ch.remove) nRows.get(c)!.delete(rid);
      }
      for (const c of MAP_COLLECTIONS) {
        const ch = changes.maps?.[c];
        if (!ch) continue;
        for (const { key, value } of ch.upsert) nMaps.get(c)!.set(key, toDoc(value, `${c}.${key}`));
        for (const key of ch.remove) nMaps.get(c)!.delete(key);
      }
      for (const { key, value } of changes.kv?.upsert ?? []) nKv.set(key, toDoc(value, key));
      for (const key of changes.kv?.remove ?? []) nKv.delete(key);
      for (const [k, v] of Object.entries(changes.meta ?? {})) nMeta.set(k, v);
      rows = nRows; maps = nMaps; kv = nKv; meta = nMeta;
    },

    async wipe() { reset(); },
  };
}
