# Storage migration — AsyncStorage → SQLite + MMKV (Step 0)

**Status:** Oct-11-2026 — PRs 1–6 built and tested. Everything persisted now lives in SQLite + MMKV
(ePurse store → `storage/appStorage.ts`; rewards, notification feed, `utils/storage` → `storage/appKv.ts`),
each copied once from AsyncStorage. Remaining: the on-device checks (step 7), then retention (step 8).
**Why:** the retention plan keeps ALL financial history by default (cleanup only by user choice).
Today's storage can't hold that. See [Retention plan](#9-what-this-unblocks).

---

## 1. Today

| Store | Persisted via | Size |
|---|---|---|
| `useEPurseStore` (`@ePurse:store`) | zustand `persist` → `createJSONStorage(AsyncStorage)` | 71 keys, ONE JSON value, schema **v42** |
| `useRewardStore` (`@ePurse:rewards`) | same | small |
| `useNotificationStore` (`ePurse_notifications_v1`) | same | small (15 d / 80 entries) |
| `utils/storage.js` (`@ePurse:*`) | AsyncStorage | remote-config cache |
| `backupService` pre-restore snapshot | AsyncStorage | a full plaintext copy, kept forever |

All three stores import AsyncStorage from `src/dev/mockStorage.js`, which swaps in an in-memory
Map when `MOCK_DATA_ENABLED`.

**Why it can't scale:**
- **6 MB cap.** async-storage on Android defaults its whole DB to 6 MB (`getDatabaseSize()` →
  `6L`); we don't raise it. Measured ~720 B per transaction → a heavy user (300/month) hits the cap
  in ~2 years. After that writes fail **silently** (`Storage.set` only `console.warn`s).
- **Whole-store rewrite.** Every `set()` re-serialises all 71 keys, every transaction included.
- **No encryption at rest.**

## 2. Target

```
              zustand stores  (UNCHANGED — in-memory working set, selectors, 162 actions)
                     │  persist middleware, custom PersistStorage (object in, object out)
          ┌──────────┴──────────────────────────┐
   hybridStorage (ePurseStore)            MMKV createJSONStorage
     │ user data (atomic)   │ device-local   (rewards, notification feed,
     ▼                      ▼                 remote-config cache)
  SQLite (SQLCipher)     MMKV (encrypted)
```

**The rule that decides where a key lives — and it already exists:**
- Every key in `STORE_KEYS` (backed-up user data) + `transactions` + `archivedTransactions`
  → **SQLite**, written in **one SQL transaction per flush**.
- Every key in `STORE_KEYS_EXCLUDED` (device-local) → **MMKV**.
- `test:payload` already asserts every persisted key is in exactly one of those lists, so a new
  key can't be left unrouted.

**Why all user data in SQLite, not just the big collections:** one store action often changes
several keys together — `ingestMessage` writes a transaction, an account balance
(`applyDelta`) and `suppressedSmsIds`; `recordLbEntry` writes a ledger row and a booked txn. Split
across two engines, a crash between writes persists half an action: a balance permanently off by
the amount, or an SMS marked handled whose transaction was never saved (lost forever, since it
won't be re-imported). One SQL transaction makes each flush all-or-nothing.

**MMKV gets:** device-local keys (`googleAccount`, permission flags, `appLockEnabled`, OS
notification ids, `pushLog`, `plannedPushes`, pending modal queues), plus `useRewardStore`,
`useNotificationStore` and the remote-config cache. Independent of the ledger, read synchronously.

## 3. SQLite schema

Each record is stored as its **JSON document plus a few indexed columns**. Not normalised: splits,
group links, the person ledger and review status stay fields on the document, exactly as the store
uses them. That logic is the riskiest in the app and doesn't change. New fields need no schema change.

```sql
-- PRAGMA user_version tracks THIS schema (separate from the zustand store version).
CREATE TABLE txn (               -- also: archived_txn, identical shape
  id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  created_at INTEGER, month TEXT, account_id TEXT, category_id TEXT,
  group_id TEXT, type TEXT, amount REAL, sms_id TEXT, is_ignored INTEGER
);
CREATE INDEX txn_month ON txn(month);       CREATE INDEX txn_account ON txn(account_id);
CREATE INDEX txn_group ON txn(group_id);    CREATE INDEX txn_sms ON txn(sms_id);

CREATE TABLE lent_borrowed (id TEXT PRIMARY KEY, doc TEXT NOT NULL,
  person_key TEXT, kind TEXT, group_id TEXT, created_at INTEGER);
CREATE TABLE grp           (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE goal_contribution (id TEXT PRIMARY KEY, doc TEXT NOT NULL, goal_id TEXT);
CREATE TABLE month_doc (kind TEXT, month TEXT, doc TEXT NOT NULL,  -- monthlyAggregates,
  PRIMARY KEY (kind, month));                                       -- budgetHistory, goalHistory
CREATE TABLE kv (key TEXT PRIMARY KEY, doc TEXT NOT NULL);          -- every other STORE_KEY
```

Phase A doesn't query the indexed columns; they're there so Phase B (§8) needs no schema migration.

## 4. How writes work — `hybridStorage`

A zustand `PersistStorage` (not `createJSONStorage`): `setItem(name, { state, version })` receives
the partialized state **object**, so nothing is stringified up front.

1. **Diff by reference.** Keep the last-flushed reference for each top-level key, and for each
   collection a `Map<id, rowRef>`. The store only ever replaces changed rows (`{ ...t, … }`), so a
   changed row is a new reference. Diffing 36 k rows by reference is ~1 ms. Only changed rows and
   keys are stringified.
2. **Coalesce.** Mark dirty and flush ~100 ms later, plus **immediately on AppState `background`**.
   Flushes run one at a time (promise chain), so order is preserved.
3. **Atomic.** Each flush = one `withExclusiveTransactionAsync`: upsert changed rows and changed kv
   keys, delete removed ids, write the store version. It all commits or none of it does.
4. MMKV keys are written synchronously as they change. They aren't coupled to the ledger, so no
   atomicity is needed.

**Pre-hydration writes are dropped.** `persist` calls `setItem` after every `set`, including any
`set` that lands while `getItem` is still loading, and at that moment the state is the INITIAL
defaults. Writing it would overwrite stored data. `setItem` is a no-op until `getItem` has finished
(test-covered, mutation-verified). Hydration itself uses the raw `set` and only calls `setItem`
after a migration.

**The one assumption, and its guard:** nothing may mutate a stored row in place (a reference diff
can't see it). The store already follows this. `stampAccountMeta` mutates, but only fresh
`newTxn`/`updatedTxn` objects before `set`. **Guard:** in dev and in tests, rows are
`Object.freeze`d after load and after each flush, so an in-place mutation throws in the 850+
store tests instead of silently not persisting.

## 5. How reads work — hydration

`getItem` merges the MMKV device-local keys + every SQLite table (`SELECT doc`, `JSON.parse`) into
one state object and returns `{ state, version }`. Then zustand's `persist` continues as today:
**the existing `migrate` chain (v2…v42) runs unchanged**, `onRehydrateStorage` still rebuilds
`CAT_MAPS`, and `useStoreHydrated` / `hasHydrated` keep their meaning. The splash already waits
for hydration.

**Cost to measure:** loading everything at start-up. At 10 years × 300/month (36 k rows) that's a
JSON.parse of ~25 MB, probably too slow on a mid-range phone. Fine for years, not forever.
Phase B (§8) bounds it.

## 6. One-time migration from AsyncStorage

On the first launch of the new build (no `storage.migratedAt` in MMKV):

1. Read `@ePurse:store` from AsyncStorage as-is (`{ state, version }`). It is **not** migrated
   first; the normal `migrate` runs after hydration, as for any upgrade.
2. Write it through `hybridStorage` (SQLite + MMKV), one transaction.
3. **Verify:** re-load from the new storage and require **deep equality** with what was read
   (stable-stringify both and compare; a one-time cost). Equal state ⇒ every selector equal. Also
   log row counts per table.
4. **Pass** → set `storage.migratedAt`, use the new storage from now on. **The AsyncStorage value is
   NOT deleted**; it stays as a fallback for ~2 releases, then a later release removes it.
5. **Fail** → hydrate from AsyncStorage for this session (the old adapter stays wired as the
   fallback), report a Sentry event with counts only, never data, and retry next launch. The user
   loses nothing.

Same pattern, simpler, for `@ePurse:rewards`, `ePurse_notifications_v1` and `@ePurse:*` (utils) →
MMKV.

### Modes (`appStorage.ts`)
| Situation | Mode | Behaviour |
|---|---|---|
| SQLite opens, migrated (or migrates + verifies now) | `hybrid` | normal |
| SQLite won't open, data NOT moved yet | `legacy` | AsyncStorage exactly as before; retried next launch |
| Migration fails to verify | `legacy` | same; half-copy wiped; Sentry `storage: migration-failed` (key names only) |
| SQLite won't open, data HAS moved (MMKV mirror flag), key still present | `unavailable` | memory only for this session (could be transient), nothing overwritten, stale AsyncStorage copy NOT used; retried next launch |
| **Key lost**: a NEW db key but a NON-EMPTY database that won't open | `hybrid` on a fresh DB | old file moved aside (`epurse.db.unreadable-<ts>` + WAL/SHM, never deleted), fresh DB marked migrated (so stale AsyncStorage is never copied), `storageRecovery` meta set → onboarding shows "COULDN'T OPEN YOUR DATA" above its Restore link. An EMPTY file isn't key loss (a failed first open creates one) |
| Mock-data mode | `hybrid` on memory | never touches real files |

## 7. Encryption, keys, failure modes

- **SQLCipher** via expo-sqlite's config plugin (option name to confirm at install), `PRAGMA key`
  right after open. Expect ~5–15% slower I/O.
- **MMKV** `encryptionKey` (AES-CFB-128).
- **Keys:** random, generated on first launch, stored in **SecureStore** (Android Keystore).
- **Key missing but encrypted data present** (e.g. phone-to-phone transfer, which secure-store's
  rules exclude, or Keystore reset): the data is unreadable. **Never create a fresh DB over it.**
  Rename the file aside (`epurse.db.unreadable-<ts>`), start empty, and offer "Restore from Google
  Drive" on first screen. The Drive backup is password-based, so it survives this.
- Phone-to-phone transfer therefore doesn't carry data over (the key doesn't move). Drive restore is
  the migration path. That's the same as today for the refresh token.

### Everything else that touches storage
| Thing | Change |
|---|---|
| `Storage.wipeEverything` / `deleteAllUserData` | Also close + delete the SQLite file, `clearAll()` every MMKV instance, delete both keys from SecureStore |
| Pre-restore snapshot | AsyncStorage → SQLite `kv` row, **expires after 7 days** (retention plan) |
| Drive backup | **Format unchanged.** It's a logical export built from store state, not a DB-file copy, so no SQLite backup API is involved |
| `MOCK_DATA_ENABLED` | Memory drivers for both engines, so mock mode never touches the real files (as today) |
| `migrateRestoredState` | Unchanged (works on the state object) |

## 8. Later — Phase B (not part of Step 0)

When start-up load gets slow for long histories: hold only ~13 months of transactions in memory.
Older months come from SQL on demand (search, opening an old month, account history), and their
stats come from the monthly-aggregate cache. That needs selectors to stop assuming
`s.transactions` is everything: 12 subscribers plus the store's own readers. Its own design when
it's needed.

## 9. What this unblocks

The retention plan: compaction stops deleting transactions (aggregates become a rebuildable
10-year cache), settled lent/borrowed and groups are kept until the user cleans up, and an optional
"Clean up history older than…" is added in Settings. That's a separate step **after** Step 0 is
verified on device.

## 10. Tests

expo-sqlite and MMKV don't run in Node (and Hermes ≠ Node; see the `backup` skill §4b2).
- **`SqlDriver`** (`exec / all / transaction(run, prepare)`) — expo-sqlite on device
  (`expoSqlDriver.ts`), **better-sqlite3** in Node (`__tests__/_sqliteNodeDriver.mjs`, devDependency),
  so the REAL SQL and schema are tested. No SQLCipher in Node: encryption is checked on device only.
- **`RecordStore`** (`load / apply(ChangeSet) / wipe`) — one contract, two implementations: SQL
  and memory (mock mode + the existing suites). `test:storage` runs the SAME contract against both,
  including atomicity (mutation-verified: commit-on-error and in-place memory writes both fail it).
- Rows are keyed by `rid`, not the record's `id`, and ordered by `seq` (the store prepends new
  transactions and tests read `transactions[0]`): a legacy row with no id, or two sharing one,
  must never collapse into one row.
- New `test:storage`: diff correctness (insert/update/delete/key-only change), atomicity (a throwing
  flush leaves the DB at the previous state), hydration round-trip == deep-equal, freeze guard
  catches in-place mutation, migration pass + forced-failure fallback, wipe removes everything,
  and a size/timing benchmark at 36 k rows (Node numbers only as a trend).
- Existing: `test:payload` key routing, `test:drive` version coupling. The store's `persist.version`
  stays the single source.

## 11. Build order (each a reviewable PR)

| # | Step | Needs rebuild |
|---|---|---|
| 1 ✅ | `react-native-mmkv` 4.3.2 + `react-native-nitro-modules` 0.37.1, `expo-sqlite` 57.0.4 w/ `useSQLCipher`; key manager `storage/keys.ts` (SecureStore, sync) + pure `keyFormat.ts` | **yes** |
| 2 ✅ | `schema.ts`, `sqlDriver.ts`, `expoSqlDriver.ts`, `recordStore.ts` (SQL + memory), `test:storage` 31 checks | no |
| 3 ✅ | `hybridStorage.ts` (diff, coalesce, atomic flush, hydration, freeze guard), `deviceKv.ts` + `mmkvDeviceKv.ts`; `storageHybrid.test.mjs` 37 incl. the REAL store under freeze across 15 actions, reload == persisted state | no |
| 4 ✅ | `legacyMigration.ts` (copy as-is → reload → exact-equality verify → only then mark; any failure wipes the half-copy) + `appStorage.ts` (modes hybrid / legacy / unavailable, Sentry tags only) wired into `ePurseStore`; flush on background (App.js) and in Delete Account; `_store-hook` stubs appStorage for the Node suites; `storageMigration.test.mjs` 15 incl. a real v41 store end-to-end | no |
| 5 ✅ | `appKv.ts` (one encrypted MMKV `epurse-app`) + pure `kvStateStorage.ts` (copy once, verify read-back, skip writes if AsyncStorage couldn't be read so defaults never shadow it); `useRewardStore`, `useNotificationStore`, `utils/storage` moved; `dev/mockStorage.js` deleted | no |
| 6 ✅ | Pre-restore snapshot → SQLite meta (`writeAside`), deleted after `PRE_RESTORE_SNAPSHOT_MS` (7 d, retention.ts; checked on app start); Delete Account: `wipeAppStorage` (empty + `wal_checkpoint(TRUNCATE)` + `VACUUM`, re-mark migrated) then AsyncStorage + both MMKV; key-loss set-aside + onboarding notice | no |
| 7 | **On-device checks (you):** fresh install; upgrade from the current build with real data; kill the app mid-ingest; Drive restore; delete account; start-up time with mock 20 k txns | — |
| 8 | Retention change (§9) | no |

## 12. Open questions / risks

1. ~~Compatibility at install~~ **RESOLVED Oct-11:** `assembleRelease` green; APK carries
   `libNitroMmkv.so`, `libmmkv.so`, `libNitroModules.so`, `libexpo-sqlite.so`, `libcrypto.so`.
   (A raw `./gradlew assembleRelease` fails at Sentry source-map upload without
   `SENTRY_AUTH_TOKEN`; `build.sh` sets `SENTRY_DISABLE_AUTO_UPLOAD=true` for that. Not a storage issue.)
2. **Start-up time** at large histories, measured in step 7. Decides when Phase B is needed.
   Node baseline (Mac, trend only) at 36 k rows: initial write 147 ms, **one new txn 11.7 ms**,
   full load 35 ms. The same data as one AsyncStorage value = 10.7 MB (> the 6 MB cap). Expect
   Hermes on a mid-range phone to be several × slower.
3. **Flush window:** a change made <100 ms before a hard kill can be lost. That's the same as today
   (AsyncStorage writes are async too), and the background flush covers normal app switches.
4. **Backup size** grows with keep-all. Measure seal time (AES-GCM is pure JS) at 20 k txns.
5. **Rollback:** a build that predates this can't read SQLite. Because the AsyncStorage value is kept
   for ~2 releases, a downgrade still finds data, but it's stale from the migration point. Acceptable
   pre-launch.
