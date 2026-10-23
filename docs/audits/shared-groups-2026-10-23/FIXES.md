# Shared-groups audit: status after fixes (Oct-24-2026)

What happened to each finding in [REPORT.md](REPORT.md). Server changes are in
`supabase/migrations/20261024000000_audit_fixes.sql`. App changes are in `src/sync/`. The design is
in `docs/SHARED_GROUP_SYNC.md`, §13a.

**How it's tested:**

- `npm run test:sql` (new): every migration, in order, on real PostgreSQL (PGlite).
- `npm run test:sync`: the ledger rules. The audit's probes are now regression tests in its "audit fixes" section.
- `npm run test:groupScenarios`: many phones against the fake server, scenarios AU1–AU5.

`reproduce.mjs` is kept as the auditor wrote it. Its probes assert the old behaviour, so most of them now fail (see the notes below).

## Priority findings

| # | Finding | Status | What changed |
|---|---|---|---|
| F01 | NULL token bypasses invite check | **Fixed** | `redeem_invite` refuses NULL and short tokens and compares with `IS DISTINCT FROM`. Every RPC refuses NULL inputs (`append_checkpoint` with a NULL base seq used to skip its race check). Malformed token hashes can't be stored. |
| F02 | Checkpoint trust and compaction | **Fixed** | Compaction deletes only up to a checkpoint that another member's phone has checked against its own full history (`ack_checkpoint`, `verified_checkpoint_seq`). The author can't vouch for their own. Our phones read their own checkpoint back before posting it. A disagreement still keeps the phone's own numbers and shows "Balances differ". |
| F03 | Frozen expense ID reused → counted twice | **Fixed** | Checkpoints carry tags of every frozen entry, and a frozen ID sent as new is refused on every phone. An edit that loses the race with a checkpoint is re-sent as a correction (scenario AU1). |
| F04 | Correction of an expense that never existed | **Fixed** | A correction must name a frozen expense that every phone knows about (the tags). |
| F05 | Invite identity not bound | **Fixed** | The invite stores which member it's for. Redeeming stamps that member on `member_joined`, and the rules allow only that claim. A plain invite joins as a new person ("add myself"). Claims made before 2026-11-01 (server time) still replay, so existing test groups and phones still on an older build keep working until then. |
| F06 | Remove/leave RPCs bypass settle-first | **Fixed in the ledger** | Losing access any way at all makes the person a past member, with their balance kept and locked until they're added back. The server still can't see balances, so it can't refuse the call itself. |
| F07 | Peers can change my bank bookkeeping | **Fixed** | A change by someone else to the amount or payer of my bank-recorded expense isn't applied. My phone re-sends the bank version, which wins as the newest. Split, title, date and category changes still apply. Manual entries are unchanged. |
| F08 | `assetlinks.json` trusts the debug key | **Open: release task** | Already on `docs/ANDROID_RELEASE.md` Track D: swap in the upload and Play signing SHA-256s. |
| F09 | No invite revocation | **Partly fixed** | A member's unused invites stop working when they leave or are removed. Invite list/revoke UI and key rotation are deferred. |
| F10 | Contact fingerprints | **Deferred** | Fingerprints only link contacts and never decide a balance. Country codes don't matter while the app is India-only. |
| F11 | Valid expenses → unreadable checkpoint | **Fixed** | Checkpoint debts have their own safe-integer cap, and the checkpoint is validated before it's posted. |
| F12 | Sync failure under-reported | **Fixed** | Failed syncs retry with backoff and jitter. A realtime reconnect triggers a catch-up pull. The status shows "Not synced" or "Balances differ" instead of always "Live". Group ⋮ has a Sync Now action. |
| F13 | Notifications off while offline | **Fixed** | The token is kept marked until the server confirms it's removed. A permission revoked in the OS removes it too. |
| F14 | Limits checked before locks | **Fixed** | Group row lock and per-user advisory lock come first, then counts. Membership is re-checked after the wait. Not tested with two real sessions (PGlite has one connection). |
| F15 | No event-volume bound | **Deferred** | Post-launch. |
| F16 | Wrong or missing key recovery | **Deferred** | Post-launch. |
| F17 | Test and prod share one backend | **Open: release task** | This is the temporary setting from Oct-15 for stage-prod testing, tracked in Track D. A real prod project is needed before launch. |
| F18 | ₹0.01 from a checkpoint dropped | **Fixed** | A one-paisa difference is ignored only when this phone has rows it could come from (rounding). A balance known only from a checkpoint now gets its Earlier Balance row. |

## Product drawbacks

| Item | Status |
|---|---|
| Push capped at 100 tokens | **Fixed:** each member's 2 newest phones, ≤ 100 (one Expo request). |
| Generic error messages | **Fixed:** open-invite limit, group full, signed out, stale key epoch and bad request now have their own messages. |
| Add Back fails after compaction | **Fixed:** former members are kept in `group_former_members`. |
| Everyone may edit/delete; no confirmations, receipts or duplicate detection | **Kept** (product decision): the edit history is the safeguard. |
| No multi-currency | **Kept:** INR only. |
| Notes, location and custom categories not shared | **Kept:** they stay on each phone. |
| Detail lost to compaction; no clean-install recovery | **Kept:** accepted restore limits (`SHARED_GROUP_SYNC.md` §12a). |
| History page capped at 100, membership audit trail, 50 vs 100 limits, contact-hash cost | **Deferred** |
| `session.ts` reuses a session when `googleEmail` is absent | **Deferred:** intentional for restored phones before Google sign-in; needs lifecycle tests. |

## Release items that need a person

1. Run `supabase db push` on the test project (the migration isn't applied yet), and later on prod.
2. From Nov-01, builds without these fixes can't create or join groups: phones on the new build refuse their claim events. Put every test phone on the new build before then, and recreate any group an old build creates after that.
3. Separate prod Supabase project (F17). Production signing fingerprints in `assetlinks.json` (F08). Firebase for push.
