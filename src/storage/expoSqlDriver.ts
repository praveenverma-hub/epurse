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

  // ONE connection, serialised. NOT withExclusiveTransactionAsync: that opens a second
  // native connection, which never gets the PRAGMA key above — under SQLCipher it can't
  // read the file, so every write silently failed and hydration never finished.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  return {
    exec: (sql) => serial(() => db.execAsync(sql)),
    all: (sql, params = []) => serial(() => db.getAllAsync(sql, params)),
    // `fn` must only use `tx` (calling exec/all from inside would wait on itself).
    transaction: (fn) => serial(async () => {
      await db.execAsync('BEGIN IMMEDIATE;');
      try {
        await fn({
          run: async (sql, params = []) => { await db.runAsync(sql, params); },
          prepare: async (sql) => {
            const st = await db.prepareAsync(sql);
            return { run: async (params) => { await st.executeAsync(params); }, finalize: () => st.finalizeAsync() };
          },
        });
        await db.execAsync('COMMIT;');
      } catch (e) {
        await db.execAsync('ROLLBACK;').catch(() => {});
        throw e;
      }
    }),
    close: () => serial(() => db.closeAsync()),
  };
}
