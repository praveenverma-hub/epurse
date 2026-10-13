# Shared Group Sync — design (phases 1–3)

**Status:** phase 1 code done Oct-13-2026 (behind `sharedSync`, off; no Supabase project yet). Phases 2–3 next.
**Schema:** `supabase/migrations/20261013000000_shared_groups.sql` (source of truth for the server).

Live sync for SHARED groups only (trips, flats, events). Everything else — accounts, SMS
transactions, budgets, goals, personal groups, unsynced shared groups — never leaves the phone.

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Backend | **Supabase**, Mumbai region (`ap-south-1`). No separate Node backend. |
| Privacy | **End-to-end encrypted from day one.** The server stores ciphertext + membership only. |
| Offline | Local-first. The app's store is the source of truth; a durable **outbox** sends, a **per-group cursor** pulls. Realtime (phase 4) is only a "something changed" poke. |
| Server tables | 4: `groups`, `group_members`, `group_invites`, `group_events` (append-only). Expenses, edits, deletes, settlements are event TYPES inside the ciphertext, not tables. |
| Validation | The server checks structure (membership, order, size, rate). Amounts are checked on every phone by ONE shared validator; invalid events are skipped identically everywhere. |
| Money | Integer paise on the wire. Shares are sent explicitly; receivers never recompute a split. |
| Sharing ends | 60 days after the last activity (server-enforced). "Until settled" (settled + 7-day grace) is phase 5. Local copies are kept. |
| Integrity | Users own correctness (duplicates, double-recorded payments). The app guarantees every phone computes the same totals and balances, and group history is never rewritten. See §8a. |
| Delete Account | Membership and account are deleted; the user's events STAY as encrypted group history with the author cleared. See §10. |
| PowerSync | No — it syncs readable rows, which E2EE rules out. |

---

## 2. What the server can see

| Visible to the server | Encrypted (server can't read) |
|---|---|
| group id, created time, last activity, expiry | group name, emoji, colour |
| member **user ids** + role (admin/member) | member names, who is who |
| event id, sequence number, author user id, time, key epoch | event type, amounts, shares, payer, title, category, date |
| invite id, its expiry, who used it | the group key (never sent — see §5) |

Supabase Auth also stores the Google **email** of anyone who signs in to sharing. That is why
sign-in to Supabase is **lazy** (§4): users who never share never get a server account.

---

## 3. Architecture

```
            ePurse app (local-first)
  ┌─────────────────────────────────────────┐
  │ zustand store → hybridStorage → SQLite  │  personal data: stays here
  │   transactions, lentBorrowed, groups,   │
  │   syncOutbox  (same flush transaction)  │
  │            │                 ▲          │
  │      encrypt + send     decrypt+validate│
  │            ▼             + fold         │
  └────────────┼─────────────────┼──────────┘
               │ RPC             │ select seq > cursor
               ▼                 │
        Supabase (Mumbai): Auth · Postgres + RLS · pg_cron
```

---

## 4. Identity and sign-in

- **Lazy:** the app signs in to Supabase only when the user first starts or joins a shared
  group (`ensureSyncSession`, `src/sync/session.ts`). supabase-js and its URL polyfill are
  `require`d on first use, so they never load for users who don't share.
- `syncAccount { userId }` in the store records that a server account exists. It is **backed
  up**, so Delete Account on a restored phone still deletes the server account.
- Two Supabase projects, test and prod, picked by the same `REMOTE_CONFIG_ENV` as remote
  config (`src/sync/config.ts`). On/off: `STATIC_CONFIG.sharedSync` + remote flag `sharedSync`.
- **No new login screen:** `src/backup/googleAuth.ts` `signIn()` already requests `openid`, so
  `exchangeCodeAsync` returns an ID token. Supabase: `auth.signInWithIdToken({ provider: 'google', token })`.
  - **Verify in phase 1:** (a) Google's refresh response (`refreshAsync`) also returns an
    `id_token` for users signed in before this ships — otherwise ask them to sign in again once,
    from the "Start Live Sharing" flow; (b) nonce handling; (c) add every OAuth client id (all
    build variants) to Supabase's Google provider "Authorized Client IDs".
- **Supabase session** is separate from the Drive grant. Stored in its own encrypted MMKV
  instance (`epurse.sync.auth`, key from SecureStore via `getMmkvDeviceKv`). Never backed up.
- **ID token:** `googleAuth.getIdToken()` refreshes with the full scope set and returns Google's
  `id_token`. Unlike `getAccessToken`, a failure there never signs the user out.
- **Sign-out** (`useGoogleSession.signOut`): also `signOutSync()` (local scope). Local shared
  groups stay; they resume when the same Google account signs in again. If Google signs the
  user out on its own (revoked grant), the Supabase session is dropped at the next sync because
  its email no longer matches the Google account.
- Supabase project: Google provider only; email/phone/anonymous sign-in OFF.

---

## 5. Encryption

- **Group key:** 32 random bytes (`src/backup/random.ts` `randomBytes`), one per group per
  **key epoch** (epoch 1 at creation; rotation on member removal is phase 5).
- **Cipher:** XChaCha20-Poly1305 (`@noble/ciphers/chacha.js`, already a dependency). Its 24-byte
  random nonce is safe with no counter to keep across devices; the backup's AES-GCM uses a 12-byte
  nonce, which is fine for one backup file but tighter for thousands of events from many phones.
- **AAD** = `epurse.grp.v1|<groupId>|<eventId>|<keyEpoch>`. Binds each ciphertext to its own event,
  so the server can't move a ciphertext to another group or replay it under another event id.
- **Invite link:** `https://epurse.co.in/join#i=<inviteId>&t=<token>&k=<groupKey>`
  - Everything is in the `#fragment`, which browsers and App Links never send to a web server.
  - The app sends **only** `inviteId` + `token` to Supabase; `k` never leaves the phone.
  - The server stores `sha256(token)`. Invites are **single-use** and expire after **48 hours**.
    Anyone holding an unused link can join and read the group, so share it privately
    (WhatsApp to the person, or a QR code shown in person).
- **Where keys live:** inside the local group record (`group.shared.keys`). The same SQLite file
  already holds the group's data in plaintext, so storing the key beside it adds no exposure.
  Because it's a backed-up field, keys ride the **encrypted** Drive backup — a restored phone can
  still read its groups. A lost key can always be re-shared by any member with a new invite.

---

## 6. Event format (inside the ciphertext)

Every event decrypts to JSON `{ v: 1, type, at, ...body }`. Member references are opaque
`memberId`s (uuid) chosen inside the group — never contact ids or phone numbers.

| type | body | who may send |
|---|---|---|
| `group.meta` | `name, emoji, color` | admin |
| `member.add` | `memberId, name` — a person in the group, joined or not | any member |
| `member.claim` | `memberId, userId` — "this person is me" | the user themself (`userId` = author) |
| `member.rename` | `memberId, name` | any member |
| `member.archive` | `memberId` — valid only when their balance is ₹0 at that point (§8a) | the member themself or an admin |
| `expense.upsert` | `entityId, amountPaise, title, categoryId, date, paidBy, shares[{memberId, paise}]` | create: anyone; edit: the original author |
| `expense.delete` | `entityId` | the original author or an admin |
| `settlement.upsert` / `.delete` | `entityId, from, to, amountPaise, date` | phase 5 |

**Not sent:** account, card/bank, SMS text or id, location, the note, custom category ids
(a custom category is sent as `other`).

**Validator — `src/sync/validate.ts`, pure, the ONE copy every phone runs.** An event is skipped
(identically on every phone) when:
- it's not valid JSON or has an unknown type or version;
- `amountPaise` isn't an integer between 1 and 10¹⁰;
- shares don't sum to the amount;
- `paidBy` or a share's member isn't in the group at that point in the sequence;
- the sender isn't allowed to send it (table above);
- text is over the input-validation caps.

It may only depend on the event sequence — never on local time, local data or settings —
otherwise phones drift apart.

**Server-side system events** are plaintext (`system_type`): `group_created`, `member_joined`,
`member_left`, `member_removed`, `member_deleted`, with `system_subject` = the user id.

---

## 7. Client sync engine (`src/sync/`)

**Outbox.** A new store row collection `syncOutbox` → SQLite table `sync_outbox`
(`SCHEMA_VERSION` 2). A store action that changes a synced group's expense writes the txn AND the
outbox row in **one `set()`**, so `hybridStorage` flushes both in one SQLite transaction — a crash
loses both or neither. It's in the backup payload (`STORE_KEYS`); replay is safe because event ids
are idempotent on the server.

Each row stores:
- `eventId`
- `groupId`
- `payload` (plaintext JSON — encrypted at send time with the current epoch)
- `createdAt`
- `attempts`
- `state`: `pending` or `failed`

**Send.** Per group, oldest first, ≤ 50 per `append_events` call. On success the row is deleted.
- **Network error:** retry with backoff.
- **Rejected** (validation or stale epoch): mark `failed` and show "1 change didn't sync" on the
  group.
- **Not a member / expired:** mark the group's sharing as ended.

**Pull.** `group_events where group_id = ? and seq > cursor order by seq limit 500`, repeated
until empty. Each event goes through decrypt → validate → fold into the store. The cursor is
saved in the same `set()`.

The cursor lives on the group record (backed up). A restored snapshot already contains every event
up to its cursor, so resuming from it is correct.

**Echo.** An incoming event whose `eventId` is one of ours that's already applied locally just
acknowledges the outbox row (if still present); it is not applied twice.

**Triggers** (phase 3):
- app foreground
- opening a synced group
- after an enqueue (debounced)
- a retry timer

Realtime pokes are added in phase 4.

**Edits.** Only an expense's author can edit it, so conflicts come only from the same user on two
phones: the highest `seq` wins.

---

## 8. Mapping into the existing model

- **Member ids.** A synced group's local `members[].memberId` ARE the remote member ids, except the
  member I claimed, which stays `'me'` locally. Translate `'me'` ⇄ `group.shared.myMemberId` at
  the sync boundary only.
- **Start Live Sharing on an existing shared group** creates the server group and sends
  `group.meta`, one `member.add` per person and one `expense.upsert` per existing group expense.
  Then, in one store action, it rewrites the group's local `c_<contactId>` ids to the new member
  ids (`members`, every `groupSplit.paidByMemberId` / `shares[].memberId`).
- **Someone else's expense arrives** → a local group txn with `id = entityId`, no `accountId`, and
  `syncOrigin: 'remote'`. It goes through the EXISTING paths, so no second ledger is built:
  - **Someone else paid** → a memo (`isGroupMemo`, `isMemoTxn`): no account delta, excluded from
    spend.
  - `buildGroupLbRows` makes my "borrowed" row, keyed by `sourceTxnId`.
- **Local changes that send events:**
  - add / edit / delete of a txn in a synced group;
  - tag into a synced group;
  - untag (→ `expense.delete`; locally the split stays per the existing untag rule);
  - ignore (already strips a shared group's tag → `expense.delete`).
- **Remote txns are not bank txns:** they never get an account, never match SMS, and the backup
  `TXN_FIELDS` allow-list gains `syncOrigin`.

---

## 8a. Integrity rules (decided Oct-13-2026)

**Principle.** The user keeps the group's data correct: a dinner added twice, a payment recorded
by both sides, or an overpayment is theirs to fix, and the app never blocks, merges or guesses.
The app guarantees two things only:
1. Every phone computes the **same totals and balances** from the same history.
2. **History is never rewritten.** A person stays in every expense they were part of — leaving,
   being removed or deleting their account removes nothing from the group's history.

| Case | Rule |
|---|---|
| My offline change is invalid by the time it reaches the server (e.g. includes someone who left) | My phone shows the server's history + my unsent changes. A rejected change drops out of that view; the expense shows **Didn't Sync** with **Edit**. |
| Edit and delete of the same expense | Delete wins, in any order. |
| Leave the group / admin removes someone | Allowed only when that person's balance in the group is ₹0 (app-enforced — the server can't see amounts). They're **archived**: still shown in old expenses, can't be added to new ones. |
| Expense edited after someone settled | Allowed; balances recompute. |
| Duplicate expense or settlement, overpayment | Nothing special — counted as entered. |
| Joining a trip I already tracked on my own | Joining always creates a fresh synced group. Nothing is merged or moved; the old local group is the user's to delete. |
| Other parts of the app change a synced expense (ignore, untag, SMS refund, cleanup…) | ONE check point, not per action: after every store write, diff the synced groups' shared fields against what was last sent and queue events from the difference. Other people's expenses have their shared fields locked; my category and note for them are local only. |
| App update changes a validation rule | Rules are frozen per event `v`. New rules → new `v` + `minSupportedVersion` bump in remote config, so no two live versions disagree. |
| One bad event in a batch | The server rejects the whole batch; resend one by one and mark only the bad one failed. |
| Someone is removed | V1: server access ends (row-level security). No key rotation yet; `key_epoch` is reserved for it. |
| Offline past expiry with unsent changes | "Sharing ended before N changes synced"; local data stays. |

---

## 9. Sharing ends

- Every new data event sets the server's `expires_at = now + 60 days`. Row-level security hides an
  expired group immediately, and a daily `pg_cron` job deletes it (03:00 IST).
- The app notices that its membership is gone and marks the group "Sharing Ended". Local data,
  balances and Lent/Borrowed rows stay; the group behaves like a normal local shared group again.
- Phase 5 adds "until settled":
  - A phone that sees every balance at ₹0 calls `attest_settled(seq)`.
  - The server accepts it only if `seq` is still the latest, then sets `expires_at = min(current,
    now + 7 days)`.
  - Any new event clears the settled mark.

---

## 10. Delete Account

Order in `SettingsScreen` `handleDeleteAccount`:

1. If the user has a sync account (`syncAccount`) and is offline, **block the delete** with a
   connect-and-retry message. Unlike the Google revoke, this can't be best-effort: once the phone
   is wiped, nothing can ask the server to delete later.
2. Edge Function `delete-account` (Supabase JWT):
   - calls `purge_user(uid)`, which removes the user's memberships, writes a `member_deleted`
     marker into each group, hands admin to the oldest remaining member, deletes any group left
     empty, and deletes their invites;
   - then deletes the auth user. Their events **stay** (encrypted; the author column clears
     automatically), so the group's history is the same for every member, old or newly joined.
   - Unsettled balances do NOT block Delete Account (Play requires deletion to always be
     available); only Leave Group needs ₹0. The delete confirmation names any group where the
     user still owes or is owed.
3. Then the existing steps: `deleteAccount()` (Google revoke) → `deleteAllUserData()` →
   `flushAppStorage()` → `Storage.wipeEverything()`.

Other members' phones: nothing changes in the history or balances. On the marker they show that
person as "Deleted Account"; nobody can edit their expenses any more (an admin can still delete one).

A user who restores an older backup gets those groups back as local-only copies; rejoining needs a
new invite.

---

## 11. Setup (one-time, per project: test and prod)

1. supabase.com → New project → region **Mumbai (ap-south-1)**.
2. Authentication → Providers → **Google**: enable; add every Android OAuth client id
   (`GOOGLE_ANDROID_CLIENT_ID`, all build variants) to **Authorized Client IDs**.
   Email, phone and anonymous sign-in: **off**. New-user sign-ups: **on** (sign-in creates the user).
3. CLI (`brew install supabase/tap/supabase`): `supabase login` → `supabase init` (keeps
   `supabase/migrations`) → `supabase link --project-ref <ref>` → `supabase db push` →
   `supabase functions deploy delete-account`.
4. Project Settings → API: copy the **Project URL** and the **anon / publishable** key into
   `SUPABASE_PROJECTS` in `src/sync/config.ts`. The service-role / secret key never goes in the app.

## 12. Phases

1. **Sign-in — code DONE (Oct-13-2026).** Lazy sign-in with the ID token, session storage,
   sign-out, the `delete-account` Edge Function and the Delete Account change (§10), feature
   flag. Not yet exercised against a real project: there's no entry point until phase 2's
   Start Live Sharing.
2. **Groups, invites, keys.** `create_group`, invite link + QR, `redeem_invite`, claim a member,
   leave / remove, key storage, Start Live Sharing.
3. **Encrypted event log + offline.** Outbox, send, pull, validator, fold, echo, remote txns as
   memos, failed-change indicator.
4. Realtime poke (broadcast `{groupId, seq}` from a trigger) + Expo push with generic text
   ("New activity in a shared group").
5. Settlement events, "until settled" expiry, key rotation on removal, keys in backup verified on
   restore.

### Files

| New | Purpose |
|---|---|
| `src/sync/config.ts` | ✅ projects (test/prod), `isSyncEnabled` |
| `src/sync/client.ts` | ✅ Supabase client, session storage |
| `src/sync/session.ts` | ✅ lazy sign-in, sign-out, `deleteSyncAccount` |
| `src/sync/crypto.ts` | key gen, encrypt/decrypt with AAD (pure) |
| `src/sync/events.ts` | event types (pure) |
| `src/sync/validate.ts` | the one validator (pure) |
| `src/sync/fold.ts` | events → local group/txn changes (pure) |
| `src/sync/engine.ts` | send/pull loop, triggers, errors |
| `src/sync/invite.ts` | build/parse invite links |
| `supabase/migrations/*`, `supabase/functions/delete-account/` | server (✅ phase 1–3 schema, ✅ delete-account) |

| Changed | Why |
|---|---|
| `src/storage/schema.ts` | `syncOutbox` row table, `SCHEMA_VERSION` 2 |
| `src/store/ePurseStore.js` | enqueue in group txn actions; apply folded changes; store version + `backupService` STORE_VERSION |
| `src/backup/payload.ts` | ✅ `syncAccount` in `STORE_KEYS`; phase 3: `syncOutbox` in `STORE_KEYS`, `syncOrigin` in `TXN_FIELDS` |
| `src/types/group.ts` | `Group.shared?` (remote id, myMemberId, keys, epoch, cursor, status) |
| `src/backup/googleAuth.ts` | ✅ `getIdToken()` |
| `src/screens/SettingsScreen.tsx` | ✅ Delete Account order (§10) + error modal |

### Tests

- **`test:sync` (pure, `.mjs` runner):**
  - crypto round-trip and AAD tamper;
  - the validator, one test per skip rule;
  - fold determinism (the same events in → the same state on every phone);
  - a **two-phone simulation** against an in-memory fake server:
    - offline adds on both phones, then reconnect → both converge;
    - a crash between enqueue and send → resend is idempotent;
    - an invalid event is skipped on both;
    - a member is deleted → the marker is handled.
- **Server: `supabase test db` (pgTAP):**
  - a non-member can't read;
  - an expired group can't be read;
  - direct inserts are denied;
  - an invite can't be redeemed twice or after it expires;
  - `append_events` is idempotent;
  - `purge_user` keeps every event (history intact) and removes only memberships and invites.

---

## 13. Defaults to confirm

- Any member can invite (Splitwise-style). Admin-only invites are a one-line change in `create_invite`.
- The note is never shared; the title (merchant) is.
- Someone records that **I** paid: on my phone it books my "lent" rows with no account movement and
  a prompt to link an account. Exact UI TBD in phase 3.
- Max 50 members per group, 100 groups per user, 50 events per batch, 16 KB per event.
