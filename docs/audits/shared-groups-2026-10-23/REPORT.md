# ePurse shared groups: security and functionality audit

**Reviewed:** 23 October 2026 (India time). **App:** 1.5.0. **Repository HEAD:** `a7fbe7ff11d5e901a01c42dd58fc51758c31ec0e`.

## Assessment

The feature has substantial functionality and a good confidentiality foundation, but **I would not approve unrestricted production rollout of shared groups yet**. The main weaknesses are authorization, identity binding, and the integrity of checkpointed history—not the choice of encryption algorithm.

Eight local probes reproduce defects or limitations. Several additional problems are evident in the effective SQL migrations and client code. Passing the existing group tests does not cover these cases. The most important findings are:

1. A NULL invite token bypasses the SQL token comparison when an attacker knows a usable invite ID.
2. A member can nominate a false or unreadable checkpoint that later becomes the retained source of truth.
3. Reusing an expense ID after a checkpoint adds the amount again and replaces its local version history.
4. Invite recipients are not bound to the identity they claim inside a group.
5. Direct membership RPCs bypass the advertised settle-before-removal workflow.
6. Shared edits can change another user's locally recorded bank-account balance.
7. Test and production builds point to the same Supabase project, defeating the documented environment separation.

These findings do **not** establish theft of actual bank funds, a break of XChaCha20-Poly1305, or unauthenticated access to arbitrary groups. Most attacks require group membership; the invite-token issue requires an authenticated account and a known, usable invite ID. Deployment-specific exposure remains unverified.

## Scope, evidence, and limits

Reviewed the group screens and forms, split and settlement paths, store integration, every module under `src/sync`, all eight SQL migrations in order, the account-deletion function, encryption/storage and backup integration, notifications, and the related tests. Also inspected the adjacent website's invite landing page and asset-links source because they carry the group key.

Evidence labels used below:

- **Reproduced:** executed against the real local fold/parser functions using synthetic data.
- **Source-confirmed:** follows directly from current implementation; no production request was made.
- **Deployment check:** source or documentation indicates a concern, but hosted configuration or device behavior must still be checked.
- **Product tradeoff:** intentional behavior with meaningful consequences, not automatically an authorization defect.

The report is a source audit with local execution, not a completed live penetration test. No live group, production database, user account, or real financial record was modified. No two-device Android/iOS run was performed. The public asset-links URL could not be fetched by the browsing tool. Current hosted migrations, Auth settings, database grants, cron execution, FCM delivery, and release signing were not verified. No dependency advisory scan was performed, so this report makes no claim that every dependency is free of vulnerabilities.

Only this report and its reproduction/evidence files were added. The existing modification to `src/screens/MonthlyRecapSummaryScreen.tsx` was left untouched.

## Functionality map

| Area | Implemented behavior | Main limitation or risk |
|---|---|---|
| Personal groups | Local grouping, totals, presentation settings | Not a shared workspace |
| Shared-type local groups | Members, splits, ledger balances before inviting | “Shared” does not mean uploaded until first invite |
| Start sharing | Lazy Google/Supabase sign-in; random group key; initial metadata, members and expenses queued | Creation and network failure recovery need real server testing |
| Invitations | Single-use, 48-hour tokens; URL fragment contains token and key; QR/share sheet; named or generic invitation | No revoke/list UI; identity hint is editable; bearer link conveys access |
| Join | Redeem, download/decrypt, claim named member or create new member; interrupted joins can retry | No verified binding of recipient to ledger identity; damaged-key recovery gaps |
| Expenses | Equal/custom splits; payer and shares; edits, delete/untag/ignore; transactions attached to existing groups | Everyone can change shared facts; remote changes affect local accounting |
| Wire validation | Integer paise, bounded fields, shares sum to total, valid IDs | Aggregate limits and frozen-entity semantics are incomplete |
| Settlement | Group-specific ledger settlements, account-backed or ledger-only entries; partial allocation through broader ledger flows | No payment execution or receipt verification; duplicate payments can be recorded twice |
| Offline sync | Durable outbox, server event IDs, per-group sequence, batching, pull/send/pull, serialized flushes | Event-triggered retries; no explicit durable retry/backoff state |
| Realtime | Private per-group channels carrying sequence notifications | No subscription-status recovery or periodic catch-up shown |
| Push | Generic activity text, excludes sender, ten-minute group cooldown | Token-removal retry lost; recipient cap; delivery receipts not processed |
| Membership | Archive at zero in normal client flow; remove, leave, add back, account deletion | RPC bypass; no consent on add-back; no key rotation |
| History | Who edited/deleted an expense, versions, before/after details | Group list capped at 100 items; old server detail compacted; no recovery workflow for disagreement |
| Checkpoints | State snapshot after 7 settled / 30 unsettled quiet days when a phone syncs | A member controls snapshot contents; fresh phones must trust it |
| Retention | After 90 quiet days, old events before checkpoint compacted; group persists | Detailed history unavailable to a fresh phone; retained deduplication IDs still grow |
| Contact linking | Group-keyed phone fingerprints; automatic contact matching; manual linking/name suggestions | Self-asserted numbers and writable fingerprints are not identity proof |
| Restore | Encrypted backup contains keys, fold, mappings and outbox; session excluded | No independent key recovery; old backup + compacted server is a critical scenario |
| Delete account | Verified JWT; service role restricted to function; memberships purged before Auth user deletion | Historical encrypted records remain for other members by design |

## Priority findings

### F01 — High: NULL token bypasses invite authentication

**Source-confirmed; validate against isolated PostgreSQL before shipping the fix.**

The effective `redeem_invite` function tests `inv.token_hash <> extensions.digest(p_token, 'sha256')`. With an existing invite and SQL NULL token, the comparison evaluates to NULL. `IF` does not enter its rejection branch for NULL. An authenticated caller who knows a currently usable invite ID can therefore redeem it without knowing the token.

The key is not returned, so this does not alone decrypt expenses. It does grant membership: the caller can fetch ciphertext and membership metadata, consume the invite, call membership-management RPCs, and submit malformed event/checkpoint payloads. The unpredictable invite UUID remains a prerequisite; this is not evidence of a practical UUID guessing attack.

**Evidence:** [effective invite function](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261019000000_any_member.sql:59). PostgreSQL documents that an `IF` branch runs only for a true condition: [PL/pgSQL conditionals](https://www.postgresql.org/docs/current/plpgsql-control-structures.html#PLPGSQL-CONDITIONALS).

**Fix:** reject NULL and malformed tokens explicitly; use `IS DISTINCT FROM` for the digest comparison; validate token-hash length at creation. Add actual SQL tests for NULL, empty, wrong, expired, revoked, consumed, and correct tokens. A small SQL-only semantic probe accompanies this report.

### F02 — High: checkpoint trust can corrupt recovery or destroy recoverable history

**Reproduced for divergent balances; source-confirmed for compaction risk.**

`append_checkpoint` checks membership, base sequence, epoch and table constraints, then marks the supplied ciphertext as the checkpoint. It cannot establish that this payload is a valid snapshot or that members agree with it. A malicious member can supply an authenticated-but-false snapshot or simply unreadable content. After dormancy, `purge_expired` deletes earlier events based on this server pointer.

A phone with complete history rejects a false snapshot and retains its own balances. A phone without that history adopts it. The reproduction gives the first phone a ₹100 debt and the second phone ₹0. An unreadable retained checkpoint can instead prevent a fresh client from reconstructing membership and history at all. This invalidates the unconditional “every phone agrees” guarantee.

**Evidence:** [checkpoint RPC](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261016000000_dormant_groups.sql:134), [adoption/verification](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:283), [compaction](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261018000000_removals_authors_compaction.sql:217). Reproduction probe 3.

**Fix:** suspend irreversible deletion based on a single unverified snapshot. Introduce a checkpoint digest and independent acknowledgements under a documented trust policy, retain recoverable previous snapshots/history, and require trustworthy validation before pruning. A single member's signature establishes authorship, not correctness. Quarantine disagreement and require explicit recovery before settlement; the current warning alone does not repair state.

### F03 — High: frozen expense IDs can be reused and counted again

**Reproduced.**

The fold's `live()` helper hides frozen entries. `expense.upsert` then treats their IDs as new, adds the full amount, and overwrites the existing entry. In the probe, the same ₹100 expense is submitted under a new event ID after checkpointing: debt becomes ₹200, while the entry contains only one version.

This requires a crafted event or a timing race; normal outgoing reconciliation tries to convert frozen edits into corrections. However, another phone can post a checkpoint between the pull and append of an otherwise legitimate edit. The server does not compare an expense edit's base state. Event-ID deduplication cannot prevent this because the new edit has a new event ID.

**Evidence:** [upsert fold](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:359), [outbox conversion](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/expenses.ts:50). Probe 1.

**Fix:** retain stable entity IDs/tombstones across checkpoints; reject ordinary upserts for frozen IDs; add expected-version/base-checkpoint semantics and retry stale edits as validated corrections. New and old clients must share the same rule, requiring a protocol/version rollout rather than silently changing historical v1 replay.

### F04 — High: correction payloads are trusted money adjustments without proof

**Reproduced.**

`expense.correct` accepts arbitrary `debts` for a nonexistent `correctsId` if its `base` equals that ID and the named members exist. It does not derive the delta from a verified original expense or ensure that the displayed replacement produces the stated debt delta. The probe adds ₹500 debt by “correcting” an expense that never existed.

Members already have broad permission to add expenses. The extra integrity problem is that displayed expense history can cease to explain actual balances, and the mechanism intended to preserve old expense correctness cannot verify it.

**Evidence:** [correction rules](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:398), [correction parser](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/events.ts:233). Probe 2.

**Fix:** preserve a compact authenticated entity registry with current canonical expense state or commitments; prove the before/after delta. If the original cannot be verified, expose an explicit balance-adjustment record with a reason and acceptance policy rather than presenting it as an ordinary edit.

### F05 — High: invite identity can be changed or claimed by the wrong person

**Reproduced at the authorization layer; source-confirmed in join flow.**

The URL's `m` member ID is not bound to the server invite. The server stores the invitation token hash but not its intended ledger identity. The fold permits any active user who has not claimed a row to claim any unclaimed member. Changing `m`, or submitting a claim directly, can attach the wrong account to an existing person's debts. “I'm Not Priya” is useful honest-user UX, not authentication.

**Evidence:** [claim rules](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:334), [join flow](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/groupSync.ts:279), [invite schema](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261013000000_shared_groups.sql:35). Probe 4.

**Fix:** bind the opaque intended member ID to the invitation and redeemed account, or use a signed encrypted binding verified by peers. Existing-identity claims should need inviter/member confirmation or verified recipient binding. Do not use self-entered phone numbers as the proof.

### F06 — High: remove/leave RPCs bypass the settle-first rule

**Source-confirmed RPC behavior; reproduced downstream fold behavior.**

The app sends `member.archive` at zero balance before removing membership. Direct calls to `remove_member` or `leave_group` do not require that archive. Removal works regardless of outstanding debts. `member_removed` removes the user from `activeUsers` but does not archive their ledger identity. Later expenses can still reference them even though they can no longer read the group.

Any member can also remove all others under the chosen policy; leaving last then deletes the server group. Existing copies remain, but server continuity and recovery are lost. Broad membership control is intentional; the promise that removal always requires settlement is not enforced at the authoritative boundary.

**Evidence:** [remove RPC](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261019000000_any_member.sql:12), [leave/helper](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261013000000_shared_groups.sql:117), [system fold](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:251). Probe 5.

**Fix:** reconcile server-access loss with ledger status regardless of entry path; explicitly preserve outstanding debt and freeze unsupported changes. Define the membership policy and use signed acknowledgements/validated state transitions if settle-first is a hard guarantee. An encrypted server cannot independently check balances by adding a simple plaintext SQL condition.

### F07 — High product-integrity risk: other members can alter local bank bookkeeping

**Source-confirmed and covered as expected behavior by existing scenarios.**

Remote expense edits update a local transaction's amount and payer. The store reverses its old account delta and applies the new delta, or parks/restores its account when the payer changes. Another member can therefore change a user's recorded account balance and private expense view through a shared edit, without that user's approval. This does not initiate a real bank transfer.

**Evidence:** [incoming projection](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/expenses.ts:294), [account changes](/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js:4287), scenario B3 in `groupScenarios.test.mjs`.

**Fix:** keep imported/account-backed cash movements immutable with respect to peer edits. Represent group allocation separately and ask the account owner to reconcile payer/amount changes. Clearly distinguish “group says you paid” from “your account recorded this payment.”

### F08 — High deployment check: invite links trust a public debug signing certificate

**Confirmed in adjacent website source; hosted state not verified.**

The website's `assetlinks.json` associates `com.epurse.app` with the public React Native debug certificate. Project documentation explicitly identifies this as a prelaunch task. A counterfeit installation under an authorized package/certificate combination can receive sensitive invite links. This is conditional on installation and link association; it does not mean another app silently replaces an installed properly signed production app.

**Evidence:** [asset links](/Users/praveenverma/Desktop/pvn/epurse-web/web/public/.well-known/assetlinks.json:1), [documented warning](/Users/praveenverma/Desktop/pvn/ePurse/docs/SHARED_GROUP_SYNC.md:122). The native fallback also uses `epurse://`, which lacks verified HTTPS domain association. Android explains how to verify deployed associations in [Verify App Links](https://developer.android.com/training/app-links/verify-applinks).

**Fix:** use the actual production/Play signing certificate on the production host, separate development associations, and test `pm get-app-links` on the installed release. Inspect EAS/Play signing, not merely generated Gradle defaults. Prefer verified HTTPS handling for secrets; document fallback risk.

### F09 — Medium: no revocation lifecycle for links and group keys

**Source-confirmed; partly an explicit roadmap limitation.**

There is a `revoked_at` field but no revoke RPC or invite-management flow. Removing an inviter does not revoke their still-open invitations. Removed users retain epoch-1 keys and can return through another still-valid invite, intentionally allowed by the latest migration. Add Back restores access without the former member accepting.

RLS blocks a removed user from directly fetching new rows; possession of the old key alone does not bypass RLS. But future ciphertext obtained elsewhere remains decryptable because no rotation occurs, and old link leaks cannot be cryptographically contained.

**Fix:** list/revoke invitations; revoke outstanding invitations on relevant membership changes; add new epochs and securely distribute keys to remaining members; require acceptance for add-back. Explain that removal cannot erase copies already downloaded.

### F10 — Medium: contact fingerprints can impersonate local contacts

**Source-confirmed; country-code collision reproduced.**

Every member can set another member's `phoneKey`. The group key needed to compute fingerprints is shared with every member, and mobile numbers are self-entered. A matching fingerprint silently links a member to a device contact, affecting names and Lent/Borrowed grouping. This is a convenience match, not authenticated identity.

`phoneDigits` uses the last ten digits; different international numbers can match. PBKDF2 slows guessing but does not prevent members testing plausible numbers. Fingerprints are excluded from checkpoints, so fresh phones after compaction can also lose matching information.

**Evidence:** [fingerprint update](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:329), [normalization](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/phoneKey.ts:24), [automatic linking](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/contactLink.ts:66). Probe 7.

**Fix:** separate contact convenience from identity trust, require confirmation for unverified matches, restrict updates to the linked identity, and use explicit country-aware normalization. Give users a way to review and correct links.

### F11 — Medium: valid expenses can create an unreadable checkpoint

**Reproduced.**

Individual amounts are capped at `MAX_PAISE`, but accumulated pair debts can legitimately exceed that cap. Checkpoint parsing applies the same per-debt cap. Two valid maximum-sized expenses create a checkpoint the app's own parser rejects. The posting path checks ciphertext size, not whether the constructed event parses successfully.

This is an extreme-value case, but it demonstrates a broken invariant: every reachable valid state must be serializable and recoverable. A larger, ordinary group can separately exceed the single checkpoint size limit; that path safely skips posting but leaves all history retained indefinitely.

**Evidence:** [debt parser](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/events.ts:145), [checkpoint posting](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/groupSync.ts:174). Probe 6.

**Fix:** distinguish per-transaction limits from safe aggregate limits, validate generated snapshots before sending, add numeric-overflow guards, and support chunked snapshots or a documented size ceiling.

### F12 — Medium: sync failure is underreported and recovery is trigger-dependent

**Source-confirmed; misleading status reproduced.**

Background flush errors are swallowed. Retries depend on another edit, screen focus, app foregrounding, or a realtime poke. Realtime subscriptions do not inspect subscription status or trigger a catch-up on successful reconnection. The “Live” label ignores last successful sync, mismatched checkpoints, and acknowledged-but-not-yet-folded outbox entries.

**Evidence:** [engine](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/engine.ts:22), [realtime](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/realtime.ts:48), [status](/Users/praveenverma/Desktop/pvn/ePurse/src/utils/groupSyncStatus.ts:16). Probe 8.

**Fix:** durable retry/error state, bounded exponential backoff with jitter, connectivity/reconnect catch-up, a last-synced timestamp, a Retry action, and visible unresolved/rejected changes. “Live” should not imply that a stale device is current.

### F13 — Medium: turning off notifications offline loses the unregister retry

**Source-confirmed.**

`unregister` catches the network failure and deletes the locally remembered token anyway. Once online with notifications still off, there is no saved token to unregister. The server may keep sending generic activity pushes until token pruning, potentially up to the 60-day retention window.

**Evidence:** [unregister](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/push.ts:74).

**Fix:** retain a pending-unregister tombstone until acknowledged. Also remove registrations when OS permission is revoked; currently a missing device token returns early. Process provider receipts to clean invalid tokens.

### F14 — Medium: quotas and authorization are checked before serialization

**Source-confirmed concurrency risk; not executed against PostgreSQL.**

The invitation redemption path counts group members before taking the group-row lock. Different invitations can concurrently pass the 50-member limit. Per-user group counts are not serialized across different groups, and invite creation counts open invitations without a lock. Membership checks in write functions occur before waiting on a group lock, allowing an already-started request to proceed after a concurrent removal unless membership is rechecked.

**Evidence:** [redeem ordering](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261019000000_any_member.sql:72), [append ordering](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261018000000_removals_authors_compaction.sql:151), [invite creation](/Users/praveenverma/Desktop/pvn/ePurse/supabase/migrations/20261013000000_shared_groups.sql:210).

**Fix:** take consistent group/user locks before checking mutable membership and quotas; revalidate after waiting. Add concurrent two-session SQL tests. Define whether a write admitted before revocation is allowed to complete.

### F15 — Medium: no effective event-volume or history-growth bound

**Source-confirmed application-layer gap; infrastructure limits unverified.**

The SQL enforces batch and individual ciphertext size, not an event rate or storage budget per user/group. A member can keep appending events. Local folds retain entry versions; live groups preserve detailed local data; server compaction retains an ID row per compacted event. “A dormant group costs ~1–2 KB” in migration commentary excludes those IDs and supporting rows/indexes.

**Fix:** enforce per-user/group rate and storage budgets, cap abusive histories, instrument pull/parse/storage costs, and benchmark large real histories. Design deduplication retention deliberately rather than assuming checkpoint size is total retained storage.

### F16 — Medium: incomplete recovery when a stored group key is wrong or missing

**Source-confirmed.**

For an existing local group, `joinFromLink` does not replace or validate its stored key using the newly supplied invite key. A fresh valid invite therefore does not necessarily repair an existing broken-key record. Regular pulls advance the sequence even when a data event cannot be decrypted; after correcting a key, skipped events need replay from an earlier cursor.

**Evidence:** [existing-group rejoin](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/groupSync.ts:288), [cursor before parse](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/fold.ts:432).

**Fix:** explicit key repair with validation against retained authenticated data, safe replay, and recovery status. Do not silently call an undecryptable group synchronized. Preserve enough state to distinguish malformed peer data from a missing local key.

### F17 — High operational risk: test and production share the same backend

**Source-confirmed; which build variants are deployed is unverified.**

`SUPABASE_PROJECTS.test` and `.prod` contain the same URL and publishable key. Comments claim test builds cannot reach production, and test builds force sharing on regardless of the production feature switch. In this checkout there is no backend isolation between those configurations.

RLS still applies, and the public publishable key is not itself a secret leak. The risk is that test accounts/traffic, experiments, and backend operations share the same Auth, database, quotas and lifecycle as production. A local feature flag is not a server authorization boundary.

**Evidence:** [environment mapping](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/config.ts:16).

**Fix:** use separate projects, credentials/configuration and migration targets. Add a release check asserting distinct test/prod project references; verify the installed release's resolved backend and actual deployment targets before any database maintenance.

### F18 — Low monetary-correctness risk: one-paisa checkpoint debt is omitted locally

**Source-confirmed.**

`planBalanceRows` drops differences of one paisa or less (`Math.abs(diff) <= 1`). For a fresh phone that knows a one-paisa debt only from a checkpoint, no Earlier Balance row is created. Leave validation still requires the exact folded balance to be zero. This can produce a small but persistent disagreement between the ledger offered for settlement and the leave rule.

**Evidence:** [balance projection](/Users/praveenverma/Desktop/pvn/ePurse/src/sync/balances.ts:55).

**Fix:** use the same exact integer-paisa policy for reconstruction, settlement and leaving, or make an explicit shared rounding/write-off event. Test a compacted group whose only remaining debt is ₹0.01.

## Product drawbacks and missing functionality

These are recommendations or intentional tradeoffs, not all security vulnerabilities.

| Gap | Consequence | Improvement |
|---|---|---|
| Everyone may edit/delete anyone's expenses and settlements | Trust depends on every member; a fake settlement can erase a debt in the ledger | Explain permissions before first share; offer confirmation/dispute or a stricter group mode |
| Both parties record one transfer | Two independent settlement IDs both count; scenario 23 explicitly accepts this | Shared payment reference, duplicate suggestion and receiver confirmation |
| No receipts or payment verification | Ledger is a record of assertions, not proof that money moved | Optional evidence attachments and pending/confirmed settlement status |
| No multi-currency wire model | Amounts are paise with no currency field | Clearly INR-only now; versioned currency/FX support if international trips are a goal |
| Notes/location/custom categories are not shared by the event schema | Members see different detail even when balances match | Mark local-only fields or extend the encrypted schema |
| Server compaction drops older expense detail | New members/restored phones may see balances without supporting bills; total-spend views based on local rows can differ | Show history start date/partial totals; optional encrypted history transfer/archive |
| Group history UI takes only the latest 100 items | Older still-local events are hard to find | Pagination, search/filter, export and explicit truncation notice |
| Group history primarily derives expense/settlement entries | Membership/invite/key changes lack an equally complete user-facing audit trail | Record and show security/membership transitions with actor and time |
| Add Back requires a retained leave/remove system row | After compaction the UI can offer an operation that fails | Persist former-member metadata or automatically guide to a new invite |
| 50 server accounts vs 100 ledger members | Two different “full group” limits; archived identities still consume fold capacity | Show active/total limits and prevent unsupported additions before saving |
| No self-service checkpoint disagreement repair | Warning leaves users to manually decide whose balance is correct | Export diagnostics without secrets, compare histories and perform explicit agreed repair |
| Generic errors for open-invite limits and other failures | Users cannot tell what action will help | Map limit, validation, authentication and retry errors precisely |
| Push sends at most 100 tokens for up to 50 members with 5 devices each | Older devices can miss notifications in a large group | Batch all recipients fairly; keep notifications advisory and catch up independently |
| Group-keyed contact hashing per address book | Work multiplies with groups and contact count; caches retain keys/numbers in memory | Benchmark on low-end phones; bound and clear caches; avoid unnecessary rescans |
| No independent shared-group discovery/key recovery on a clean install | Google sign-in alone cannot reconstruct encrypted groups | Explain backup dependence; secure re-invitation/device transfer recovery |

Additional identity lifecycle issue: `session.ts` reuses a Supabase session when `googleEmail` is absent (`!googleEmail || …`). Documentation says losing the Google identity causes a mismatch/sign-out, but that condition does the opposite. Normal explicit sign-out calls `signOutSync`, so this is not proof that ordinary sign-out fails. Add lifecycle tests for revoked Google grants, absent local identity, restore, account switching, and stale Supabase sessions; define which identity is authoritative.

## What is working well

- Authenticated encryption uses random 24-byte nonces and binds group ID, event ID and epoch as associated data. Existing tests cover wrong key, tampering and cross-group/event replay.
- Server reads are membership-gated by RLS; client writes use narrowly scoped security-definer functions with empty search paths. Internal helpers are revoked from client roles in migrations.
- Invite tokens use strong random bytes and hashed storage. Secret link fields are placed in fragments; the landing page source contains no third-party script in its own component and declares no-referrer. Parent layout and deployed assets still merit release verification.
- Integer paise and explicit shares avoid independent rounding decisions on receiving phones.
- Atomic store application reduces accidental feedback loops from received edits into outgoing events.
- Stable event IDs and retained compacted IDs address network retries and backup replay.
- The account-deletion function derives the user from a verified JWT instead of accepting an arbitrary deletion target.
- Encrypted SQLCipher/MMKV storage and encrypted backups protect stored state; Supabase sessions are excluded from backup.
- Existing scenario coverage includes interrupted joins/leaves, offline edits, compaction, restore-related state, account deletion, contact mapping, and local accounting.

These controls should be preserved while addressing the authority and recovery gaps.

## Executed validation

All **51 `test:*` scripts** were attempted: the main `npm test` chain stopped at `test:store`, then the remaining scripts were run independently. **45 scripts passed; 6 failed.** These are script-level counts, not counts of assertions.

| Suite | Result |
|---|---|
| `test:sync` | 228/228 passed |
| `test:groupScenarios` | 138/138 passed |
| `test:group` | 8/8 passed |
| `test:splitShares` | 17/17 passed |
| `test:settleAllocation` | 14/14 passed |
| `test:groupHero` | 12/12 passed |
| New audit probes | 8/8 confirmed current defects/limitations |
| `test:store` | 962/963; stale DashboardScreen source-location assertion appears to miss code moved to AwareRunBoot |
| `test:contrast` | 291/294; LB card threshold, acknowledgement button assertion, slate danger contrast |
| `test:headerLayout` | 130/131; layout configuration assertion |
| `test:profile` | 124/125; back-button structural assertion |
| `test:rewards` | 78/80; quick action and history MonthDivider assertions |
| `test:elevation` | 22/23; onboarding shadow opacity |

The six failures existed in the checked-out source before any application-code change by this audit. They are not all proven user-facing regressions: several inspect source structure. The store test specifically searches the old DashboardScreen implementation; `AwareRunBoot.tsx` contains the await-before-read sequence. Triage these failures rather than treating them as six security bugs.

The group scenario suite uses `_fakeSyncServer.mjs`, not PostgreSQL. It cannot certify SQL NULL behavior, grants, RLS, real transactions, concurrency, cron, Supabase Auth, Realtime reconnection, or native push delivery.

Run the added local probes from the repository root:

```sh
node --no-warnings --import ./src/utils/__tests__/_register.mjs docs/audits/shared-groups-2026-10-23/reproduce.mjs
```

The probes intentionally assert current bad behavior and should be inverted into regression tests as fixes land. They do not contact a server.

## Recommended implementation order

### Before expanding production sharing

1. Fix NULL invite authentication; add PostgreSQL authorization tests and audit all RPC nullable inputs.
   Separate test and production backends before running deployment or maintenance experiments.
2. Stop destructive compaction until checkpoint trust and recovery are sound. Validate every locally generated snapshot before submission.
3. Fix frozen-entity reuse and correction validation with versioned protocol rules and stale-client compatibility.
4. Bind invites/claims and make membership removal semantics enforceable and accurately represented.
5. Isolate private account cash movements from peer edits.
6. Verify production link associations/signing; implement invite revocation and define key-rotation behavior.

### Reliability and support

7. Add durable retries, reconnect catch-up, meaningful sync status, failed-change review, key repair and disagreement recovery.
8. Fix notification unregistration retry, delivery cleanup and recipient batching.
9. Enforce quotas under locks; bound event volume, memory and retained storage.
10. Resolve or update the six failing test scripts and add device/SQL coverage to release gates.

### Product polish

11. Add duplicate settlement detection, confirmations/disputes and optional receipt support.
12. Expose partial history, shared versus local fields, currency scope, membership limits and privacy semantics.
13. Add history pagination/export, invite management and secure new-device recovery.

## Release acceptance matrix

| Test | Required outcome |
|---|---|
| NULL/wrong/expired/revoked invite token | No membership, event, or invite consumption |
| Outsider reads/writes every table/RPC | Denied; internal helpers inaccessible |
| Concurrent invite redemption near limits | Quotas respected; deterministic retry behavior |
| Removal racing append/checkpoint | Behavior matches documented admission policy; no stale access surprises |
| Checkpoint with invalid or conflicting payload | Never causes irreversible loss of valid history |
| Checkpoint between pull and edit append | Expense is counted exactly once on all devices |
| Fabricated correction/mismatched delta | Rejected or shown as explicit approved adjustment |
| Modified named invitation / wrong claimant | Cannot take another person's identity silently |
| Peer edits an imported bank expense | Private recorded cash movement stays intact until owner reconciles |
| Remove/rejoin/add-back/key rotation | Access, keys, ledger status and consent all agree |
| Airplane mode → reconnect without navigation | Outbox and pulls eventually complete with accurate status |
| Kill app before/after append reply | No missing or duplicated expense/settlement |
| Restore old backup after server compaction | Deterministic balances; clear partial-history state; safe replay |
| Wrong stored key followed by valid invite | Validated key repair and replay recover the group |
| Notifications disabled offline | Eventual unregister is retried and confirmed |
| Two real phones, release builds | App Links, Google identity, RLS, Realtime, push and restore all verified |

**Release position:** suitable for continued controlled testing after the immediate authentication fix, with explicit trust limitations. A clean automated group test run alone is not sufficient evidence for general release.
