// SqlDriver on expo-sqlite, encrypted with SQLCipher (app.base.json: expo-sqlite
// `useSQLCipher`). Device only — the Node tests use better-sqlite3 behind the same interface.

import * as SQLite from 'expo-sqlite';
import * as FS from 'expo-file-system/legacy';
import { dbKeyPragma } from './keyFormat';
import type { SqlDriver } from './sqlDriver';

export const DB_NAME = 'epurse.db';

export async function openExpoSqlDriver(keyHex: string, name: string = DB_NAME): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  try {
    // The key must be the first statement on the connection.
    await db.execAsync(dbKeyPragma(keyHex));
    // SQLCipher only checks the key on first read, so read now: a wrong key fails
    // HERE (SQLITE_NOTADB) instead of halfway through hydration.
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master;');
    await db.execAsync('PRAGMA journal_mode = WAL;');
  } catch (e) {
    await db.closeAsync().catch(() => {}); // release the file so it can be set aside
    throw e;
  }

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

/**
 * Move an unreadable database (and its WAL/SHM) aside — never delete it. Returns the
 * new base name, or null if there was no database file (so nothing was unreadable).
 */
export async function setAsideDatabase(name: string = DB_NAME): Promise<string | null> {
  const dir = String(SQLite.defaultDatabaseDirectory).replace(/\/$/, '');
  const base = dir.startsWith('file://') ? dir : `file://${dir}`;
  // An empty file is one this launch's failed open just created — not lost data.
  const main = await FS.getInfoAsync(`${base}/${name}`);
  if (!main.exists || !(main.size > 0)) return null;
  const aside = `${name}.unreadable-${Date.now()}`;
  let moved = false;
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${base}/${name}${suffix}`;
    if (!(await FS.getInfoAsync(from)).exists) continue;
    await FS.moveAsync({ from, to: `${base}/${aside}${suffix}` });
    moved = true;
  }
  return moved ? aside : null;
}
