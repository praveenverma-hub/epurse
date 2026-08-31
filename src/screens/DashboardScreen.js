// =============================================================================
// DashboardScreen
// -----------------------------------------------------------------------------
// Layout (top → bottom):
//   1. Gradient header — greeting + vault / bell / avatar
//   2. Hero — SPENT for the selected period (expenses − refunds)
//   3. D / W / M / Y period toggle + the synced-date-range label
//   4. Income / Refunds — one segmented surface, not two pills
//   5. HomeCarousel — live cards ranked by urgency; feature promos are its empty
//      state (see analytics/homeCards.js)
//   ── "your money" group ──
//   6. Lent / Borrowed widgets
//   7. Monthly recap card (month-end look-back; below the live balances)
//   8. Budget summary
//   ── "activity" group ──
//   9. Daily review queue (self-hides when empty)
//  10. Recent transactions for the selected period (capped at HOME_RECENT_LIMIT)
//  11. Brand footer + FAB
//
// Sections 6-8 and 9-10 are WRAPPED into groups so the page has two levels of
// spacing (tight within a group, looser between) — see `bodyContent` in styles.
//
// This list was wrong for a while — it promised a "total ePurse balance" hero and
// "account chips, horizontal scroller", neither of which exists (net worth lives
// on AccountsScreen via selectEPurseNetWorth, and Home shows no balance at all).
// It's the map the next change navigates by, so keep it honest.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';

import { useEPurseStore, selectUnreviewedQueue, selectYesterdayTransactionCount, selectGapTransactionCount, selectExpenseStats, selectLatestRecapMonth, selectWeeklySummary, spendExcluded } from '../store/ePurseStore';
import {
  useRewardStore,
  selectLevel,
} from '../store/useRewardStore';
const selectPendingSavings = (s) => s.pendingSavingsReward;
import { colors, radius, readableOn, spacing, typography, shadows, pinnedHeaderChrome } from '../constants/theme';
import { useTheme, useGradient } from '../hooks/useTheme';
import { useHeaderStatusBar } from '../hooks/useHeaderStatusBar';
import { STATIC_CONFIG } from '../config/staticConfig';
import { formatCurrency } from '../utils/format';
// import { SAMPLE_MESSAGES } from '../utils/messageParser'; // unused while simulate SMS is hidden
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import { syncNow, whenFirstSweepSettled } from '../hooks/useSmsSync';
import { TAB_BAR_HEIGHT, tabBarClearance } from '../context/TabBarVisibilityContext';

import LentBorrowedWidget from '../components/LentBorrowedWidget';
import { BudgetSummary } from '../components/BudgetSummary';
import WeeklyRecapModal from '../components/WeeklyRecapModal';
import DailyQueueStack from '../components/DailyQueueStack';
import CrystalPiggyVault from '../components/CrystalPiggyVault';
import BellIcon from '../components/BellIcon';
import NotificationsSheet from '../components/NotificationsSheet';
import AppBrandFooter from '../components/AppBrandFooter';
import EmptyState from '../components/EmptyState';
import {
  useNotificationStore,
  selectHasUnreadNotifications,
} from '../store/useNotificationStore';
import { REWARD_CONFIG, vaultTierForStreak, multiplierForStreak, labelForStreak } from '../config/rewardConfig';
import InfoSheet from '../components/InfoSheet';
import { selectAwareStreak } from '../store/useRewardStore';
import WelcomeStreakModal from '../components/WelcomeStreakModal';
import CheckInBanner from '../components/CheckInBanner';
import MonthlyRecapModal from '../components/MonthlyRecapModal';
import MonthlyRecapCard from '../components/MonthlyRecapCard';
import CCPaymentPromptModal from '../components/CCPaymentPromptModal';
import TransactionItem from '../components/TransactionItem';
import TxnDebugSheet from '../components/TxnDebugSheet';
import { IS_PREVIEW_BUILD } from '../constants/buildVariant';
import FAB from '../components/FAB';
import CategoryPickerModal from '../components/CategoryPickerModal';
import CCBillPaymentSheet from '../components/CCBillPaymentSheet';
import LinkContactModal from '../components/LinkContactModal';
import SplitConfigModal from '../components/SplitConfigModal';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { canSplitTransaction, countsForSpend, debitDisplayAmount } from '../utils/split';
import EpcClaimBottomSheet from '../components/EpcClaimBottomSheet';
import GroupPickerSheet from '../components/GroupPickerSheet';
import GroupExpenseSheet from '../components/GroupExpenseSheet';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import TxnDetailSheet from '../components/TxnDetailSheet';
import SectionHeader from '../components/SectionHeader';
import HeaderChip from '../components/HeaderChip';
import HomeCarousel from '../components/HomeCarousel';
import { buildHomeCards, PROMO_CARDS } from '../analytics/homeCards';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { detectSubscriptions } from '../analytics/behavioralSelectors';
// ── Period config ─────────────────────────────────────────────────────────────
// `a11y` spells out what the single letter means — "D" alone is read aloud as
// the letter D, which tells a screen-reader user nothing.
const PERIODS = [
  { key: 'D', label: 'D', title: 'today', a11y: 'Today' },
  { key: 'W', label: 'W', title: 'week',  a11y: 'This week' },
  { key: 'M', label: 'M', title: 'month', a11y: 'This month' },
  { key: 'Y', label: 'Y', title: 'year',  a11y: 'This year' },
];

/**
 * Both of these are build-time SWITCHES, so they live in `config/staticConfig.ts`
 * with the rest of them — the full rationale for each (what `true` restores, and
 * which fixes are deliberately NOT reverted with the look) is on the flag there.
 *
 * Aliased to short local names because they read at a dozen call sites below and
 * `STATIC_CONFIG.dashboard.useOriginalHeader` inline would bury the JSX. The alias is
 * the only copy: nothing else in this file re-derives them.
 *
 * `PERIOD_SLOP` stays here — it is per-variant tap geometry, not a switch.
 */
const USE_ORIGINAL_HEADER = STATIC_CONFIG.dashboard.useOriginalHeader;
const PERIOD_SELECTOR     = STATIC_CONFIG.dashboard.periodSelector;

/**
 * Pinned bar height: the header row's `marginTop` (12) + the 42pt HeaderChip,
 * which is the tallest thing in it. Deterministic — no text drives it — so this
 * one is safe as a constant, unlike the hero.
 */
const HEADER_BAR_H = 54;

/**
 * FIRST-FRAME estimate for the hero only; the real height is measured. Roughly:
 * balance block (16 + label 14 + 2 + 38px figure ≈ 50) + period row (2 + 12 + 32)
 * + stats row (12 + 10 + 14 + 3 + 20 + 10). Being a few points out is invisible
 * because the measurement corrects it on the next frame — do NOT promote this to
 * `heroHeight`.
 */
const HEADER_HERO_EST = 196;

/** Per-variant tap-target padding — see the note on the periodSelector flag. */
const PERIOD_SLOP = {
  // Cells touch: width carries the target sideways (minWidth 44), slop vertically.
  segmented: { top: 6, bottom: 6, left: 0, right: 0 },
  // 38pt circle + 3 each side = 44. 3 is exactly half the 6pt gap, so neighbours
  // meet without overlapping.
  original:  { top: 3, bottom: 3, left: 3, right: 3 },
  // 32pt box + 6 each side = 44, and 6 is exactly half the 12pt gap so
  // neighbouring targets meet without overlapping. `periodTabRow` carries 6pt of
  // horizontal padding so the FIRST and LAST items' outer slop lands inside the
  // row — outside it, that slop would be undeliverable and those two items would
  // quietly have smaller targets than the middle two.
  underline: { top: 6, bottom: 6, left: 6, right: 6 },
};

/** Time-of-day greeting. Module-level + pure so it can be recomputed on focus. */
const greetingForHour = (h) => {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// ── Main screen ───────────────────────────────────────────────────────────────
const DashboardScreen = ({ navigation }) => {
  const theme           = useTheme();
  const gradient = useGradient();
  const toast           = useToast();
  const hydrated        = useStoreHydrated();
  // The reward store persists separately and hydrates FIRST — see the check-in effect.
  const rewardsHydrated = useStoreHydrated(useRewardStore);
  const transactions    = useEPurseStore((s) => s.transactions);
  const categories      = useEPurseStore((s) => s.categories);
  const monthlyAggs     = useEPurseStore((s) => s.monthlyAggregates);
  const lent            = useEPurseStore((s) => s.getTotalLent());
  const borrowed        = useEPurseStore((s) => s.getTotalBorrowed());
  const userName        = useEPurseStore((s) => s.userName);
  const lastSmsDate     = useEPurseStore((s) => s.lastSmsDate);
  const updateTransactionCategory = useEPurseStore((s) => s.updateTransactionCategory);
  const updateTwoTierCategory = useEPurseStore((s) => s.updateTwoTierCategory);
  const updateTransactionCategoryWithContact = useEPurseStore((s) => s.updateTransactionCategoryWithContact);
  const relinkLentBorrowedEntry = useEPurseStore((s) => s.relinkLentBorrowedEntry);
  const lentBorrowedAll = useEPurseStore((s) => s.lentBorrowed);
  const setTransactionHidden = useEPurseStore((s) => s.setTransactionHidden);
  const setTransactionRefund = useEPurseStore((s) => s.setTransactionRefund);
  const deleteTransaction = useEPurseStore((s) => s.deleteTransaction);
  const ignoreTransaction = useEPurseStore((s) => s.ignoreTransaction);
  const level              = useRewardStore(selectLevel);
  const awareStreak        = useRewardStore(selectAwareStreak);
  const checkIn            = useRewardStore((s) => s.checkIn);
  const claimSavingsBonus  = useRewardStore((s) => s.claimSavingsBonus);
  const pendingSavingsReward = useRewardStore(selectPendingSavings);
  const vaultTier        = vaultTierForStreak(awareStreak);
  const unignoreTransaction = useEPurseStore((s) => s.unignoreTransaction);
  const budget              = useEPurseStore((s) => s.budget);
  const setTransactionSplit = useEPurseStore((s) => s.setTransactionSplit);
  const groups                  = useEPurseStore((s) => s.groups);
  const tagTransactionToGroup   = useEPurseStore((s) => s.tagTransactionToGroup);
  const updateGroupExpense      = useEPurseStore((s) => s.updateGroupExpense);
  const untagTransactionFromGroup = useEPurseStore((s) => s.untagTransactionFromGroup);
  const addGroupExpense = useEPurseStore((s) => s.addGroupExpense);
  const showMonthlyRecap     = useEPurseStore((s) => s.showMonthlyRecap);
  const latestRecapMonth     = useEPurseStore(selectLatestRecapMonth);
  const recapCardDismissed   = useEPurseStore((s) => s.monthlyRecapCardDismissed);
  const dismissMonthlyRecapCard = useEPurseStore((s) => s.dismissMonthlyRecapCard);

  // Ink for the ACTIVE segment, which sits on a solid white cell. Measured, not
  // picked: the old active pill used `theme.primary` directly, which is 3.12:1 on
  // Sunset and **1.41:1 on Gold** against white — it failed on four of the five
  // accents. `readableOn` darkens only as far as it must (worst case now 4.66:1)
  // and leaves Platinum's near-black untouched.
  // 'segmented' and 'original' both put the active label on a SOLID WHITE
  // surface, so the ink has to be derived: `theme.primary` raw is 3.12:1 on
  // Sunset and 1.41:1 on Gold against white — it failed on four of the five
  // accents in the old pills. 'underline' has no filled surface; its label sits
  // on the gradient and stays white.
  const periodActiveInk = useMemo(
    () => (PERIOD_SELECTOR === 'underline' ? '#FFFFFF' : readableOn('#FFFFFF', theme.primary)),
    [theme.primary],
  );

  // `scrollEventThrottle` isn't taken: CollapsingHeaderScreen owns the ScrollView
  // and pins it to 16 (the native driver needs every frame).
  const { onScroll } = useTabBarScroll();
  const insets = useSafeAreaInsets();

  const [period, setPeriod]     = useState('M');
  // The header's gradient bar cross-fades into a LIGHT pinned bar, which also
  // covers the status-bar inset — so the glyphs have to flip with it.
  const [headerPinned, setHeaderPinned] = useState(false);
  useHeaderStatusBar(headerPinned);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [lbLinkTxn, setLbLinkTxn] = useState(null);   // { txn, categoryId }
  const [ccBillTxn, setCcBillTxn] = useState(null);   // txn being reclassified as a CC bill payment
  const [splitTxn, setSplitTxn] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, primaryText, destructive, onConfirm }
  const [debugTxn, setDebugTxn] = useState(null);
  const [groupPickerTxn, setGroupPickerTxn] = useState(null);
  const [groupExpenseTxn, setGroupExpenseTxn] = useState(null); // { txn, group } — tag NEW into group
  const [editGroupTxn,    setEditGroupTxn]    = useState(null); // { txn, group } — set/edit split
  const [groupDetailTxn,  setGroupDetailTxn]  = useState(null); // { txn, group } — tap a shared-group row → view detail
  const [detailTxn,       setDetailTxn]       = useState(null); // plain txn — tap a row → view detail before edit
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  // Dev-only: long-press vault to cycle tiers for visual preview.
  // null means "use real tier from streak".
  const [devVaultTier, setDevVaultTier] = useState(null);
  const devVaultTimer = React.useRef(null);
  // The 8s reset timer outlived the screen otherwise, firing setState on an
  // unmounted component.
  useEffect(() => () => clearTimeout(devVaultTimer.current), []);

  // Aware Run explainer — what the vault chip in the header opens.
  const [vaultInfoVisible, setVaultInfoVisible] = useState(false);

  // Notifications
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const hasUnreadNotifications = useNotificationStore(selectHasUnreadNotifications);

  // ── Period-aware expense stats (centralized selector) ────────────────────
  // Returns { debits, credits, net, count, recent }.
  // Excludes ignored, private (isHidden), and Lent/Borrowed categories.
  const periodStats = useMemo(
    () => selectExpenseStats(period)({ transactions, monthlyAggregates: monthlyAggs, groups }),
    [period, transactions, monthlyAggs, groups]
  );

  // ── Carousel cards ───────────────────────────────────────────────────────
  // The strip carries live facts ranked by urgency, with the feature banners as
  // its empty state (see analytics/homeCards.js). This screen's only job is to
  // gather the numbers; homeCards.js decides which of them earn a card.
  //
  // Everything here goes through an existing store getter rather than summing
  // transactions locally. Those getters carry the full four-part spend predicate
  // (ignored / NON_SPEND / refund netting / spendExcluded) and the raw-first,
  // aggregate-as-fallback rule — a hand-rolled loop here would drift from the
  // rest of the app, which is exactly the bug this codebase keeps re-finding.
  // These two are computed in a useMemo rather than inside the zustand selector.
  // A selector runs on EVERY store write and its result is compared by identity —
  // and both getters build a fresh object each call, so they never compared equal
  // and this screen re-rendered (and rebuilt every Home card) on every single
  // store update. That is worst exactly at launch, when the SMS sweep writes
  // repeatedly, which is the moment the carousel was visibly struggling.
  // `budget` is already subscribed above (line ~214) — don't re-declare it.
  // Subscribed for RE-RENDER, not because it's read directly: `spendExcluded`
  // consults a module-level mirror, so without this dep a spend-rule change
  // wouldn't invalidate the memos below (same pattern as AnalyticsScreen).
  const excludedExpenseParents = useEPurseStore((s) => s.excludedExpenseParents);
  const getBudgetUsage = useEPurseStore((s) => s.getBudgetUsage);
  const getCategoryBreakdown = useEPurseStore((s) => s.getCategoryBreakdown);
  const budgetUsage = useMemo(
    () => (budget ? getBudgetUsage() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [budget, transactions, groups, excludedExpenseParents, getBudgetUsage],
  );
  const topCategory = useMemo(
    () => getCategoryBreakdown()[0] || null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, groups, excludedExpenseParents, getCategoryBreakdown],
  );
  const weekSummary = useEPurseStore(selectWeeklySummary);
  const ccBills     = useEPurseStore((s) => s.ccBills);

  // detectSubscriptions has no access to `groups`, so the exclusion has to be
  // applied to its INPUT — the same pre-filter maybeFireSubscriptionAlerts uses
  // (groups skill §3: any helper taking raw transactions does NOT self-exclude).
  const subscriptions = useMemo(
    () => detectSubscriptions(transactions.filter((t) => !spendExcluded(t, groups))),
    [transactions, groups],
  );

  // Spend sitting in the catch-all category: real money that can't appear in any
  // breakdown until it's labelled. Counted with the same predicate as the
  // category breakdown so the two agree about what "this month's spend" means.
  const uncategorised = useMemo(() => {
    const now = new Date();
    let amount = 0;
    let count = 0;
    transactions.forEach((t) => {
      if (t.categoryId !== 'other') return;
      if (t.isIgnored || !countsForSpend(t) || spendExcluded(t, groups)) return;
      const d = new Date(t.createdAt);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) return;
      amount += debitDisplayAmount(t);
      count += 1;
    });
    return { amount, count };
  }, [transactions, groups]);

  const homeCards = useMemo(
    () => buildHomeCards(
      {
        budget: budgetUsage,
        topCategory,
        subscriptions,
        uncategorised,
        week: weekSummary,
        ccBills,
        // Read once per rebuild rather than inside the builder, so the card set is
        // a pure function of its inputs and the due-date window is testable.
        now: Date.now(),
      },
      PROMO_CARDS,
    ),
    [budgetUsage, topCategory, subscriptions, uncategorised, weekSummary, ccBills],
  );

  // The single LB entry this LB-tagged (locked) transaction created — powers the
  // "Edit person" affordance in the manage-transaction sheet's locked notice.
  const linkedLbEntry = useMemo(
    () => (activeTxn ? (lentBorrowedAll || []).find((l) => l.sourceTxnId === activeTxn.id) : null),
    [activeTxn, lentBorrowedAll],
  );

  // ── Sync date-range label ────────────────────────────────────────────────
  // Shows "1 Apr – 9 May" — the span of messages we have synced.
  // Start: oldest transaction date (or oldest aggregate month if no raw txns).
  // End:   lastSmsDate cursor (the most recent SMS we processed).
  const dataInfo = useMemo(() => {
    if (!lastSmsDate) return 'Not synced yet';

    const fmt = (ms) =>
      new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

    // Find the earliest date we have data for
    let startMs = null;

    // Check raw transactions first
    const counted = transactions.filter((t) => !t.isIgnored);
    if (counted.length > 0) {
      const oldest = [...counted].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      )[0];
      startMs = new Date(oldest.createdAt).getTime();
    }

    // Fall back to oldest aggregate month key (format: 'YYYY-MM')
    if (!startMs) {
      const aggKeys = Object.keys(monthlyAggs).sort();
      if (aggKeys.length > 0) {
        const [yr, mo] = aggKeys[0].split('-').map(Number);
        startMs = new Date(yr, mo - 1, 1).getTime();
      }
    }

    if (!startMs) return fmt(lastSmsDate);
    return `${fmt(startMs)} – ${fmt(lastSmsDate)}`;
  }, [lastSmsDate, transactions, monthlyAggs]);

  // ── Simulate SMS (hidden for now — permission is requested on first launch)
  // const onSimulateSMS = useCallback(() => {
  //   const msg    = SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)];
  //   const parsed = ingestMessage(msg, { receivedAt: new Date().toISOString() });
  //   if (parsed) {
  //     Alert.alert('SMS auto-detected', `${parsed.merchant}\n${formatCurrency(parsed.amount)} · ${parsed.type.toUpperCase()}`);
  //   }
  // }, [ingestMessage]);

  // ── Pull to refresh — a REAL inbox sweep ─────────────────────────────────
  // This used to be `setTimeout(600)`: the spinner turned, nothing synced. On a
  // money app the refresh pull is the "is this up to date?" gesture, so it now
  // runs the same sweep the mount/foreground path runs (`syncNow`, which owns
  // the shared lock) and reports what actually happened. Every branch says
  // something — a silent spinner is what made the old one feel broken.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { status, added } = await syncNow();
      if (status === 'ok') {
        if (added > 0) toast.success(`${added} new transaction${added === 1 ? '' : 's'}`);
        else toast.info('Up to date', 'No new messages since the last sync.');
      } else if (status === 'no-permission') {
        toast.warning('SMS access is off', 'Turn it on in Settings to auto-capture transactions.');
      } else if (status === 'unsupported') {
        // iOS / Expo Go — there's no inbox to read, so don't imply a failure.
        toast.info('Manual entry only', 'Automatic SMS capture needs Android.');
      } else if (status === 'error') {
        toast.error("Couldn't sync", 'Please try again in a moment.');
      }
      // 'busy' — a sweep was already mid-flight; it will finish on its own and
      // its results land in the list. Saying anything here would be noise.
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  // ── Aware Run check-in (hands-free) ──────────────────────────────────────
  // Runs once on mount AND on every screen focus (foregrounding the app
  // after the day rolls over still counts). checkIn() is idempotent within
  // a calendar day, so re-firing on focus is safe.
  //
  // We pass YESTERDAY's SMS transaction count (not today's queue) so the
  // store can correctly evaluate Zero-Transaction Day eligibility. The
  // current queue is always empty at morning open — using it caused a false
  // SAVINGS bonus every single day.
  //
  // ⚠ It must NOT run until the app actually knows what happened yesterday. Both
  // preconditions below caused a real bug — a Zero-Transaction bonus awarded to a
  // user who HAD spent the day before:
  //
  //   1. BOTH stores must be rehydrated. They persist separately and race: the
  //      reward store is a handful of counters and lands first, while the finance
  //      store carries every transaction and lands later. In that window
  //      `lastCheckedInDate` is already yesterday (so this is not treated as a
  //      first check-in) while `transactions` is still empty — so yesterday's
  //      count reads 0 and the bonus fires.
  //   2. The first SMS sweep must have settled. Yesterday's bank messages only
  //      enter the store when the sweep imports them, and someone who did not open
  //      the app yesterday has none of them at mount — which is exactly the person
  //      this question is asked about.
  //
  // And it is not self-correcting: `checkIn` is idempotent per calendar day
  // (gap === 0 → SAME_DAY no-op), so the first answer of the day is the final one.
  useEffect(() => {
    if (!hydrated || !rewardsHydrated) return undefined;
    let cancelled = false;

    // Pass yesterday's count (Zero-Transaction Day / SAVINGS eligibility) AND the
    // missed-days count so a skipped app-open on a no-transaction day doesn't break
    // the Aware Run (selectGapTransactionCount → forgivenGap in the reward store).
    const runCheckIn = async () => {
      await whenFirstSweepSettled();
      if (cancelled) return;
      // Read AFTER the await, never before: the sweep is the whole point.
      const st = useEPurseStore.getState();
      const yesterdayCount = selectYesterdayTransactionCount(st);
      const gapCount = selectGapTransactionCount(st, useRewardStore.getState().lastCheckedInDate);
      checkIn(yesterdayCount, gapCount);
    };
    const sub = navigation.addListener('focus', runCheckIn);
    // Fire once on initial mount as well (focus listener doesn't fire on the
    // first render because the screen is already focused).
    runCheckIn();
    return () => { cancelled = true; sub(); };
  }, [navigation, checkIn, hydrated, rewardsHydrated]);


  // Recomputed on every focus, not memoized once at mount: this screen is the
  // app's landing tab and often stays mounted for hours, so a mount-time value
  // greeted people with "Good morning" at 9pm.
  const [greeting, setGreeting] = useState(() => greetingForHour(new Date().getHours()));
  useEffect(() => {
    const refresh = () => setGreeting(greetingForHour(new Date().getHours()));
    const sub = navigation.addListener('focus', refresh);
    refresh();
    return sub;
  }, [navigation]);

  const periodTitle = PERIODS.find((p) => p.key === period)?.title ?? 'period';

  // Exact label for the transactions section header
  const txnSectionLabel = period === 'M'
    ? new Date().toLocaleDateString('en-IN', { month: 'long' })
    : period === 'D'
    ? 'Today'
    : `this ${periodTitle}`;

  /**
   * The header's identity row — rendered TWICE: on the gradient, and on the
   * light bar that pins to the top. `onLight` is the only thing that varies.
   *
   * One function, not two JSX branches. The pinned bar must not simply DROP the
   * avatar, vault or bell: while it is up, the gradient bar behind it is inert,
   * so anything missing here has no route at all (ui-consistency §2). And a
   * second copy of a row this size goes stale the first time one control gains a
   * prop — the same argument the USE_ORIGINAL_HEADER note below already makes.
   *
   * The chips derive their own light-surface fill/border/badge from `onLight`
   * (see HeaderChip); only the two text inks are passed, because those are
   * plain styles with nothing to derive.
   */
  const pinned = useMemo(() => pinnedHeaderChrome(theme.card, theme), [theme]);

  const identityRow = (onLight) => {
    const ink      = onLight ? pinned.ink      : '#fff';
    const inkMuted = onLight ? pinned.inkMuted : '#FFFFFFCC';
    /* ── Top row: identity and actions, side configurable ───────────────
       The avatar moved from the right cluster to the left (Aug-26). The
       constraint that decides HOW is an alignment spine: the greeting, the
       hero eyebrow, the 38px figure, the period toggle and the stat block
       all start at the same x. Putting the avatar *before* the greeting text
       would indent only the greeting and break that line — so the avatar
       itself sits on the spine and the greeting rides beside it.

       What it buys: the bar splits semantically (who you are | what needs
       you), and the right cluster drops from three controls to two.

       `USE_ORIGINAL_HEADER` flips it back. Each element is defined ONCE below and
       only its POSITION varies, so the two arrangements can't drift — a
       second JSX branch would be a copy that goes stale the first time one
       of these gains a prop. The only thing that changes with the flag is
       the greeting's margins, which differ because in right-mode it has no
       avatar on its left. */
    const avatarChip = (
      <HeaderChip
        onLight={onLight}
        onPress={() => navigation.navigate('RewardShop')}
        // Was a bare TouchableOpacity with no role and no label, so a screen
        // reader announced the header's main nav target as the letter "P".
        accessibilityLabel={
          userName ? `${userName}'s profile · level ${level}` : `Profile · level ${level}`
        }
        accessibilityHint="Opens rewards and settings"
        badge={level}
      >
        <Text style={[styles.avatarInitial, { color: ink }]}>
          {userName ? userName.charAt(0).toUpperCase() : '👤'}
        </Text>
      </HeaderChip>
    );

    const greeting_ = (
      <View style={[
        styles.headerGreetWrap,
        USE_ORIGINAL_HEADER ? styles.headerGreetLeading : styles.headerGreetBesideAvatar,
      ]}>
        <Text style={[styles.greeting, { color: inkMuted }]} numberOfLines={1}>{greeting}</Text>
        <Text style={[styles.userName, { color: ink }]} numberOfLines={1} ellipsizeMode="tail">
          {userName ? `Hi, ${userName}` : 'ePurse'}
        </Text>
      </View>
    );

    // Behaviour defined ONCE; only the chrome differs between the two
    // header modes. The a11y label, the hint and the dev-only tier cycler
    // are identical either way, so they can't fall out of sync.
    const vaultBehaviour = {
      onPress: () => setVaultInfoVisible(true),
      accessibilityLabel: awareStreak > 0
        ? `Crystal Piggy Vault · ${awareStreak} day Aware Run · ${vaultTier} tier`
        : `Crystal Piggy Vault · ${vaultTier} tier`,
      accessibilityHint: 'Explains how the Aware Run streak works',
      // Dev-only tier preview, gated like TxnDebugSheet. UnGated, a user
      // long-pressing got an unexplainable 8-second visual change.
      onLongPress: IS_PREVIEW_BUILD ? () => {
        const ORDER = ['base', 'streak', 'premium'];
        const current = devVaultTier ?? vaultTier;
        const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
        setDevVaultTier(next);
        clearTimeout(devVaultTimer.current);
        devVaultTimer.current = setTimeout(() => setDevVaultTier(null), 8000);
      } : undefined,
    };

    const vaultChip = USE_ORIGINAL_HEADER ? (
      /* AS IT WAS: a rounded-rect chip sized around a 40pt asset that draws
         its own "Xd Aware" label internally. That label is why this control
         was taller than the circular bell and avatar beside it — restoring
         the look restores that too, which is the point of the flag.
         `hitSlop` is NOT part of the old look: it's the 44pt tap-target fix,
         and the original had none. */
      <TouchableOpacity
        style={[
          styles.vaultBtnOriginal,
          onLight && { backgroundColor: pinned.fill(0x14 / 255), borderColor: pinned.fill(0x22 / 255) },
        ]}
        activeOpacity={0.85}
        accessibilityRole="button"
        hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
        {...vaultBehaviour}
      >
        <CrystalPiggyVault
          tier={devVaultTier ?? vaultTier}
          size={40}
          day={awareStreak > 0 ? awareStreak : undefined}
        />
      </TouchableOpacity>
    ) : (
      <HeaderChip
        {...vaultBehaviour}
        onLight={onLight}
        // The streak day is a proper corner badge here, legible at 9px
        // instead of the 8px two-line pill drawn inside the asset.
        badge={awareStreak > 0 ? awareStreak : undefined}
      >
        {/* 32, not 40: it has to sit inside the shared 42pt chip with its
            border, and the day count moved out to the badge so the asset no
            longer carries text of its own. */}
        <CrystalPiggyVault tier={devVaultTier ?? vaultTier} size={32} />
      </HeaderChip>
    );

    const bell = (
      <BellIcon
        hasUnread={hasUnreadNotifications}
        onPress={() => setNotificationsVisible(true)}
        onLight={onLight}
      />
    );

    return (
      <View style={styles.headerRow}>
        {!USE_ORIGINAL_HEADER && avatarChip}
        {greeting_}
        <View style={styles.headerRight}>
          {vaultChip}
          {bell}
          {/* Right-mode returns the avatar to the END of the action cluster,
              exactly where it used to live. */}
          {USE_ORIGINAL_HEADER && avatarChip}
        </View>
      </View>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* The status bar is driven by useHeaderStatusBar (imperative + focus-gated).
          The header now pins as a LIGHT bar, so 'light-content' is no longer
          always right — and a declarative StatusBar stays mounted in the tab
          navigator and would leak the wrong style onto the next tab. */}

      {/* Floating check-in banner — auto-shows on new-day launches. */}
      <CheckInBanner />

      {/* ───── Gradient header ───── */}
      <CollapsingHeaderScreen
        gradientColors={gradient}
        onCollapseChange={setHeaderPinned}
        /* The pinned bar is that same row, inked for a light surface. */
        renderCollapsedBar={() => identityRow(true)}
        renderBar={() => identityRow(false)}
        renderHero={() => (
          <>
          {/* Spend (expenses − refunds) for the selected period. The label is an
              uppercase micro-eyebrow so the figure below is unmistakably the
              subject — see the type-tier note in the styles. */}
          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>
              {`Spent ${period === 'D' ? 'today' : `this ${periodTitle}`}`.toUpperCase()}
            </Text>
            <Text style={styles.balanceValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {formatCurrency(periodStats.spent)}
            </Text>
          </View>

          {/* ── D / W / M / Y ─────────────────────────────────────────────
              Three looks behind `PERIOD_SELECTOR`; see its note for why the tap
              geometry differs per variant. Only the CHROME switches below — the
              handler and the whole a11y contract are written once. */}
          <View style={styles.periodRow}>
            <View
              style={[
                PERIOD_SELECTOR === 'segmented' && styles.periodTrack,
                PERIOD_SELECTOR === 'original'  && styles.periodCircleRow,
                PERIOD_SELECTOR === 'underline' && styles.periodTabRow,
              ]}
              accessibilityRole="tablist"
            >
              {PERIODS.map((p) => {
                const active = period === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[
                      PERIOD_SELECTOR === 'segmented' && [styles.periodCell,   active && styles.periodCellActive],
                      PERIOD_SELECTOR === 'original'  && [styles.periodCircle, active && styles.periodCircleActive],
                      PERIOD_SELECTOR === 'underline' && styles.periodTab,
                    ]}
                    onPress={() => setPeriod(p.key)}
                    activeOpacity={0.75}
                    accessibilityRole="tab"
                    accessibilityLabel={p.a11y}
                    // Without this a screen reader reads four identical-sounding
                    // tabs with no indication of which period is showing.
                    accessibilityState={{ selected: active }}
                    hitSlop={PERIOD_SLOP[PERIOD_SELECTOR]}
                  >
                    {/* The underline variant draws its rule on an INNER element
                        sized to the letter, not on the 44pt touch area — otherwise
                        the rule is 44pt long under a single character, which is
                        what made this variant look stretched. Touch size and
                        visual size are separate concerns. */}
                    {PERIOD_SELECTOR === 'underline' ? (
                      <View style={[styles.periodRule, active && styles.periodRuleActive]}>
                        <Text style={[styles.periodLabel, styles.periodLabelUnderline, active && { color: periodActiveInk }]}>
                          {p.label}
                        </Text>
                      </View>
                    ) : (
                      <Text style={[styles.periodLabel, active && { color: periodActiveInk }]}>
                        {p.label}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            {/* "Synced" prefix so this reads as a STATEMENT about data coverage
                rather than a stray date range sitting next to the toggle. */}
            <Text style={styles.dataInfo} numberOfLines={1}>
              {dataInfo === 'Not synced yet' ? dataInfo : `Synced ${dataInfo}`}
            </Text>
          </View>

          {/* ── Income / refunds — ONE surface, split by a divider ──
              Two separate pills read as two objects competing with the hero
              figure; a single segmented block is one object with two facts in it.
              The labels dropped their period suffix too: the hero already says
              "this month" right above, so "Income this month" / "Refunds this
              month" printed the same phrase three times in one glance. */}
          <View style={styles.statsRow}>
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>INCOME</Text>
              <Text style={styles.statValue} numberOfLines={1}>{formatCurrency(periodStats.received)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>REFUNDS</Text>
              <Text style={styles.statValue} numberOfLines={1}>{formatCurrency(periodStats.refunds)}</Text>
            </View>
          </View>
          </>
        )}
        // ── Collapsing mode ──────────────────────────────────────────────────
        // The component owns the ScrollView here, so the body lives as children
        // rather than as a sibling <ScrollView>. The component ADDS
        // `contentContainerStyle`'s paddingTop to the expanded header height, so
        // the value in `bodyContent` is the gap BELOW the header.
        //
        // `heroHeight` is deliberately NOT passed: this hero is three stacked
        // TEXT blocks, so its height moves with the font and the user's OS
        // font-scale setting. A pinned number would clip it on one device and
        // leave it floating on another. The estimate below is only for the very
        // first frame, before the measurement lands.
        barHeight={HEADER_BAR_H}
        estimatedHeroHeight={HEADER_HERO_EST}
        contentContainerStyle={styles.bodyContent}
        onScroll={onScroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* "What matters right now" — live cards ranked by urgency, with the
            feature banners as the empty state for someone with no data yet.
            Drawn rather than shipped as images so they follow both the accent
            theme and the numbers (see the note in HomeCarousel). */}
        <HomeCarousel
          cards={homeCards}
          // An empty store is not a user with no data. Until AsyncStorage returns,
          // every live card builder sees nothing and the promo banners fill in —
          // so without this a mid-month user watched five feature ads flash past
          // before their real cards arrived. See useStoreHydrated.
          loading={!hydrated}
          // Break out of `bodyContent`'s gutter so the strip is full-screen. The
          // card was inset twice — 16pt gutter + 28pt peek = 44pt from the edge,
          // against 16pt for every other card on the page.
          bleed={spacing.lg}
          onNavigate={(route, params) => navigation.navigate(route, params)}
        />

        {/* ═══ "YOUR MONEY" group ═══
            Grouped so the page has TWO levels of spacing instead of one uniform
            gap everywhere — these three belong together (what you owe, what the
            month did, what's left), so they sit closer to each other than to the
            groups above and below. Both members that can vanish (the recap card)
            sit beside two that always render, so this wrapper is never empty —
            an empty wrapper would still take a slot in the parent `gap` and open
            a double gap around nothing. */}
        <View style={styles.group}>
          {/* Lent / Borrowed */}
          <LentBorrowedWidget
            lent={lent}
            borrowed={borrowed}
            onPressLent={() => navigation.navigate('LentBorrowed', { kind: 'lent' })}
            onPressBorrowed={() => navigation.navigate('LentBorrowed', { kind: 'borrowed' })}
          />

          {/* Monthly recap — persistent month-end card, dismissible per month.
              Sits BELOW Lent/Borrowed: it's a look-back at a month that has
              already closed, so it shouldn't outrank the live balances at the top
              of the screen. Spacing comes from the group's `gap`, so moving it
              needs no margin changes (ui-consistency §6). */}
          {showMonthlyRecap && latestRecapMonth && recapCardDismissed !== latestRecapMonth && (
            <MonthlyRecapCard
              monthKey={latestRecapMonth}
              onDismiss={() => dismissMonthlyRecapCard(latestRecapMonth)}
            />
          )}

          {/* Monthly budget — empty CTA or active progress */}
          <BudgetSummary onPress={() => navigation.navigate('Insights', { defaultTab: 'budget', openPlan: !budget })} />
        </View>

        {/* Weekly spend recap is no longer an inline card — it appears once, after
            a week ends, as a centered modal (WeeklyRecapModal below). */}

        {/* ═══ "ACTIVITY" group ═══
            The day's review and the period's transactions are the same subject.
            `DailyQueueStack` self-hides when empty, but the transaction section
            always renders, so this wrapper always has content. */}
        <View style={styles.group}>
          {/* Daily review queue — appears only when unreviewed SMS transactions exist */}
          <DailyQueueStack />

          {/* Period transactions — wrapped as ONE section so the row list keeps its
              own tight spacing while the group `gap` spaces the sections evenly. */}
          <View style={styles.txnSection}>
            <SectionHeader
              icon="receipt-outline"
              accentColor={theme.primary}
              style={styles.recentHeader}
              // A node title, not a string: the count keeps its own muted style
              // rather than inheriting the h3 weight.
              title={<>
                Transactions · {txnSectionLabel}
                <Text style={styles.txnCount}> ({periodStats.count})</Text>
              </>}
              a11yTitle={`Transactions, ${txnSectionLabel}`}
              // Nothing to view when the period is empty (e.g. a freshly onboarded user).
              right={periodStats.recent.length > 0 ? (
                <TouchableOpacity onPress={() => navigation.navigate('Transactions', { initialPeriod: period })}>
                  <Text style={[styles.viewAll, { color: theme.primary }]}>View all</Text>
                </TouchableOpacity>
              ) : null}
            />

            {periodStats.recent.length === 0 ? (
              <EmptyState
                compact
                icon="receipt-outline"
                title={`Nothing this ${periodTitle}`}
                subtitle="Add a manual entry or switch to a wider period."
                // Holds roughly the height of a few transaction rows, so an empty
                // period doesn't collapse the page and pull the brand footer up
                // into view right under the section heading.
                style={styles.recentEmpty}
              />
            ) : (
              periodStats.recent.map((t) => (
                <TransactionItem
                  key={t.id}
                  txn={t}
                  onPress={() => {
                    // Tapping the card opens the most relevant DETAIL view for
                    // what this transaction actually is — always view-first, then
                    // edit. A shared-group expense still gets its own detail sheet
                    // (who paid, per-member shares — a different ledger entirely,
                    // see the groups skill). A direct split now goes through the
                    // SAME TxnDetailSheet as a plain transaction: it renders a
                    // split breakdown section when txn.isSplit, and its Edit opens
                    // the full form (amount/merchant/category/…) with the shares
                    // editable inline there — split used to be its own island via
                    // SplitDetailsModal → SplitConfigModal, reachable only from
                    // this tap, with no way to touch anything else about the txn.
                    // The category-icon tap still skips straight to the manage
                    // sheet as a fast path.
                    const group = t.groupId ? groups.find((g) => g.id === t.groupId) : null;
                    if (group && group.type === 'shared') { setGroupDetailTxn({ txn: t, group }); return; }
                    setDetailTxn(t);
                  }}
                  onPressCategory={() => setActiveTxn(t)}
                  onPressSplitChip={() => setDetailTxn(t)}
                  onLongPress={IS_PREVIEW_BUILD ? () => setDebugTxn(t) : undefined}
                />
              ))
            )}
          </View>
        </View>

        {/* The footer's own padding IS this screen's tab-bar clearance — the band
            must reach the screen's bottom edge, so the space can't sit after it. */}
        <AppBrandFooter bottomClearance={tabBarClearance(insets.bottom)} />
      </CollapsingHeaderScreen>

      <FAB onPress={() => navigation.navigate('AddTransaction')} bottomInset={TAB_BAR_HEIGHT + insets.bottom} />

      <CategoryPickerModal
        visible={!!activeTxn}
        categories={categories}
        categoryLocked={!!activeTxn?.lbLocked}
        linkedPerson={linkedLbEntry?.person || null}
        onEditPerson={linkedLbEntry ? () => {
          const t = activeTxn;
          setActiveTxn(null);
          setLbLinkTxn({ txn: t, categoryId: t.categoryId, suggestedPersons: [], mode: 'edit' });
        } : undefined}
        selectedCategoryId={activeTxn?.categoryId}
        selectedParent={activeTxn?.parentCategory}
        selectedChild={activeTxn?.childCategory}
        isHidden={!!activeTxn?.isHidden}
        isIgnored={!!activeTxn?.isIgnored}
        canRefund={activeTxn?.type === 'credit'}
        isRefund={!!activeTxn?.isRefund}
        onToggleRefund={(v) => {
          if (!activeTxn) return;
          setTransactionRefund(activeTxn.id, v);
          setActiveTxn(null);
        }}
        canSplit={!!activeTxn && canSplitTransaction(activeTxn)}
        isSplitTxn={!!activeTxn?.isSplit}
        currentGroupId={activeTxn?.groupId || null}
        onPressAddToGroup={activeTxn?.lbLocked ? undefined : () => {
          const t = activeTxn;
          setActiveTxn(null);
          setGroupPickerTxn(t);
        }}
        onPressRemoveFromGroup={() => {
          if (!activeTxn) return;
          untagTransactionFromGroup(activeTxn.id);
          toast.success('Removed from group');
          setActiveTxn(null);
        }}
        onPressEditGroup={(() => {
          const g = activeTxn?.groupId ? groups.find((grp) => grp.id === activeTxn.groupId) : null;
          if (!g || g.type !== 'shared' || (g.members?.length ?? 0) <= 1) return undefined;
          return () => {
            const fresh = useEPurseStore.getState().transactions.find((t) => t.id === activeTxn.id) || activeTxn;
            setActiveTxn(null);
            setEditGroupTxn({ txn: fresh, group: g });
          };
        })()}
        groupHasSplit={!!activeTxn?.groupSplit}
        onPressSplit={() => {
          const t = activeTxn;
          setActiveTxn(null);
          setSplitTxn(t);
        }}
        onClose={() => setActiveTxn(null)}
        onSelectTwoTier={(parentCategory, childCategory) => {
          if (!activeTxn) return;
          updateTwoTierCategory(activeTxn.id, parentCategory, childCategory);
          setActiveTxn(null);
        }}
        onSelectCategory={(categoryId) => {
          if (!activeTxn) return;
          // "Credit Card Bill" opens the card-picker + reconcile sheet.
          if (categoryId === 'cc_bill') {
            const t = activeTxn;
            setActiveTxn(null);
            setCcBillTxn(t);
            return;
          }
          updateTransactionCategory(activeTxn.id, categoryId);
          setActiveTxn(null);
        }}
        onSelectLentBorrow={(categoryId) => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setLbLinkTxn({ txn: t, categoryId });
        }}
        onToggleHidden={(hidden) => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: hidden ? 'Mark as Private?' : 'Make Public?',
            message: hidden
              ? 'This transaction will be private — hidden from default views but still counted in totals.'
              : 'This transaction will be visible again in all default views.',
            primaryText: hidden ? 'Mark Private' : 'Make Public',
            destructive: hidden,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              setTransactionHidden(t.id, hidden);
              setConfirm(null);
            },
          });
        }}
        onDelete={() => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: 'Delete transaction?',
            message: 'This action cannot be undone.',
            primaryText: 'Delete',
            destructive: true,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              deleteTransaction(t.id);
              setConfirm(null);
            },
          });
        }}
        onIgnore={() => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: 'Ignore transaction?',
            message:
              'This removes it from your balances and every total and chart. It will be treated as if it never happened.',
            primaryText: 'Ignore',
            destructive: true,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              ignoreTransaction(t.id);
              setConfirm(null);
            },
          });
        }}
        onRestore={() => {
          if (!activeTxn) return;
          const t = activeTxn;
          setActiveTxn(null);
          setConfirm({
            title: 'Restore transaction?',
            message: 'This adds it back to balances, totals, and charts.',
            primaryText: 'Restore',
            destructive: false,
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => {
              unignoreTransaction(t.id);
              setConfirm(null);
            },
          });
        }}
      />

      <CCBillPaymentSheet
        txn={ccBillTxn}
        onClose={() => setCcBillTxn(null)}
      />

      <LinkContactModal
        visible={!!lbLinkTxn}
        categoryId={lbLinkTxn?.categoryId}
        suggestedPersons={lbLinkTxn?.suggestedPersons || []}
        onConfirm={(contactInfo) => {
          if (!lbLinkTxn) return;
          if (lbLinkTxn.mode === 'edit') {
            relinkLentBorrowedEntry(lbLinkTxn.txn.id, contactInfo);
          } else {
            updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, contactInfo);
          }
          setLbLinkTxn(null);
        }}
        onSkip={() => {
          if (!lbLinkTxn) return;
          // Editing an existing link: Skip just cancels — resetting to "Unlinked"
          // would be a destructive default for a correction flow.
          if (lbLinkTxn.mode !== 'edit') {
            updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, { person: 'Unlinked', phone: null, contactId: null });
          }
          setLbLinkTxn(null);
        }}
        onClose={() => setLbLinkTxn(null)}
      />

      <SplitConfigModal
        visible={!!splitTxn}
        transaction={splitTxn}
        onClose={() => setSplitTxn(null)}
        onApply={(others, meta) => {
          if (splitTxn) {
            setTransactionSplit(splitTxn.id, others, meta);
            toast.success(others.length ? 'Split saved' : 'Split removed');
          }
          setSplitTxn(null);
        }}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />

      {/* Monthly recap — one-time month-end moment (replaces the old celebration
          modal; folds in the budget streak/saved wrap-up). Then persists as a
          dashboard card below. */}
      <MonthlyRecapModal />

      {/* Weekly recap — one-time centered modal after a week ends */}
      <WeeklyRecapModal />

      {/* Day-1 Aware Run welcome — auto-dismisses after 4.5s */}
      <WelcomeStreakModal />

      {/* CC outstanding true-up prompt */}
      <CCPaymentPromptModal />

      {IS_PREVIEW_BUILD && (
        <TxnDebugSheet txn={debugTxn} onClose={() => setDebugTxn(null)} />
      )}

      <GroupPickerSheet
        visible={!!groupPickerTxn}
        txn={groupPickerTxn}
        onClose={() => setGroupPickerTxn(null)}
        onCreateNew={() => { setGroupPickerTxn(null); navigation.navigate('Groups'); }}
        onPick={(groupId, group) => {
          const txn = groupPickerTxn;
          setGroupPickerTxn(null);
          if (group?.type === 'shared') {
            setGroupExpenseTxn({ txn, group });
          } else {
            tagTransactionToGroup(txn.id, groupId);
            toast.success('Added to group');
          }
        }}
      />

      {groupExpenseTxn && (
        <GroupExpenseSheet
          visible={!!groupExpenseTxn}
          group={groupExpenseTxn.group}
          presetAmount={groupExpenseTxn.txn?.amount}
          onClose={() => setGroupExpenseTxn(null)}
          onAdd={(expenseData) => {
            tagTransactionToGroup(groupExpenseTxn.txn.id, groupExpenseTxn.group.id, expenseData.shares?.length ? {
              paidByMemberId: expenseData.paidByMemberId,
              paidByName: expenseData.paidByName,
              shares: expenseData.shares,
            } : null);
            toast.success('Added to group');
            setGroupExpenseTxn(null);
          }}
        />
      )}

      {editGroupTxn && (
        <GroupExpenseSheet
          visible={!!editGroupTxn}
          group={editGroupTxn.group}
          editTxn={editGroupTxn.txn}
          presetAmount={
            // Lock the amount ONLY for SMS-derived rows, where the bank is the source
            // of truth. A MANUAL group expense stays editable — the rule
            // AddGroupExpenseScreen already used. Passing it unconditionally made the
            // same manual expense editable from the Groups tab but frozen here.
            editGroupTxn.txn?.source !== 'manual' ? editGroupTxn.txn?.amount : undefined
          }
          showCategory
          lockPayerToMe={!editGroupTxn.txn?.isGroupMemo && !!editGroupTxn.txn?.accountId}
          onClose={() => setEditGroupTxn(null)}
          onAdd={(expenseData) => {
            updateGroupExpense(editGroupTxn.txn.id, expenseData);
            toast.success('Changes saved');
            setEditGroupTxn(null);
          }}
        />
      )}

      {/* Tapping a shared-group transaction card opens this first — who paid,
          per-member shares, your position — with an Edit pill into the same
          split editor (editGroupTxn) used everywhere else. */}
      <GroupTxnDetailSheet
        txn={groupDetailTxn?.txn || null}
        onClose={() => setGroupDetailTxn(null)}
        onEdit={() => {
          const { txn, group } = groupDetailTxn;
          setGroupDetailTxn(null);
          setEditGroupTxn({ txn, group });
        }}
      />

      {/* Plain-transaction detail — view first, Edit opens the full edit form
          (amount/merchant/account/category/note), mirroring the group edit
          flow. LB-linked transactions keep their own dedicated edit path
          (the manage sheet's "Edit person"), since a lend/borrow link isn't
          editable from this form. */}
      <TxnDetailSheet
        txn={detailTxn}
        myName={userName ? `You (${userName})` : 'You'}
        onClose={() => setDetailTxn(null)}
        onEdit={() => {
          const t = detailTxn;
          setDetailTxn(null);
          if (t.lbLocked) {
            setActiveTxn(t);
          } else {
            navigation.navigate('AddTransaction', { editTxnId: t.id });
          }
        }}
      />

      {/* EPC claim sheet — surfaces automatically when a Zero-Transaction Day
          bonus is detected. User must consciously claim; crediting is deferred
          to claimSavingsBonus() so the balance only changes on explicit tap. */}
      <EpcClaimBottomSheet
        visible={!!pendingSavingsReward}
        epcAmount={pendingSavingsReward?.epcAmount ?? 0}
        rpAmount={pendingSavingsReward?.rpAmount ?? 0}
        onClaim={claimSavingsBonus}
      />

      {/* Aware Run explainer — opened by the vault chip in the header. Every
          number is read from REWARD_CONFIG rather than typed into the copy, so
          retuning the ladder can't leave this sheet lying (the rewards skill
          flags exactly that trap for REWARD_COPY). */}
      <InfoSheet
        visible={vaultInfoVisible}
        onClose={() => setVaultInfoVisible(false)}
        // Ionicons, not emoji: chrome is vector icons app-wide, and only an
        // entity's OWN emoji (a category, a group) is data (ui-consistency §5).
        // `flame-outline` for the streak rather than a piggy glyph — Ionicons has
        // no piggy, and pulling in MaterialCommunityIcons for one icon would add a
        // second stroke style to the header for no gain.
        icon={<Ionicons name="flame-outline" size={26} color={theme.primary} />}
        title="Crystal Piggy Vault"
        eyebrow={`${awareStreak}-day Aware Run · ${labelForStreak(awareStreak)} · ×${multiplierForStreak(awareStreak)}`}
        body="Your vault grows as you keep reviewing what you spend. The streak multiplies everything you earn."
        bullets={[
          {
            icon: 'calendar-outline',
            label: 'Keeping the run',
            value: 'Open ePurse once a day. Miss a day that had no transactions and the run is forgiven — there was nothing to be aware of.',
          },
          {
            icon: 'sparkles-outline',
            label: 'What it multiplies',
            value: `Reviewing a transaction earns ${REWARD_CONFIG.REVIEW_RP_BASE} RP and ${REWARD_CONFIG.REVIEW_EPC_BASE} EPC, then your multiplier is applied. First ${REWARD_CONFIG.DAILY_REVIEW_CAP} reviews each day count.`,
          },
          {
            icon: 'trending-up-outline',
            label: 'The ladder',
            value: REWARD_CONFIG.MULTIPLIER_TIERS
              // The last tier's maxDay is Infinity → renders as "Day 16+".
              .map((t) => `Day ${t.minDay}${Number.isFinite(t.maxDay) ? `–${t.maxDay}` : '+'} ×${t.multiplier}`)
              .join(' · '),
          },
          {
            icon: 'diamond-outline',
            label: 'Vault crystals',
            value: 'One crystal to start, three from day 3, six from day 16. The tiers are deliberately not the same as the earning ladder.',
          },
        ]}
      />

      {/* Activity feed — bell icon in header opens this. */}
      <NotificationsSheet
        visible={notificationsVisible}
        onClose={() => setNotificationsVisible(false)}
      />

    </View>
  );
};

// ── Quick action tile ─────────────────────────────────────────────────────────
// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  // `flex: 1` lets a long name truncate rather than shove the action cluster
  // off-screen. The MARGINS depend on which side the avatar is on (USE_ORIGINAL_HEADER),
  // so they live in the two variants below rather than here — getting this wrong
  // is the one way flipping the flag could leave the header subtly off.
  headerGreetWrap: { flex: 1 },
  /** Avatar on the left: gaps on BOTH sides. */
  headerGreetBesideAvatar: { marginLeft: spacing.md, marginRight: spacing.sm },
  /** Original: the greeting leads the row, so it only needs a trailing gap. */
  headerGreetLeading: { marginRight: spacing.md },
  // Colour is applied at the call site — the row renders on the gradient AND on
  // the light pinned bar (`identityRow`). Only the type weights live here.
  greeting:  { ...typography.small },
  userName:  { ...typography.h2, marginTop: 2 },
  headerRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    flexShrink:    0,
  },
  // Only used when USE_ORIGINAL_HEADER — the pre-Aug-26 vault chip. A rounded
  // RECT sized around its content rather than the shared 42pt circle, which is
  // exactly why it was the tallest control in the row: the 40pt asset draws an
  // "Xd Aware" label below the piggy. Kept verbatim so the flag restores the real
  // original, not an approximation of it.
  vaultBtnOriginal: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF22',
  },

  avatarInitial: {
    fontSize: 17,
    fontWeight: '700',
  },


  // ── Hero type: THREE tiers, not four ──────────────────────────────────────
  // The hero held five numbers across four ad-hoc sizes, so nothing led. Now:
  //   EYEBROW  11/800 uppercase, tracked  — what the figure is (and the metric
  //                                         labels below, so they're one tier)
  //   FIGURE   38/800 tight                — the subject
  //   VALUE    15/700                      — supporting numbers
  // Uppercase micro-labels for metrics are the sanctioned tier in
  // ui-consistency §1 (distinct from section headings, which stay h3 sentence-case).
  balanceBlock: { marginTop: spacing.lg },
  balanceLabel: {
    color: '#FFFFFFCC',
    ...typography.tiny,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  balanceValue: {
    color: '#fff',
    // 38, up from 36, with tighter tracking: the gap to the supporting 15px
    // values is what makes this read as the subject rather than the largest of
    // several numbers. `adjustsFontSizeToFit` keeps a ₹1,23,45,678 on one line
    // instead of wrapping the hero.
    fontSize: 38,
    fontWeight: '800',
    marginTop: spacing.xxs,
    letterSpacing: -0.8,
  },

  // ── Period toggle: a segmented track ──────────────────────────────────────
  // `paddingVertical` here is what makes the cells' 6pt hitSlop actually WORK.
  // A touch outside an ancestor's bounds is never delivered to its children, no
  // matter how much hitSlop the child declares — so the 32pt track needs a row
  // tall enough to contain the 44pt target. The 6pt comes OUT of the old
  // marginTop (8 → 2) so the visual gap above is unchanged and the hero gains no
  // height. Change one without the other and either the spacing shifts or the
  // bottom 6pt of every tap target silently stops responding.
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    paddingVertical: 6,
  },
  /** Label, shared by all three variants — only the ACTIVE colour differs. */
  periodLabel: { color: '#FFFFFFBB', fontWeight: '700', fontSize: 13 },
  // Bigger ONLY on the underline variant. The 44pt pitch between items is a hard
  // floor (see below), so the way to make the letters look closer together is to
  // have them occupy more of it rather than to move them.
  periodLabelUnderline: { fontSize: 15 },

  // ── 'segmented' ───────────────────────────────────────────────────────────
  periodTrack: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.pill,
    // Clips the active cell's corners to the track's own radius, so the filled
    // segment reads as nested rather than as a pill floating on a bar.
    overflow: 'hidden',
  },
  // 44 wide with NO horizontal hitSlop — the cells touch, so slop would overlap.
  // Width carries the target horizontally, hitSlop carries it vertically.
  periodCell: {
    minWidth: 44,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  periodCellActive: { backgroundColor: '#FFFFFF' },

  // ── 'original' — four separate circles, the pre-Aug-26 look ────────────────
  periodCircleRow: { flexDirection: 'row', gap: 6 },
  periodCircle: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF20',
  },
  periodCircleActive: { backgroundColor: '#FFFFFF' },

  // ── 'underline' — text, 2pt rule under the active one ─────────────────────
  // 32pt boxes with a 12pt gap, not 44pt boxes butted together: without a track
  // behind them the empty space between letters is VISIBLE, so the same total
  // width that reads fine on the segmented variant reads as sprawl here. The
  // letters now span 164pt instead of 188. The 6pt padding is invisible but is
  // what keeps the outer items' slop deliverable (see PERIOD_SLOP.underline).
  periodTabRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 6 },
  // The TOUCH area. Deliberately carries no border: see `periodRule`.
  periodTab: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The VISUAL rule, sized to the LETTER rather than to the touch area — on the
  // first attempt the border sat on the 44pt touch box, so a single character got
  // a 44pt rule, which is what made this variant look stretched. 22 fixed rather
  // than content-width so all four rules match: "W" is ~3pt wider than "Y" at
  // 13/700, and rules of differing lengths read as sloppy.
  periodRule: {
    width: 26,
    alignItems: 'center',
    paddingBottom: 3,
    // TRANSPARENT, not absent: an absent border would make the label jump 2pt
    // when it becomes active. Reserve the space in both states.
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  periodRuleActive: { borderBottomColor: '#FFFFFF' },

  // The synced-range label — the header's trust signal ("is this current?"), and
  // previously its least legible text: 10px at #FFFFFF66 measures 1.13–2.29:1
  // across the five accents. Full white at the shared tiny size takes that to
  // 1.41–5.81:1, which is the ceiling available here: the gradient itself caps
  // white text below AA on four of five accents (amber 1.41 even at full
  // opacity), which is the app-wide gap recorded in ui-consistency §7. So this
  // is now exactly as readable as the rest of the header, and no further fix is
  // possible without settling that decision. Don't reintroduce an alpha.
  dataInfo: { color: '#FFFFFF', ...typography.tiny },

  // ── Income / refunds: ONE segmented surface ───────────────────────────────
  // Was two separate pills with a gap between them. One surface split by a
  // hairline is a single object carrying two facts, which competes far less with
  // the figure above it — and it can't drift out of alignment the way two
  // independently-padded pills can.
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  // Inset top and bottom so it reads as a divider between cells rather than a
  // seam splitting the surface into two shapes.
  statDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: '#FFFFFF3D',
    marginVertical: spacing.sm,
  },
  // Same eyebrow tier as balanceLabel — the metric labels and the hero label are
  // the same KIND of thing, so they get the same treatment.
  statLabel: { color: '#FFFFFFCC', ...typography.tiny, fontWeight: '800', letterSpacing: 0.9 },
  statValue: { color: '#fff', ...typography.bodyBold, fontWeight: '700', marginTop: 3 },

  // Body
  // ── Vertical rhythm: TWO levels, not one ──────────────────────────────────
  // `gap: spacing.xl` (24) separates GROUPS; `styles.group`'s `gap: spacing.lg`
  // (16) separates sections inside a group. One uniform gap everywhere gave the
  // page no cadence — every section sat equally far from every other, so nothing
  // read as belonging together. A 1.5× ratio is enough to feel grouped without
  // making the page taller.
  //
  // Sections must still not add their own outer marginTop/marginBottom — it
  // compounds with whichever gap applies (ui-consistency §6).
  //
  // paddingTop adds back the body's -spacing.lg overlap (tuck under the curved
  // header) so the header→first-section gap equals the inter-GROUP gap.
  // `paddingTop` here is space BELOW the header, not from the top of the screen:
  // CollapsingHeaderScreen ADDS it to the expanded header height. 24 reproduces
  // the old fixed-mode gap exactly — that was 16pt of header padding, minus a
  // 16pt body tuck, plus 40pt of content padding.
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, gap: spacing.xl, flexGrow: 1 },
  // A wrapper must never be EMPTY: it still occupies a slot in the parent `gap`,
  // so an empty one opens a double gap around nothing. Every group here contains
  // at least one always-rendered section (see the JSX comments).
  group: { gap: spacing.lg },

  txnCount: { ...typography.small, color: colors.textSecondary, fontWeight: '400' },

  // Recent
  txnSection: {},
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // No marginTop — the parent `gap` spaces this section from the queue above.
    marginBottom: spacing.sm,
  },
  viewAll: { ...typography.small, color: colors.primary, fontWeight: '700' },
  // `compact` EmptyState is intentionally short (it's built to sit inside a card),
  // which on Home leaves the whole page barely taller than the header. Reserve the
  // space a populated list would occupy and centre the placeholder inside it.
  recentEmpty: { minHeight: 300, justifyContent: 'center' },
});

export default DashboardScreen;
