// =============================================================================
// DashboardScreen
// -----------------------------------------------------------------------------
// Layout (top → bottom):
//   1. Gradient header — greeting + total ePurse balance
//   2. D / W / M / Y period toggle  →  spend & income refresh accordingly
//   3. Account chips  — horizontal scroller
//   4. Lent / Borrowed widgets
//   5. Quick actions
//   6. Recent transactions for selected period
//   7. FAB
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';

import { useEPurseStore, selectUnreviewedQueue, selectYesterdayTransactionCount, selectGapTransactionCount, selectExpenseStats, selectLatestRecapMonth } from '../store/ePurseStore';
import {
  useRewardStore,
  selectLevel,
} from '../store/useRewardStore';
const selectPendingSavings = (s) => s.pendingSavingsReward;
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
// import { SAMPLE_MESSAGES } from '../utils/messageParser'; // unused while simulate SMS is hidden
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';

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
import { vaultTierForStreak } from '../config/rewardConfig';
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
import SplitDetailsModal from '../components/SplitDetailsModal';
import CenterModal from '../components/CenterModal';
import { canSplitTransaction } from '../utils/split';
import EpcClaimBottomSheet from '../components/EpcClaimBottomSheet';
import GroupPickerSheet from '../components/GroupPickerSheet';
import GroupExpenseSheet from '../components/GroupExpenseSheet';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import TxnDetailSheet from '../components/TxnDetailSheet';
// ── Period config ─────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'D', label: 'D', title: 'today' },
  { key: 'W', label: 'W', title: 'week' },
  { key: 'M', label: 'M', title: 'month' },
  { key: 'Y', label: 'Y', title: 'year' },
];

// ── Main screen ───────────────────────────────────────────────────────────────
const DashboardScreen = ({ navigation }) => {
  const theme           = useTheme();
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

  const { onScroll, scrollEventThrottle } = useTabBarScroll();
  const insets = useSafeAreaInsets();

  const [period, setPeriod]     = useState('M');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [lbLinkTxn, setLbLinkTxn] = useState(null);   // { txn, categoryId }
  const [ccBillTxn, setCcBillTxn] = useState(null);   // txn being reclassified as a CC bill payment
  const [splitTxn, setSplitTxn] = useState(null);
  const [splitDetailsTxn, setSplitDetailsTxn] = useState(null);
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  // ── Aware Run check-in (hands-free) ──────────────────────────────────────
  // Runs once on mount AND on every screen focus (foregrounding the app
  // after the day rolls over still counts). checkIn() is idempotent within
  // a calendar day, so re-firing on focus is safe.
  //
  // We pass YESTERDAY's SMS transaction count (not today's queue) so the
  // store can correctly evaluate Zero-Transaction Day eligibility. The
  // current queue is always empty at morning open — using it caused a false
  // SAVINGS bonus every single day.
  useEffect(() => {
    // Pass yesterday's count (Zero-Transaction Day / SAVINGS eligibility) AND the
    // missed-days count so a skipped app-open on a no-transaction day doesn't break
    // the Aware Run (selectGapTransactionCount → forgivenGap in the reward store).
    const runCheckIn = () => {
      const st = useEPurseStore.getState();
      const yesterdayCount = selectYesterdayTransactionCount(st);
      const gapCount = selectGapTransactionCount(st, useRewardStore.getState().lastCheckedInDate);
      checkIn(yesterdayCount, gapCount);
    };
    const sub = navigation.addListener('focus', runCheckIn);
    // Fire once on initial mount as well (focus listener doesn't fire on the
    // first render because the screen is already focused).
    runCheckIn();
    return sub;
  }, [navigation, checkIn]);


  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const periodTitle = PERIODS.find((p) => p.key === period)?.title ?? 'period';

  // Exact label for the transactions section header
  const txnSectionLabel = period === 'M'
    ? new Date().toLocaleDateString('en-IN', { month: 'long' })
    : period === 'D'
    ? 'Today'
    : `this ${periodTitle}`;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Floating check-in banner — auto-shows on new-day launches. */}
      <CheckInBanner />

      {/* ───── Gradient header ───── */}
      <CollapsingHeaderScreen
        collapsible={false}
        gradientColors={[theme.gradientStart, theme.gradientEnd]}
        renderBar={() => (
          /* Top row */
          <View style={styles.headerRow}>
            <View style={styles.headerGreetWrap}>
              <Text style={styles.greeting} numberOfLines={1}>{greeting}</Text>
              <Text style={styles.userName} numberOfLines={1} ellipsizeMode="tail">
                {userName ? `Hi, ${userName} 👋` : 'ePurse 👋'}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity
                style={styles.vaultBtn}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Crystal Piggy Vault · ${awareStreak} day Aware Run · ${vaultTier} tier`}
                onPress={() => {/* vault chip — sheet auto-shows when pendingSavingsReward is set */}}
                onLongPress={() => {
                  // Cycle through all three visual tiers for inspection.
                  // Resets to real streak tier after 8 seconds.
                  const ORDER = ['base', 'streak', 'premium'];
                  const current = devVaultTier ?? vaultTier;
                  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
                  setDevVaultTier(next);
                  clearTimeout(devVaultTimer.current);
                  devVaultTimer.current = setTimeout(() => setDevVaultTier(null), 8000);
                }}
              >
                <CrystalPiggyVault
                  tier={devVaultTier ?? vaultTier}
                  size={40}
                  day={awareStreak > 0 ? awareStreak : undefined}
                />
              </TouchableOpacity>
              <BellIcon
                hasUnread={hasUnreadNotifications}
                onPress={() => setNotificationsVisible(true)}
              />
              <TouchableOpacity
                style={styles.avatarBtn}
                onPress={() => navigation.navigate('RewardShop')}
                activeOpacity={0.8}
              >
                <Text style={styles.avatarInitial}>
                  {userName ? userName.charAt(0).toUpperCase() : '👤'}
                </Text>
                <View style={styles.levelBadge}>
                  <Text style={styles.levelBadgeText}>{level}</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}
        renderHero={() => (
          <>
          {/* Spend (expenses − refunds) for the selected period. */}
          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>Spent {period === 'D' ? 'today' : `this ${periodTitle}`}</Text>
            <Text style={styles.balanceValue}>{formatCurrency(periodStats.spent)}</Text>
          </View>

          {/* ── W / M / Y toggle ── */}
          <View style={styles.periodRow}>
            <View style={styles.periodPills}>
              {PERIODS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[styles.pill, period === p.key && styles.pillActive]}
                  onPress={() => setPeriod(p.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.pillText, period === p.key && [styles.pillTextActive, { color: theme.primary }]]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.dataInfo}>{dataInfo}</Text>
          </View>

          {/* ── Period income / refund pills (spend is the big number above) ── */}
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Income {period === 'D' ? 'today' : `this ${periodTitle}`}</Text>
              <Text style={styles.statValue}>{formatCurrency(periodStats.received)}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Refunds {period === 'D' ? 'today' : `this ${periodTitle}`}</Text>
              <Text style={styles.statValue}>{formatCurrency(periodStats.refunds)}</Text>
            </View>
          </View>
          </>
        )}
      />

      {/* ───── Scrollable body ───── */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Monthly recap — persistent month-end card, dismissible per month */}
        {showMonthlyRecap && latestRecapMonth && recapCardDismissed !== latestRecapMonth && (
          <MonthlyRecapCard
            monthKey={latestRecapMonth}
            onDismiss={() => dismissMonthlyRecapCard(latestRecapMonth)}
          />
        )}

        {/* Lent / Borrowed */}
        <LentBorrowedWidget
          lent={lent}
          borrowed={borrowed}
          onPressLent={() => navigation.navigate('LentBorrowed', { kind: 'lent' })}
          onPressBorrowed={() => navigation.navigate('LentBorrowed', { kind: 'borrowed' })}
        />

        {/* Monthly budget — empty CTA or active progress */}
        <BudgetSummary onPress={() => navigation.navigate('Insights', { defaultTab: 'budget', openPlan: !budget })} />

        {/* Weekly spend recap is no longer an inline card — it appears once, after
            a week ends, as a centered modal (WeeklyRecapModal below). */}

        {/* Daily review queue — appears only when unreviewed SMS transactions exist */}
        <DailyQueueStack />

        {/* Period transactions — wrapped as ONE section so the row list keeps its
            own tight spacing while the parent `gap` spaces the sections evenly. */}
        <View style={styles.txnSection}>
          <View style={styles.recentHeader}>
            <Text style={styles.sectionTitle}>
              Transactions · {txnSectionLabel}
              <Text style={styles.txnCount}> ({periodStats.count})</Text>
            </Text>
            {/* Nothing to view when the period is empty (e.g. a freshly onboarded user). */}
            {periodStats.recent.length > 0 ? (
              <TouchableOpacity onPress={() => navigation.navigate('Transactions', { initialPeriod: period })}>
                <Text style={[styles.viewAll, { color: theme.primary }]}>View all</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {periodStats.recent.length === 0 ? (
            <EmptyState
              compact
              icon="receipt-outline"
              title={`Nothing this ${periodTitle}`}
              subtitle="Add a manual entry or switch to a wider period."
            />
          ) : (
            periodStats.recent.map((t) => (
              <TransactionItem
                key={t.id}
                txn={t}
                onPress={() => {
                  // Tapping the card opens the most relevant DETAIL view for
                  // what this transaction actually is — always view-first, then
                  // edit: a shared-group expense shows its split detail (who
                  // paid, per-member shares); a direct split shows its share
                  // breakdown; a plain transaction shows its own detail sheet.
                  // The category-icon tap still skips straight to the manage
                  // sheet as a fast path.
                  const group = t.groupId ? groups.find((g) => g.id === t.groupId) : null;
                  if (group && group.type === 'shared') { setGroupDetailTxn({ txn: t, group }); return; }
                  if (t.isSplit) { setSplitDetailsTxn(t); return; }
                  setDetailTxn(t);
                }}
                onPressCategory={() => setActiveTxn(t)}
                onPressSplitChip={() => setSplitDetailsTxn(t)}
                onLongPress={IS_PREVIEW_BUILD ? () => setDebugTxn(t) : undefined}
              />
            ))
          )}
        </View>

        <AppBrandFooter />

        {/* <View style={{ height: TAB_BAR_HEIGHT + 80 }} /> */}
      </ScrollView>

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
          if (splitTxn) setTransactionSplit(splitTxn.id, others, meta);
          setSplitTxn(null);
        }}
      />

      <SplitDetailsModal
        visible={!!splitDetailsTxn}
        txn={splitDetailsTxn}
        myName={userName ? `You (${userName})` : 'You'}
        onClose={() => setSplitDetailsTxn(null)}
        onEdit={() => {
          const t = splitDetailsTxn;
          setSplitDetailsTxn(null);
          setSplitTxn(t);
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
            setGroupExpenseTxn(null);
          }}
        />
      )}

      {editGroupTxn && (
        <GroupExpenseSheet
          visible={!!editGroupTxn}
          group={editGroupTxn.group}
          editTxn={editGroupTxn.txn}
          presetAmount={editGroupTxn.txn?.amount}
          showCategory
          lockPayerToMe={!editGroupTxn.txn?.isGroupMemo && !!editGroupTxn.txn?.accountId}
          onClose={() => setEditGroupTxn(null)}
          onAdd={(expenseData) => {
            updateGroupExpense(editGroupTxn.txn.id, expenseData);
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

      {/* Plain-transaction detail — view first, Edit hands off to the manage sheet. */}
      <TxnDetailSheet
        txn={detailTxn}
        onClose={() => setDetailTxn(null)}
        onEdit={() => {
          const t = detailTxn;
          setDetailTxn(null);
          setActiveTxn(t);
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
  headerGreetWrap: { flex: 1, marginRight: spacing.md },
  greeting:  { color: '#FFFFFFCC', ...typography.small },
  userName:  { color: '#fff', ...typography.h2, marginTop: 2 },
  headerRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
    flexShrink:    0,
  },
  avatarBtn: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF22',
    borderWidth: 1.5,
    borderColor: '#FFFFFF44',
  },
  avatarInitial: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  levelBadge: {
    position: 'absolute',
    bottom: -3, right: -3,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#7C3AED',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  levelBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },

  // ─── Crystal Piggy Vault (header-mounted Aware Run asset) ───────────
  vaultBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF14',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFFFFF22',
  },
  // vaultBadge and tier variants kept below for reference — superseded by
  // the "Xd Aware" label rendered inside CrystalPiggyVault.
  vaultBadge: {
    position: 'absolute',
    bottom: -4, right: -4,
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  vaultBadgeBase: {
    backgroundColor: '#0F766E',
  },
  vaultBadgeStreak: {
    backgroundColor: '#0E7490',
  },
  vaultBadgePremium: {
    backgroundColor: '#B45309',
  },
  vaultBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: -0.2,
  },

  balanceBlock: { marginTop: spacing.lg },
  balanceLabel: { color: '#FFFFFFCC', ...typography.small },
  balanceValue: {
    color: '#fff', fontSize: 36, fontWeight: '800',
    marginTop: spacing.xxs, letterSpacing: -0.5,
  },

  // Period toggle
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  periodPills: { flexDirection: 'row', gap: 6 },
  pill: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF20',
  },
  pillActive: { backgroundColor: '#fff' },
  pillText: { color: '#FFFFFFBB', fontWeight: '700', fontSize: 13 },
  pillTextActive: { color: colors.primary },

  dataInfo: { color: '#FFFFFF66', fontSize: 10, fontWeight: '500' },

  // Spend / income pills
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statPill: {
    flex: 1,
    backgroundColor: '#FFFFFF1F',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  statLabel: { color: '#FFFFFFCC', ...typography.tiny },
  statValue: { color: '#fff', ...typography.bodyBold, fontWeight: '700', marginTop: 2 },
  statSub: { color: '#FFFFFFAA', fontSize: 10, fontWeight: '600', marginTop: 1 },

  // Body
  body: { flex: 1, marginTop: -spacing.lg },
  // `gap` gives every top-level section the SAME vertical spacing. Sections must
  // not add their own outer marginTop/marginBottom or it compounds with this.
  // paddingTop adds back the body's -spacing.lg overlap (tuck under the curved
  // header) so the header→first-section gap equals the inter-section gap (spacing.xl).
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl + spacing.lg, gap: spacing.xl, flexGrow: 1 },

  sectionTitle: { ...typography.h3, color: colors.textPrimary },
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
});

export default DashboardScreen;
