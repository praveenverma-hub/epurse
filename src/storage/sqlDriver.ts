// The minimal SQL surface the record store needs. Implemented by expo-sqlite on device
// (expoSqlDriver.ts) and by better-sqlite3 in the Node tests, so the SAME SQL is tested.

export type SqlParam = string | number | null;

export interface SqlStatement {
  run(params: SqlParam[]): Promise<void>;
  finalize(): Promise<void>;
}

export interface SqlTx {
  run(sql: string, params?: SqlParam[]): Promise<void>;
  prepare(sql: string): Promise<SqlStatement>;
}

export interface SqlDriver {
  /** One or more statements, no parameters. */
  exec(sql: string): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Exclusive and all-or-nothing: a throw inside `fn` rolls everything back. */
  transaction(fn: (tx: SqlTx) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
