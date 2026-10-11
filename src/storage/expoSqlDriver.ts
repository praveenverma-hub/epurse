// SqlDriver on expo-sqlite, encrypted with SQLCipher (app.base.json: expo-sqlite
// `useSQLCipher`). Device only — the Node tests use better-sqlite3 behind the same interface.

import * as SQLite from 'expo-sqlite';
import { dbKeyPragma } from './keyFormat';
import type { SqlDriver } from './sqlDriver';

export const DB_NAME = 'epurse.db';

export async function openExpoSqlDriver(keyHex: string, name: string = DB_NAME): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  // The key must be the first statement on the connection.
  await db.execAsync(dbKeyPragma(keyHex));
  // SQLCipher only checks the key on first read, so read now: a wrong key fails
  // HERE (SQLITE_NOTADB) instead of halfway through hydration.
  await db.getFirstAsync('SELECT count(*) FROM sqlite_master;');
  await db.execAsync('PRAGMA journal_mode = WAL;');

  return {
    exec: (sql) => db.execAsync(sql),
    all: (sql, params = []) => db.getAllAsync(sql, params),
    transaction: (fn) => db.withExclusiveTransactionAsync((txn) => fn({
      run: async (sql, params = []) => { await txn.runAsync(sql, params); },
      prepare: async (sql) => {
        const st = await txn.prepareAsync(sql);
        return { run: async (params) => { await st.executeAsync(params); }, finalize: () => st.finalizeAsync() };
      },
    })),
    close: () => db.closeAsync(),
  };
}
