# Dark mode — what it will take

> **Status: NOT STARTED.** The *mechanism* is built and tested; the *surface migration* is not.
> Gated by `STATIC_CONFIG.theme.canvasThemes` (currently `false`). Written 2026-09-01 so the
> inventory doesn't have to be rediscovered.

## 1. What we're building

A real light/dark mode, WhatsApp-style: the whole app repaints, not one screen.

- **Background** — deep slate `#0F172A`, the dark counterpart of today's `#F4F5F7`.
- **Cards and raised surfaces** — shades of dark slate, each keeping the JOB it has in the light
  palette (a card lifts off the background; a divider separates rows *inside* a card; an input
  border is stronger than a divider, so an unfilled control still has an edge).
- **Text** — light shades of white and grey for reading, **carbon mint `#00FFC2` for emphasis**.

  One recommendation, from measuring it: mint reads at **12.21:1** on the slate card, which is
  excellent for a figure, a link, an active label or a key number — and too loud for body copy.
  Neon body text is fatiguing at paragraph length, and if everything is mint then nothing is
  emphasised. Use mint the way the light theme uses the accent: on the thing you want looked at
  first. The greys below already carry the reading.

## 2. The palette (built, measured, ready)

`CARBON_NEUTRALS` in `src/constants/themes.js`. Measured against the light palette it mirrors —
**better in every pair**, and notably better in the two places light has always been weak:

| Role | Carbon | on light | |
|---|---|---|---|
| `background` | `#0F172A` | `#F4F5F7` | the canvas |
| `card` | `#182234` | `#FFFFFF` | lifts off bg 1.120 (light 1.091) |
| `cardAlt` | `#1F2B40` | `#FAFAFB` | second-level surface |
| `divider` | `#2A3853` | `#EAECEE` | 1.358 on card (light 1.184) |
| `inputBorder` | `#3A4A69` | `#D7DADE` | 1.794 on card (light 1.403) |
| `textPrimary` | `#E6EDF5` | `#1C1C1E` | 13.51:1 (light 17.01) |
| `textSecondary` | `#9BB0C9` | `#6B7280` | **7.17:1** (light 4.83) |
| `textMuted` | `#7A93AF` | `#9CA3AF` | **5.03:1** (light 2.54 — a long-standing gap, not inherited) |
| accent (mint) | `#00FFC2` | — | **12.21:1** on card (1.31 on white) |

Status colours are theme-agnostic and all gain: success 6.28, danger 4.24, warning 7.42, info 4.33
— against 2.54 / 3.76 / 2.15 / 3.68 on white.

## 3. Why it isn't on yet — the one blocker

**972 `colors.*` references across 50 files paint from the STATIC light palette.**

`src/constants/theme.js` exports `colors` as a frozen light palette, and `StyleSheet.create`
captures those values at module load. **No palette change can ever reach them** — not a theme
switch, not the `darkMode` flag. Turn the canvas on today and the themed surfaces go slate while
everything else stays white: a half-lit app, worse than a consistently light one.

## 4. The migration — mechanical, not a redesign

`theme.*` is a **strict superset** of `colors.*` (asserted by a test in `themeContrast.test.mjs`;
`inputBorder` was the last missing key and now exists on both). So a file converts by renaming the
object, using the pattern `RewardShop.tsx` / `ProfileScreen.tsx` already use:

```js
// before
const styles = StyleSheet.create({ card: { backgroundColor: colors.card } });

// after
const makeStyles = (t) => StyleSheet.create({ card: { backgroundColor: t.card } });
// …inside the component:
const theme = useTheme();
const styles = useMemo(() => makeStyles(theme), [theme]);
```

**Per-file gotchas, in the order they'll bite:**

1. **Sub-components declared at module scope that use `styles`** (9 files, marked below). `styles`
   stops being module-scope, so they must take it as a prop — `RewardShop` did exactly this for
   `LevelChip` / `XpBar` / `ShopCard`. This is the only part that isn't a rename.
2. **18 files don't call `useTheme()` yet** — add the hook. A few are pure presentational
   components with no hook context today; check each renders inside the tree (all do).
3. **Inline `colors.` in JSX**, not just in the stylesheet — same rename, easy to miss with a
   stylesheet-only pass.
4. **`SmsDiagnosticScreen` has 3 `StyleSheet.create` calls** — the only file that does.
5. **Hardcoded hex outside `colors`** — `#FFF`, `#000`, `rgba(...)` literals are NOT covered by the
   rename and are the likeliest source of a white block on a dark screen. Grep separately.
6. **`shadows.*`** are tuned for a light ground; a black drop shadow on slate is invisible. Dark
   surfaces usually need a lighter border instead of a shadow (`useRewardPalette` already does this
   with its `hairline` pair).
7. **Decorative gradients and tints** keyed off `theme.darkMode` — `buildPalette` now reports the
   EFFECTIVE value, so these follow the canvas automatically once the surface underneath them does.

## 5. Suggested order

Tranche by what the user sees, so each step is eyeball-verifiable on a device:

1. **The five tabs** — Dashboard, Transactions, Analytics/Insights, Groups, Accounts.
2. **Shared components they render** — `TransactionItem`, `MonthDivider`, `SectionHeader`,
   `EmptyState`, `NavListRow`, `PlainScreenHeader`, `HomeCarousel`, `AccountChip`.
3. **Modals and sheets** — `CategoryPickerModal` (the single worst file), `SplitConfigModal`,
   `LinkContactModal`, `TxnDetailSheet`, `GroupTxnDetailSheet`, `ExportSheet`, the reminder modals.
4. **Pushed screens** — Settings, Categories, SpendRules, Backup, BudgetPlan, LbPerson,
   AddTransaction, AddGroupExpense, SmsDiagnostic.
5. Flip `STATIC_CONFIG.theme.canvasThemes` to `true`. Nothing else changes.

## 6. Open decision — accent-owned, or a real toggle?

Right now dark is tied to the Carbon accent (`alwaysDark: true`). The store has always had a
separate `darkMode` flag and `setDarkMode`, with `DARK_NEUTRALS` sitting unused since the palette
was written. **The migration unblocks both** — same code path — so this can be decided after, not
before. WhatsApp-style suggests the toggle: *Settings → Appearance → Light / Dark / System*, with
the accent orthogonal to it. Carbon would then be the accent that also *defaults* to dark.

## 7. Inventory (measured, 2026-09-01)

**50 files · 972 references.** `useTheme?` = already has the hook. `subs` = module-scope
sub-components touching `styles` (the gotcha in §4.1) — bold means it needs the prop-passing fix.

| File | `colors.*` refs | useTheme? | sheets | subs |
|---|---|---|---|---|
| `components/CategoryPickerModal.tsx` | 59 | yes | 1 | **2** |
| `screens/TransactionsScreen.js` | 51 | yes | 1 | 1 |
| `screens/BudgetScreen.js` | 48 | yes | 1 | 1 |
| `screens/AccountsScreen.js` | 46 | yes | 1 | 1 |
| `components/SplitConfigModal.js` | 46 | **no** | 1 | 1 |
| `screens/AddTransactionScreen.tsx` | 42 | yes | 1 | **2** |
| `components/LinkContactModal.js` | 40 | **no** | 1 | 1 |
| `screens/BackupScreen.js` | 34 | yes | 1 | 1 |
| `screens/BudgetPlanScreen.js` | 34 | yes | 1 | 1 |
| `components/TransactionItem.js` | 34 | **no** | 1 | 1 |
| `components/BorrowReminderModal.js` | 33 | yes | 1 | 1 |
| `screens/GroupsScreen.tsx` | 31 | yes | 1 | 1 |
| `components/DailyQueueStack.js` | 29 | yes | 1 | **3** |
| `screens/LbPersonScreen.js` | 28 | yes | 1 | **2** |
| `components/CreateGroupModal.tsx` | 28 | yes | 1 | 1 |
| `components/LbEntryForm.js` | 26 | **no** | 1 | 1 |
| `components/TxnDetailSheet.tsx` | 24 | yes | 1 | 0 |
| `screens/AnalyticsScreen.js` | 23 | yes | 1 | **6** |
| `screens/CategoriesScreen.js` | 23 | yes | 1 | 1 |
| `components/ExportSheet.tsx` | 21 | yes | 1 | 1 |
| `components/WhatsAppReminderModal.js` | 21 | yes | 1 | 1 |
| `components/GroupTxnDetailSheet.tsx` | 20 | yes | 1 | 0 |
| `components/HabitLeakMatrix.js` | 17 | **no** | 1 | **2** |
| `screens/LentBorrowedScreen.js` | 16 | yes | 1 | **2** |
| `screens/SmsDiagnosticScreen.js` | 15 | **no** | 3 | 1 |
| `screens/SpendRulesScreen.js` | 15 | yes | 1 | 1 |
| `components/FormField.tsx` | 15 | **no** | 1 | 0 |
| `components/GroupExpenseForm.tsx` | 15 | yes | 1 | 1 |
| `components/AddAccountModal.js` | 14 | yes | 1 | 1 |
| `screens/SettingsScreen.js` | 11 | yes | 1 | 1 |
| `components/CelebrationModal.js` | 10 | yes | 1 | 1 |
| `screens/AddGroupExpenseScreen.tsx` | 9 | **no** | 1 | 1 |
| `components/GhostLineChart.js` | 9 | **no** | 1 | 1 |
| `components/GroupPickerSheet.tsx` | 9 | yes | 1 | 0 |
| `components/CenterModal.js` | 8 | yes | 1 | 0 |
| `components/DateField.tsx` | 8 | **no** | 1 | 0 |
| `components/InlineDropdown.tsx` | 7 | yes | 1 | 1 |
| `components/MonthDivider.tsx` | 7 | **no** | 1 | 0 |
| `components/SubscriptionHeartbeat.js` | 7 | **no** | 1 | **2** |
| `components/GroupExpenseSheet.tsx` | 6 | **no** | 1 | 1 |
| `components/HomeCarousel.tsx` | 6 | yes | 1 | **2** |
| `components/CustomWidgetContainer.tsx` | 5 | **no** | 1 | 0 |
| `screens/DashboardScreen.js` | 4 | yes | 1 | 1 |
| `components/PlainScreenHeader.tsx` | 4 | **no** | 1 | 1 |
| `components/SectionHeader.tsx` | 4 | **no** | 1 | 1 |
| `components/AccountChip.js` | 3 | **no** | 1 | 1 |
| `components/AppBrandFooter.tsx` | 2 | yes | 1 | 1 |
| `components/EmptyState.tsx` | 2 | yes | 1 | 1 |
| `components/SheetCloseButton.tsx` | 2 | **no** | 1 | 1 |
| `components/NavListRow.tsx` | 1 | yes | 1 | 1 |

Regenerate with:

```
grep -rc "\bcolors\.[a-zA-Z]" src/screens/*.js src/screens/*.tsx src/components/*.tsx src/components/*.js | awk -F: '$2>0' | sort -t: -k2 -rn
```

A **ratchet** in `themeContrast.test.mjs` reads the 972 above and fails if the count goes UP, so the
backlog can only shrink. When it shrinks, update the number here.
