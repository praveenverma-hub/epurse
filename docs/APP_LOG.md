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
  **Sep-7-2026: the "NOT COUNTED" tag renamed to "EXCLUDED"** everywhere it appears (Spend
  Rules screen, transaction badges, Settings summary, Activity filter/footer) — flagged as
  unprofessional wording for a finance app. Display strings only, no logic touched.
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

- **Sep-7-2026: CC-payment "which card" bug fixed — was showing the WRONG card.** User report:
  "the card bill paid for shown in modal is wrong, are we not fetching the card number from
  msg." Confirmed true for common real phrasing: the payment-notification interceptor used a
  generic account-mask regex that silently returned `null` on "...CREDIT CARD ENDING WITH
  2170..." and partial-mask formats like "...Credit Card Account 4xxx7004..." — never asserted
  by any test. With no mask, the store fell back to guessing a Credit Card account by TYPE
  ALONE (array/id order, ignoring bank name), so `CCPaymentPromptModal` could show — and
  True-up/Settle could mutate — the wrong card whenever the user held more than one. Fixed with
  a new shared `extractCardLast4` (used by both the payment and bill-reminder interceptors) plus
  a bank-aware fallback in `accountMatch.js`'s no-mask branch. New suites: `CC card mask
  extraction (Sep-26)` in `messageParser.test.mjs`, and `src/utils/__tests__/accountMatch.test.mjs`
  (`npm run test:accountMatch`, the module's first dedicated suite). Both mutation-verified.
- **Sep-7-2026: `cc_bill` category re-homed from Transfers to Bills & Utilities.** Was aliased
  to the `transfers` parent in the two-tier tree (grouped with settlement rows) purely because
  nobody had revisited it since; re-aliased to `bills`. No effect on spend totals (`cc_bill`
  stays in `NON_SPEND_CATEGORY_IDS` regardless). The category picker's "Credit Card Bill" row
  also moved — it used to render at the very bottom of the sheet after Settlements; now renders
  inside the Bills & Utilities section itself, right below its child chips, via a new named
  `extraContent` slot on `ParentRow`. Fixed an adjacent label typo too (`categories.js`'s flat
  list said "Bills & Utility", the tree said "Bills & Utilities").

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
- **Sep-9-2026: fixed manually-added transactions showing no account on their card at all**
  (reported: "after submission, the transaction card does not show any account"). Cause:
  `TransactionItem.js` reads `txn.accountType`/`txn.accountMask` directly (never a live
  account lookup) — the shape SMS ingest already denormalises onto every parsed txn, but
  `addTransaction`/`addGroupExpense`/`updateTransaction`/`updateGroupExpense` only ever set
  `accountId`. New shared `stampAccountMeta`/`clearAccountMeta` helpers now set/clear these
  fields at all 4 write paths (edit paths re-stamp from the newly chosen account, fixing a
  second bug where editing a txn's account left the OLD bank's mask showing). Store v28
  migration backfills already-persisted manual transactions.
- **Sep-13-2026: fixed `setAccountAnchor` storing a Credit Card's anchored balance as a
  positive number.** Reported directly: "when we update the balances for cc it adds as
  balance not a outstanding amount." A CC's `balance` is a LIABILITY app-wide
  (`AccountDetailsScreen`'s `Math.abs(rawBalance)` display, `selectEPurseNetWorth`'s
  `Math.min(bal, 0)`), i.e. always stored NEGATIVE — but the anchor modal (tap the balance
  on `AccountDetailsScreen` to correct it) only ever collects a plain non-negative "how much
  is outstanding" figure, same shape as a bank account's balance, and `setAccountAnchor`
  applied it verbatim regardless of account type. Anchoring a card to "8000" silently stored
  `balance: 8000` (read everywhere else as ₹8,000 held IN the account) instead of `-8000`
  (₹8,000 OWED). Fixed to negate for `ACCOUNT_TYPES.CREDIT_CARD` only; a bank/debit account
  anchor is unaffected. Two knock-on UI fixes on the same modal (`BalanceAnchorModal` in
  `OnboardingExperience.tsx`, shared but with only one live caller,
  `AccountDetailsScreen`): (1) the caller now passes the already-computed positive
  `summaryValue` as `initialValue`, not the raw signed `account.balance` — the field would
  otherwise open pre-filled with e.g. `-8000` for a card even though the label above reads
  "Total Outstanding ₹8,000", and since the field itself REJECTS negative input
  (`valid = amount >= 0`), the Anchor button would stay disabled until the user deleted the
  minus sign themselves; (2) a new `isCreditCard` prop swaps the modal's copy/button label to
  "Update outstanding balance" / "Update" instead of "Anchor live balance" / "Anchor" —
  the modal itself never negates anything, only the store does, keeping the sign rule in ONE
  place. New regression tests in `storeIntegration.test.mjs` pin both the CC and non-CC
  cases. Store suite 494 → 496.
- **Sep-13-2026: the account-detail edit pencil moved off the header, onto the card, then to
  its bottom-right corner (corrected same day).** The pencil added alongside
  `ManageAccountModal` (Sep-6, above) lived in the nav header next to the balance-info ⓘ;
  asked to move it "in the card we show in the top" instead — the same "manage this thing"
  affordance belongs on the thing itself. The header now carries only the ⓘ (fixed-width
  `navSide` slots keep the title centred whether the right side holds one icon or two, so
  removing one needed no layout change). First landed in `cardTopRow` beside the bank
  name/network badge (matching `GoalDetailScreen`'s top-right hero pencil), then asked to
  move to the BOTTOM-right instead — placed in-flow beside the card number/holder block
  (`cardBottomRow`, `justifyContent: 'space-between'`), not absolutely positioned: this card
  already reserves its true bottom edge for the hidden pocket-sheet overlap
  (`paddingBottom: POCKET_OVERLAP + 8`), so an in-flow sibling of the number/holder text
  automatically stays clear of that seam the same way the text already does, with no
  overlap math to get wrong. Translucent-white circular `cardEditBtn` (matching
  `networkBadge`'s own `#FFFFFF26` ink convention for this bespoke gradient surface — not
  `theme.card`/`textSecondary`, which would be invisible here) opens the same
  `ManageAccountModal`.
- **Sep-13-2026: the Balance Anchor pencil got the same chip treatment.** Flagged directly:
  "adjust the pencil size n ui in balance ancor in account detail screen." The "tap to
  correct the balance" affordance (`summaryBox`, the white card above the transaction list)
  had its OWN pencil — a bare 20px `EditIcon` in a hardcoded `#94A3B8`, just floating beside
  the balance value with `marginLeft: 8` and no chrome of its own, unlike every other pencil
  this session (the card's `cardEditBtn`, `GoalCard`/`GoalDetailScreen`'s pencil). Now a
  matching 26×26 circular chip (`summaryEditBtn`, `#F1F5F9` fill — this box is its own fully
  static-hex surface, not theme-driven, so the chip stays in that same static palette rather
  than mixing in `theme.*`) holding a smaller 13px icon in `#64748B` (matching the label's
  own muted grey). Purely visual — `onPress`/`openAnchor` still lives on the outer
  `TouchableOpacity`, the icon has never itself been a separate tap target.

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
- **Sep-9-2026: fixed the Home budget card showing a stale progress bar** — reported as
  "updates very late, I have to go to budget screen and back, restart app, then also very
  late." `BudgetSummary.tsx` (the component rendered on Home) never subscribed to
  `transactions`/`groups`/`excludedExpenseParents`, so it didn't even re-render on a new
  transaction, and its `usage` `useMemo` deps (`[budget, getBudgetUsage]`) couldn't have
  recomputed even if it had — the card was frozen at whatever spend existed the instant it
  first mounted. `BudgetScreen.js`'s own `usage` memo already included `transactions`, which
  is why that screen looked live. Now matches that pattern.

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

## Goals (savings / investment / to-lend planning)

**Done — Phase 1, Sep-9-2026**
- **The forward-looking half of planning.** Budget caps what leaves; Goals commits what
  stays. Reached from Profile → Goals (`GoalsScreen.tsx`, route `Goals`).
- **One salary, split by hand.** `AllocationBar.tsx` renders the whole month's income as a
  single bar; Spending rides in it as a LOCKED segment (owned by Budget, immovable here) and
  the unallocated remainder is a real segment rather than a number in a corner. Dragging a
  divider moves money between its two neighbours only — `rebalancePair` keeps the pair's
  total invariant, so the bar can never allocate more than the salary. Snaps to ₹500, with a
  haptic per step and a success haptic when the plan balances.
- **Monthly rhythm mirrors Budget exactly**: a new month starts with no plan;
  `rolloverGoalPlanIfNeeded` snapshots the finished month into `goalHistory` and keeps the
  old plan as `lastGoalPlan`, which the screen offers as a one-tap "Keep last month's plan".
  Nothing ever carries silently.
- **Goals can track themselves.** A goal with an auto rule is funded by REAL spend that
  matches it (a SIP debit funds the SIP goal). Only open-ended savings goals need
  contributions logged by hand — the kinds people abandon are the ones needing upkeep.
  *(Phase 1 shipped this as a single `autoParentId` that IGNORED manual logs; both changed
  in phase 2 below.)*
- **Salary is TYPED, never read from SMS.** The app already parses income, which is exactly
  why this screen asks. Using the detected figure is a deliberate future opt-in, not a
  default — see the memory note before wiring `getMonthlyIncome` in.
- **Reconciliation strip** (Salary · Spending · Goals · Free) ties Budget and Goals into one
  number so the two planning screens don't read as unrelated forms. *(Sep-12: was its own
  bordered card sitting after "This Month's Split", restating four numbers already visible on
  that card — flagged as not belonging there. Folded IN as that card's own closing row, below
  the goal legend, separated by a divider — a summary line the card ends on, not a second card
  competing for attention at the bottom of the scroll.)*
- Starter templates (`constants/goals.ts`) make the empty state a launchpad; goal categories
  are their OWN namespace, deliberately not the two-tier spend tree. *(Sep-12: tapping one now
  navigates to `GoalFormScreen` pre-filled rather than writing the goal silently — see the
  Phase 4 bullet below.)*
- Goals get an "Add money" prompt for logging by hand. `CenterModal` gained an optional
  `children` SLOT for that one-input prompt — a named axis, not a second dialog component.
- Store v29 (`goals`, `goalPlan`, `lastGoalPlan`, `goalContributions`, `goalHistory`), all
  five in the backup allow-list. `npm run test:goals` (47 pure-maths cases) + 30 store cases;
  the drag invariant and the delete-cleanup/auto-funding rules are mutation-verified.

**Done — Phase 2, Sep-11-2026** (six changes asked for after using phase 1)

- **Goals now fill themselves from any category OR merchant.** A goal carries an `autoRule`
  — `{ parentIds, categoryIds, merchants }`, ORed — so categorising a transaction into any
  of them funds the goal with nothing typed. Merchant keywords match case- and
  punctuation-insensitively, so `zerodha` catches `UPI/ZERODHA BROKING LTD/9988`. Picked in
  the goal editor: a checkbox per parent category, expandable to sub-categories, plus a
  merchant keyword field. A memo (someone else paid) never funds a goal.
- **Manual top-ups now work on EVERY goal, auto ones included.** Phase 1 made the two
  sources exclusive to prevent a double count; that meant a goal whose bank SMS never
  arrived was permanently short with no way to correct it. They now ADD, and the UI names
  each part ("₹5,000 matched · ₹2,000 added") so a double entry is visible rather than
  prevented. The "Add money" prompt on an auto goal says so.
- **The allocation bar drags smoothly.** It was calling back into JavaScript on every frame
  of the drag — a React state update and a full screen re-render per frame — so a slow drag
  queued hundreds and the bar kept moving for seconds after the finger stopped. The gesture
  now runs entirely on the UI thread against one shared array of values, and JS learns the
  new numbers exactly ONCE, on release. `snapAmount` / `rebalancePair` are marked
  `'worklet'` so the preview and the committed number come from the same maths.
- **The plan is VIEW-first with an explicit Edit.** It used to be permanently live, with
  Save appearing only once something was already dirty — so there was no way to look at your
  plan without being inside it. Now read-only until "Edit", ending at Save or Cancel (and
  Cancel can throw the draft away precisely because the committed plan was never being
  written to). A month with no plan yet opens straight into editing.
- **Goals are square tiles** (`GoalCard.tsx`), two per row: a state ribbon (GOAL COMPLETE /
  8 MONTHS TO GO / pace), the goal's glyph as a medallion, the target in a pill, the name, a
  progress bar, and a three-stat footer (Saved · Target · This month). The old list rows were
  a planning control doing double duty as a status display.
- **Reaching a lifetime target congratulates and pays.** `GoalAchievedModal` fires once per
  goal, with confetti (extracted from `CelebrationModal` into a shared `Confetti.tsx`) and a
  real bonus: **+250 RP / +25 EPC**, scaled by the Aware Run multiplier (`awardGoalBonus`,
  plus a `goal_achieved` notification). Open-ended goals never fire it — there is no line to
  cross. The once-per-goal guard is `bonusAwardedAt` on the goal, written AFTER the credit,
  so a crash between the two can only ever under-award.
- Store **v30** migrates `autoParentId` → `autoRule.parentIds` and seeds `achievedAt` /
  `bonusAwardedAt`; `backupService.STORE_VERSION` bumped to match. `npm run test:goals` 47 →
  70, store goals cases 30 → 44.

**Done — Phase 2b, Sep-11-2026** (crash + the follow-up UI pass)

- **FIXED: the app closed the moment you dragged the slider.** Phase 2 marked `snapAmount` /
  `rebalancePair` in `goalPlan.js` as `'worklet'` so the UI-thread drag could reuse them. A
  worklet may only call worklets, and a cross-FILE worklet reference is not reliably
  serialised to the UI runtime by the Reanimated 3.6 babel plugin — so frame one of a drag
  hit a plain JS function on the UI thread and took the process with it. The bar now owns a
  small LOCAL worklet (`snapWithin`) and commits back through `rebalancePair` on the JS
  thread, which re-snaps — so `goalPlan.js` still produces every stored number. **Never
  import a function into a gesture worklet.**
- **Header `+` → an info affordance.** The (i) opens an InfoSheet explaining how goals work
  (auto-funding, manual top-ups, targets, and that Spending is Budget's).
- **Adding a goal is the floating +**, the same FAB Home uses. Both dashed "add a goal" rows
  are gone. The FAB hides at the 8-goal cap, which the dashed row used to enforce.
- **"This month's split" no longer says "drag a divider" when there is no bar** — with no
  salary typed the card is a single empty field, so the subtitle now tells you to enter one.
- **Goal tiles: progress is the RING around the glyph**, not a bar under it, and it sits
  FLUSH against the glyph disc (the disc is exactly the arc's inner diameter). The fill went
  through two colours before landing: first a fixed amber, then the theme's dark accent
  measured on a neutral track (because the tile is already washed in the goal's colour and a
  same-hue track read as one more band of it). **Sep-12: it is now the GOAL's own colour** —
  matching the wash and the medallion glow, so the tile reads as one coloured object rather
  than the ring introducing a second, unrelated accent — with the neutral track
  (`theme.divider`) staying the one deliberate exception to §5b. Still `readableOn(track,
  color, 3)`: most of the 8 goal colours pass unboosted, a few (teal, sky, amber, pink) sit at
  ~3.1–3.2:1 on the light-mode track and get nudged; dark mode clears 3:1 unboosted for all
  eight.
- The tile's top ribbon states, in priority order: **GOAL COMPLETE** → **NOTHING PLANNED** →
  **N MONTHS TO GO** (target ÷ this month's allocation) → this month's pace (FULLY FUNDED /
  AHEAD OF PACE / ON TRACK / BEHIND PACE). *Fixed:* a goal with no allocation in the current
  plan has no pace row, and the chip fell through to a default of "ON TRACK" — announcing
  progress on a goal doing nothing. **A status chip must never invent reassurance from
  missing data.** It also went full-bleed across the tile's top (it was a centred pill at 74%
  width, ~90pt of text room, which truncated "15 MONTHS TO GO" on a 360pt phone) and the
  labels got longer now that they fit — "AHEAD" alone never said ahead of *what*. The band is
  a TINT of the state's colour (18%), not the solid, and its ink is measured on what that
  actually composites to — goal wash over card, then band over that — since a translucent
  surface has no colour of its own to measure against. Worst case across every theme × goal
  colour × state is 4.50:1. It carries the card's INNER radius and is inset by the border
  width rather than relying on `overflow: hidden`, which left the band square against the
  rounded corners on Android, plus a hairline under it so the translucent band has a defined
  lower edge. The pencil sits top-right just below it; both offsets derive from one
  `RIBBON_H` constant, and it clears the progress ring by 5.7pt even on a 320pt phone.
- *Fixed:* the tile **printed the same number twice**. The footer's middle stat mirrored the
  headline pill exactly — Target when the pill said TARGET, Monthly when it said MONTHLY — so
  it duplicated whichever branch it took. The footer is two cells now (Saved so far · This
  month), each with half the row instead of a third, and a size up from the labels the
  three-cell version had been shrunk to.
- "This month's split" subtitle is now a short prompt ("Add more to reach your goals sooner.")
  instead of *"Saved. Tap Edit to change it."* — which narrated a button in its own header
  row and repeated the saved state the month line already carries.
  The drag hint stays, but only while editing: that the dividers are draggable is the one
  thing on the card that isn't self-evident.
- *Fixed:* the allocation bar's FREE segment is drawn with a border, and a square-cornered
  stroke under the bar's rounded clip got sliced off at the ends — the outline stopped short
  of the curve instead of following it. End segments now carry the bar's own radius.
  (Clipping alone is enough for a solid fill; it is not for a stroke.)
- **The card body no longer opens the edit form.** It used to be the SAME tap as the pencil,
  so tapping anywhere on a tile could land you in a form you didn't ask for. Editing is the
  pencil now, exclusively — and the body tap itself was later given its own job (see the
  auto-fund-link bullet below): it opens the goal's matching-transactions drill-down.
- Both edit affordances were inlined Ionicons (`pencil` on the tile, `create-outline` on the
  plan button) — two different glyphs, and neither the app's. Both are `EditIcon` now (§4),
  and the tile's sits in an outlined circle so it reads as a button rather than as part of
  the tile's decoration. The glyph sits on a RADIAL glow in the goal's colour that fades to nothing at
  the disc's edge — SVG, because RN's `shadow*`/`elevation` can only draw a hard drop
  BENEATH a view, which is a different thing from light behind an icon. Each tile's gradient
  gets a `useId`-derived id: SVG gradient ids are global, so a shared one makes every glow on
  the screen pick up whichever card mounted last. One centred **Update**
  button (the "Auto" tag beside it is gone; the sheet it opens says so instead), and an
  explicit edit pencil.
- The ring is a new shared **`ProgressRing.tsx`** — BudgetSummary's identical local copy was
  deleted and now imports it. (AnalyticsScreen's and CustomWidgetContainer's rings are still
  local; they weren't touched.)
- **FIXED: Delete did nothing in the goal editor.** The editor was a `<Modal>` and its
  confirm was a second `<Modal>` rendered while the first was still visible — the exact
  stacked-modal failure ui-consistency §8b documents. Which leads to:
- The goal form's selected-sub-category count is a tinted CHIP (NavListRow's badge geometry),
  not a bare digit beside the label — which read as part of the label. Ink measured on the
  tint rather than the card; worst case 4.50:1 across all five themes.
- *Fixed:* the merchant row's add button was a hardcoded 46pt beside an input measuring ~43
  (font + padding + border), so it stood 3pt proud. The row is `alignItems: 'stretch'` now
  and the button takes its height from the field.
- *Fixed:* in the goal form's category rows the selected-child COUNT and the expand chevron
  printed on top of each other — the chevron was absolutely positioned over a flex row whose
  last element was that count. The chevron is a sibling in the row now, not an overlay.
- Goal form: **Delete moved into the pinned footer beside Save** (icon-only, outlined, same
  height, a fraction of the width). At the end of the scroll it was reachable only after
  scrolling past the whole auto-funding list, which made it feel missing.
- **GoalsScreen section order corrected (Sep-12), TWICE — the second pass reverses the
  first's reasoning.** Round one: "Your Goals" sat ABOVE "This Month's Split", so dragging the
  bar's live effect on a goal's monthly figure was scrolled out of view above the control that
  produced it. Fixed by moving the split card and reconciliation strip first, goals below —
  correct for as long as the BAR was how you changed a goal's amount. Save/Cancel also moved
  to a PINNED footer outside the `ScrollView` at the same time (a footer-CTA pattern, like
  `GoalFormScreen`/BudgetPlan), which stands unchanged by round two.
  Round two (see the very next bullet): once a goal's amount is only ever edited from that
  goal's OWN form, the reason to put the split card first disappears — there's no more live
  drag feedback to keep in view. **Goals now come FIRST again**, split card and reconciliation
  strip below, because goals are the actual subject and the split is supporting arithmetic
  underneath them. The floating + still hides while editing (still true — the footer occupies
  the same corner) and can't collide with the new footer or invite starting an unrelated goal
  mid-edit.
- **A goal's monthly amount moved OUT of the split card and INTO the goal's own form
  (Sep-12).** Reported as odd by design review: a goal's identity and lifetime target lived in
  `GoalFormScreen`, but its MONTHLY commitment was only ever editable from a completely
  different section — the split card's drag bar and ± steppers — with the identical rupee
  figure then rendered a second time, unlinked, as the goal tile's own stat. Two screens both
  claiming to own one number. Fixed:
  - **`GoalFormScreen` gained a "Monthly Contribution" field**, right after Overall Target —
    a goal's two numbers (lifetime target, monthly commitment) now both live where you'd look
    for either. Saving writes it via `updateGoalAllocation`, clamped to what's actually free
    this month (salary − the locked spending cap − every OTHER goal's share). If no plan
    exists yet for this month (salary not set), the field explains that instead of silently
    no-opping.
  - **`updateGoalAllocation`'s clamp was ALSO wrong before this** (and unused until now — the
    bar never actually called it, only its own local copy of the same logic did): it clamped
    against the full salary, never subtracting the locked spending cap, so a form calling it
    directly could over-commit into money Budget had already claimed. Fixed to compute room
    the same way the old steppers did.
  - **`AllocationBar` is now permanently view-only** on this screen (`disabled` hard-wired
    true, no `onChangePair` wired to anything) — it shows the sum of what every goal's form has
    already set, and nothing here writes to it any more. The split card's per-goal rows lost
    their ± steppers, becoming a plain legend (swatch, name, amount) — a key to the bar's
    segments, not a second control for the same number.
  - GoalsScreen's local `alloc` draft state is GONE entirely — allocations are read live from
    `goalPlan`/`lastGoalPlan` (`liveAllocations`) on every render, since there is no more
    in-screen editing of them left to protect behind a draft. The salary figure keeps its own
    draft + Edit/Save/Cancel (Sep-11's "view first" pattern, untouched) since that number
    genuinely still belongs to this screen.
  - *Fixed same day:* the empty-state template row first shipped as a silent `addGoal(...)`
    call — tap a template and the goal existed immediately, with no chance to see or change
    what got created, which read as a bug ("takes you to the goals screen" instead of a form).
    **Templates now navigate to `GoalFormScreen` with a `prefill` route param** (name, emoji,
    colour, kind, `autoParentId`, `suggestedPct`) instead of writing anything — the form seeds
    its fields from it when creating (never for an edit), including the Monthly Contribution
    field: `suggestedPct` × this month's salary, snapped and clamped to whatever's actually
    free, if a plan exists. Nothing is created until the user reviews the form and taps Save,
    same as typing one from scratch.
- **The bar's drag + steppers came BACK the same day, on request** — "keep the slider edit
  functionality for the monthly overview." The above stands otherwise: the goal's form still
  has its own Monthly Contribution field, `updateGoalAllocation`'s fixed clamp is unchanged,
  and the template→form prefill is unchanged. What's reversed:
  - **`AllocationBar` on `GoalsScreen` is `disabled={!editing}` again**, not permanently true —
    drag returns while the card is in Edit mode, same UI-thread gesture, same commit shape.
  - **The per-goal legend rows have their ± steppers back** (`setOne`, mirroring the SAME
    room-after-spending-cap clamp `updateGoalAllocation` now runs, kept local since the
    stepper edits a draft, not the live plan).
  - **GoalsScreen's local `alloc` draft is back**, seeded from `goalPlan`/`lastGoalPlan` in the
    existing `seed()` effect — which re-fires whenever the store's `goalPlan` reference
    changes, so a goal's form writing `updateGoalAllocation` directly still shows up here
    (the two paths write the same store field, they just take different routes to it: the
    bar/steppers via a local draft + Save, the form immediately).
  - Card title reverted to **"This Month's Split"** (an edit surface again, not a pure view);
    the subtitle's "drag a divider" copy is back for the same reason.
  - Section order — goals grid ABOVE the split card — was left AS IS. That ordering's original
    reasoning ("nothing to keep in view once the bar stopped editing") no longer strictly
    holds now that the bar edits again, but reordering wasn't asked for here; flagged so it
    isn't silently "fixed" without a fresh signal from the user.
- **The auto-fund link is now VISIBLE from both sides (Sep-12).** The link between a
  transaction and the goal(s) it funds already existed — a goal's `autoRule` is matched
  against every transaction LIVE, nothing is ever stored on the transaction — but nothing in
  the UI showed it. Two new read-only selectors (`getGoalsForTxn`, `getGoalTransactions`),
  both re-running the exact match `goalFundingForMonth` already sums, so the total and what's
  shown can never disagree:
  - **`TxnDetailSheet`** gained a "Counts toward" row — 🛟 Emergency Fund, say — whenever the
    transaction matches a goal's rule right now. Recomputed on every open; editing the rule or
    recategorising the transaction changes the answer next time, no stale link to invalidate.
  - **New `GoalTransactionsSheet`** lists a goal's matching transactions for the live month —
    tapping a goal tile's BODY opens it (finally giving that reserved prop a job). Tapping a
    row opens the same `TxnDetailSheet`, so a transaction found here reads identically to one
    found on the Activity list. Gated against the stacked-modal bug (§8b): it hides itself the
    instant a row's detail sheet opens.
  - **`addGoalContribution` gained an optional `sourceTxnId`** — a manual contribution can now
    remember which transaction it came from, and the SAME (goal, transaction) pair can only
    ever produce one contribution (refused, not duplicated, on a repeat). Nothing writes it
    yet; it's the plumbing a future review-queue quick-add needs, built now so that caller
    doesn't need a migration later.
  Considered and rejected: storing an explicit `goalId` on the transaction at categorisation
  time. That would go stale the moment a rule or a category changed, and couldn't be
  retroactive for a goal created after the transaction — the live match already gets both for
  free.
- *Fixed:* saving a goal, deleting one, saving/updating the monthly plan, keeping last month's
  plan, and logging a manual contribution all did their thing with NO confirmation — every
  other write flow in the app (`ReminderFormScreen`, group settle, etc.) shows a toast, and
  Goals was silent. All five now `toast.success(...)` via the shared `useToast()`. The
  goal-form toast fires AFTER `navigation.goBack()`, same as `ReminderFormScreen`: it needs to
  render on the screen the user lands ON, not the one being popped.
- Goal form pass: **Overall target moved up to sit directly under Type** (it is the substance
  of the goal; glyph and colour are decoration and follow both), the Icon row gained the
  **type-your-own emoji tile** the group and category forms already have — the device
  keyboard is the picker, so no emoji-picker dependency — and the selected **colour swatch now
  uses the app's treatment** (scale up + white inner ring + dark drop, per CreateGroupModal)
  instead of a theme-coloured border that was invisible on half the palette.
- **The goal editor is now a full screen** (`GoalFormScreen`, route `GoalForm`), replacing
  `GoalEditorSheet`. It had outgrown a sheet anyway — name, glyph, colour, kind, target AND a
  category/merchant rule list is a form, not a prompt (§2b: pick by growth). Its delete
  confirm is now the only modal on screen, so it works.
- *Fixed:* a brand-new goal with neither an overall target nor a monthly amount set (both are
  deliberately optional — a goal that only auto-funds from categories needs neither) used to
  print **"₹0" three times over**: the headline pill ("MONTHLY ₹0"), and both footer stats.
  Every one of those zeros was technically true, but three in a row on a tile that also
  already says "NOTHING PLANNED" on its ribbon reads as broken, not as "nothing has happened
  yet." `GoalCard` now shows **"—" instead of ₹0** for the pill and both footer stats, but
  ONLY when the goal is genuinely idle (`lifetimeSaved <= 0` — which can only be true if
  nothing was ever saved into it, this month included) AND has no target and no plan. An
  ONGOING goal that simply got nothing THIS month still shows a real "₹0" for "This month" —
  that zero is informative (behind pace), so it is never dashed.
- *Fixed a real rollover bug*, found by walking through "does the recurring/lifetime total
  keep adding up" with the user: `rolloverGoalPlanIfNeeded`'s snapshot loop only walked
  `goalPlan.allocations` — so a goal with **no monthly plan slot** (pure auto-fund, exactly the
  "NOTHING PLANNED" shape) got **no row in that month's `goalHistory` snapshot at all**, even
  if it earned real auto-matched money that month. Not an aging/retention issue — the month
  was never recorded, period, so `getGoalLifetimeSaved` silently dropped it the moment the
  month rolled over. Fixed to walk every goal in `s.goals`, recording `{planned, funded}` for
  any goal with either one nonzero (a goal that did nothing that month still gets no row, so
  history doesn't bloat with zeros). Covered by a new store test (isolated on scratch goals,
  dated explicitly into the forced-rollover month since funded is computed by the
  TRANSACTION's month, not the plan's).
- **Goals gain a DURATION: One-Time vs Recurring (Sep-12, store v31).** A second axis from
  `kind` (`kind` = what the money is for; `duration` = whether it has a finish line), designed
  after the user asked how a goal should show "one-time" vs "recurring" given it already has
  both a lifetime target AND a monthly figure. **First shipped as mutually exclusive (one-time
  = target only, no split-bar membership at all) — corrected the SAME DAY**: the user pointed
  out a one-time goal should ALSO be able to take a monthly contribution ("it will be much
  better"), which is in fact the common case (saving toward a target at a steady monthly rate),
  not an edge case. Settled shape:
  - **One-Time** — an Overall Target, and OPTIONALLY a Monthly Contribution toward it. Can be
    "achieved" (that's measured against the target). Its ribbon: `N MONTHS TO GO` when both a
    target and a monthly rate are known (the ORIGINAL pre-duration projection, `monthsToTarget`
    — this is exactly why `monthsLeft` came back onto `GoalCard` after being removed as
    "unreachable" earlier the same day); `N% SAVED` when there's a target but no monthly rate
    to project a date from (tracked purely by top-ups/auto-fund).
  - **Recurring** — a Monthly Contribution ONLY, no target ever, never "achieved". Ribbon is
    pace (FUNDED/AHEAD/ON TRACK/BEHIND/NOTHING PLANNED), same as it always was.
  - **Both** live in the monthly split bar identically, and **both auto-carry their monthly
    figure at rollover** — duration no longer gates which goals are in the bar or which
    auto-carry; only whether the Target field exists at all. `rolloverGoalPlanIfNeeded` builds
    a fresh CURRENT-month plan from every goal's last allocation (any goal, not "recurring
    only") the instant the month turns over, instead of nulling it and waiting for "Keep Last
    Month's Plan" — the one deliberate exception to "nothing carries over until you say so."
    Salary still only carries forward as a pre-filled, freely-editable starting figure.
  - **The design fork this whole feature turned on** — how "automatic" recurrence works — was
    put to the user with two options (lean on the existing carry-forward vs. a real standing
    order outside `goalPlan`, locked in the bar like Spending); chose the low-risk carry-forward
    option, which is what made today's correction a small, safe change rather than a rearchitect.
  - `GoalFormScreen`: Duration chip pair, chosen FIRST (decides only whether Target shows);
    Monthly Contribution now renders for BOTH durations, unconditionally. Switching TO Recurring
    clears the target (Recurring never has one); switching to One-Time no longer clears the
    monthly figure, since One-Time keeps it too.
  - Migration (v31) infers duration from what a goal already had (a target → one-time; none →
    recurring) and — corrected same day — leaves EVERY existing allocation exactly as it was on
    either kind; nothing is stripped, since a one-time goal keeps taking part in the monthly bar
    just as it always did.
  - Templates all default to Recurring (they suggest a monthly %, none ship a target amount).
  - Store suite 469 → 483 (migration, duration inference on `addGoal`, and the auto-carry
    rollover behaviour — corrected to cover BOTH durations — are all covered). tsc clean.
- **`AllocationBar` divider fixed to trade against Free only (Sep-12).** With 3+ goals in the
  bar, dragging the divider between goal 2 and goal 3 to grow goal 2 was silently taking the
  money FROM goal 3 (`rebalancePair` on the two adjacent segments — the divider's original,
  documented "one rule"). That's the opposite of what the row steppers already did
  (`allocationWithinSalary`: any one goal only ever trades against the unallocated pool).
  Reworked so every divider adjusts its LEFT segment against Free, wherever Free happens to
  sit in the bar — goals drawn after the one being dragged keep their own rupee figures and
  just shift position on screen as the dragged segment grows or shrinks. Both the drag path and
  the accessibility increment/decrement action now go through the same "segment vs Free" model.
  No store or migration change; `AllocationBar.tsx`'s own doc comment rewritten to match.
- **`getGoalPlanUsage` was hiding real money on an unplanned goal (Sep-12).** Reported as:
  "updating a One-Time goal's allocation adds value to 'This month', but a Recurring goal
  behaves correctly." Root cause: the selector's per-goal loop skipped any goal with
  `planned <= 0` entirely (`if (p <= 0) return`) — even one with REAL funded money that month
  (a manual top-up or auto-matched spend). `GoalCard`'s "This month" stat read `row?.funded ??
  0`, so that money was invisible until a plan slot existed, then suddenly appeared once an
  allocation was set — reading as though SETTING the plan had added the money. Recurring goals
  rarely show this because they're almost always created WITH a monthly figure; One-Time goals
  commonly aren't (a target funded by ad-hoc top-ups, no monthly commitment). Fixed to include
  a goal whenever EITHER `planned > 0` OR `funded > 0`. Same bug class, same fix shape, as the
  rollover-snapshot bug fixed earlier the same day — this is the live-month twin of that one.
  Dependent fix: `GoalCard`'s `planned0` used to be derived from `!status` (status was only
  ever undefined because the store skipped the row) — now derived directly from `planned <= 0`,
  so the ribbon's "nothing planned" state isn't perturbed by a goal that has money but no plan.
  Store suite 483 → 487. tsc clean.
- **A manual top-up is now a REAL transaction, not a bare number (Sep-12).** `addGoalContribution`
  used to be written straight from a typed amount — no account, no trace in Activity, no effect
  on any balance. Flagged directly: "it should either open Add Transaction with a goal variant,
  or a better version where every goal value is linked to a transaction" — went with the latter,
  since it's smaller than threading a goal mode through the 1500-line Add Transaction screen and
  matches how an AUTO goal already worked (its money was always a real, categorised transaction;
  only the MANUAL path was a shadow ledger). The "Add money" modal now also asks which account
  the money left (skipped entirely with only one account), then calls the same `addTransaction`
  every manual spend goes through and links `goalContributions`' existing (previously unused)
  `sourceTxnId` back to it. Category is picked automatically, never asked: a goal WITH an auto
  rule gets its rule's own first category, so the transaction satisfies the rule on its own and
  is picked up by the ordinary auto-match — no separate contribution is written at all, which
  structurally rules out the double-count the modal used to just warn about; a goal with no rule
  falls back to Investments (investment-kind) or Other. `getGoalTransactions` (the goal-card body
  tap's drill-down) now also lists a linked transaction alongside auto-matched ones, so "what is
  this total made of" stays honest for a manual top-up too. `deleteTransaction`/`ignoreTransaction`
  now also drop the `goalContributions` row a deleted/ignored transaction linked to — same cleanup
  `lentBorrowed` already gets via its own `sourceTxnId` — so a removed transaction can't leave a
  goal permanently crediting money that no longer left any account. Store suite 487 → 494. tsc clean.
- **"Put aside" copy tightened.** The month subtitle read "₹X of ₹Y put aside this month", which
  paired two different meanings (already-saved vs. planned) under one verb. Now "₹X saved of ₹Y
  planned this month" — each number gets its own word. The info-sheet bullet and the top-up
  modal's own copy were rewritten together with the transaction change above, since "put aside" no
  longer described what the action does (it logs a transaction now, not a bare figure).
- **"Log" corrected back to "Add" everywhere in Goals.** Flagged directly: the app already has
  one verb for this action (Add Expense, Add Transaction) and the new top-up copy had quietly
  introduced a second ("Log for X", "Logged under…"). Corrected throughout — modal title, primary
  button, both message variants, the category hint, the toast, the info-sheet bullet, the
  no-account error — to match the app's existing vocabulary rather than a locally "nicer" word.
- **Card tap now opens a real screen, `GoalDetailScreen`, with the stats a sheet had no room
  for.** `GoalTransactionsSheet` (a bottom sheet, this month's matching transactions only) is
  DELETED — everything it did moved into the new screen's own transactions section, unchanged
  (`getGoalTransactions`), alongside what never had a home before: a big ring + headline (lifetime
  saved vs. target for a One-Time goal, this month's funded vs. planned for Recurring), a 4-tile
  stat grid (saved so far / target / this month planned / this month funded), the goal's own
  auto-rule named in plain words, and a `goalHistory` table of closed months (the live month is
  already the stat grid, so history only shows what's actually settled). Registered as
  `GoalDetail` in `AppNavigator.js`. The "Add money" flow was pulled out of `GoalsScreen` into its
  own `GoalFundModal` component the moment a second screen needed the identical thing — same
  account picker, same automatic category inference, same `addTransaction` + `sourceTxnId` write,
  now with exactly one owner instead of two copies that could drift. tsc clean, full test suite
  unaffected (this is UI-only; nothing in the store changed).
- **The FAB sat too low on both `Goals` and `GoalDetail` — no `bottomInset` at all.** `FAB` never
  reads the safe area itself; every caller has to pass its own `bottomInset`, and these two
  simply didn't. Fixed to `bottomInset={insets.bottom}` on both (they're root stack screens, no
  tab bar to also clear — `DashboardScreen`/`GroupsScreen` additionally add `TAB_BAR_HEIGHT` since
  they sit on top of it). Now clears the home indicator / gesture-nav bar on both platforms.
- **The goal's auto-fund categories moved INTO the hero card, as chips.** First shipped as a
  single joined-string sentence ("Auto-tracks: Investments, merchants: x, y") in its own box
  below the stat grid. Asked to fold it into the hero card itself, the same way for a One-Time
  goal as a Recurring one, laid out as a row (or two, wrapping as needed) rather than one long
  line. Now one chip per category (its own emoji, tinted by its own colour) plus one per merchant
  keyword (a plain `pricetag-outline` glyph, since a typed keyword has no emoji of its own to
  carry).
- **The hero card was growing tall for no reason — rebuilt as two rows instead of six.** Flagged
  directly: "just increasing height unnecessary… lots of empty space". It had been one centred
  column — ring, value, sub, pace caption, kind/duration badges, auto-fund chips, each its OWN
  row — so every row past the (narrow) ring left dead space on both sides while the card kept
  growing taller. Rebuilt as: ring + the value/sub/caption column side by side in one row, then
  kind/duration badges and auto-fund chips sharing ONE wrapping row (told apart by tint alone —
  plain outline vs. a colour wash — instead of a label each). Ring shrunk 104→84pt to suit sitting
  beside text rather than centred alone; hero's vertical padding tightened to match.
- **The detail screen's fund trigger corrected to match "Add Goal" (same day).** First shipped as
  a pinned, full-width footer button ("Add Money" with a leading icon). Corrected: `GoalsScreen`'s
  only "start adding X" affordance is the shared `FAB` (a floating gradient "+", bottom-right,
  icon-only) — the detail screen's own fund trigger now reuses that exact component and position
  instead of a bespoke bar. Also the general rule this surfaced: **a full-width button in this app
  never pairs an icon with text** — a FAB carries an icon alone, a full-width button carries text
  alone. `FAB.js` gained an optional `accessibilityLabel` (default `'Add'`, every existing caller
  unaffected) since "Add Money" as visible text no longer exists once the button is icon-only.
- **The auto-fund category picker moved out of `GoalFormScreen` into its own sheet,
  `GoalCategoryPickerModal`.** Flagged directly: a row per top-level category, each expandable to
  its own sub-categories, printed straight into the form — the form's LENGTH grew with however
  many categories exist in the tree, exactly the growth the form's own header comment already
  warned about when it explained why this became a pushed screen in the first place (ui-consistency
  §2b: pick by growth). The category TREE is what actually grows unboundedly, not the rest of the
  form, so only that list moves into a sheet — name/glyph/colour/kind/duration/target/monthly stay
  a normal, fixed-length screen. The form now shows one compact `FormSelectRow` ("Choose
  categories" / a truncated one-line summary of what's picked); tapping it opens the sheet, and —
  same interaction `CategoryPickerModal` already uses elsewhere ("changes apply on tap") — every
  toggle inside writes straight to the SAME `parentIds`/`categoryIds` state the form already held,
  so there's no separate draft to reconcile and the row's summary is never a tap behind reality.
  Merchants keep their existing inline text-input + chip list (bounded by what the user has
  actually typed, so it never had this growth problem). `test:parse` 175 → 176 (new file).
- **Sep-13-2026: "why can't I pick Restaurants?" — answered, and it turned up a dead option.**
  Asked directly: "in goals add form we show categories, but dont see all sub categoriees under
  it, like for food we have groceries and other 3 sub categories, i only see groceries, why,
  check for others as well."

  **Working as designed, and the design is right — but nothing said so.** A sub-category can only
  be offered as a funding source when it has its OWN `legacyId`. Most don't: Food Delivery, Fast
  Food & Cafes and Restaurants all resolve to legacy `food`, so a rule on "Restaurants" is
  indistinguishable at match time from a rule on "Food & Dining". Measured across the tree: **only
  4 of 29 built-in sub-categories carry their own legacy id** (`groceries`, plus `self`/`lent`/
  `borrowed` under Transfers), so 8 of the 11 parents show no sub-categories at all. This is the
  SAME constraint `SpendRulesScreen` documents and refuses for the same reasons, spelled out in
  the store: sub-categories mostly have no legacy id, transactions don't always carry a
  `childCategory` (only set when the merchant dictionary matched or the user picked one by hand),
  and compaction keeps history as legacy `byCategory` — so a sub-category rule could not be
  applied to un-enriched SMS rows or to anything past 90 days.

  Matching on `t.childCategory` was considered and rejected: it would work for enriched rows and
  silently miss the rest. For a goal that funds itself automatically that is the worst failure
  mode available — the goal just under-funds, and the user has no way to see which rows were
  skipped. Giving every child its own `legacyId` is the real fix and is a data migration that
  would break aggregated history; not something to do in passing.

  So the fix is that the sheet now EXPLAINS itself, since a list where Food opens to one lonely
  chip and most parents have no chevron reads as broken rather than as deliberately limited: a
  line under the hint ("Sub-categories are offered only where spending is recorded separately"),
  plus, when a parent is expanded, the omitted children named outright — "Food Delivery, Fast Food
  & Cafes, Restaurants all record as Food & Dining". Note custom sub-categories are unaffected:
  `buildCategoryTree` gives every custom node `legacyId: c.legacyId ?? c.id`, so anything the user
  creates themselves is always independently targetable.

  **Checking "the others" turned up a real bug: Income was offered and could never fund anything.**
  Goal funding counts SPEND (`countsForSpend` is debit-or-refund) and every Income row is a
  credit, so an "Income" rule matched nothing, forever, silently. Verified empirically against
  every parent rather than by reading. Now filtered out via a new `CREDIT_ONLY_PARENT_IDS` in
  `twoTierCategories.ts` — deliberately NOT reusing `NON_BUDGETABLE_PARENT_IDS`, which answers a
  different question ("can this hold a budget") and also covers Transfers: a self-transfer into
  savings is a debit and is one of the more sensible things to fund a goal from.

  `test:goals` 70 → 89: every parent is asserted to fund or never-fund, Income is pinned as the
  only credit-only parent while Transfers is pinned as NOT one, and the 4-of-29 legacy-id count is
  asserted so that adding a `legacyId` becomes a deliberate act with a test to update rather than
  something that quietly widens the picker.
- **Sep-13-2026: "so why don't we use id instead?" — and the answer turned up four parser bugs.**
  Asked directly: "as we have distinct id for all, may be leagcy id are recurring values we can
  ommit?"

  **`legacyId` is not a duplicate of `id` — it is the PARSER'S OUTPUT NAMESPACE.** The keys of
  `CATEGORY_KEYWORDS` are exactly `food travel fuel bills shopping groceries entertainment health
  education investments salary transfer lent borrowed lent_settled borrow_repaid` — the same values
  the tree carries as `legacyId`. So the two fields answer different questions: `id` is a node in
  the DISPLAY tree (every node has a distinct one), while `legacyId` is a value the DETECTION layer
  can actually produce and the key every stored transaction, budget and compacted aggregate uses.
  They are many-to-one ON PURPOSE.

  Which is also the real reason Groceries is the one pickable child under Food: it is the only one
  the app can independently DETECT — `CATEGORY_KEYWORDS.groceries` carries bigbasket, blinkit,
  zepto, instamart, dmart. No keyword set can tell "Restaurants" from "Fast Food & Cafes" in a bank
  SMS; both are a UPI payment to a merchant name. A child gets a `legacyId` exactly where the app
  can identify it — by keyword (groceries), by the self-transfer detector (self), or via the LB
  flow (lent/borrowed). So switching to `id` would not produce finer data; it would rename coarse
  data, and a row that is genuinely only known to be `food` would start claiming to be
  `restaurants`.

  **Four real bugs found while verifying that, all one root cause.** `categorise` returned the
  first category in `CATEGORY_KEYWORDS` order with a keyword anywhere in the text, so a keyword was
  silently swallowed whenever a SHORTER keyword in an EARLIER category was a substring of it:
  - `AJIO` → **bills**, because 'jio' (the telecom) sits inside 'ajio'. Same for `JIOCINEMA`,
    `jio cinema` and `JIOSAAVN`, all of which are entertainment.
  - `AMAZON PRIME` → **shopping**, because 'amazon' swallowed 'amazon prime'.
  - `"paid back to X"` → **lent_settled** (money IN, non-spend) instead of `borrow_repaid` (money
    OUT, a real expense), because `lent_settled` carries 'paid back' and `borrow_repaid` the more
    specific 'paid back to'. **That one inverted the direction of a debt.**

  Every one of these merchants was ALREADY listed in its correct category, so the collision was
  defeating the intent rather than filling a gap — no keyword edits were needed to fix any of them.
  `categorise` now discards a matched keyword that another matched keyword contains outright, then
  applies the existing first-category-wins rule to what remains.

  **"Longest keyword wins" was tried first and is WRONG** — it broke FASTag, sending every top-up
  to bills because 'recharge' (8) is longer than 'fastag' (6) and much less specific. Keyword length
  only tracks specificity among keywords that actually OVERLAP; containment is the real relation.
  Category ORDER stays load-bearing for independent matches (travel is listed before bills
  precisely so a toll top-up is travel, not a utility bill).

  `test:parser` 323 → 331 with a new `Keyword shadowing (Sep-13-26)` suite covering all four bugs,
  plus the two cases the fix must NOT overshoot: a genuine JIO prepaid recharge is still bills, and
  FASTag is still travel.
- **Sep-13-2026: EVERY sub-category is now offered as a goal funding source.** The intent, stated
  plainly: "we create new category and sub category, map it with any new goal, then that goal will
  auto read it correctly when user categories them mannualy, as we never always be able to
  categories transaction correctly that why we have this categorisation modal... so same i want for
  existing subcategories."

  That reframes the constraint, and correctly. The earlier refusal assumed a rule could only ever
  see the FLAT category on a row — and since Food Delivery, Fast Food and Restaurants all collapse
  to legacy `food`, a "Restaurants" rule was indistinguishable from a "Food & Dining" one. But a
  transaction also carries the tree child the user actually filed it under, and **the review queue
  exists precisely so the user fixes what the parser could not work out.** A goal reading that
  correction is the whole point of having the correction.

  `ruleMatchesTxn` now matches `categoryIds` against the resolved CHILD id as well as the flat
  category id. **No new rule field and no migration**: where a child id and a legacy id are the
  same string (`groceries`, `self`, `lent`, `borrowed`) they mean the same category, so a goal
  saved as `categoryIds: ['groceries']` keeps matching parser-detected grocery rows exactly as
  before — and now also matches ones hand-filed as Groceries. Supporting pieces: `childLabelToId`
  in `buildLegacyMaps` (child labels are unique across the whole tree, which is what makes a flat
  map safe) and `childCatIdForTxn`, mirroring the existing `parentCatIdForTxn` so callers resolve a
  row's sub-category through the store's maps rather than poking at the raw label.

  The picker drops its `legacyId` filter and its "sub-categories are offered only where spending is
  recorded separately" note — nothing is withheld now. What the sheet says instead is what is
  actually true of the mechanism: only spend you've filed under a sub-category counts toward it, so
  anything re-categorised in the review queue is picked up.

  The honest boundary, which the user named themselves and accepted: a row nobody has filed past
  its parent (approve-swiped, no merchant-dictionary hit) does not match a CHILD rule — it is still
  swept by a PARENT rule, unchanged. That is the correct split rather than a gap: "Restaurants"
  meaning "all Food" would make the sub-category pointless.

  `test:goals` 89 → 94 and `test:store` 496 → 500. The store suite proves it end-to-end rather than
  through the pure matcher, because the funding path also filters on `countsForSpend`/memo/month
  first: a goal mapped to Restaurants takes the row filed as Restaurants (₹1,200), leaves the
  Food Delivery sibling and the unfiled row alone, and a parent-level Food goal still takes filed
  and unfiled rows alike.
- **Sep-13-2026: `DailyQueueSection.tsx` deleted — 700 lines of dead code.** Surfaced while
  cross-checking the review-queue flow: the component had no importers at all, and the queue
  actually mounted on the Dashboard is `DailyQueueStack.js`. It had been quietly collecting
  maintenance anyway — the shadow/`overflow` sweep earlier the same day "fixed" it, on a component
  that never renders.

  Verified before deleting: one export, zero importers, no dynamic/lazy import, no barrel
  re-export, and committed at `f70e855` so it stays recoverable. Stale references cleaned up in
  the same pass — the store's `cleanMerchant` comment and the `ui-consistency` "adopted by" list
  both pointed at it (a "keep current" list naming a deleted file is exactly how those lists rot),
  plus two example citations in the skill and one in `elevationLadder.test.mjs`. Historical
  narrative entries keep the file's name but are now marked as deleted.

  `test:parse` 176 → 175 — that suite compiles every source file, so the count tracks the file
  list; the drop IS the deletion.
- **Sep-13-2026: a goal's funding rule is now FIXED AT CREATION, a category is REQUIRED, and
  ONE-TIME goals re-derive closed months.** Three linked decisions, and the order matters —
  freezing the rule is what makes the re-derive safe, so it isn't three features but one.

  **1. The rule is ADD-ONLY, and an addition counts from the day it was added.** A goal's progress
  IS the sum of what its rule matched, so an entry it has already been measured with can never be
  removed or rewritten — that would restate what the goal has always been worth. Widening is fine
  and useful though, so `updateGoal` keeps every existing entry, accepts new ones, and stamps each
  new one into `autoRule.addedAt` (id/merchant-key → ISO date). `ruleMatchesTxn`'s new `activeAt`
  then only counts a stamped entry for transactions dated on or after it, so **a goal's number can
  only ever grow forwards from a rule edit, never change retroactively.** Entries from creation
  carry no stamp and always apply, so nothing about existing goals changes.

  This started as a hard freeze ("create a new goal instead"), which was right about the danger and
  too blunt about the cost — you could never broaden a goal without losing its history. Flagged as
  the cost of the decision, and the answer was the effective-from date: "yes we can have it like
  this, specifing to user that these counts now on." The legacy `autoParentId` back door goes
  through the same merge, so it can't sneak an unstamped entry in.

  The form says exactly what an addition will and won't do — *"they count from today onward, so
  this goal's progress so far stays as it is. What it already tracks can't be removed."* Without
  that second half a user reasonably expects a newly added category to sweep up the spend already
  sitting in it. Entries already in force show ticked but refuse to untick, and an
  already-funding merchant chip loses its ✕ — a control that removed one would make Save look
  like it did nothing, since the store keeps it regardless.

  **2. A category is required.** Merchants alone no longer qualify: a goal exists to track money
  moving into something and the category is what names it. Form-level validation only — the store
  stays tolerant so goals created before this keep working.

  **3. One-time goals re-derive a closed month.** Raised directly: "for a one time goals person
  might change in previous transactions, should we not consider it?" Correct, and the duration is
  the right axis. A RECURRING goal's month is a closed unit ("I put ₹5,000 in during August") and
  stays frozen; a ONE-TIME goal's number is a lifetime total against a target, so a category
  corrected in the review queue afterwards has to move it.

  Bounded by compaction, which drops transactions individually at `now - RAW_RETENTION_MS`
  (90 days). `getGoalLifetimeSaved` re-derives a closed month only when the WHOLE month is still
  inside that window (new `monthStartMs` helper) — a month straddling the line is already half
  gone, and re-deriving it would silently UNDERCOUNT, which is the exact failure the snapshot
  exists to prevent. Past the window the snapshot stays authoritative.

  Also fixed in passing: `GoalFormScreen`'s category summary still read `c.legacyId` only, left
  over from when that was the picker's key — so a sub-category without one was selectable but
  invisible in the form's summary row. It now reads the same `legacyId ?? id` the picker writes.

  `test:store` 500 → 510 and `test:goals` 94 → 102. The widening tests are dated EXPLICITLY rather
  than leaning on wall-clock ordering — the stamp and a transaction added moments earlier land in
  the same millisecond in a fast run, which is exactly the false pass a timing-dependent test
  gives you. They prove all four corners: an added category takes spend from after the stamp,
  never from before it, the original entry keeps counting from before the edit, and a removal
  attempt leaves the original in place.
- **Sep-13-2026: the goal congratulation was being spent on a screen nobody was looking at.**
  Reported as "not seeing the congratulations banner when goal value reached". The store was fine
  — `getNewlyAchievedGoals` returns the goal correctly, verified directly. The bug was entirely in
  the UI, and the mechanism is worth remembering: **claiming an achievement is DESTRUCTIVE.**
  `markGoalAchieved` stamps `achievedAt`, which is the exact field `getNewlyAchievedGoals` filters
  on, so a goal can only ever be celebrated once.

  `GoalAchievedModal` lived only on `GoalsScreen`, and its effect had no focus gate — while the
  "Add money" FAB that usually tips a goal over its target is on `GoalDetailScreen`. So funding a
  goal from the detail screen ran the effect on the LIST screen still mounted underneath: the
  bonus was awarded and the goal marked, against a screen the user wasn't on, and the
  congratulation was consumed without ever being seen. Nothing failed, nothing logged.

  Fixed by extracting `useGoalAchievement` (ui-consistency §0 — needed on two screens, so it
  becomes one hook) which is **focus-gated**, so only the screen the user is actually on can claim
  an achievement, and the two screens can't race for the same goal. `GoalDetailScreen` now renders
  the modal too, which is where the money usually goes in. The bonus is still credited BEFORE the
  goal is marked, so a crash between the two can only ever under-award.
- **Sep-13-2026: `GoalFundModal` had no idea a goal had a target.** Reported as "am able to add
  more than the goal value". It never read `lifetimeTarget`, so there was no "still needed" figure
  anywhere and nothing marked an overshoot.

  Overfunding stays **allowed**, deliberately: the contribution mirrors a transfer that has already
  happened, so refusing it would leave the goal disagreeing with the money. It just stops being a
  surprise — the same reasoning the funding split already uses ("a double entry is VISIBLE rather
  than prevented"). The modal now shows `₹X left to reach ₹Y`, offers it as a one-tap "Use this",
  and switches to `₹N more than the ₹X still needed` in `theme.warning` when the typed amount goes
  past it. A goal with no target (Recurring) has no finish line, so none of it renders.

  `test:goals` 102 → 112 — the focus gate and the award-then-mark ordering, both screens claiming
  through the shared hook rather than their own effect, and the fund modal knowing the remaining
  amount while explicitly NOT capping the submitted one.
- **Sep-13-2026: audited every OTHER self-opening modal — found a second data-losing bug, and gave
  them all a priority order.** Asked for after the goal congratulation fix: "do and priortise
  things which modal to be shown first and make note so any new we add we check first for
  existing once."

  **The audit.** Five surfaces on the Dashboard open themselves from a store flag, each unaware of
  the others: `MonthlyRecapModal`, `WeeklyRecapModal`, `CCPaymentPromptModal`,
  `EpcClaimBottomSheet` and the `CheckInBanner` (a banner, so it can coexist). **There was no
  sequencing between them at all** — on a first open after a month rolls over, with a card bill to
  reconcile and coins to claim, several could be `visible` simultaneously, which is precisely the
  stacking §8b already documents.

  **The second bug, and this one loses data.** `maybeQueueWeeklyRecap` writes `pendingWeeklyRecap`
  AND `weeklyRecapHandled` in ONE `set`, where the guard is what stops it queuing again — but the
  persist `partialize` kept the GUARD and dropped the QUEUE. So closing the app before the modal
  was seen threw that week's recap away permanently: claimed, never shown, no way back. Same for
  the monthly one. Notably `pendingCelebration`/`pendingCCPayment` were already persisted
  correctly, so this was drift inside one file rather than a missing idea. Both pending flags are
  persisted now — which is also what makes deferring one behind a higher-priority modal safe
  rather than destructive.

  **The order**, in `constants/autoModals.ts` (pure and dependency-free so the test can pin it
  headlessly, same as `constants/carousel.ts`): `ccPayment` → `monthlyRecap` → `weeklyRecap` →
  `epcClaim`. The card-payment question comes first because it is a question about the user's own
  money — answering it changes stored balances, so every number the other surfaces would show is
  only correct afterwards, and it has a real deadline. Monthly beats weekly because it is rarer and
  tied to a boundary that will not come round again. The coin claim is last because nothing about
  it expires. Each flag folds in the user's own "show me this" setting, so a switched-off recap
  can't block the queue behind a modal that was never going to appear.

  Also found dead while auditing: **`CelebrationModal.js` is imported nowhere** (superseded by
  `MonthlyRecapModal` — "one popup, not two"), and `pendingCelebration` is written by the store but
  read only by that dead file, so it is queued and never shown. Left in place pending a decision.

  `npm run test:modals` (new, 17 assertions) pins the order, that each surface consults the queue,
  and the invariant that actually bit: **every persisted "already handled" guard has its queue
  persisted alongside it.** Rule written up as ui-consistency §8a-i.
- **Sep-13-2026: the goal congratulation is now claimed on DISMISS, not on render — which fixes it
  properly and heals the goals the earlier attempt stranded.** Reported again after the focus fix:
  "again when i added from goals screen, did not see the celebration modal on goal amount, for
  monthly one i did."

  The focus gate was a real fix but only half the problem. The second cause: the money almost
  always arrives through `GoalFundModal`, which is itself a native `<Modal>` (via `CenterModal`).
  Closing it and presenting `GoalAchievedModal` in the same commit is exactly the stack §8b calls
  unreliable — and the ARRIVING modal is the one that silently loses. That is also why the monthly
  recap worked: nothing is dismissing when it opens.

  **Both causes have one shape: SHOWING the modal was what consumed it.** `markGoalAchieved`
  stamped `achievedAt`, and `getNewlyAchievedGoals` filtered on exactly that — so anything that
  stopped the modal reaching the screen destroyed the congratulation permanently. Patching each
  cause in turn would have left the next one to find.

  So the state is split. **`achievedAt` records a fact about the money** (and still drives the
  "achieved" badge on the card); **new `celebratedAt` records that the user was actually TOLD**,
  and only that gates the modal, stamped when the modal is DISMISSED. A congratulation that never
  arrives simply comes back. Goals stranded by the old behaviour — achieved and paid, never
  celebrated — **heal themselves on the next open**, and `getNewlyAchievedGoals` now reports
  `bonusAlreadyAwarded` so a re-show can never credit the bonus twice.

  The hook also takes `blocked`, and waits ~400ms past it (a dismissing `<Modal>` is still on
  screen for its fade), so the congratulation is held — claim included — until the screen is clear.
  `test:store` 510 → 519 and `test:goals` 112 → 117, including the case that matters most: a goal
  marked achieved is still offered, is flagged as already paid, and only `markGoalCelebrated` ends
  the offer.
- **Sep-13-2026: a goal top-up was being filed under "Other" — a regression from widening the
  category picker.** Reported as "the update button in goal card shows others category but i
  selected mutual funds for that group".

  `GoalFundModal.inferGoalTxnCategory` returned `rule.categoryIds[0]` verbatim. That was correct
  while `categoryIds` only ever held FLAT legacy ids — but since the picker started offering every
  sub-category it holds tree CHILD ids (`mf`, `restaurants`, …), and those are not flat categories
  at all. So the modal wrote `categoryId: 'mf'` into a real transaction: its own hint looked it up
  in `DEFAULT_CATEGORIES`, missed, and printed "Other" — and worse, every budget, chart and monthly
  aggregate would bucket that row as unknown. **Exactly the "when a key's derivation changes, grep
  every reader" trap noted two entries above, which I then walked into anyway** — the picker and
  the form summary got updated, this third reader did not.

  `inferGoalTxnCategory` now resolves through the tree and returns the flat `categoryId` PLUS the
  two-tier labels, so the row is filed exactly as if it had been categorised by hand — which is
  also what makes it satisfy the goal's own rule via `childCategory`.

  **And the assumption underneath it is now CHECKED rather than trusted.** For an auto-tracked goal
  the modal deliberately skips `addGoalContribution`, on the grounds that the transaction it just
  wrote already matches the goal's rule. Any disagreement between the inference and the rule
  therefore meant money left the account and the goal never moved, silently. It now asks the goal's
  real matcher (`ruleMatchesTxn`) whether the row actually matches, and writes the explicit
  contribution when it doesn't — so "Add money" always funds the goal.

  `test:goals` 117 → 121.
- **Sep-14-2026: the app was white-screening — a hook behind a short-circuit.** Reported as "app
  breaking". Mine, from the auto-modal queue: both recap modals read

  ```js
  const visible = pending && show && useAutoModalQueue() === 'x';   // ← hook inside &&
  ```

  A hook after a `&&` is **skipped whenever the left side is falsy**, so the hook COUNT changes
  between renders and React throws "rendered fewer hooks than expected" — and these sit on the
  Dashboard, which re-renders constantly. Both now call the hook unconditionally and compare the
  result afterwards.

  **Nothing in the repo could have caught it**, which is the part worth fixing: it parses, it
  type-checks, and all 2144 assertions passed, because the fault only exists at RENDER time with a
  particular value. `test:parse` — which already reads every source file to compile it — now also
  fails on a hook call appearing after a `&&`, `||` or `?` on the same line. Verified by
  re-introducing the exact line, which the lint catches and names.

  Also audited every other file touched in this session for the same shape and for hooks after an
  early return; the two recap modals were the only real cases (the scan's other hits were all
  module-level helper functions, not component bodies).
- **Sep-14-2026: THE actual reason the goal congratulation never appeared — the goal was RECURRING,
  and a recurring goal had no finish line to cross.** Reported four times ("i still dont see the
  congrats goal banner"), and **none of the three preceding fixes could ever have helped**. They
  were all real bugs (an unfocused screen claiming it, a modal stacking over it, claim-on-render
  consuming it) but none of them was THIS bug.

  `GoalFormScreen` force-clears `lifetimeTarget` on a Recurring goal — correctly, it has no target
  — and `getNewlyAchievedGoals` required `Number(g.lifetimeTarget) > 0`. So for a recurring goal
  the congratulation was **unreachable by construction**, no matter what the modal plumbing did.

  **The lesson is on me and it is about method.** Four rounds went into fixing the mechanism that
  shows the modal, because each round found a genuine defect there and that felt like progress.
  Nobody checked whether the goal could ever QUALIFY. The question "what does this data have to
  look like for the feature to fire at all?" should have come first, and one direct question to the
  user settled it in one round after four of guessing.

  **A recurring goal's finish line is THIS MONTH's committed amount**
  (`goalPlan.allocations[goalId]` — which is exactly the "monthly" figure its own form writes),
  celebrated once per month via a new `celebratedMonth` stamp (one field, cannot grow). The modal
  says so rather than reusing the one-time copy: "THIS MONTH DONE", "this month's ₹5,000 is
  covered", "It starts again next month" — "GOAL COMPLETE" on something that restarts in three
  weeks reads as wrong the moment the user looks at the goal again.

  **A monthly completion pays NO bonus, deliberately.** `awardGoalBonus` credits real RP and EPC on
  a streak multiplier; a recurring goal would collect it every month forever, and a ₹1 monthly
  commitment would farm it outright. The congratulation is the reward — the money stays tied to
  finishing something. It is flagged `bonusAlreadyAwarded` so it reuses the existing
  never-pay-twice path rather than adding a second one.

  `test:store` 519 → 528, covering both directions: meeting the amount fires, being short of it
  doesn't, no monthly amount means nothing to reach, celebrating stamps WHICH month, and the next
  month is a fresh finish line.
- **The "How goals work" explainer trimmed, and `InfoSheet` itself capped at 75% screen height.**
  Flagged directly: "too much content... used 75% height". Two separate fixes: (1) Goals' own
  copy went from 6 bullets to 3 — folded "recurring goals reapply automatically" into the body
  line (it's basic mechanics, not a separate callout), merged "they can fill themselves" +
  "or you top them up" into one "two ways money counts" bullet, dropped the standalone
  "split it here, or per goal" bullet (already covered by the body). (2) `InfoSheet` itself —
  used by 10 screens, not just Goals — had NO height cap and no scroll, so any caller with enough
  bullets could push its CTA button off the bottom of the screen with no way to reach it. Both
  the `sheet` and `centerCard` variants now cap at `SCREEN_H * 0.75` with `overflow: 'hidden'`,
  and the body/bullets sit in a `ScrollView` (`flexShrink: 1` — Yoga defaults flexShrink to 0,
  unlike web, so without it the ScrollView just grows past its bounded parent instead of
  scrolling) so the title stays put and the CTA stays reachable regardless of content length.
- **`GoalFormScreen`/`GoalDetailScreen` headers given a white fill, matching `AddTransactionScreen`'s
  pattern.** Flagged directly: "the second level n beyond screen have the header bg white; as in
  add form." Both are pushed from `GoalsScreen` (itself pushed from Profile), so they're the
  "second level and beyond" — same depth as `AddTransactionScreen`, whose header is explicitly
  `colors.card` over a `colors.background` body. `PlainScreenHeader` already had a `bordered` prop
  for exactly this (card fill + hairline) but it paints the STATIC `colors.card`/`colors.divider` —
  wrong for these two screens, which are theme-adaptive (`theme.darkMode`-aware `StatusBar`
  already). Gave `PlainScreenHeader` two new optional props, `surfaceColor`/`dividerColor`, that
  override the static bordered fill/hairline when passed; both goal screens now pass
  `bordered surfaceColor={theme.card} dividerColor={theme.divider}`. `GoalDetailScreen` also
  gained `tint`/`titleColor={theme.textPrimary}` on its header (it hadn't had either before,
  unlike `GoalFormScreen`) so the title/back-chevron ink stays theme-correct now that the bar
  itself is themed rather than transparent-over-background.

**Done — Sep-14-2026, a completed goal's Update button, target lock, and the monthly figure's bounds**
- **"Update" on an already-achieved goal relabels to "Add Extra"**, muted grey instead of primary
  blue (`GoalCard.tsx`) — it still opens the same fund modal (real money can still move in), it
  just stops competing with the ribbon's own "GOAL COMPLETE" for attention. A permanent
  congratulation banner in the button's place was considered and rejected: a congratulation is a
  one-shot MOMENT, and parking it there would state completion twice while blocking legitimate
  extra funding.
- **A one-time goal's target LOCKS once reached** (`GoalFormScreen`) — shown as a static row with
  a lock icon. Raising a target after it's already been hit would rewrite the finish line the
  achievement was measured against, the same reasoning already applied to category/merchant at
  creation.
- **Found and fixed the actual mechanism bug behind a RECURRING goal's ribbon getting stuck on
  "GOAL COMPLETE" forever**: `markGoalAchieved` was stamping `achievedAt` for monthly completions
  too, with nothing ever clearing it. Now only a `kind: 'lifetime'` completion stamps it; a monthly
  one is tracked entirely by `celebratedMonth`.
- **A recurring goal's monthly figure can be RAISED mid-month and it takes effect immediately**
  (the figure lives in `goalPlan.allocations`, already scoped to the current month) — but raising
  it after this month was already celebrated needed the stale `celebratedMonth` stamp cleared, or
  the banner would stay wrongly blocked even though funding no longer meets the new, higher
  number. Both write paths onto that figure — `updateGoalAllocation` (the form) and `setGoalPlan`
  (the split bar's whole-draft commit, which never goes through the other action) — got the reset.
- **A typed monthly figure could exceed the actual room left (salary minus budget cap minus every
  other goal's share) and get silently clamped down with NO feedback** — reported as "not
  reflecting/persisting". The store has to stay silent there (it's also the bar-drag's write
  path, and a drag can't pop a toast mid-gesture); fixed at the form layer instead: Save is now
  blocked with a toast naming the true ceiling, matching the existing "pick a category" validation
  pattern, rather than quietly saving less than what was typed.
- **The monthly figure now has a real FLOOR and, for a completed goal, a full PIN — enforced in the
  STORE itself, not just the screens that call it** (same reasoning as `autoRule` being add-only
  enforced in `updateGoal` rather than only in a form): it can never read below money already
  funded this month (`goalFundedForMonth`), and a completed ONE-TIME goal's figure can't move in
  EITHER direction at all — there's nothing left to pace toward once its lifetime target is
  reached. Both `updateGoalAllocation` and `setGoalPlan` carry the same bound; the form (toast +
  red border) and the split bar (steppers `disabled` at the floor/for a completed goal; the drag
  gesture corrected on the settled pair, since a LIVE worklet constraint isn't safe to add — see
  the drag-crash trap above) layer clear messaging on top.
- Considered and dropped: an "Archive" action for a completed goal — there's no archived-goals view
  or undo mechanism anywhere in the app yet, and a one-way disappear button with no recovery would
  be worse than the existing explicit Delete. Left as an open item, not built.

`test:store` 519 → 542 across this run; `tsc` clean throughout; full suite 2159 → 2169/2169.

**Done — Sep-14-2026, the split bar's divider still nudged mid-scroll**
- Reported as "the scroll bar still moves by scrolling." The divider's `Gesture.Pan()`
  (`AllocationBar.tsx`) had `.activeOffsetX([-4, 4])` with a comment claiming it "let a vertical
  scroll win" — but that only delays the gesture's OWN activation past 4px of horizontal
  movement; it never tells it to yield to the ScrollView above it (a plain RN `ScrollView`, not
  gesture-handler's own). An ordinary vertical swipe with any incidental horizontal jitter could
  still cross that 4px threshold before the scroll fully took over, nudging the divider mid-scroll.
  Added `.failOffsetY([-10, 10])`: the gesture now fails outright once vertical movement crosses
  that band, handing the touch back to the ScrollView instead of sitting in a pending state that
  can still claim it. `activeOffsetX`/`failOffsetY` are a pair for any RNGH gesture nested in a
  plain ScrollView — one alone isn't the yield it looked like. Component-level gesture fix with no
  `.mjs` harness coverage possible; `tsc` clean, full suite unaffected (2169/2169), as expected.
- **Still nudged after that fix ("still scrollable") — the gap was the ARENA, not the threshold.**
  The enclosing container was a plain `ScrollView` from `'react-native'`, running on RN's old
  responder system, a different arena entirely from `react-native-gesture-handler`. A gesture's
  own offset thresholds only reliably resolve ambiguity against OTHER gesture-handler
  gestures/components in that same arena — against a foreign responder it goes through a
  compatibility shim, not a guarantee. Swapped `GoalsScreen.tsx`'s `ScrollView` import to
  `'react-native-gesture-handler'` (API-identical, so the import line was the whole change).
  `failOffsetY` stays — it still needed a real threshold, it just needed the right arena to
  matter. Lesson: a gesture's own offset config only resolves conflicts within its OWN gesture
  system — check what arena the thing it's yielding to actually runs on before trusting an offset
  tweak alone. `tsc` clean, full suite unaffected (2169/2169).
- **"still scrollable, once goal completed" named the ACTUAL bug — nothing to do with scrolling.**
  An achieved one-time goal's divider was still a fully live `Gesture.Pan()` that tracked a finger
  in real time; the store-level pin from earlier only corrected the committed value on release, so
  the handle visibly slid freely and only snapped back after letting go — reads as "still
  draggable," not a scroll conflict. Root cause: `AllocationSegment.locked` (already what makes
  Spending's divider fully immovable, with no `GestureDetector` attached at all) was never set for
  an achieved goal's own segment. Fixed: `locked: !!g.achievedAt` in `GoalsScreen`'s segment
  builder, plus a new optional `lockedReason` on the segment (defaulting to Spending's existing
  wording) since the accessibility label was hardcoded to "is set in Budget" — wrong for a goal
  locked for an unrelated reason. The `failOffsetY`/gesture-handler-`ScrollView` fixes above were
  real, independent gaps worth keeping (a still-open goal's divider genuinely could nudge during a
  plain scroll) but were never what this report was about. `tsc` clean, full suite unaffected
  (2169/2169).
- **That full lock was itself wrong, on both counts ("sometimes it comes back sometimes it's able
  to decrease... only allow to increase value for goal as in form").** Mechanism: the floor was
  only ever enforced on COMMIT, never inside the live drag itself — the worklet had no floor at
  all while a finger was down, so whether it visibly snapped back on release depended on exactly
  where the finger let go. Fixed by flooring the drag LIVE: `AllocationSegment` gained `minValue`,
  mirrored onto a `useSharedValue` the gesture's `onUpdate` clamps to every frame, the same
  mechanism already used for the ceiling. Policy: a full pin (blocking increases too) was never
  right — replaced with a RATCHET where a completed goal's floor is its OWN current value (rise
  freely, never fall below it), distinct from an open goal's floor (funded-this-month, free to
  move either way down to that number). Reverted the same day, same turn, across every place the
  full pin had shipped to: the bar's segment builder, its steppers (the `+` re-enabled), the
  form's Monthly Contribution field (back to an editable input with the tighter floor, not a
  locked static row), and both store actions (`updateGoalAllocation`, `setGoalPlan`). The
  lifetime TARGET field's full lock is UNCHANGED and still correct — a different field, a
  different reason (raising a finish line after crossing it rewrites the achievement; a bigger
  goal is a new goal). `test:store` 542 → 543, `tsc` clean, full suite 2169 → 2170/2170.
- **A toast now explains why the drag stopped moving.** New optional `AllocationBar` prop
  `onFloorHit`, fired from inside the same `onUpdate` worklet that enforces the live floor, the
  instant the raw attempted value crosses below it — guarded to fire AT MOST ONCE per drag
  gesture, not once per frame spent pinned there. Decoupled on purpose: the component only reports
  the event, `GoalsScreen` decides to show a toast, with copy that differs for an achieved goal
  ("can only go up from here, never down") vs an open one (names the actual amount already funded
  this month).
- **"N MONTHS TO GO" replaced with the actual calendar month.** "does not provides much clarity" —
  a bare count makes the reader do the arithmetic to find out what month that actually is, and its
  text width grows with distance (it had already truncated once on a narrow phone). New
  `projectedMonthLabel` (`goalPlan.js`) turns the count into the month it lands on, flat-width
  regardless of how far away: `GoalCard`'s ribbon now reads "DONE BY SEP '27" instead of "18
  MONTHS TO GO"; `GoalDetailScreen`'s roomier caption reads "Done by September 2027 at this rate".
  `test:goals` 122 → 128, `tsc` clean, full suite 2170 → 2176/2176.
- **Production-readiness audit, asked for directly.** Found and fixed one real bug: the divider's
  accessibility increment/decrement bypassed the drag's live floor entirely and announced a
  requested value to screen readers even when it was about to be silently corrected by the
  commit-time safety net — the write was never wrong, but the SPOKEN number was, which reads as
  the control lying about what it did. Now floors the same way and announces "can't go below ₹X"
  instead. Confirmed clean: migration already backfills the new goal fields for pre-v30 data;
  every numeric write is NaN/undefined-guarded; no stray debug statements anywhere touched this
  session.

**Done — Sep-14-2026, the achieved-goal ratchet REMOVED (resolves the item above)**
- Asked directly: "one time confirmation... or any better?" Chose better: instead of a monthly
  prompt to manage the ratchet's permanence, removed the ratchet entirely. One rule now, for every
  goal, achieved or not: the floor is money actually funded THIS month — nothing more. That resets
  to 0 every new calendar month on its own, so the permanence problem is gone architecturally, with
  no new UI. There was never an integrity reason for the stricter rule either — completing a goal
  is fully decoupled from its monthly figure (confirmed the revision before this one), so an
  achieved goal's unfunded plan number never needed more protection than an open goal already has.
  Removed the special case everywhere it had landed: both store actions, the bar's segment/stepper
  logic, and the form's floor/messaging — the Monthly Contribution field has zero achieved-specific
  branches left in it. New test jumps the store into a fresh month with a stale carried-over figure
  and confirms the floor is 0 there, not the old peak. `test:store` 543 → 544, `tsc` clean, full
  suite 2176 → 2177/2177.

**Done — Sep-14-2026, completed one-time goals get their own "Completed" section**
- "where do we show completed one time goals?" surfaced a real capacity bug while checking: the
  main grid's `MAX_ACTIVE_GOALS` cap (8) counted a finished one-time goal FOREVER — complete 8 over
  the years and creating a 9th is permanently blocked, even though several of the "8" are just
  trophies. Hiding them was rejected outright (same reasoning as dropping "Archive" the same day:
  a one-way disappear with no way to see them again is worse than the clutter). Split into
  `gridGoals` (in progress) and `completedGoals` (done) — the cap and the main grid now only count
  `gridGoals`; a new "Completed" section (trophy icon, success-green accent) renders
  `completedGoals` right below it, in the same card style. Both still fully participate in the
  monthly split bar below (unchanged) — a completed goal can keep taking "extra" via its monthly
  figure, which is the entire reason that stayed editable at all. `tsc` clean, full suite
  unaffected (2177/2177) — UI-only, no `.mjs` harness path.

**Done — Sep-14-2026, section moved to the bottom + recurring goals can now be Discontinued**
- Reordering: "Your Goals" (in progress, including a recurring goal that's fully funded this
  month — it never earns `achievedAt`, so it's still active) stays at the TOP; the split card sits
  in the middle; "Completed" — renamed **"No Longer Active"** and broadened — moved to the very
  BOTTOM, since a genuinely finished or stopped goal is a look-back, not something to plan around.
- New: "what if a recurring monthly goal user now wants to discontinue, we don't give option for
  that." A "Discontinue this goal" action in `GoalFormScreen` (any time, not gated to a month-start
  prompt — that would reintroduce the exact interruption pattern just avoided for a different
  problem the same day), confirmed via a non-destructive modal. Discontinuing clears the goal's
  current allocation and stops its AUTOMATIC funding — a manual top-up still works, an explicit
  action always wins. History (contributions, lifetime totals) is untouched, unlike Delete. A
  "Resume" action on the card in "No Longer Active" brings it straight back to the active grid.
  Store bumped to v32 (migration backfills the new field); `backupService.ts`'s own version
  constant caught by its own sync test and bumped alongside it.
- One subtlety worth remembering: the stop is a LIVE gate off the goal's current state, not a
  recorded "paused window" — resuming lets a transaction that matched WHILE discontinued count
  too. Building true period-exclusion was judged not worth the complexity for a distinction users
  would find confusing to explain.
- `test:store` 544 → 553, `tsc` clean, full suite 2177 → 2186/2186.

**Done — Sep-14-2026, three UI polish requests**
- Discontinue moved from a quiet text row into the footer, beside Delete and Save — same shape as
  Delete's icon button, muted border instead of danger-red (nothing is lost, unlike Delete).
- `GoalCard` gets a neutral treatment for any inactive (done or discontinued) goal. **Superseded
  the same day** ("can't see any update on inactive goals") — a flat scrim was tried first and was
  invisible, because the medallion's glow and the progress ring draw straight from `color` and
  render ON TOP of any background layer, unaffected by one. Fixed for real: a new `accentColor`
  (the goal's hue when active, `theme.textMuted` when not) now feeds every accent use — the wash,
  the ring, the glow, both borders — so an inactive card is genuinely grey everywhere it matters,
  not just behind a layer that couldn't reach the parts that actually catch the eye. Identity
  (emoji, name) stays untouched.
- "This Month's Split" heading moved OUTSIDE its bordered card, matching "Your Goals" and "No
  Longer Active" — it had drifted into being the only one of the three with its `SectionHeader`
  nested inside the card box instead of sitting above it as a plain heading.
- Spacing: more room BETWEEN sections, less room BETWEEN a heading and its own content — both were
  the same distance before. `body.gap` 16 → 24, `secHead.marginBottom` 12 → 8, one shared style so
  all three sections picked it up identically.
- UI-only, `tsc` clean, full suite unaffected (2186/2186).

**Done — Sep-14-2026, goal-completion reward audit**
- User asked to review the RP/EPC bonus paid on a goal's lifetime target being reached
  (`awardGoalBonus` in `useRewardStore.ts`, fired from `useGoalAchievement`). Traced the whole
  path: detection (`getNewlyAchievedGoals`) → claim (focus-gated effect, credits RP/EPC then
  stamps `achievedAt`) → seen (`celebratedAt`, stamped on modal dismiss). Confirmed correct:
  flat 250 RP / 25 EPC base scaled by the Aware Run streak multiplier, paid at most once ever
  per goal (`bonusAwardedAt`), monthly (recurring-goal) completions are congratulated but
  deliberately never paid, and the target field genuinely locks in the form once achieved — so
  the "can't farm by editing the target down and up" claim in `rewardConfig.ts`'s comment holds
  in two independent ways, not just the store-side guard.
- **Fixed one real bug found along the way**: `awardGoalBonus`'s notification `dedupeKey` was
  `goal_achieved:${goalName}:${date}` — keyed on the goal's NAME, which the app never requires
  to be unique. Two goals sharing a name (nothing stops that — "Vacation" is a plausible name to
  reuse) both crossing their lifetime target on the same calendar day would collide, and
  `useNotificationStore.add()` REPLACES an existing dedupeKey rather than keeping both — so the
  first goal's bell notification would be silently overwritten by the second's. The RP/EPC
  itself was never at risk (that guard is `bonusAwardedAt` on the goal, keyed by id already) —
  only the bell-feed entry could be lost. `awardGoalBonus` now takes `(goalId, goalName)` and
  keys on `goal_achieved:${goalId}` — no date suffix needed, since this event can only ever
  fire once per goal ever (same permanent-key pattern the store already uses for `level_up`).
- `tsc` clean, full suite unaffected (2186/2186 unrelated tests, no reward-store unit tests
  existed to update since none called `awardGoalBonus` directly).

**Done — Sep-14-2026, goal-completion reward REWORK (amount-aware, both durations paid, one formula)**
- Follow-up to the audit above. Three real asks: (1) the flat 250 RP/25 EPC ignored the goal's own
  amount — a ₹500 goal and a ₹5,00,000 goal paid identically; (2) a recurring goal never paid
  anything, congratulation only; (3) keep the anti-grind posture the audit already confirmed
  ("not awarded too much too early"), and put the formula in exactly one place.
- **One formula, in `rewardConfig.ts`**: `computeGoalReward({durationKind, amount, streakDay})`
  wraps a NEW `bandForGoalAmount` — four fixed bands (Small/Medium/Large/Very Large) classifying
  an amount, ascending, first match wins (mirrors `MULTIPLIER_TIERS`' own shape). Both durations
  are classified by the SAME bands (the "common determination factor for amount" asked for) but
  pay a DIFFERENT scale per band — one-time pays more per band since it's a single permanent
  achievement, recurring pays less since it can repeat every month. Deliberately BANDED, not a raw
  proportion of the amount — a straight percentage would mean a big enough goal pays 50-100x a
  small one, which is exactly the "buys everything" risk; the top band is a hard ceiling
  (350 RP/35 EPC one-time, 40 RP/4 EPC recurring, pre-multiplier) no amount can exceed.
- **Recurring goals now genuinely pay**, up to once per calendar month per goal. New goal field
  `bonusAwardedMonth` (store v33) is the monthly twin of `bonusAwardedAt` — same crash-safety
  ordering (credit first, stamp second), same "paid vs seen are different facts" split that
  `achievedAt`/`celebratedAt` already established, just at monthly grain instead of once-ever. New
  store action `markGoalMonthlyBonusAwarded`; `getNewlyAchievedGoals`'s monthly branch no longer
  hardcodes `bonusAlreadyAwarded: true` — it now reads `goal.bonusAwardedMonth === mk`.
- **The actual "not too much too early" backstop**: a NEW hard ceiling on TOTAL goal-derived
  RP/EPC per calendar month, across every goal (one-time + recurring combined) —
  `GOAL_REWARD_MONTHLY_CAP_RP`/`_EPC` (1000/100), mirroring `DAILY_REVIEW_CAP`'s shape at a
  monthly grain instead of daily. Set comfortably above a single Very-Large completion at the top
  streak multiplier (~525 RP/53 EPC) so one legitimate big completion is never clipped — it only
  bites once SEVERAL goals land in the same month, the actual abuse shape (create many goals,
  fund them all at once; at `MAX_ACTIVE_GOALS`=8 all completing Very-Large in one month that would
  otherwise be ~4,200 RP, bounded to 1,000). Tracked in `useRewardStore` via
  `goalRewardMonthKey`/`goalRpEarnedThisMonth`/`goalEpcEarnedThisMonth`, reset lazily whenever the
  calendar month changes — additive persisted fields, no store version bump needed there (zustand
  `persist`'s own `merge` already spreads fresh defaults under old persisted state).
- **A clamped-to-zero result is never thrown away** — `awardGoalBonus` always returns what it
  actually paid, even ₹0, so the caller can tell "already paid earlier" (`reward === null`, a
  re-show) apart from "attempted, but this month's budget was already spent" (`reward` present but
  all-zero). `GoalAchievedModal` now has three states instead of two and never renders "+0 RP" —
  the zero case gets its own honest copy instead ("this month's goal-reward budget is already
  spent... nothing paid this time").
- **Explicitly deferred, on the user's own call**: a deadline field for one-time goals (would let
  a self-set aggressive date bump a goal's band up a notch) — ships as a follow-up once the
  banded system has been felt in practice, not bundled into this schema/migration pass. A
  time-elapsed anti-farm guard for a suspiciously fast completion was also considered and
  deliberately NOT built — the banded ceiling + the new monthly ceiling were judged sufficient,
  same shape as every other anti-grind mechanism already in this economy (`DAILY_REVIEW_CAP`,
  level-gated shop items), with no new heuristic about a goal's age to tune or explain.
- Store v32 → v33 (`bonusAwardedMonth` seeded null), `backupService.ts` `STORE_VERSION` bumped in
  lockstep (the same trap this session already hit once — an existing test catches any future
  drift). `REWARD_COPY`'s goal bullets in the RP/EPC info sheets rewritten to describe the scaling
  rule instead of a now-wrong flat number.
- New `npm run test:rewards` (`rewardConfig.test.mjs`, 42 cases): real, executable tests for
  `bandForGoalAmount`/`computeGoalReward` (band boundaries, the top band's ceiling, one-time vs
  recurring ordering on every band, the multiplier ladder) — these are dependency-free pure
  functions, unlike `useRewardStore.ts` itself, which can't run in this headless harness at all
  (zustand's `persist` middleware calls `AsyncStorage.setItem` synchronously inside `set()`, and
  the RN AsyncStorage shim has no `setItem` outside a real app) — so the monthly-ceiling clamp and
  the hook's call-site wiring are covered as source-text assertions instead, the same convention
  already used for every other RN-coupled store/hook file in this suite. `test:store` 553 → 558
  (the stale "recurring never pays" assertion rewritten, new coverage for the monthly paid/eligible
  transition added). `tsc` clean, full suite 2186 → 2233/2233 (+5 in `test:store`, +42 new file).

**Done — Sep-14-2026, GoalAchievedModal copy fix**
- The reward row's third cell showed `×1.2 Aware Run` beside the RP/EPC numbers — user flagged
  this is misleading: the Aware Run streak multiplier isn't something being AWARDED for the goal,
  it's the same counting/tracking value that scales daily review earnings — it shouldn't get its
  own line item as if it were a third payout. Removed the cell; the multiplier still scales the
  RP/EPC numbers the modal DOES show (that logic is unchanged), it just no longer has its own
  visible chip. CTA also renamed from the flat "Nice" to "Yay!" — a celebration modal deserves a
  celebrating word, not an acknowledgement.
- UI-only, `tsc` clean, full suite unaffected (2233/2233 — no test asserted on either the removed
  cell or the old button text).

**Open**
- Not yet surfaced outside Profile: no Home card, no notifications, no monthly-recap block.
- The liquid-fill visual from the prototype was deliberately NOT used — `DailyBudgetLiquidWave`
  is a PAID shop widget (`liquid_wave`, 600 EPC), so reusing it free here would undercut the
  shop. Goal progress uses a plain track/fill instead; a distinct Goals visual is open.
- Income-aware suggestions and goal feasibility warnings are still open.
- **Superseded (Sep-13-26): every sub-category is now offered in the auto-fund picker**, matched
  against the resolved CHILD id (`ruleMatchesTxn`/`childLabelToId`), not only ones with their own
  flat legacy id — see the parser-sweep memory for the reasoning.
- An "archived goals" view + undo mechanism, so a completed goal can eventually get an "Archive"
  action without being a one-way disappear.
- Not yet manually verified in a running app (no UI test infrastructure exists) — the usual
  caveat for a UI change this size.

---

## Lent/Borrowed & Splits

**Done**
- LentBorrowed refactor (May-2026): multi-select filters, account chip nav, LB exclusion
  from totals, contact/phone linking, per-person net balance.
- Split payer model: plain splits get a group-style "Who paid?"; a non-me payer books a
  memo (no balance movement, a `borrowed` row) instead of a real debit.
- Settle + CC balances (Jul-2026): new countable `repayment` category (superseded — see
  Sep-2026 below); borrow-settle books a real expense on a chosen account; single-row
  settlement invariant (never an origin+counterpart pair) enforced across every settle
  path (group, full, re-tag, manual).
- LB form + retention: shared `LbEntryForm`, inline field errors, balance-aware toasts,
  backdating fix (retention counted from `createdAt`, extended 1yr→2yr).
- Split flow audit (Aug-2026): fixed LB rows losing `contactId` on re-tag, untagging a memo
  conjuring a phantom expense.
- **`repayment` category REMOVED, merged into `borrow_repaid` (Sep-2026).** User: "remove
  repayment globally, we already have lent settled and borrow repaid." It wasn't a pure
  duplicate — `repayment` was the only SPEND-counting category the settle-with-account flow
  used, while `borrow_repaid` was blanket non-spend everywhere (even for a real bank-SMS
  "loan repaid" debit). Real fix: `borrow_repaid` is no longer in `NON_SPEND_CATEGORY_IDS` —
  paying off a debt is a genuine, final expense — and `repayment` is deleted outright.
  `lent_settled` deliberately stays non-spend (getting your own money back isn't income).
  Store v27 migration rewrites any existing `repayment` transaction to `borrow_repaid` and
  drops the dead category entry so nothing orphans. `backupService.STORE_VERSION` bumped to
  match. Mutation-verified: reverting either the category-set change or the migration turns
  new `storeIntegration.test.mjs` checks red.

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
- **Sep-9-2026: fixed a stale "already in group" checkmark in the group-tag picker** —
  reported: after tagging txn A to Group X, opening the picker for a DIFFERENT untagged
  txn B already showed a checkmark on Group X. `GroupPickerSheet.tsx` is one long-lived
  instance reused across every open (no `key` per transaction); its local `selected` state
  was only ever set on pick, never reset on close, so it survived into the next open. Now
  resets on `visible → false` (every close path — pick, dismiss, create-new — flips
  `visible`). Local UI-state bug only; the store's `tagTransactionToGroup` was never wrong.

**Open**
- None currently tracked (spend-exclusion cross-cutting checklist lives in the groups skill
  — re-audit it whenever a new spend-summing surface is added).

---

## Rewards & Gamification

**Done**
- RP/EPC dual currency, Aware Run streak + multiplier, daily review cap, shop widgets
  (Liquid Wave, Concentric Rings, Plasma Flame), zero-transaction check-in grace period.
- Budget streak + category mastery (lives in the main store, not the reward store).
- **Sep-14-26: Shop gated behind `STATIC_CONFIG.shop.enabled` (false for 1st MVP)** —
  `ShopScreen` shows a "Coming soon" state + FAQ instead of the buyable widget cards;
  RP/EPC/level keep earning and displaying exactly as before (only the catalogue is
  held back). Profile's Shop row gets a `SOON` badge. New shared `FaqAccordion`
  component for the FAQ, meant for reuse (Goals, other app FAQs).

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
- **Sep-13-2026: `HomeCarousel`'s card shadow was never actually visible.** Flagged directly:
  "all cards we show has some shadow effect so can you check again this." `cardWrap` (the
  `Pressable` wrapping each card) combined `...shadows.card` with `overflow: 'hidden'` on the
  SAME view — the clip needed to keep the gradient/bubbles inside the rounded corner also
  clips the view's OWN shadow layer (iOS `masksToBounds`; Android `elevation`), so the shadow
  the file's own comment insists on ("every other card on the Dashboard is elevated... without
  it the banner sat flat") was silently never rendering. Confirmed by checking `AccountCard.tsx`
  (a card in a DIFFERENT carousel), which already does this correctly: shadow on an outer shell
  with no `overflow`, rounding + clip on the inner `LinearGradient`. Fixed `HomeCarousel` to
  match — moved `overflow: 'hidden'` off `cardWrap` onto `card` (which now also carries the
  matching `borderRadius`), so the shadow renders and the rounded-corner clipping is unchanged.
  Answering the standing "should it even have one" question directly: **yes** — the shadow
  was always the intended design (per the file's own comment, and matching "every top-level
  section card sits at `shadows.card`" elsewhere on Home), this was purely a rendering bug,
  not a design call to revisit.
- **Sep-13-2026: same bug swept app-wide — 11 more files had a shadow clipped by `overflow:
  'hidden'` on the SAME view.** Since the HomeCarousel bug is a mechanical, greppable pattern
  (any style combining a `shadows.*` spread or literal `shadowColor`/`elevation` with
  `overflow: 'hidden'`), an Explore-agent audit checked every file in `src/screens`/
  `src/components` that uses `overflow: 'hidden'` anywhere. Found and fixed 11 more genuine
  conflicts, all via the same shell/visuals split (shadow on an outer view with no overflow,
  rounding + clip moved to an inner view — copying the already-correct pattern in
  `AccountCard.tsx`/`LentBorrowedWidget.js`/`GroupsScreen.tsx`'s own cards):
  `GoalCard.tsx` (`card` → new `cardShell` outer, caller's `style` prop — GoalsScreen's grid
  sizing — moved to the shell since it must land on the SIZING element), `DailyQueueSection.tsx`
  and `DailyQueueStack.js` (both an absolutely-positioned, `Animated.View`-transformed swipe
  card — new `cardInner`/inner `View` holds background/padding/overflow, the animated outer
  keeps position + transform + shadow), `EpcClaimBottomSheet.tsx` (`claimBtnWrap` → `claimBtn`,
  which already had the matching radius), `StreakFlameEmitter.tsx` (`container` → new
  `containerInner`), `GoalAchievedModal.tsx` (`sheet` → new `sheetInner`), `ProfileScreen.tsx`
  (`heroCard` → new `heroCardInner`), `ShopScreen.tsx` (`card` → new `cardClip`, also now
  correctly wraps the frosted lock overlay so ITS tint respects the rounded corner too),
  `LentBorrowedScreen.js` (`personCard`'s single child, `personCardHeader`, already fills it
  exactly — moved the clip there instead of adding a new view), `TransactionsScreen.js`
  (already had the correct shell/inner split for a DIFFERENT reason — §3bb's floating-✕
  clipping rule — just needed the shadow moved from the inner `sheet` onto the existing outer
  shell), `SmsDiagnosticScreen.js` (`runBtn` → `runBtnGradient`, already had the matching
  radius). **Deliberately left alone:** `CollapsingHeaderScreen.tsx`'s 3 header/elevation
  style keys — its own existing comments already document this EXACT trade-off as measured
  and accepted ("the Android elevation shadow follows the squarer outline while expanded — a
  corner's worth of difference"), and restructuring this specific, extremely fragile,
  native-driver-constrained shared component without being asked risks breaking scrolling
  headers across half the app; `TransactionItem.js`'s `groupBanner` ribbon (`elevation: 1`
  alongside `zIndex: 3` — almost certainly there for Android z-STACKING against siblings, not
  a meaningful visible shadow at that magnitude, so not worth the added nesting).

- **Sep-13-2026: the elevation ladder — the un-clipping above is what made the app look
  over-shadowed, so every shadow got re-judged.** Flagged directly: "we need to think through
  that we don't unnecessarily add extra shadow... in profile screen it's too much shadow, not
  required that much... understand which element needs what shadow." The key realisation is
  that the sweep above did not ADD a single shadow — it made shadows *render* that had been
  clipped away for their whole life, which means those numbers had never once been seen on a
  device. Authored blind, they had drifted badly: `ProfileScreen.heroCard` was **black at 0.4
  opacity** (6.7x the `card` token, 3.3x `elevated`) on a card that does not float;
  `ShopScreen.card` was 0.3 on a whole scrolling LIST; `CheckInBanner.pill` was `elevation: 16`,
  higher than the FAB.

  `constants/theme.js` now states an explicit five-rung ladder, keyed to MEANING rather than
  taste, with two new rungs: **`pop`** (a small control marked selected/grabbable) and
  **`sheet`** (a panel rising from the bottom edge, casting UPWARD). The governing rule is
  written down: **a high opacity is only ever paid for with COLOUR** — `fab` gets 0.32 because
  it is the accent hue and reads as light coming off the button, whereas black past ~0.12 stops
  reading as elevation and starts reading as grime.

  Corrections made, grouped by what was actually wrong:
  - **Over-elevated** — `ProfileScreen` `heroCard` 0.4 → `shadows.card` and `avatar` 0.45 → a
    0.22 accent halo (it is nested inside the hero, and two lifts in one composite object read
    as mush); `ShopScreen` `card` 0.3 → `shadows.card` and `cardActive` 0.35 → 0.22;
    `CheckInBanner.pill` 0.35/e16 → matched to the shared `Toast` (0.16/e10), since they are the
    same object; `StreakFlameEmitter` 0.22/e8 → `shadows.card`; `AccountDetailsScreen.card`
    0.18/y8 → `shadows.elevated`; `SheetCloseButton` 0.18 → `shadows.pop`.
  - **Two more clipped shadows the earlier sweep MISSED** — `Toast.toast` and
    `CheckInBanner.pill` both still had `overflow:'hidden'` on the shadow's own view, so neither
    had ever drawn. Both split into shell + inner.
  - **Nested same-rung shadows** (a shadow inside a shadow reads as mush, not as two depths) —
    `HomeCarousel.iconChip` (inside `cardWrap`) and `TransactionsScreen.searchBar` (inside
    `headerSection`) both dropped to flat; their fill and border already separate them.
  - **Bottom sheets all cast the wrong way** — nine sheets used `elevated`'s DOWNWARD offset,
    which throws the shadow into the sheet's own body where it can never be seen. That is
    exactly why every hand-rolled sheet had invented private numbers (`TwoTierCategorySheet` at
    `elevation: 22` and `SmartRuleModal` at 18 — the two heaviest in the app). All now on
    `shadows.sheet`.
  - **Six copies of one small-control shadow** (0.2–0.3 / r2–r3 / y1 / e2–e4) across
    `CategoriesScreen`, `GoalFormScreen`, `CreateGroupModal` (x2), `AllocationBar` and
    `AccountCard` → one `shadows.pop`.
  - **An iOS-only shadow** — `GaugeProgress.centerDisc` declared the iOS props but no
    `elevation`, so it simply did not exist on Android. Android draws from `elevation` alone.
    `ShopScreen.cardActive` had the same gap, leaving its owned-state glow invisible there.
  - **In-flow cards at the overlay rung** — `BudgetScreen.heroCard` and `CategoriesScreen.formCard`
    sat at `elevated` directly above `card`-rung lists; a hero earns prominence from size, fill
    and type, not by out-shadowing its own list.

  Deliberately NOT changed: the shared CTA convention (`GradientButton` is `elevated`, and
  `EpcClaimBottomSheet`'s claim button matches it); the chart markers
  (`ConcentricSpendingRings.tipBadge`, `GaugeProgress.pointer`) whose 0.45 is paid for with the
  datum's own colour, injected at runtime; `AnimatedTabBar` and `AccountDetailsScreen`'s wallet
  pocket, both bespoke upward-casting physical metaphors; and the two documented `overflow`
  trade-offs from the earlier sweep.

  **`npm run test:elevation`** (new, 14 assertions) holds the ladder: no neutral shadow above
  0.16, none above 0.45 at all, no hand-rolled elevation above the FAB's 10, no shadow without
  a matching `elevation`, no shadow sharing a view with `overflow:'hidden'` (4 documented
  exceptions), no bottom sheet casting downward, and >60% of shadows coming from tokens. It
  scans comment-STRIPPED source — the comments explaining these fixes quote the very numbers
  being banned, so a raw scan would fail on its own documentation.

- **Sep-13-2026: the Home carousel's shadow STILL wasn't visible — the clip was in the list, not
  the card.** Flagged: "for the home features carousel it still does not show shadow or its
  cutting at bottom of card so not visible." The card's styles had been correct since the
  shell/inner split; the clip had simply moved one level out. **A `FlatList` is a scroll
  container and clips its content to its own bounds**, and `cardWrap` is `flex: 1` (load-bearing
  — it's what makes every card stretch to a uniform row height), so each card's bottom edge sat
  exactly ON that boundary. `shadows.card` reaches `offsetY 2 + radius 8 = 10pt` BELOW the card,
  and `contentContainerStyle` reserved `paddingHorizontal` only — no vertical room at all — so
  the entire shadow was cut off.

  Fixed by reserving vertical room in the content container and cancelling it again with an
  equal negative margin on the list, so the shadow gets its space without pushing the
  Dashboard's sections apart. The amount is a new shared `CARD_SHADOW_PAD` in
  `constants/carousel.js` — **derived, not chosen**: the largest downward reach of the two
  carousels' shadows (`shadows.card` = 10, GroupInsightCarousel's card = y4 + r8 = 12).

  `GroupInsightCarousel` had the same defect in weaker form — it reserved `spacing.xs` (4) for a
  shadow reaching 12, so its bottom two-thirds were clipped. Same fix, with the negative margin
  sized to preserve its original 4pt of breathing room so its layout height is unchanged.

  **This was invisible to every existing check**: the styles are correct, tsc is happy, and
  `test:elevation` passes because the SHADOW is well-formed — only the container's padding
  decides whether anyone can see it. `npm run test:carousel` (66, was 60) now pins it: the pad
  covers both carousels' measured reach (parsed from the token and the component, so a shadow
  that grows fails the test), both carousels reserve it, and both cancel it with a negative
  margin — that last one specifically so a future spacing regression can't ship disguised as a
  shadow fix. Verified it fails by restoring the old padding-free version.

  **The general lesson, now in `ui-consistency` §6b-i: a correct shadow is only half of it — a
  shadow also needs ROOM. Any scroll container, and any ancestor with `overflow: 'hidden'`, will
  clip a child's shadow at its own edge.**

- **Sep-13-2026: Activity's header drew a line under the status bar, and its pinned filter row
  drew one on its own top edge.** Flagged: "in activity tab the header shows shadow or line below
  the status bar. Also when the filter row comes in on scroll that also shows same on top side."
  One cause for both. **A shadow spans `offsetY ± shadowRadius`, so it spills ABOVE its own
  element by `radius − offsetY`** — for `shadows.card` that is 8 − 2 = **6pt of upward spill**.
  Every card rung spills upward deliberately; that is what reads as "lifted". But `headerSection`
  is the first child of `SafeAreaView edges={['top']}`, so its spill had nowhere to go but the
  status-bar inset, and `stickyChipRibbon` pins at `top: 0`, so its spill drew along its own top
  edge. Neither was a rendering bug — both were the wrong RUNG.

  This was a real gap in the ladder: there was no rung for **top chrome**. Added
  **`shadows.topBar`** — the mirror of `sheet`. `sheet` rises from the bottom and casts up;
  `topBar` sits at the top and casts down, each toward the content it covers. It keeps
  `shadowRadius <= shadowOffset.height`, which makes the upward spill exactly zero.

  - `headerSection` → **no shadow at all**, hairline only. Nothing scrolls beneath it (it is a
    SIBLING of the list container), so a shadow there separated it from nothing. This also puts
    it back in line with `PlainScreenHeader`, the shared header on ~11 other screens, which has
    never had a shadow — Activity was the outlier.
  - `stickyChipRibbon` → **`shadows.topBar`**. This one genuinely does cover scrolling content,
    so it keeps a shadow; it just casts straight down now.

  `test:elevation` (19, was 14) asserts `topBar` has zero upward spill while every other rung
  keeps its upward spill, plus the two Activity invariants directly. A GENERIC "nothing pinned to
  the top may spill upward" scan was written, tried, and **deliberately thrown away**: `top: 0` is
  relative to whatever parent a view sits in, so it cannot distinguish screen chrome from a badge
  pinned inside a chart (`ConcentricSpendingRings.tipBadge`) or a card at the top of a stacked
  deck (`DailyQueueSection.card`) — it flagged both, and an upward spill is correct for each.
  Allowlisting them would have made a bad heuristic pass rather than tested anything.

- **Sep-13-2026 (correction, same day): the line was the header's HAIRLINE, not its shadow — and
  the search field's own edge should not have been removed.** Clarified: "have you removed the
  search bar container border, revert it, i meant the bottom filter section that we hide n show
  when scroll... that shows line at top bellow the search bar row remove that."

  Two corrections:
  1. **`searchBar`'s `...shadows.card` restored.** It had been dropped in the ladder pass as a
     nested shadow (it sat inside a then-shadowed `headerSection`). That reasoning expired the
     moment `headerSection` lost its own shadow — there was nothing left to nest inside — and the
     edge is what makes the field read as a control rather than as a gap in the bar.
  2. **`headerSection`'s bottom hairline removed.** THAT was the reported line, not the shadow.
     The bar is the white card surface and the list below it is the grey page background, so the
     boundary is already drawn by the surface change; the hairline was a second separator for it.
     It only became obvious in the state the user described: the sticky filter ribbon is white
     too, so when it slides in the hairline ends up squeezed between two white surfaces as a hard
     line across the top of the filter row.

  `stickyChipRibbon` keeps `shadows.topBar` — that part was right, it does cover scrolling
  content. `test:elevation` (21, was 19) now asserts the header has neither a shadow nor a
  divider, that the two surfaces it relies on actually differ (so the rule can't outlive its
  premise), and that the search field keeps its edge.

  Also re-learned, second time: **`themeContrast`'s static-palette ratchet greps RAW source, so a
  comment containing the literal `colors.<name>` counts as a reference.** Explaining this fix in a
  comment pushed the count 949 → 950 and failed the build; reworded to name the surfaces in prose
  instead. (The ratchet would be better stripping comments the way `elevationLadder` does, but
  changing it would rebase the budget — left alone deliberately.)

---

## Notifications

**Done**
- Full local-only inventory (no FCM): budget breach, mid-month nudge, CC payment, CC bill
  due (with OS reminder scheduling), subscription-hike alert, monthly recap.
- Onboarding permission priming (+`POST_NOTIFICATIONS`).
- **Sep-6-2026: Reminders, built.** The Profile → Reminders row was a `SOON` placeholder that
  deliberately shipped no controls; it's now a real screen in two halves:
  - **Upcoming** — a persisted `reminders` registry every source writes to, so a reminder is
    visible once set instead of vanishing into the OS. Lists the user's own reminders, lent
    AND borrow nudges, and credit-card bill dates; each row is editable (except a card bill,
    whose date comes from the bank) and cancellable.
  - **Automatic nudges** — real switches for all 7 app-initiated notifications, backed by a
    new `notificationPrefs`. Every fire site in `ePurseStore` is gated through one
    `nudgeAllowed` helper (they all live in that one file, which is why the toggles needed no
    screen changes). The switch silences the PUSH only, never the in-app bell entry — a
    breach you muted is still findable in the feed. A test asserts every switch on the screen
    has a matching gate, so a control that moves nothing can't ship.
- **Custom + repeating reminders**, via one full-screen `ReminderFormScreen` used by all three
  entry points (Add, lent bell, borrow bell). Replaced `BorrowReminderModal`, which could only
  ever do the borrow case. Presets (Tonight / Tomorrow / 3 days) + exact date & time pickers
  (new shared `TimeField`, `DateField` gained `minimumDate`) + Once / Weekly / Monthly.
- **The two directions are deliberately NOT symmetric** (settled Sep-6-2026, after a scheduled
  lent reminder was built and then removed): money you OWE is your own task, so the bell
  schedules a nudge to yourself; money owed TO YOU is someone else's task, so the action is to
  message them. The lent row therefore keeps **WhatsApp only** and shows no bell. A test guards
  the decision (`lb_lent` must not exist anywhere) rather than the code that once implemented it.
- **`WhatsAppReminderModal` → `WhatsAppReminderScreen`.** Picking a tone, setting a due date,
  editing the wording and saving a banner is a compose-and-send form, not a glance — and it was
  already a sheet pinned to a fixed 88% of screen height, i.e. a screen in sheet's clothing. As
  a screen its "saved to gallery" `CenterModal` also stops being a second `<Modal>` stacked on
  the sheet's own (the ui-consistency §8b hazard). Kept as `.js`: a move plus a shell swap,
  where also typing 5 SVG banner components would have buried the diff.
- Fixed on report: the old sheet's "Remind yourself to pay **₹1,200** to **Rahul**" line was
  demoted to a small muted string and read like a blank alarm. It's back above the banner with
  the amount + name emphasised, which is why the caller passes `presetAmount`/`presetPerson`
  SEPARATELY rather than a ready-made sentence — half a pre-composed string can't be bolded.
  Both values live on the record too, so re-opening an existing reminder says the same thing,
  and the notification body is composed from them (one source, so the two can't drift).
- Repeats are expanded into absolute one-off dates by a pure `utils/reminderSchedule`, a few
  occurrences at a time, and topped back up by `reconcileReminders()` at launch/foreground —
  **not** a native repeating trigger, because expo SDK 50 has no cross-platform monthly one
  (`CalendarTrigger` is iOS-only), so "remind me on the 5th" had no native answer on Android.
  Consequence, stated plainly: a repeat stays armed ~3 occurrences unattended and re-arms
  whenever the app is opened. Monthly clamps into short months (the 31st → Feb 28/29) instead
  of skipping them, which a naive `setMonth` does silently; 34 unit tests pin that arithmetic.
- Reminder RECORDS are backed up and re-armed on a restored device; notification **ids** are
  not (device-local, same rule as `ccDueReminderIds`).

- **Sep-6-2026: two bugs caught cross-checking a green suite**, both hidden by a swallowed
  failure path. (a) `scheduleReminder` cancelled the reminder it was replacing *before* knowing
  the new occurrences were accepted — since `reconcileReminders` re-arms repeats on every
  launch, revoking notification permission would have silently deleted every repeating
  reminder. Now arms first, retires second (prune-after-upload ordering). (b) The card-bill
  mirror was entirely dead: `formatCurrency` wasn't imported in `ePurseStore.js`, the record-
  composing line threw inside a `.then()` whose `.catch(() => {})` ate it, so card bills never
  reached the Reminders screen and every CC-bill test still passed. The test stub for
  `scheduleCCBillDueReminder` returned `null`, which short-circuited that `.then()` so no test
  ever ran it; it returns an id now and the record is asserted. Both fixes mutation-verified.
- Also fixed while cross-checking: the WhatsApp screen lost the card background its fields' grey
  fills depend on (grey-on-grey, visible only by their borders), and its Send button wasn't
  paying the bottom safe-area inset now that it's a screen with `edges={['top']}`.

**Open**
- Reminders set before this build (via the old borrow sheet) still fire, but can no longer be
  cancelled in-app: the dead `notificationIds` map they lived in was removed rather than kept
  as a shim. One-time, affects only reminders already scheduled at upgrade.
- Tapping a delivered reminder doesn't deep-link anywhere yet (no notification-response
  handler exists) — a lent reminder can't jump straight into the WhatsApp nudge.
- Not built from the suggested list: renewal reminders before a recurring charge (the data is
  already there — `detectSubscriptions` returns merchant + amount + `dayOfMonth`), stale
  settle-up nudges, stale-balance nudges, quiet hours, snooze.

- **Sep-14-2026: Reminders vs Notifications, separated.** Requested directly: a reminder is
  something the user asked to be reminded about; the "Automatic nudges" section listed
  notifications the app decides to send by itself, and the two had been living on one screen.
  Moved the 7 nudge switches (bill due, cycle closed, payment received, subscription hikes,
  budget limits, mid-month check-in, monthly recap) out to a new `NotificationsScreen`, reached
  from a **Notifications** row in Settings → Manage. `RemindersScreen` goes back to showing only
  the user's own `reminders` registry, blank via `EmptyState` by default — same shape as before
  the nudges section was ever added. No mechanism changed: `notificationPrefs` /
  `setNotificationPref` / `nudgeAllowed` still live in `ePurseStore.js` exactly as before, just
  read from the new screen. `profileNav.test.mjs` was split to match: §5 now asserts Reminders
  carries no nudge code at all, a new §5a re-asserts "every switch has a matching store gate"
  against `NotificationsScreen.tsx` instead.
- **Sep-14-2026 follow-up: Reminders' blank state un-boxed, one card per reminder.** The empty
  state was a compact `EmptyState` inside a card; every other empty screen in the app (Groups,
  Transactions, Accounts) shows unboxed centred text instead, so it's now the plain `full`
  `EmptyState` with no card wrapper. The reminder list itself used to be one shared card with a
  hairline between rows; each reminder is now its own card, stacked under a bare "Upcoming"
  heading — the same shape Goals/Groups use for their own lists.
- **Sep-14-2026, same-day: custom reminders can optionally be tied to a person + amount.**
  Requested directly, clarified via a quick multiple-choice to confirm scope. A new "Who
  (optional)" section on the reminder form (custom reminders only — an `lb_borrow` reminder keeps
  its fixed context line, unchanged) lets you type a name or pick from contacts, then optionally
  add an amount; when both are set it shows the same "Remind yourself to pay ₹X to Y" line and
  notification wording an LB-bell reminder already used. Person and amount now persist
  independently (a person tagged with no amount used to be silently dropped, since the store call
  only ever wrote both-or-neither). New shared `components/ContactPickerSheet.tsx` — extracted
  the same day out of `LbEntryForm.js`'s inline contact-search sheet (needed in >1 file, so one
  component rather than a third copy) — also dropped `LbEntryForm.js`'s own permission-denied
  dialog and ~90 lines / 11 static-colour references along the way.
- **Sep-14-2026, same-day: deleting a reminder had NO confirmation — fixed on both paths, and
  turned into a standing app-wide rule.** Flagged directly. The list's ✕ called `cancelReminder`
  straight from its `onPress`, and the form's own "Delete reminder" button called its delete
  handler directly — a single accidental tap permanently removed a reminder with no way back,
  unlike every other delete flow in the app (accounts, goals, groups, transactions, LB entries),
  which already gate the real call behind a `CenterModal`. Both now do too — the list holds one
  shared confirm keyed by the tapped reminder's id, the form's confirm gates its existing delete
  handler. Documented as a permanent rule (ui-consistency §8c-i): a destructive/irreversible
  action's `onPress` may only set STATE, never call the store action itself — that happens in the
  confirm's `onPrimary` alone. `profileNav.test.mjs` asserts both Reminders paths route through a
  `CenterModal` rather than calling `cancelReminder` inline.
- **Sep-14-2026, same-day follow-up: the form's Delete button moved to match every other edit
  screen.** It was a full-width "Delete reminder" row at the end of the scroll; every other edit
  form (`GoalFormScreen`, etc.) puts Delete in the pinned footer beside Save instead, icon-only
  and the same height as Save but a fraction of the width. Moved and restyled to match exactly —
  behaviour unchanged, only where it lives and how it looks.

---

## Backup (Google Drive)

**Done**
- Encrypted backup/restore (AES-256-GCM + scrypt), ALLOW-LIST payload (parsed values only,
  raw SMS never leaves the device), `drive.file` OAuth scope, onboarding restore entry point.
- Password vs recovery-key normalisation (`toKeyMaterial`), Hermes-safe crypto (no
  TextEncoder/Buffer/atob dependency).
- **Sep-14-26: FAQ section** (shared `FaqAccordion`) — encryption safety, lost-phone restore,
  forgotten-password recovery, raw SMS never uploaded. Second adopter after Shop.

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
- **Sep-14-2026: Settings destination tree — Title Case sweep + a rename.** Flagged directly:
  headings across Settings and its nested screens read inconsistently (`SettingsScreen`'s own
  row list mixed `Monthly recap` sentence-case beside `SMS Diagnostic` Title-case). Swept
  `SettingsScreen` and the screens actually reachable ONLY by navigating through it
  (`NotificationsScreen`, `SpendRulesScreen`) onto the standing Title Case rule — `SectionHeader`
  titles, button labels, and (newly covered) `NavListRow` labels all fixed to Title Case;
  hints/subtitles/EmptyState copy/confirm-dialog titles stayed sentence case, unaffected. Also
  renamed "Counts as expense" → **"Expense Inclusions"** (the Settings row label and
  `SpendRulesScreen`'s own screen title, kept in sync) — the underlying concept/predicate is
  still `spendExcluded`/"counts as expense" everywhere in code, only the visible copy changed.
  `BackupScreen` was swept too in a first pass, then reverted — it's a Profile-hub sibling of
  Settings (its own top-level destination, not nested under it), caught on report ("why are you
  changing in backup screen").

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
- **Double-submit guard (Sep-2026):** new shared `src/hooks/useSubmitGuard.ts` — a
  double-tap on a Save/Add button used to create two persisted rows (every add action
  mints a fresh id, nothing de-dupes). Swept 13 forms: Add Transaction, Add Group
  Expense, the Lent/Borrowed entry form (both shells), Add Account, the shared
  `CenterModal` confirm dialog (~30 call sites), both CC-payment sheets, Create Group,
  custom categories, Budget Plan. Wires into `GradientButton`'s existing but previously
  unused `loading` prop for a real spinner + auto-disable. WhatsApp reminder screen and
  the Daily Queue's review-award path still remain — lower risk, not yet done.
- **Depth-2+ header/status-bar sweep (Sep-13-26).** Flagged directly (via Goals, then
  widened app-wide): "the status bar color need to be in sync as well and we are talking
  about all screens... 2. and beyond." A screen is "depth 2+" if it's only reachable by
  navigating through ANOTHER already-pushed (non-tab) screen — e.g. `Settings`/`Goals`/
  `Shop`/`Reminders`/`Backup` (pushed from `Profile`, itself pushed from a tab) and
  `Categories`/`SpendRules`/`SmsDiagnostic`/`GoalForm`/`GoalDetail` (pushed one level
  deeper still, from `Settings`/`Goals`). An Explore-agent audit of the full
  `AppNavigator.js` reachability graph (19 pushed screens, 6 at depth 1 / 13 at depth 2+)
  found two separate gaps across the depth-2+ set:
  1. **10 of 13 depth-2+ screens had a `PlainScreenHeader` with no `bordered`**, so the
     header had no fill of its own and simply showed through to the page's gray/themed
     background — only `LbPersonScreen` (hand-rolled), `GoalFormScreen` and
     `GoalDetailScreen` (both already fixed the same day, see Goals above) painted a real
     white/card bar. Fixed the other 9 the same way: `SettingsScreen.js`,
     `BackupScreen.js`, `SpendRulesScreen.js`, `CategoriesScreen.js` get plain `bordered`
     (they're static-palette screens, so the component's built-in `colors.card`/
     `colors.divider` default is correct); `RemindersScreen.tsx`, `GoalsScreen.tsx`,
     `ShopScreen.tsx`, `ReminderFormScreen.tsx`, `WhatsAppReminderScreen.js` get
     `bordered surfaceColor={theme.card} dividerColor={theme.divider}` (or `D.card`/
     `D.border` on Shop, which uses `useRewardPalette`'s `D` alias for the same theme
     tokens) since they're theme-adaptive screens whose `StatusBar` already branches on
     `theme.darkMode`.
  2. **3 screens had NO owned `<StatusBar>` at all** — `CategoriesScreen.js`,
     `GoalDetailScreen.tsx` (both branches — the "goal not found" empty state and the
     main render), and `SmsDiagnosticScreen.js`. Since `expo-status-bar` is a
     last-mounted-wins global and native-stack never unmounts the screen behind it, each
     of these was silently inheriting whichever style its PARENT screen happened to set
     — `CategoriesScreen`/`GoalDetailScreen` got lucky (parent's dark-icon choice happens
     to match their own light/card surface), but `SmsDiagnosticScreen` (a fixed gradient
     `CollapsingHeaderScreen`, `collapsible={false}`) was inheriting `Settings`' dark
     icons on top of its own saturated gradient header — the actual invisible-icon bug
     the sweep was meant to catch. Fixed: `CategoriesScreen` gets a bare
     `<StatusBar style="dark" />` (matches its sibling static screens), `GoalDetailScreen`
     gets `<StatusBar style={theme.darkMode ? 'light' : 'dark'} />` in both branches
     (matches `GoalFormScreen`'s existing pattern), `SmsDiagnosticScreen` gets a bare
     `<StatusBar style="light" />` (matches every other fixed-gradient `CollapsingHeaderScreen`
     screen, e.g. `GroupsScreen.tsx`).
  `PlainScreenHeader` gained two new optional props to make fix #1 possible without
  hardcoding a static colour onto a theme-adaptive screen: `surfaceColor`/`dividerColor`
  override the `bordered` fill/hairline when passed, so `bordered` alone still means "the
  static default" for a non-theme screen and `bordered` + the two overrides means "the
  live theme's card/divider" for one that isn't. Depth-1 screens (`Profile`,
  `AddTransaction`, `AddGroupExpense`, `LentBorrowed`, `AccountDetails`, `BudgetPlan`)
  were explicitly OUT of scope for this pass and were left untouched even where the audit
  incidentally found a gap there too (`AccountDetails` has no header fill; `LentBorrowed`
  has no owned `StatusBar` on its gradient `CollapsingHeaderScreen` at all) — flagged
  below, not fixed, since the ask was depth 2 and beyond.
- **iOS follow-up: the safe-area TOP INSET itself wasn't white (Sep-13-26).** Flagged
  directly: "in ios the status bar color is not white... we are specifying the color not
  using default." The depth-2+ sweep above painted the HEADER white via `bordered`, but on
  every one of those 11 screens the `SafeAreaView` (or hand-rolled equivalent) wrapping the
  header was ITSELF still filled with the page's gray/themed background — and on iOS the
  safe-area top inset (behind the notch/Dynamic Island, where the clock/battery sit) is
  real screen area painted by whatever's directly behind it, not by the header row nested
  inside it. So the actual status-bar strip stayed gray while a white header started only
  just below it — a visible seam, and the literal "specifying [a] color [instead of
  leaving it to] default" the report described (the `SafeAreaView`'s own style explicitly
  set `backgroundColor: colors.background`/`theme.background`). Confirmed the working
  counter-example already existed: `AddTransactionScreen`'s `headerSafe` and
  `LbPersonScreen`'s `root` both paint the SafeAreaView ITSELF `colors.card`, which is why
  neither ever showed the bug. Fixed the same way on all 11 screens the depth-2+ sweep
  touched: `SettingsScreen.js`, `BackupScreen.js`, `SpendRulesScreen.js`,
  `CategoriesScreen.js`, `GoalsScreen.tsx`, `GoalFormScreen.tsx`, `GoalDetailScreen.tsx`
  (both branches), `RemindersScreen.tsx`, `ReminderFormScreen.tsx`,
  `WhatsAppReminderScreen.js`, `ShopScreen.tsx` — the SafeAreaView now carries the header's
  own white/card fill, and the scrollable body below it (a `ScrollView`'s `style`, or a
  wrapping `View` where the body isn't a single ScrollView, as on `ShopScreen`) repaints
  the page's gray/themed background explicitly, so the "white header over gray body" look
  is unbroken — just with the white now correctly starting at the very top of the screen
  instead of below the notch. `WhatsAppReminderScreen` needed no body repaint since its
  own body (`sheet`) was already `theme.card`, matching the header. Caused a real ratchet
  bump on the 4 static screens (`colors.card`/`colors.background` +4 net after removing one
  phantom match from a code comment that happened to contain the literal string
  "colors.card") — `docs/DARK_MODE.md`'s recorded budget updated 945→949 with a note
  explaining it's a legitimate fix, not new code choosing the static palette over
  `useTheme()`.
- **Two more polish fixes on the same set of screens (Sep-13-26).** Flagged directly: "check
  we have proper padding for the first item we render below header as in some it no padding
  like in goal screen[; and] the month [line] at top has the separation line visible[,]
  correct that." (1) `GoalsScreen.tsx`, `GoalFormScreen.tsx`, `RemindersScreen.tsx` and
  `ReminderFormScreen.tsx` were each missing `paddingTop` on their scroll body
  (`paddingHorizontal`/`paddingBottom`/`gap` only) — the first card/field sat flush against
  the header with no breathing room, unlike `SettingsScreen`/`BackupScreen`/`SpendRulesScreen`/
  `CategoriesScreen` (which use the `padding: spacing.lg` shorthand, covering top too) and
  `GoalDetailScreen`/`WhatsAppReminderScreen` (already fine for the same reason). Added
  `paddingTop: spacing.lg` to the four. (2) `GoalsScreen`'s month line (`"September 2026 ·
  plan set"`) sits BELOW the header as its own `<Text>`, and the header's `bordered` hairline
  was drawing between the TITLE ROW and that line — the wrong boundary; the one dividing
  hairline belongs between the whole white chrome block (title + month line) and the gray
  scrollable body below, i.e. under the month line, not above it. `PlainScreenHeader` gained
  a `hairline` prop (default `true`) that suppresses just the border while keeping `bordered`'s
  fill; `GoalsScreen` now passes `hairline={false}` and draws its own `borderBottomWidth:
  StyleSheet.hairlineWidth` on the month line's own style instead. No other screen touched
  this session renders content directly below the header outside the ScrollView, so no other
  caller needed this axis.
- **`ShopScreen` was missed by the paddingTop pass above (Sep-13-26 follow-up: "shop still
  misses").** Its first item below the header isn't inside the `ScrollView` either — it's
  `balanceStrip`, a bordered card rendered as a sibling right after the header (same shape as
  `GoalsScreen`'s month line, which is why the earlier sweep's "check the scroll body's
  `paddingTop`" framing missed it: `balanceStrip` had `marginHorizontal`/`marginBottom` but no
  `marginTop`, so it sat flush against the header with zero top spacing). Added
  `marginTop: spacing.lg` directly on `balanceStrip`'s own style. General lesson: "does the
  scroll body have `paddingTop`" isn't the full check — the real question is "does whatever
  renders FIRST below the header (in or out of the ScrollView) have top spacing", and a card
  rendered outside the ScrollView needs its OWN margin, not a contentContainerStyle fix.
- **Dashed borders removed app-wide, replaced with a plain thin solid edge (Sep-13-26).**
  Flagged directly: "remove the dotted border wherever we have, just have the thin pure
  line." Swept every `borderStyle: 'dashed'` on a plain RN View border (the classic "tap to
  add" / "this is a custom input, not a preset" cue) — 8 occurrences across 7 files:
  `BudgetPlanScreen.js` (`addCatBtn`), `BudgetScreen.js` (`unbudgetedCard`),
  `CategoriesScreen.js` (`newParentBtn`, `emojiOwn`), `GoalFormScreen.tsx` (`emojiOwn`),
  `AccountsScreen.js` (`addCardPlaceholder`), `BudgetSummary.tsx` (`emptyCard`),
  `GroupPickerSheet.tsx` (`newRow`). Just deleted the `borderStyle` line each time — RN
  defaults to solid, so no replacement value needed. The two "own emoji" tiles
  (`CategoriesScreen`/`GoalFormScreen`) keep reading as an input rather than one more preset
  WITHOUT the dash: presets carry no border (or a transparent one until selected), so the
  tile's now-solid border is still the distinguishing cue on its own.
  **Deliberately NOT touched — these are SVG `strokeDasharray`, a different mechanism for a
  different purpose, not a `View` border:** `GhostLineChart.js`'s ghost (previous-month) line
  — a named, documented "this month vs a ghost of last month" data encoding, already also
  colour-differentiated from the hero line, but the dash itself carries the "faded/past"
  connotation the component is named for; `HabitLeakMatrix.js`'s quadrant divider lines — a
  threshold/reference-line convention, not an editable control; `ProgressRing.tsx`/
  `CustomWidgetContainer.tsx`'s `strokeDasharray` — a progress-ring RENDERING TECHNIQUE (dash
  length set to the full circumference so the ring draws as a plain solid arc; not visually
  dashed at all); `WhatsAppReminderScreen.js`'s decorative "stamp/seal" SVG in a promotional
  banner illustration (a real stamp's perforated edge is the whole point of the shape).

**Open**
- Depth-1 gaps found incidentally during the depth-2+ sweep, NOT fixed (out of scope):
  `AccountDetailsScreen.tsx`'s header (`styles.navBar`) has no `backgroundColor` at all,
  so it shows through to the page background rather than a distinct bar; and
  `LentBorrowedScreen.js` (gradient `CollapsingHeaderScreen`) has no owned `<StatusBar>`
  anywhere in the file, relying entirely on whatever the Dashboard tab last set.
- `align="bottom"` in `RecapModalShell.tsx` is dead code (no live caller) — flagged, not
  removed, in case a future recap variant wants it.
- Double-submit guard not yet applied to `WhatsAppReminderScreen.js` (`handleSend`) or
  `DailyQueueStack.js` (`markReviewed`/`recordReview`) — see the double-submit-guard memory.

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
