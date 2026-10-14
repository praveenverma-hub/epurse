# Shared Group Sync — design (phases 1–4, settlements, checkpoints)

**Status:** phases 1–4 code done (Oct-13 → Oct-15-2026), all migrations on the TEST project; not yet tried on two real phones. End-to-end behaviour is pinned by `npm run test:groupScenarios` (§12).
**Schema:** `supabase/migrations/` — every `2026101*_*.sql`, applied in order (later files replace earlier function definitions; never edit an applied one).

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
| Server retention | **Groups never end from inactivity (Oct-15-2026).** After 7 quiet days (settled) or 30 (unsettled) a phone posts a checkpoint of people + who owes whom. After 90 quiet days the group goes DORMANT: the server keeps the group, its members and the latest checkpoint and drops older events; the next change wakes it with no action from anyone (§9). Phones always keep everything. |
| Who decides | **No admin (decided Oct-15-2026).** A group is a money record between people who trust each other, not a chat group: nobody adds expenses for fun, and what's shared stays between its members. Any member adds people, invites, edits, deletes, removes someone at ₹0 and adds a former member back; nobody's approval is asked. The server's `role` column is kept but unused. |
| Integrity | Users own correctness (duplicates, double-recorded payments). The app guarantees every phone computes the same totals and balances, and group history is never rewritten. See §8a. |
| Delete Account | Membership and account are deleted; the user's events STAY as encrypted group history, still under their (now meaningless) author id so every phone folds them the same. See §10. |
| PowerSync | No — it syncs readable rows, which E2EE rules out. |

---

## 2. What the server can see

| Visible to the server | Encrypted (server can't read) |
|---|---|
| group id, created time, last activity, expiry | group name, emoji, colour |
| member **user ids** (+ an unused role column) | member names, who is who |
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
  │   group.shared.outbox (same flush)      │
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

- **Lazy:** the app signs in to Supabase only when the user first invites someone to, or joins, a
  shared group (`ensureSyncSession`, `src/sync/session.ts`). supabase-js and its URL polyfill are
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
- **Opening the app from a link (built Oct-15-2026):**
  - **App Links:** an `https://epurse.co.in/join…` intent filter with `autoVerify`
    (`app.base.json`) + `/.well-known/assetlinks.json` on the domain (source: the `epurse-web` repo,
    `web/public/.well-known/assetlinks.json`).
    Verified → Android opens ePurse straight from WhatsApp; the fragment comes along.
  - **Fallback page** `epurse.co.in/join` (source: `epurse-web` repo, `web/src/app/join/`): reads the fragment in
    the browser and opens `epurse://join#…` (same invite, the app's scheme), with an Open in
    ePurse button and a Play link. Self-contained on purpose — no analytics or external scripts,
    since anything loaded there could read the key.
  - **QR code:** the invite sheet shows the same https link as a QR (`components/QrCode`). Any
    camera app or Lens opens it → App Link / `/join` page, exactly like a tapped link. The encoder
    is `toqr` 0.1.1 VENDORED into `src/utils/qr/` (MIT) — upstream builds a `TextEncoder` on
    import, which Hermes lacks; the copy takes bytes only (tested without `TextEncoder`, and
    module-for-module against upstream).
  - In the app, `InviteLinkBoot` (`App.js`) opens Join Group with the link filled in; the user
    still taps Join, so a link alone never joins anyone. `parseInviteLink` accepts both forms.
  - **Fingerprints:** `assetlinks.json` currently lists the PUBLIC React Native debug keystore
    (SHA-256 `FA:C6:17:45:…:3B:9C`) for all four packages, for testing. Any app signed with that key
    under our package names would be verified for invite links — **before launch, `com.epurse.app`
    must list only the EAS upload key + Play app-signing SHA-256s** (`docs/ANDROID_RELEASE.md`
    Track D). The `epurse://` scheme can be claimed by any app too; the invite is single-use and
    expires in 48 h, which bounds that.
- **Where keys live:** inside the local group record (`group.shared.keys`). Restore is tested
  (`test:payload`): a live group comes back with its key, history, member map and outbox (sent and
  unsent items), plus its transactions' and settle rows' sync fields and `syncAccount`. The same SQLite file
  already holds the group's data in plaintext, so storing the key beside it adds no exposure.
  Because it's a backed-up field, keys ride the **encrypted** Drive backup — a restored phone can
  still read its groups. A lost key can always be re-shared by any member with a new invite.

---

## 6. Event format (inside the ciphertext)

Every event decrypts to JSON `{ v: 1, type, at, ...body }`. Member references are opaque
`memberId`s (uuid) chosen inside the group — never contact ids or phone numbers.

Built: `src/sync/events.ts` (format + strict parser) and `src/sync/fold.ts` (rules + balances),
tested by `npm run test:sync`.

| type | body | who may send |
|---|---|---|
| `group.meta` | `name, emoji, color` | any member |
| `member.add` | `memberId, name` — a person in the group, joined or not | any member |
| `member.claim` | `memberId, userId` — "this person is me" | the user themself (`userId` = author), once |
| `member.rename` | `memberId, name` | any member |
| `member.archive` | `memberId` — only when their balance is ₹0 at that point (§8a) | any member |
| `expense.upsert` | `entityId, amountPaise, title, categoryId, date, paidBy, shares[{memberId, paise}]` | any member (create or edit) |
| `settlement.upsert` | `entityId, from, to, amountPaise, date` (from ≠ to) | any member (create or edit) |
| `expense.delete` / `settlement.delete` | `entityId` | any member |
| `group.checkpoint` | `baseSeq, meta, members, activeUsers, deletedUsers, debts[{from, to, paise}]` | any member (§8b) |
| `expense.correct` | `entityId, correctsId, title, date, debts[], expense` — an edit/delete of a frozen expense | any member (§8b) |

**Edits (decided Oct-13-2026):** any member can edit; the **last edit by seq wins** on every phone,
with no prompt (overwrite). Every version is kept with who sent it and the **server's** time
(`versions[]` in the fold), so each expense has a full edit history that stays on every phone after
sharing ends.

Settlements are in v1 already, so phase 5's settle UI needs no format bump.

**No admin anywhere.** The fold never had one (the server's role isn't in the history every phone
replays), and since Oct-15-2026 neither the app nor the server uses one (§1 "Who decides"). Users
own correctness (§8a), so the permissive rules above are fine.

**Not sent:** account, card/bank, SMS text or id, location, the note, custom category ids
(a custom category is sent as `other`).

**The ONE validator every phone runs** = `parseEvent` (structure) + `foldEvents` (rules against the
history so far). An event is skipped, identically on every phone, when:
- it can't be decrypted, isn't valid JSON, or has an unknown type or version;
- an amount isn't a whole number of paise between 1 and 10¹⁰ (₹10 crore);
- shares don't sum to the amount, or list a member twice;
- it names a member who doesn't exist, or an archived one who isn't already on that entry;
- the sender isn't allowed to send it (table above), or isn't a member at that seq;
- it edits a deleted entry (delete wins), or reuses an expense id as a settlement;
- text is over the frozen v1 limits (`V1_LIMITS` — deliberately not `INPUT_LIMITS`).

It depends only on the event sequence — never on local time, local data or settings —
otherwise phones drift apart. Balances in the fold always sum to zero.

**Server-side system events** are plaintext (`system_type`): `group_created`, `member_joined`,
`member_left`, `member_removed`, `member_deleted`, with `system_subject` = the user id.

---

## 7. Client sync engine (`src/sync/`)

Built Oct-14-2026: `expenses.ts` (pure), `engine.ts`, `groupSync.ts`. Tested by `test:sync`
(pure two-phone simulation), `test:store` ("shared-group sync: …") and `test:groupScenarios` —
many phones on the REAL store + groupSync + fold + crypto against an in-memory server that follows
the SQL (`_fakeSyncServer.mjs`; keep it in step with every migration). It ends with invariants
checked on every phone: Lent/Borrowed adds up to the history, nothing left unsent.

**One check point, going out.** `engine.ts` installs ONE store subscription (`SharedSyncBoot` in
`App.js`, only AFTER hydration — before it, transactions read as empty and every server expense
would look deleted). On any change to `transactions` or `groups`, `planOutgoing` compares each live
group's expenses with the server history (`fold.entries`) and queues the difference: new/edited →
`expense.upsert`, gone from the group (deleted, ignored, untagged) → `expense.delete`, plus
name/emoji/colour/people via `planGroupChanges`. No store action "sends" anything itself. An event
already waiting in the outbox is never queued twice. Transactions get a `syncId` (server id) the
first time they can be sent; one with no split yet isn't sent until it has one.

**Outbox** = `group.shared.outbox` (not a separate table): it lives on the group record, so the
expense change and its outbox entry reach SQLite in the same coalesced flush. Backed up with the
group; a resend is safe because each item's `eventId` is fixed when queued.

**Send** (`flushGroup`): per group, one at a time; a `pending` group is created on the server
first; ≤ 50 per `append_events`; sent items leave the outbox; then pull. Not a member / ended →
the group is marked ended. Offline → stays queued. Debounced 1.5 s after a change.

**Pull** (`pullGroup`): `seq > cursor`, 500 at a time → decrypt → `foldEvents` → `planIncoming`
→ ONE `setSharedGroupState` write with the new history, members, name AND the transaction changes.
One write matters: in between, the outgoing check would read a remote edit as a local one.

**Incoming rules** (`planIncoming` + the store): an expense with an unsent local change is left
alone until it's sent. New from someone else → a transaction `sync_<id>` (`syncOrigin: 'remote'`,
no account; a memo if someone else paid) with Lent/Borrowed rows via `buildGroupLbRows`. Edited →
updated in place (my own bank expense keeps its account; the balance moves by the difference;
never auto-creates an account). Deleted → someone else's or a memo goes; my own bank expense stays
as a plain expense of mine (`detachFromGroup`, the same rule Delete Group uses). Someone changes
the payer of my bank expense to another member → a memo here, its account parked in
`memoAccountId`; changed back, or deleted, the account is debited again. Mine, sent, but absent from the history → the rules skipped it:
flagged `syncRejected` (card chip **NOT SYNCED**) and not re-sent until it changes.

**Triggers:** a change (debounced), opening a group, the Groups tab, app start and foreground.
Realtime pokes are phase 4.

**Settlements (built Oct-14-2026, `src/sync/settlements.ts`).** A settle in a live group is a
group-tagged Lent/Borrowed row (`lent_settled` = they paid me, `borrow_repaid` = I paid them,
`memberId` = who). The same subscription sends each one as `settlement.upsert`, and a removed row
(its Repayment transaction deleted) as `settlement.delete`. Coming in, only settlements that
involve me become rows (`lb_sync_<id>`); one between two other people changes nothing here.
**Settle from Lent/Borrowed** (`settlePersonBalance`) records each LIVE group's part as that
group's own row, then one row for the rest — each group's balance is its own. Group Lent/Borrowed
rows carry `memberId` (`buildGroupLbRows`, `lbRowMember`). A settlement the rules skip is flagged on
its row (`syncRejected`), shown NOT SYNCED on the person's Lent/Borrowed group line, and not
re-sent until it changes.

**Lent/Borrowed always adds up to the history (Oct-15-2026, `src/sync/balances.ts`).** After every
pull, a live group's Lent/Borrowed rows are compared with what the history says each person and I
owe each other (only rows of changes the server has — not unsent or NOT SYNCED ones). When part of
the history is known only as a checkpoint or as a correction of an expense this phone never had
(joined or restored after a dormant group was compacted), one **"Earlier balance"** row per person
(`lb_earlier_…`) makes up the difference. So what Lent/Borrowed shows, what Settle settles and
what Leave/Remove check are always the same number.

**Checkpoints + corrections (built Oct-14-2026).** `flushGroup` = pull → send → pull → post a
checkpoint if `checkpointDue` (`src/sync/checkpoint.ts`; quiet time from `fold.lastAt`, the server
time of the last event). An edit or delete of a frozen expense goes out as `expense.correct`
(`planOutgoing`), built on the version the outbox's own pending corrections reached, so two quick
edits never count the old share twice. Incoming, frozen expenses and settlements are mirrored like
live ones, so a correction updates the SAME local transaction in place (or removes it).

**Sent ≠ done.** A sent outbox item keeps its server `seq` and stays until a pull folds past it
(`reconcileOutbox`). Dropping it at send time let the store subscription see the change as unsent
for a moment and queue it again — harmless for an edit, double-counting for a correction. The same
step turns an UNSENT edit/delete of an expense that a checkpoint has since frozen into a
correction (same eventId) — sent as an edit it would land as a second, new expense on every phone.
Pulling before sending keeps that window to milliseconds; it can't be closed fully without the
server reading amounts.

**Frozen settlements can't be deleted** (the rules don't see them). If a settle row is removed
here (its Repayment transaction deleted), nothing is sent and the next pull puts the row back —
an empty pull still reconciles. To undo it, settle the other way.

**Edits.** Any member can edit; the highest `seq` wins on every phone, and every version stays
in the entry's history (§6).

## 7a. Live updates and push (phase 4, built Oct-15-2026)

One trigger on `groups.last_seq` (migration `20261015000000_realtime_push.sql`) runs after every
new event (data, system or checkpoint):

- **Realtime poke.** `realtime.send({ seq }, 'poke', 'group:<id>', private)`. Only members can
  listen (policy on `realtime.messages` via `is_member`); phones can't broadcast. While the app is
  open, `src/sync/realtime.ts` holds one channel per live group and pulls (debounced 400 ms) when a
  poke's seq is ahead of the fold — my own writes are ignored that way. Closed on background.
- **Push.** Expo's push service, called from Postgres with `pg_net` (no Edge Function, no secret):
  title "New Group Activity", body "Someone updated a group you share.", `data { type:
  'shared_group', groupId }` (the server id — already known to the server). At most one per group
  per 10 minutes (`groups.last_push_at`), never for a checkpoint, never to the author. Expo learns a
  device token and that generic text; nothing else.
- **Never fails a write:** both sends are wrapped and swallow their errors.
- **Tokens:** `push_tokens` (≤ 5 per user, functions only). `src/sync/push.ts` registers this phone
  only while sharing is on, Settings → Notifications → **Shared Group Activity** is on (kind
  `sharedGroupActivity`, default on), it has a live group, notification permission is already
  granted (never asked for here) and a session exists; otherwise it removes the token. Re-registered
  daily; a token unseen for 60 days is pruned by cron. Sign-out removes it; Delete Account cascades.
- **On the phone:** channel `shared-groups` ("Shared Groups"); with the app open the push isn't
  shown (realtime already pulled); a tap opens that group (`NotificationTapBoot`).
- **Builds without Firebase** (no `google-services.json`) can't get a token — push is skipped
  quietly; realtime still works. Server pushes ignore the app's quiet hours and daily cap.

---

## 8. Mapping into the existing model

- **Member ids.** A synced group's local `members[].memberId` ARE the remote member ids, except the
  member I claimed, which stays `'me'` locally. Translate `'me'` ⇄ `group.shared.myMemberId` at
  the sync boundary only.
- **Start sharing (the first invite)** creates the server group and sends `group.meta`, one
  `member.add` per person and one `expense.upsert` per existing group expense. Local `c_<contactId>`
  ids are NOT rewritten: `shared.memberMap` maps them to the new server ids at the sync boundary.
  If the server can't be reached, the group goes back to a plain local one (never stuck "pending").
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
- **NOT SYNCED for what can't be sent (Oct-15-2026):** an expense in a live group that was never on
  the server and can't be projected (e.g. no split) gets `syncRejected = UNSENDABLE` from
  `planOutgoing` — same chip as a skipped one — and clears when it becomes sendable. Before this it
  stayed on the phone silently (how the duplicate-self bug hid).
- **Remote txns are not bank txns:** they never get an account by themselves (one recorded as
  mine can be linked by hand, §13), never match SMS, and the backup `TXN_FIELDS` allow-list gains
  `syncOrigin`.
- **Clean Up History** never removes a live shared group (I'd still be a member on the server);
  once sharing has ended it can go like any other group.

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
| My offline change is invalid by the time it reaches the server (e.g. includes someone who left) | A NEW expense or settlement the rules skip shows **NOT SYNCED**; Edit fixes it and it goes out. An EDIT the rules skip is replaced by the server's version (known gap: silently). The app prevents the usual causes — past members aren't offered in new splits, and their expenses' money is locked. |
| Who may delete (decided Oct-15-2026) | **Any member**, like editing — the creator-only rule is gone (it made deletes, untags and ignores of someone else's expense bounce back or loop). |
| Edit and delete of the same expense | Delete wins, in any order. |
| Two phones edit the same OLD (checkpointed) expense | Each correction names the correction it was built on (`base`); the fold keeps the latest per expense (`fold.corrections`, also in checkpoints) and refuses a stale one the same way everywhere. A phone still holding an unsent correction rebuilds it on top when it sees the other (`reconcileOutbox`), so the last edit wins and debts match the card. |
| Leave the group / remove someone | Allowed only when that person's balance in the group is ₹0 (app-enforced — the server can't see amounts). They're **archived**: still shown in old expenses, can't be added to new ones. **Remove (built Oct-15-2026):** Members tab → ⋮ on their row → Remove From Group (`removeSharedMember`). **Any member** may remove anyone at ₹0; for someone who joined it also ends their server access (`remove_member`). If that server step fails, the row keeps offering Remove so it can be retried. |
| Someone left or was removed — what others see (confirmed Oct-15-2026) | They stay in the group's history: every past expense and settlement keeps them (balances must still add up, and every phone must compute the same from the same history). Members tab lists them under a collapsed **Past Members**. Their own phone keeps a read-only copy (**Sharing Ended**: no Add Expense / Edit Group / Group Zone / Add Member, hidden from group pickers, zone turned off) they can delete. |
| **Add Back** (built Oct-15-2026) | Any member, from Past Members → ⋮ → Add Back to Group: `readd_member` (migrations `20261017000000_add_back.sql`, `20261019000000_any_member.sql`) re-adds a FORMER member (their leave/removal marker must be in the history — after dormant compaction it may not be → new invite). No link: their phone still has the key and `syncAllSharedGroups` re-activates its ended copy when the server lists them again. Not for deleted accounts. Becomes per-user-key work once key rotation exists. |
| Someone who LEFT comes back (new invite) | They're their OLD member again: `member_joined` un-archives the member that user had claimed, on every phone; their phone adopts it (`commit`: the member holding my user id is me) and a "Sharing Ended" copy goes live again. |
| Someone REMOVED comes back with an invite (decided Oct-15-2026, revised the same day) | They join as their old self, like someone who left. A member giving them an invite is the group's say-so; the server no longer keeps a removal list (`group_removals` dropped by `20261019000000_any_member.sql`). |
| Someone deleted their account | Their member is a past member on every phone (`membersFromFold`): tagged Deleted Account, under Past Members, out of new splits, and the money of their old expenses locked like anyone who left. Their balance can still be settled. |
| Delete Group (a local or "Sharing Ended" copy) | `detachFromGroup`: an expense paid from my account stays as my plain expense; one someone else paid, or a synced "you paid" never linked to an account, goes — kept, it counted as my spend (found Oct-15-2026: a ₹1,000 "Rahul paid" became ₹1,000 of mine). The group's Lent/Borrowed rows go with it, as before. |
| A "Sharing Ended" copy goes live again (Add Back, rejoin) | It takes the server's history first (`resync`): what was changed in the ended copy is overwritten, never sent. |
| Someone added later belongs in an earlier expense | Allowed: edit that expense and add them (Splitwise does the same). |
| Expense edited after someone settled | Allowed; balances recompute — **unless someone in it has left** (below). |
| Expense or settlement involving someone who has LEFT (decided Oct-15-2026) | Nothing may move their balance: they left at ₹0 and aren't there to see it. Fold rule `movesPastMember` → `past_member` for an edit, delete or correction that changes their net. Title, category, date and note still edit. The app enforces it first (`pastMemberIn` in split.js): the edit form locks amount/split/group with a reason, the review card hides Ignore/Delete/group change, and the store refuses delete/ignore/untag/move and keeps the money in `updateGroupExpense`. **Add Back** unlocks it. Once sharing has ended on this phone it's a local group again. Replaces "settle with someone who left" — that case can no longer arise. |
| Duplicate expense or settlement, overpayment | Nothing special — counted as entered. |
| Joining a trip I already tracked on my own | Joining always creates a fresh synced group. Nothing is merged or moved; the old local group is the user's to delete. |
| Other parts of the app change a synced expense (ignore, untag, SMS refund, cleanup…) | ONE check point, not per action: after every store write, diff the synced groups' shared fields against what was last sent and queue events from the difference. Any member can edit any expense (§6); a custom category reads as "other" to the others, and the note stays local. |
| App update changes a validation rule | Rules are frozen per event `v`. New rules → new `v` + `minSupportedVersion` bump in remote config, so no two live versions disagree. |
| One bad event in a batch | NOT built: the server rejects the whole batch and `doFlush` stops there. Structural limits (size, batch) are checked on the phone before sending, so this needs an app bug — then the outbox is stuck until fixed. |
| Someone is removed | V1: server access ends (row-level security). No key rotation yet; `key_epoch` is reserved for it. |
| Unsent changes when sharing ends (I left, was removed, or everyone else left) — groups no longer end from inactivity (§9) | The group shows Sharing Ended; local data stays. |

---

## 8b. Checkpoints (decided Oct-14-2026)

A checkpoint is an encrypted `group.checkpoint` event: meta, members (who's who, archived),
active/deleted users, and **who owes whom per pair** — no expenses. Built by `buildCheckpoint`
(`fold.ts`), posted with `append_checkpoint`, which the server accepts only while its `baseSeq`
is still the latest (so it never races a new expense).

- **When:** the next phone that syncs after the group has been quiet for
  `SHARED_CHECKPOINT_SETTLED_QUIET_MS` (7 days, everyone at ₹0) or
  `SHARED_CHECKPOINT_UNSETTLED_QUIET_MS` (30 days), with nothing waiting to send and no earlier
  disagreement (`checkpointDue`). Skipped if it would exceed the 16 KB event limit
  (`MAX_CIPHERTEXT_CHARS`). Built Oct-14-2026.
- **Verify or adopt.** A phone holding every event up to `baseSeq` VERIFIES it against its own
  state; if they differ it keeps its own numbers and sets `checkpointMismatch` — the Members tab
  then asks to compare with the group before settling up, and one Sentry warning goes out
  (`sync/report.ts`, the seq only). A phone missing history (late joiner, restored phone — it sees a seq gap) ADOPTS it:
  people and per-pair debts, `historyFrom` = the checkpoint.
- **Frozen.** Every entry before a checkpoint is frozen on every phone: kept for display, ignored
  by the rules. A phone that never saw it is in the same rule state, so phones stay in step.
- **Editing an old expense** still looks like a normal edit. For a frozen one the app sends an
  `expense.correct` (`buildCorrection`): the change in who-owes-whom plus the new version for
  display. Phones with the original update that same transaction in place and add the version
  to its edit history; a late joiner only sees its balances move. Balances are identical to a
  plain edit (tested, incl. a late joiner).
- **Maths unchanged.** Same split code, same rule (each sharer owes the payer). Balance = the
  checkpoint's opening position + everything after; integers in paise, so no drift.
- **Fresh start** after a checkpoint continues in the same group — same people, invite and key;
  nobody re-uploads anything.
- **Compaction** runs only on DORMANT groups (90 quiet days, §9): events before the latest
  checkpoint are dropped. `compact_groups` (all groups at once) stays unscheduled. A late joiner
  after that gets balances, not the older expenses, until history sharing (phase 5) exists.
- **Keeping full history instead** = remove the `delete from group_events` in `purge_expired`;
  nothing on the phones changes.

---

## 9. Sharing ends — only when people leave

**Decided Oct-15-2026: a group never ends from inactivity**, and there is no "Share Again" —
it would have meant new invites for everyone. Migration `20261016000000_dormant_groups.sql`:

- Every data event sets `expires_at = now + 90 days` (a checkpoint doesn't — it isn't activity).
- Daily `pg_cron` (`purge_expired`, 03:00 IST): a group past `expires_at` goes **dormant** —
  if it has a checkpoint, events before it are deleted and `expires_at = infinity` until the next
  change; without one it keeps its events and is looked at again the next day. Cost: the group
  row, its members and a ~1–2 KB checkpoint.
- **The next change wakes it**: `append_events` clears `dormant_at` and resets the 90 days. Nothing
  changes for the phones — same group, same key, same members; a phone that was offline through
  it sees a seq gap and adopts the checkpoint (§8b).
- `is_member` no longer looks at expiry, so nothing is hidden.
- A group ends only when people go: Leave (₹0), removed by a member, Delete Account — or the
  last member leaving (the server deletes it). Then the app marks it "Sharing Ended"; local
  data, balances and Lent/Borrowed rows stay as a read-only copy (§8a) the user can delete.
- Phone-side mirror: `SHARED_SERVER_IDLE_MS` in `src/constants/retention.ts`.
- **"Not synced" is exact:** a change is flagged only if it was SENT (its outbox item has a seq),
  the history now covers that seq, and the entity isn't there (`skippedBySend`).
- Compaction keeps the dropped events' ids (`group_compacted_ids`), so a resend of one after it (a
  restored phone's outbox, a retry) is still recognised by `append_events` and never counted twice.

---

## 10. Delete Account

Order in `SettingsScreen` `handleDeleteAccount`:

1. If the user has a sync account (`syncAccount`) and is offline, **block the delete** with a
   connect-and-retry message. Unlike the Google revoke, this can't be best-effort: once the phone
   is wiped, nothing can ask the server to delete later.
2. Edge Function `delete-account` (Supabase JWT):
   - calls `purge_user(uid)`, which removes the user's memberships, writes a `member_deleted`
     marker into each group, deletes any group left empty, and deletes their invites;
   - then deletes the auth user. Their events **stay** (encrypted), still under their author id —
     a random uuid of an account that no longer exists. It used to be cleared, and then a phone that
     rebuilt the history later (a new member, a restore) skipped those events and computed different
     balances (found by the scenario suite; fixed by `20261018000000_removals_authors_compaction.sql`).
     Members tabs show them as **Deleted Account**.
   - Unsettled balances do NOT block Delete Account (Play requires deletion to always be
     available); only Leave Group needs ₹0. With a sync account, the confirmation adds: "You
     also leave every shared group; what you added stays in their history for the other
     members." Push tokens go with the auth user (cascade).
3. Then the existing steps: `deleteAccount()` (Google revoke) → `deleteAllUserData()` →
   `flushAppStorage()` → `Storage.wipeEverything()`.

Other members' phones: nothing changes in the history or balances. On the marker they show that
person as "Deleted Account"; their expenses stay — any member can still edit them (§6), and
delete them now that the author is gone.

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
5. **Push (phase 4), once for all variants — PENDING (Oct-15-26: creds added later).** Android
   push tokens come from Firebase Cloud Messaging, even though the server talks to Expo. Free
   (FCM on the Spark plan; Expo push is free too):
   - console.firebase.google.com → Add project (Analytics off) → Add app → Android, once per
     package: `com.epurse.app`, `com.epurse.app.dtest`, `com.epurse.app.dprod`,
     `com.epurse.app.stest` → download **`google-services.json`** (one file covers all four) into
     the repo root. `app.config.js` picks it up only if it exists.
   - Firebase → Project settings → Service accounts → **Generate new private key** (JSON) →
     expo.dev → project `epurse` → Credentials → Android → each package → **FCM V1 service
     account key** → upload. That key stays on expo.dev; never commit it.
   - Rebuild the app (native change).
6. **Invite links open the app** — deploy the `epurse-web` site (it has the `/join` route and
   `public/.well-known/assetlinks.json`; the host must serve that as `application/json` with no
   redirect, and `/join` → `join.html`), then rebuild the app (new intent filter). Check with
   `adb shell pm get-app-links com.epurse.app.dtest` → `epurse.co.in: verified`.

## 12. Phases

1. **Sign-in — code DONE (Oct-13-2026).** Lazy sign-in with the ID token, session storage,
   sign-out, the `delete-account` Edge Function and the Delete Account change (§10), feature
   flag. Not yet exercised against a real project: there's no entry point until phase 2's
   Start Live Sharing.
2. **Groups, invites, keys — code DONE (Oct-14-2026), not yet tried on a device.**
   `src/sync/groupSync.ts`. **A shared group goes live on its FIRST invite** (decided Oct-14 —
   no "Start Live Sharing" step; until someone is invited nothing leaves the phone). Invite:
   ⋮ → Invite People asks **"Who's This Invite For?"** (everyone not joined yet, or Someone New),
   or Members tab → **Invite** next to a person. A link for a person carries `&m=<memberId>`, and
   their phone becomes that person; a Someone New link adds them under their own name. **The joiner
   is never asked** (decided Oct-15-2026): the app can't match a Google account to a name the inviter
   typed from contacts, and the inviter is the one who knows. If that name was taken meanwhile they
   join as a new person; a join cut short finishes by itself on the group's next sync (`doFlush` →
   `doFinishJoining`; one group's sends, pulls and joins run one at a time). Members tab tags come
   from `memberStatus` (Joined / Not Joined / Left / Deleted Account; none on my own row). Join (Groups tab header → `JoinGroupScreen`, paste the link — or the whole shared
   message; `parseInviteLink` finds the link in it), Leave Shared Group (₹0 only; replaces Delete
   while live), Edit Group (name/emoji/colour, new people, renames — sent by the engine's subscription). Pull on GroupDetail focus and
   on Groups tab focus (`syncAllSharedGroups`, which also marks groups the server dropped as
   "Sharing Ended"). Test builds have sharing ON (`useSyncEnabled`). **Expenses don't sync yet**
   — that's phase 3. Invite links open the app since Oct-15 (§5). **QR invite (Oct-15):** Create
   Invite opens a sheet with the link as a QR code (scan with the phone's camera — no in-app
   scanner, no camera permission) + Share Link (`components/QrCode`, vendored `utils/qr/toqr.js`).
   Removing a person who's already on the server isn't offered in Edit Group (they leave at ₹0).
3. **Expense sync + offline — code DONE (Oct-14-2026), not yet tried on a device.** §7: one
   check point out, one write in, outbox on the group, NOT SYNCED chip. **Settlement sync —
   code DONE (Oct-14-2026)**, pulled forward from phase 5 (§7 Settlements).
4. **Realtime poke + push — code DONE (Oct-15-2026), not yet tried on a device** (§7a). Migrations
   are on the test project (Oct-15); prod needs `supabase db push`. For push only, the
   Firebase steps in §11.5 + a rebuild — **Firebase PENDING**; until then push is skipped.
5. **Deferred:** history sharing for late joiners (only matters after a group goes dormant) and
   key rotation on removal (needs per-member key pairs; the server already cuts off removed
   members). Done: settlement sync (§7), never-ending groups (§9), remove someone (§8a), restore
   verified (§5), mismatch notice (§8b), Delete Account wording (§10) — all Oct-15.

### Files

| New | Purpose |
|---|---|
| `src/sync/config.ts` | ✅ projects (test/prod), `isSyncEnabled` |
| `src/sync/client.ts` | ✅ Supabase client, session storage |
| `src/sync/session.ts` | ✅ lazy sign-in, sign-out, `deleteSyncAccount` |
| `src/sync/crypto.ts` | ✅ key gen, encrypt/decrypt with AAD, uuid, sha256 (pure) |
| `src/sync/events.ts` | ✅ event types, frozen v1 limits, strict parser (pure) |
| `src/sync/fold.ts` | ✅ events → members, entries, balances; the rules (pure) |
| `src/sync/api.ts` | ✅ one function per RPC + event/member reads; server errors → `SyncError` |
| `src/sync/errors.ts` | ✅ `SyncError` codes + user-facing messages |
| `src/sync/localGroup.ts` | ✅ server ⇄ local members (`memberMap`, `'me'`), edit planning (pure) |
| `src/sync/groupSync.ts` | ✅ phase 2 actions (start, invite, join, claim, pull, leave, push edits) |
| `src/screens/JoinGroupScreen.tsx` | ✅ paste link → Join (nothing asked) |
| `src/sync/expenses.ts` | ✅ `projectExpense`, `planOutgoing`, `planIncoming` (pure) |
| `src/sync/settlements.ts` | ✅ settle rows ⇄ `settlement.*` events, `lbRowMember` (pure) |
| `src/sync/checkpoint.ts` | ✅ `checkpointDue` — when a phone posts one (pure) |
| `src/sync/realtime.ts` | ✅ private `group:<id>` channels while open; poke → pull |
| `src/sync/push.ts` | ✅ register / remove this phone's Expo push token |
| `src/sync/engine.ts` | ✅ the store subscription + debounced send + foreground sync |
| `src/sync/invite.ts` | ✅ build/parse invite links (pure) |
| `supabase/migrations/*`, `supabase/functions/delete-account/` | server (✅ schema, ✅ keep-history delete, ✅ checkpoints, ✅ delete-account) |

| Changed | Why |
|---|---|
| `src/store/ePurseStore.js` | ✅ `setSharedGroupState` applies server changes in one write (no store version bump: new fields are optional) |
| `src/backup/payload.ts` | ✅ `syncAccount` in `STORE_KEYS`; `syncId`/`syncOrigin`/`syncRejected` in `TXN_FIELDS` |
| `src/utils/txnCardModel.ts` | ✅ NOT SYNCED chip |
| `src/types/group.ts` | ✅ `Group.shared?: GroupShared` (remoteId, keys, keyEpoch, myMemberId, memberMap, fold, status) + `GroupMember.archived` |
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
  - direct inserts are denied;
  - an invite can't be redeemed twice or after it expires;
  - `append_events` is idempotent;
  - `purge_user` keeps every event (history intact) and removes only memberships and invites.

---

## 12a. Known limitations (accepted Oct-15-2026)

Kept on purpose; each is solved by a setting, not new machinery.

The Drive backup holds no server data, only what's needed to reconnect: keys, last-seen seq,
member map, outbox and `syncAccount`. A restored phone signs in with the same Google account
(sign-in is Google-only, so it always is) and pulls everything after the backup's seq. Shared
groups therefore recover past the backup point; personal data only up to it.

| Case | Effect | Fix when needed |
|---|---|---|
| Group goes dormant (90 quiet days) between a backup and its restore | The restored phone adopts the checkpoint: balances and people right, expenses added in that window never show as transactions | Raise the dormant days, or keep full history until settled (`purge_expired`) |
| Late joiner after a group went dormant | Sees balances, not the older expenses | Same as above |
| The user's own group expenses added after the last backup | Come back from the server as group entries with no account (`accountId: null`): group balance right, the bank account balance misses that debit | Regular automatic backups (planned: on the user's chosen time slot) |
| Anything personal after the last backup | Lost — no server copy, by design | Regular automatic backups |
| Bank SMS for such an expense read again after restore | Could show the spend twice (group copy + new plain transaction); group copies never match SMS | Regular backups shrink the window; matching can come later |

## 13. Defaults to confirm

- Any member can invite (Splitwise-style); there is no admin (§1).
- The note is never shared; the title (merchant) is.
- Someone records that **I** paid: on my phone it books my "lent" rows with no account movement.
  **Built Oct-15-2026:** the detail sheet's Account row says "Not From an Account"; Edit starts on
  that too (`AccountField` `noneLabel`) instead of the primary account, and picking an account
  debits it (`updateGroupExpense` never auto-books a `syncOrigin: 'remote'` expense). Deleted on
  the server after I linked it → it stays as my plain expense, like my own. Also how a restored
  phone re-links its own expenses (§12a).
- Max 50 members per group, 100 groups per user, 50 events per batch, 16 KB per event.
