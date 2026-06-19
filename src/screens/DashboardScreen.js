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
  Animated, Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEPurseStore, selectUnreviewedQueue, selectYesterdayTransactionCount, selectExpenseStats } from '../store/ePurseStore';
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
import DailyQueueStack from '../components/DailyQueueStack';
import CrystalPiggyVault from '../components/CrystalPiggyVault';
import BellIcon from '../components/BellIcon';
import NotificationsSheet from '../components/NotificationsSheet';
import {
  useNotificationStore,
  selectHasUnreadNotifications,
} from '../store/useNotificationStore';
import { vaultTierForStreak } from '../config/rewardConfig';
import { selectAwareStreak } from '../store/useRewardStore';
import WelcomeStreakModal from '../components/WelcomeStreakModal';
import CheckInBanner from '../components/CheckInBanner';
import CelebrationModal from '../components/CelebrationModal';
import CCPaymentPromptModal from '../components/CCPaymentPromptModal';
import TransactionItem from '../components/TransactionItem';
import TxnDebugSheet from '../components/TxnDebugSheet';
import { IS_PREVIEW_BUILD } from '../constants/buildVariant';
import FAB from '../components/FAB';
import CategoryPickerModal from '../components/CategoryPickerModal';
import LinkContactModal from '../components/LinkContactModal';
import SplitConfigModal from '../components/SplitConfigModal';
import SplitDetailsModal from '../components/SplitDetailsModal';
import CenterModal from '../components/CenterModal';
import { canSplitTransaction } from '../utils/split';
import EpcClaimBottomSheet from '../components/EpcClaimBottomSheet';
import GroupPickerSheet from '../components/GroupPickerSheet';
import GroupExpenseSheet from '../components/GroupExpenseSheet';
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
  const setTransactionHidden = useEPurseStore((s) => s.setTransactionHidden);
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
  const tagTransactionToGroup   = useEPurseStore((s) => s.tagTransactionToGroup);
  const untagTransactionFromGroup = useEPurseStore((s) => s.untagTransactionFromGroup);
  const addGroupExpense = useEPurseStore((s) => s.addGroupExpense);
  const pendingCelebration  = useEPurseStore((s) => s.pendingCelebration);
  const clearPendingCelebration = useEPurseStore((s) => s.clearPendingCelebration);

  const { onScroll, scrollEventThrottle } = useTabBarScroll();
  const insets = useSafeAreaInsets();

  const [period, setPeriod]     = useState('M');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);
  const [lbLinkTxn, setLbLinkTxn] = useState(null);   // { txn, categoryId }
  const [splitTxn, setSplitTxn] = useState(null);
  const [splitDetailsTxn, setSplitDetailsTxn] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, message, primaryText, destructive, onConfirm }
  const [showSettings, setShowSettings] = useState(false);
  const [debugTxn, setDebugTxn] = useState(null);
  const [groupPickerTxn, setGroupPickerTxn] = useState(null);
  const [groupExpenseTxn, setGroupExpenseTxn] = useState(null); // { txn, group }
  const [createGroupVisible, setCreateGroupVisible] = useState(false);
  const settingsSlide = useState(() => new Animated.Value(0))[0];
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
    () => selectExpenseStats(period)({ transactions, monthlyAggregates: monthlyAggs }),
    [period, transactions, monthlyAggs]
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
    const sub = navigation.addListener('focus', () => {
      const yesterdayCount = selectYesterdayTransactionCount(useEPurseStore.getState());
      checkIn(yesterdayCount);
    });
    // Fire once on initial mount as well (focus listener doesn't fire on the
    // first render because the screen is already focused).
    const yesterdayCount = selectYesterdayTransactionCount(useEPurseStore.getState());
    checkIn(yesterdayCount);
    return sub;
  }, [navigation, checkIn]);


  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const periodTitle = PERIODS.find((p) => p.key === period)?.title ?? 'period';
  // periodStats.net = debits − credits (positive = net expense outflow).
  const periodNet = periodStats.net;

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
      <LinearGradient
        colors={[theme.gradientStart, theme.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']}>
          {/* Top row */}
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
                onLongPress={IS_PREVIEW_BUILD ? () => {
                  setShowSettings(true);
                  Animated.spring(settingsSlide, { toValue: 1, useNativeDriver: true, tension: 65, friction: 11 }).start();
                } : undefined}
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

          {/* Net expense (debits − credits) for the selected period. */}
          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>ePurse net expense {period === 'D' ? 'today' : `this ${periodTitle}`}</Text>
            <Text style={styles.balanceValue}>{formatCurrency(periodNet)}</Text>
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

          {/* ── Period debit / credit pills ── */}
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Debits {period === 'D' ? 'today' : `this ${periodTitle}`}</Text>
              <Text style={styles.statValue}>{formatCurrency(periodStats.debits)}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Credits {period === 'D' ? 'today' : `this ${periodTitle}`}</Text>
              <Text style={styles.statValue}>{formatCurrency(periodStats.credits)}</Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

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
        {/* Lent / Borrowed */}
        <LentBorrowedWidget
          lent={lent}
          borrowed={borrowed}
          onPressLent={() => navigation.navigate('LentBorrowed', { kind: 'lent' })}
          onPressBorrowed={() => navigation.navigate('LentBorrowed', { kind: 'borrowed' })}
        />

        {/* Monthly budget — empty CTA or active progress */}
        <BudgetSummary onPress={() => navigation.navigate('Insights', { defaultTab: 'budget', openPlan: !budget })} />

        {/* Daily review queue — appears only when unreviewed SMS transactions exist */}
        <DailyQueueStack />

        {/* Period transactions */}
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>
            Transactions · {txnSectionLabel}
            <Text style={styles.txnCount}> ({periodStats.count})</Text>
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Transactions', { initialPeriod: period })}>
            <Text style={[styles.viewAll, { color: theme.primary }]}>View all</Text>
          </TouchableOpacity>
        </View>

        {periodStats.recent.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>Nothing this {periodTitle}</Text>
            <Text style={styles.emptyHelp}>
              Add a manual entry or switch to a wider period.
            </Text>
          </View>
        ) : (
          periodStats.recent.map((t) => (
            <TransactionItem
              key={t.id}
              txn={t}
              onPressCategory={() => setActiveTxn(t)}
              onPressSplitChip={() => setSplitDetailsTxn(t)}
              onLongPress={IS_PREVIEW_BUILD ? () => setDebugTxn(t) : undefined}
            />
          ))
        )}

        <View style={{ height: TAB_BAR_HEIGHT + 80 }} />
      </ScrollView>

      <FAB onPress={() => navigation.navigate('AddTransaction')} bottomInset={TAB_BAR_HEIGHT + insets.bottom} />

      <CategoryPickerModal
        visible={!!activeTxn}
        categories={categories}
        categoryLocked={!!activeTxn?.lbLocked}
        selectedCategoryId={activeTxn?.categoryId}
        selectedParent={activeTxn?.parentCategory}
        selectedChild={activeTxn?.childCategory}
        isHidden={!!activeTxn?.isHidden}
        isIgnored={!!activeTxn?.isIgnored}
        canSplit={!!activeTxn && canSplitTransaction(activeTxn)}
        isSplitTxn={!!activeTxn?.isSplit}
        currentGroupId={activeTxn?.groupId || null}
        onPressAddToGroup={() => {
          const t = activeTxn;
          setActiveTxn(null);
          setGroupPickerTxn(t);
        }}
        onPressRemoveFromGroup={() => {
          if (!activeTxn) return;
          untagTransactionFromGroup(activeTxn.id);
          setActiveTxn(null);
        }}
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

      <LinkContactModal
        visible={!!lbLinkTxn}
        categoryId={lbLinkTxn?.categoryId}
        onConfirm={(contactInfo) => {
          if (!lbLinkTxn) return;
          updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, contactInfo);
          setLbLinkTxn(null);
        }}
        onSkip={() => {
          if (!lbLinkTxn) return;
          updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, { person: 'Unlinked', phone: null, contactId: null });
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

      {/* Monthly wrap-up celebration — shown after rollover snapshots a month */}
      <CelebrationModal
        visible={!!pendingCelebration}
        onClose={clearPendingCelebration}
        onPlanNext={() => {
          clearPendingCelebration();
          navigation.navigate('Insights');
        }}
      />

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

      {/* ── Settings bottom sheet ── */}
      <Modal
        visible={showSettings}
        transparent
        animationType="none"
        onRequestClose={() => {
          Animated.timing(settingsSlide, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setShowSettings(false));
        }}
      >
        <TouchableOpacity
          style={styles.settingsBackdrop}
          activeOpacity={1}
          onPress={() => {
            Animated.timing(settingsSlide, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => setShowSettings(false));
          }}
        >
          <Animated.View
            style={[
              styles.settingsSheet,
              { transform: [{ translateY: settingsSlide.interpolate({ inputRange: [0, 1], outputRange: [300, 0] }) }] },
            ]}
          >
            <View style={styles.settingsHandle} />
            {[
              { emoji: '📂', label: 'Categories', route: 'Categories' },
              { emoji: '🔬', label: 'SMS Diagnostic', route: 'SmsDiagnostic' },
            ].map(({ emoji, label, route }) => (
              <TouchableOpacity
                key={route}
                style={styles.settingsRow}
                activeOpacity={0.7}
                onPress={() => {
                  setShowSettings(false);
                  settingsSlide.setValue(0);
                  navigation.navigate(route);
                }}
              >
                <Text style={styles.settingsRowEmoji}>{emoji}</Text>
                <Text style={styles.settingsRowLabel}>{label}</Text>
                <Text style={styles.settingsRowChevron}>›</Text>
              </TouchableOpacity>
            ))}
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// ── Quick action tile ─────────────────────────────────────────────────────────
// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
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
    marginTop: spacing.xs, letterSpacing: -0.5,
  },

  // Period toggle
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
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

  // Body
  body: { flex: 1, marginTop: -spacing.lg },
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  txnCount: { ...typography.small, color: colors.textSecondary, fontWeight: '400' },

  // Recent
  recentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  viewAll: { ...typography.small, color: colors.primary, fontWeight: '700' },

  // Plain (no card) empty state — just emoji + text, like the Groups empty list.
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptyHelp: {
    ...typography.small, color: colors.textSecondary,
    textAlign: 'center', marginTop: spacing.xs,
  },

  // Settings sheet
  settingsBackdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
  settingsSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: 36,
    paddingTop: spacing.sm,
    ...shadows.elevated,
  },
  settingsHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  settingsRowEmoji: { fontSize: 20 },
  settingsRowLabel: { flex: 1, ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  settingsRowChevron: { fontSize: 22, color: colors.textSecondary, fontWeight: '300' },
});

export default DashboardScreen;
