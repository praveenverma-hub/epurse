// =============================================================================
// SQLite schema for ePurse user data. PURE (no expo imports) — the Node tests run
// this exact DDL against real SQLite (better-sqlite3).
//
// Each record is its JSON document plus a few indexed columns. Not normalised on
// purpose: splits, group links and the person ledger stay fields on the document,
// exactly as the store uses them. See docs/STORAGE_MIGRATION.md §3.
//
// Rows are keyed by `rid`, NOT the record's own `id`: an old row with no id, or two
// rows sharing one, must still be stored as separate rows (an upsert by `id` would
// silently drop one). `seq` preserves the store's array order.
// =============================================================================

/** PRAGMA user_version. Bump + add a step in migrateSchema when the DDL changes. */
export const SCHEMA_VERSION = 1;

/** Array-valued store keys → table. */
export const ROW_TABLES = {
  transactions: 'txn',
  archivedTransactions: 'archived_txn',
  lentBorrowed: 'lent_borrowed',
  groups: 'grp',
  goalContributions: 'goal_contribution',
} as const;
export type RowCollection = keyof typeof ROW_TABLES;
export const ROW_COLLECTIONS = Object.keys(ROW_TABLES) as RowCollection[];

/** Month-keyed object maps → month_doc.kind. */
export const MAP_KINDS = {
  monthlyAggregates: 'agg',
  budgetHistory: 'budget',
  goalHistory: 'goal',
} as const;
export type MapCollection = keyof typeof MAP_KINDS;
export const MAP_COLLECTIONS = Object.keys(MAP_KINDS) as MapCollection[];

const COMMON = 'rid TEXT PRIMARY KEY, seq REAL NOT NULL, id TEXT, doc TEXT NOT NULL';
const TXN_COLS = 'created_at INTEGER, month TEXT, account_id TEXT, category_id TEXT, group_id TEXT, '
  + 'type TEXT, amount REAL, sms_id TEXT, is_ignored INTEGER';

const txnTable = (t: string) => [
  `CREATE TABLE IF NOT EXISTS ${t} (${COMMON}, ${TXN_COLS});`,
  `CREATE INDEX IF NOT EXISTS ${t}_seq ON ${t}(seq);`,
  `CREATE INDEX IF NOT EXISTS ${t}_month ON ${t}(month);`,
  `CREATE INDEX IF NOT EXISTS ${t}_account ON ${t}(account_id);`,
  `CREATE INDEX IF NOT EXISTS ${t}_group ON ${t}(group_id);`,
  `CREATE INDEX IF NOT EXISTS ${t}_sms ON ${t}(sms_id);`,
];

export const SCHEMA_V1: string[] = [
  ...txnTable('txn'),
  ...txnTable('archived_txn'),
  `CREATE TABLE IF NOT EXISTS lent_borrowed (${COMMON}, kind TEXT, group_id TEXT, created_at INTEGER);`,
  'CREATE INDEX IF NOT EXISTS lent_borrowed_seq ON lent_borrowed(seq);',
  `CREATE TABLE IF NOT EXISTS grp (${COMMON});`,
  'CREATE INDEX IF NOT EXISTS grp_seq ON grp(seq);',
  `CREATE TABLE IF NOT EXISTS goal_contribution (${COMMON}, goal_id TEXT);`,
  'CREATE INDEX IF NOT EXISTS goal_contribution_seq ON goal_contribution(seq);',
  'CREATE TABLE IF NOT EXISTS month_doc (kind TEXT NOT NULL, month TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (kind, month));',
  // Every other backed-up store key, one JSON value each.
  'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, doc TEXT NOT NULL);',
  // Storage bookkeeping (store version, migration marks) — never store keys.
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
];

type Rec = Record<string, any>;

const ms = (v: unknown): number | null => {
  if (v == null) return null;
  const n = new Date(v as string).getTime();
  return Number.isFinite(n) ? n : null;
};
// Same as utils/format.js monthKey (local time) — duplicated to keep this file import-free.
const month = (v: unknown): string | null => {
  const n = ms(v);
  if (n == null) return null;
  const d = new Date(n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Extra indexed columns per table, in DDL order. Values only — never the whole doc. */
export const EXTRA_COLUMNS: Record<RowCollection, { names: string[]; of: (r: Rec) => (string | number | null)[] }> = {
  transactions: { names: ['created_at', 'month', 'account_id', 'category_id', 'group_id', 'type', 'amount', 'sms_id', 'is_ignored'],
    of: (t) => [ms(t.createdAt), month(t.createdAt), str(t.accountId), str(t.categoryId), str(t.groupId),
      str(t.type), num(t.amount), str(t.smsId), t.isIgnored ? 1 : 0] },
  archivedTransactions: { names: [], of: () => [] }, // filled below — same as transactions
  lentBorrowed: { names: ['kind', 'group_id', 'created_at'], of: (l) => [str(l.kind), str(l.groupId), ms(l.createdAt ?? l.date)] },
  groups: { names: [], of: () => [] },
  goalContributions: { names: ['goal_id'], of: (c) => [str(c.goalId)] },
};
EXTRA_COLUMNS.archivedTransactions = EXTRA_COLUMNS.transactions;
