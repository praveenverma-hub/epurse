# ePurse App Log

A module-wise record of what's shipped and what's still open. Update this whenever a
feature lands or a bug is fixed — add a dated bullet under the right module's "Done"
list, and move/add to "Open" for anything discovered but not yet resolved. Keep entries
one line where possible; link a file/symbol name (greppable) instead of describing code.

---

## Transactions & Parser (SMS ingestion, categorisation, self-transfer, retention)

**Done**
- Three-gate accept filter (source/phrase/amount), merchant enrichment with two-tier
  categories + subscription detection, self-transfer auto-detect (dual-mask/phone/name/ref).
- Custom categories (user-created parents/children, merged everywhere via `useCategoryTree`).
- Non-spend single source (`NON_SPEND_CATEGORY_IDS`) — lent/borrowed/self/cc_bill excluded
  from every total consistently.
- Spend rules (Aug-2026): user picks which parent categories count as expenses at all.
- Account match fix: one shared `utils/accountMatch.js` for "which account", scored
  matching for same-last-4 cards across banks.
- Parser sweep (Aug-2026, 50-msg audit): fixed reversal-credit rejection, bare "returned"
  faking LB repayments, top-up rejection, junk merchants.
- E2E MVP acceptance pass (Sep-2026, `npm run test:e2e`): found and fixed 3 real bugs —
  cashback/discount "on \<date\>" colliding with the promo filter, cross-bank self-transfer
  needing transfer-language (not just ref) to link, verb-before-mask direction reversal.
- Bulk reconciliation test (Sep-2026, `npm run test:bulk`): 35-txn volume/cross-check pass,
  0 app defects — validates balances, spend stats, budget, groups and splits together.
- **Sep-6-2026: CC bill payment reconciliation fixes** (see Budget/Accounts below for detail).
- **Sep-6-2026: 4 more parser gaps closed** — merchant now resolves correctly for SIP/NACH
  toward a mutual fund (singular "toward" wasn't matched at all), a Groww mandate debit
  ("against your account" ran the capture past the payee with no stop word), and an
  Apple One autopay subscription (6-word merchant, capped at 5 — added "subscription" as
  a stop word). Also: Amex/IndusInd "Available Spends Limit" / "Clear Spends Limit"
  phrasing now correctly infers Credit Card (was falling through to Debit Card because
  the existing check required "limit" immediately after "available"/"avl"/"card", not
  allowing the word "Spends" in between). All in `messageParser.js`'s `MERCHANT_REGEX`
  and `inferAccountType`; see `.claude/skills/transaction-parser/SKILL.md`'s Known Gaps
  for the exact before/after on each.

- **Sep-6-2026: CC bill cycle date now captured and saved on the card.** New
  `CC_STATEMENT_DATE_REGEX` extracts the statement/cycle-close date (distinct from the
  payment due date) from real phrasing already seen in bank SMS ("...for statement dt
  20-May-26 is..."). The store distils both dates to plain day-of-month numbers and
  saves them on the matching credit card ACCOUNT (`dueDay`/`statementDay`, 1-31) via a
  new `applyCcCycleInfoToAccount` — not just the transient per-bill `ccBills` entry —
  so the card "remembers" its recurring cycle across months instead of only reacting
  to whichever bill SMS arrived most recently. Real dates only, never guessed; a
  message carrying only one of the two dates updates just that field without erasing
  the other. This is the `statementDay`/`dueDay` half of a `TODO(cc-limits)` note that
  had been sitting in the code since account unification (`creditLimit`/`limitGroupId`
  remain not built). **Deliberately groundwork only** — nothing yet reminds the user
  proactively from the saved cycle day alone (without a fresh SMS each month); that's
  the natural next step once enough cards have this populated.

- **Sep-6-2026: proactive "cycle closed" heads-up, from saved data alone.** New
  `maybeFireCcCycleHeadsUp` (checked at app launch + every foreground, alongside the
  existing budget-rollover/subscription checks in `App.js`'s `BudgetRolloverBoot`):
  for each credit card with a learned `statementDay`, once today's date has passed
  it for the current month AND no real bill SMS already arrived this cycle, fires a
  SOFT (non-urgent, no amount) "your billing cycle likely just closed" nudge — both
  an in-app feed entry and a local push. Deliberately soft-only, no predicted due-date
  payment reminder (that would need guessing an amount) — scoped this way per explicit
  user choice. Trusts even a single real data point (a bank's cycle day essentially
  never changes), but a newer SMS reporting a different day always overwrites freely —
  never locked in. Fires at most once per card per calendar month.

**Open / known gaps** (tracked in `.claude/skills/transaction-parser/SKILL.md`)
- **FD create/maturity still books as investment debit/credit, not self-transfer** — this
  is a genuine open PRODUCT decision, not a regex bug (checked Sep-6-2026): there's no
  tracked "FD account" to reconcile a self-transfer against, and excluding the
  `investments` category from spend entirely would also hide a real one-off stock
  purchase. Needs a decision before it can be coded.
- A bare "Card ending xxNNNN" spend with genuinely no limit/due/outstanding wording
  anywhere in the SMS still can't be told apart from a Debit Card — there's no signal
  left to read without a maintained brand-name lookup table. User-correctable via the
  onboarding card screen's Debit/Credit toggle.
- Merchant still leaks the sender on formats where no real payee name is isolable
  at all (this is by design, not a bug — see the skill for why a fabricated-looking
  merchant is worse than the bank's name).

---

## Accounts & Balances

**Done**
- Debit Card account type, SMS type-inference rules.
- Account unification: debit-card ↔ bank merge via `aliasMasks` (same money, 3 link paths).
- Net worth = assets − CC liability.
- Anchor-balance fix: the "correct my balance" anchor was one-directional and silently
  inflated balances on delete/ignore of a pre-anchor transaction — now two-directional.
- **Sep-6-2026: `addAccount` id-collision bug, fixed.** The user-facing "Add Account" path
  generated ids as `acct_${Date.now()}` (no random suffix) while every other account
  creator in the store used `acct_<timestamp>_<rand>`. Two accounts added within the same
  millisecond (e.g. a fast onboarding flow) would get an IDENTICAL id, so a later
  single-account update (balance, anchor, CC reconcile) would silently mutate BOTH. Now
  matches the safe pattern everywhere. No known user-facing incident traced to this yet —
  found while investigating a CC-bill-payment report; fixed defensively.
- **Sep-6-2026: Manage Account modal** — a "Manage Transaction"-style bottom sheet
  (`ManageAccountModal.tsx`) consolidating rename, type change, link-to-bank, read-only
  details (bank/mask, linked cards, CC bill cycle if known), and delete. Opened from the
  flat account list's left type-icon (mirrors tapping a transaction card's icon), and from
  a new pencil icon on `AccountDetailsScreen`'s header; the CRED-style carousel cards are
  unchanged. New `renameAccount` store action (names were create-time-only before).
  `deleteAccount` now also prunes `archivedTransactions`, stale `declinedAccountLinks`
  entries naming the account's mask, and — for a Credit Card — its `ccBills` entry,
  scheduled `ccDueReminderIds` (cancels the OS notification too), and
  `ccCycleHeadsUpNotified` state; previously only live `transactions` were unlinked and
  everything else lingered as dead references. `LinkCardToBankSheet.tsx` extracted from
  `AccountsScreen`'s inline bank-picker so both surfaces share it. Unlink/unmerge still
  deliberately not built — `linkDebitCardToBank` stays one-way.
- CC card limit schema is still note-only (`TODO(cc-limits)` in `ePurseStore.js`); net
  worth still treats a CC purely as its outstanding balance. `statementDay`/`dueDay`
  themselves ARE real, populated fields now (see the cycle-date entry below).

---

## Budget

**Done**
- Budget-by-parent-category rework (Jun-2026): caps on first-level categories only
  (groceries rolls into food), derived non-editable total, no month auto-carry (a new
  month always starts with `budget: null` — the user must explicitly create a new plan,
  pre-filled from `lastBudgetPlan`).
- Aug-11-2026: fixed `rolloverBudgetIfNeeded` reading `monthlyAggregates` (always empty for
  a month that just ended) instead of raw transactions — every month's snapshotted
  `actual` was silently 0, breaking streaks and the recap. Store v25 migration repaired
  already-corrupted history.
- Category mastery badges (⭐ ≥3mo, 🥇 ≥6mo) from `budgetHistory`.
- Budget streak (consecutive on-budget months) drives the CelebrationModal.

**Open — reported Sep-6-2026, NOT YET REPRODUCED, needs your help to pin down**
- **"App breaks when creating/saving a new budget plan"** — reported right after a month
  rolled over (when `budget` is `null` and the user goes to create the new month's plan).
  Read through `BudgetPlanScreen.js` (`savePlan`, `seedFromHistory`/`seedFromSavedPlan`),
  `BudgetScreen.js` (the auto-open-on-first-visit effect, `getBudgetUsage`,
  `getCategoryMastery`), and the store's budget actions (`setBudget`, `updateBudgetCategory`,
  `rolloverBudgetIfNeeded`) — nothing null-unsafe found; all reads are optional-chained
  and the store actions have store-level test coverage that passes. **No crash reporting
  exists in the app** (no Sentry/ErrorBoundary), so there's no log to recover after the
  fact. Next time this happens: note whether it was right after month-end, whether it was
  the FIRST plan ever or an edit, and if the Expo dev overlay shows a red-screen error
  message/stack — that's the fastest way to actually find this one.

---

## Lent/Borrowed & Splits

**Done**
- LentBorrowed refactor (May-2026): multi-select filters, account chip nav, LB exclusion
  from totals, contact/phone linking, per-person net balance.
- Split payer model: plain splits get a group-style "Who paid?"; a non-me payer books a
  memo (no balance movement, a `borrowed` row) instead of a real debit.
- Settle + CC balances (Jul-2026): new countable `repayment` category; borrow-settle books
  a real Repayment expense on a chosen account; single-row settlement invariant (never an
  origin+counterpart pair) enforced across every settle path (group, full, re-tag, manual).
- LB form + retention: shared `LbEntryForm`, inline field errors, balance-aware toasts,
  backdating fix (retention counted from `createdAt`, extended 1yr→2yr).
- Split flow audit (Aug-2026): fixed LB rows losing `contactId` on re-tag, untagging a memo
  conjuring a phantom expense.

**Open**
- None currently tracked.

---

## Groups

**Done**
- Two group modes (personal/shared), per-member balances derived live via the shared LB
  ledger (`buildGroupLbRows`) — no parallel in-group ledger.
- Group Zone + location (Jun-2026): auto-tag new txns to an active trip/group.
- Group Insight Carousel (Jul-2026) on Analytics.
- Personal groups display MONTHLY totals (not all-time) since Jun-2026.
- Auto-prune (180 days inactive AND fully settled).
- **Sep-6-2026: CC bill reconciliation now wired into GroupsScreen's category picker too**
  (see Budget/Accounts CC-payment entry) — previously bypassed the card-crediting step.

**Open**
- None currently tracked (spend-exclusion cross-cutting checklist lives in the groups skill
  — re-audit it whenever a new spend-summing surface is added).

---

## Rewards & Gamification

**Done**
- RP/EPC dual currency, Aware Run streak + multiplier, daily review cap, shop widgets
  (Liquid Wave, Concentric Rings, Plasma Flame), zero-transaction check-in grace period.
- Budget streak + category mastery (lives in the main store, not the reward store).

**Open**
- No automated tests for this module (manual verification only) — noted as an accepted
  gap in the rewards skill, not a bug.

---

## Analytics & Insights / Home

**Done**
- Behavioral Insights (GhostLineChart, HabitLeakMatrix, SubscriptionHeartbeat).
- Refund/expense model: Spent = expenses − refunds, Received = non-refund credits, with a
  full spend-site consistency sweep.
- Weekly summary (one-time centred modal) + Monthly recap (dashboard card + modal + PDF).
- Home enhancements: real pull-to-refresh, HomeCarousel with 6 urgency-ranked cards incl.
  CC-bill-due, layout passes (elevation language, 3-tier hero, centred carousel), reworked
  header (HeaderChip, avatar on the alignment spine), segmented period selector.
  **Batch 2 of Home enhancements was mostly DECLINED by the user — don't re-propose
  balance/left-to-spend/reorder changes without checking why first.**
- Activity date filter + arrange (Aug-2026): calendar-month ranges, quick chips synced
  with the filter sheet, Sort/Group dropdowns.
- **Sep-6-2026: transaction location now shown in the detail view** — `TxnDetailSheet.tsx`
  (plain txns, incl. splits) and `GroupTxnDetailSheet.tsx` (group expenses) both render
  the coarse place captured at add time, via the existing `locationKey()` helper
  (city-first, falls back to district/region). City name only for now, no icon. The
  capture itself (manual add + live-SMS-only, never the backfill sweep) already existed —
  this just surfaces it; see the earlier Q&A in this log's history for how capture works.

**Open**
- None currently tracked.

**Fixed**
- **Sep-6-2026: CC-bill-due carousel card kept showing "bill to pay" after the bill was
  manually marked paid via Manage Transaction.** Root cause: `markAsCCBillPayment` (the
  manual reconcile action) never cleared the card's entry in the `ccBills` map that the
  card actually reads from (`homeCards.js`'s `ccBillCard` selector) — only the AUTOMATIC
  "payment received SMS" path (`applyCCPayment`) cleared it. `markAsCCBillPayment` now
  clears the matching `ccBills` entry the same way `applyCCPayment` does.
- **Sep-6-2026: the scheduled OS push reminder for a bill's due date wasn't cancelled
  when the bill got paid** (`ccDueReminderIds`/`scheduleCCBillDueReminder`) — only a NEW
  bill's reminder cancelled the OLD one, so a paid-off bill's due-date notification could
  still fire once. New shared helper `cancelCcDueRemindersForCard` (in `ePurseStore.js`)
  cancels every scheduled reminder for a card and drops it from the map; called from both
  `applyCCPayment` (automatic) and `markAsCCBillPayment` (manual) the moment a payment for
  that card is confirmed. Verified via a live-store repro covering both paths.

---

## Notifications

**Done**
- Full local-only inventory (no FCM): budget breach, mid-month nudge, CC payment, CC bill
  due (with OS reminder scheduling), subscription-hike alert, monthly recap.
- Onboarding permission priming (+`POST_NOTIFICATIONS`).

**Open**
- None currently tracked (the CC-bill-due reminder not being cancelled on payment,
  formerly listed here, is fixed — see Analytics & Insights / Home).

---

## Backup (Google Drive)

**Done**
- Encrypted backup/restore (AES-256-GCM + scrypt), ALLOW-LIST payload (parsed values only,
  raw SMS never leaves the device), `drive.file` OAuth scope, onboarding restore entry point.
- Password vs recovery-key normalisation (`toKeyMaterial`), Hermes-safe crypto (no
  TextEncoder/Buffer/atob dependency).

**Open**
- **Untested against a real Google account** — phases 1-6 (manual backup+restore,
  onboarding restore) are done and unit-tested, but nobody has run a real sign-in +
  upload + restore round-trip on-device yet.

---

## Onboarding

**Done**
- Fresh-start onboarding (Jun-2026): pre-onboarding SMS archived separately, balances
  start at 0, `welcomeReviewSeen` tutorial card.
- Restore-from-backup entry point on the registration slide.

**Open**
- None currently tracked.

---

## Profile, Settings & Theme

**Done**
- Settings moved out of the long-press menu into a real `SettingsScreen` (theme picker,
  Backup moved out to its own destination).
- Profile revamp: hub screen with a destination list, `ShopScreen`, `RemindersScreen`
  placeholder, shared `PlainScreenHeader` + `NavListRow`.
- 5 accent themes incl. Carbon (replaced Gold — brand color rule: never put a bright
  color in a gradient, only in `primary`).
- Dark theme base (most recent commit, `5f21246`) — landed but see Open below.

**Open**
- **Dark mode is planned but not fully built** — read `docs/DARK_MODE.md` before touching
  any colour/background. Blocked on 972 static `colors.*` references across 50 files that
  `StyleSheet.create` freezes at load. A regression test ratchets this backlog so it can
  only shrink, never grow.
- ~20 CTA button-height sites still don't use the shared `BUTTON_H` token — offered, not
  yet swept (list lives in the button-height memory/history).

---

## UI Consistency / Navigation

**Done**
- Canonical section headings, shared `EmptyState`/`InfoIcon`/`EditIcon`, type-canonical
  icons matching the tab bar, `CollapsingHeaderScreen` for every themed gradient header.
- Tab bar: themed active ink via `readableOn`, `tabBarClearance` shared constant, fixed
  the "stuck hidden" bug (bottom nav could hide on scroll and never come back).
- Transaction card tap: whole-card is view-first-then-edit everywhere (`TxnDetailSheet`,
  `GroupTxnDetailSheet`, `SplitDetailsModal`).
- Input validation: one shared `src/utils/validation.js` (limits, sanitizers, validators)
  used by every user-typed field; overflow protection (`numberOfLines` + flex) tracked
  per-screen in the input-validation skill.

**Open**
- `align="bottom"` in `RecapModalShell.tsx` is dead code (no live caller) — flagged, not
  removed, in case a future recap variant wants it.

---

## Testing infrastructure

**Done**
- Zero-dependency `.mjs` test runners (`_register.mjs`, `_resolve-hook.mjs` for
  parser-only tests; `_store-hook.mjs` loads the real store headlessly, stubbing only
  native/Expo leaves).
- `npm test` chain: parser/self-transfer/store suites, `e2eJourney` (narrative MVP
  acceptance, 55/55), `bulkReconciliation` (35-txn volume cross-check, 37/37), SMS sync,
  backup/payload/drive suites, crypto/envelope suites. 330+ individual checks, all green.

**Open**
- No automated coverage for the Rewards or Groups UI screens (documented as accepted
  gaps in their own skills — verify manually after touching either).
