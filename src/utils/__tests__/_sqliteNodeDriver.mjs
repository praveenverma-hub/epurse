// SqlDriver on better-sqlite3 (devDependency) — runs the app's REAL SQL in Node.
// No SQLCipher here, so encryption itself is only checked on device.
import Database from 'better-sqlite3';

export function openNodeSqlDriver(file = ':memory:') {
  const db = new Database(file);
  let chain = Promise.resolve();
  const tx = {
    run: async (sql, params = []) => { db.prepare(sql).run(...params); },
    prepare: async (sql) => {
      const st = db.prepare(sql);
      return { run: async (params) => { st.run(...params); }, finalize: async () => {} };
    },
  };
  return {
    exec: async (sql) => { db.exec(sql); },
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    // Serialised + all-or-nothing, like expo-sqlite's withExclusiveTransactionAsync.
    transaction: (fn) => {
      const run = chain.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try { await fn(tx); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      });
      chain = run.catch(() => {});
      return run;
    },
    close: async () => { db.close(); },
    raw: db,
  };
}
