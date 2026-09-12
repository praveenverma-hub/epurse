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

**Open**
- Not yet surfaced outside Profile: no Home card, no notifications, no monthly-recap block.
- The liquid-fill visual from the prototype was deliberately NOT used — `DailyBudgetLiquidWave`
  is a PAID shop widget (`liquid_wave`, 600 EPC), so reusing it free here would undercut the
  shop. Goal progress uses a plain track/fill instead; a distinct Goals visual is open.
- Income-aware suggestions and goal feasibility warnings are still open.
- Sub-category rules only bite where a child has its OWN flat category id — in the built-in
  tree that's Groceries and the Transfers children; every USER-created sub-category has one.
  The editor only offers the ones it can actually enforce.
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
- **Double-submit guard (Sep-2026):** new shared `src/hooks/useSubmitGuard.ts` — a
  double-tap on a Save/Add button used to create two persisted rows (every add action
  mints a fresh id, nothing de-dupes). Swept 13 forms: Add Transaction, Add Group
  Expense, the Lent/Borrowed entry form (both shells), Add Account, the shared
  `CenterModal` confirm dialog (~30 call sites), both CC-payment sheets, Create Group,
  custom categories, Budget Plan. Wires into `GradientButton`'s existing but previously
  unused `loading` prop for a real spinner + auto-disable. WhatsApp reminder screen and
  the Daily Queue's review-award path still remain — lower risk, not yet done.

**Open**
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
