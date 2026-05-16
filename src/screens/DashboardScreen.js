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

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';
// import { SAMPLE_MESSAGES } from '../utils/messageParser'; // unused while simulate SMS is hidden
import { TRANSACTION_TYPES } from '../constants/categories';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';

import LentBorrowedWidget from '../components/LentBorrowedWidget';
import BudgetWidget from '../components/BudgetWidget';
import CelebrationModal from '../components/CelebrationModal';
import TransactionItem from '../components/TransactionItem';
import FAB from '../components/FAB';
import CategoryPickerModal from '../components/CategoryPickerModal';
import LinkContactModal from '../components/LinkContactModal';
import SplitConfigModal from '../components/SplitConfigModal';
import SplitDetailsModal from '../components/SplitDetailsModal';
import CenterModal from '../components/CenterModal';
import { canSplitTransaction, debitDisplayAmount } from '../utils/split';
// ── Period config ─────────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'D', label: 'D', title: 'today' },
  { key: 'W', label: 'W', title: 'week' },
  { key: 'M', label: 'M', title: 'month' },
  { key: 'Y', label: 'Y', title: 'year' },
];

/** Returns epoch-ms of the start of the chosen period. */
const periodStart = (key) => {
  const now = new Date();
  if (key === 'D') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (key === 'W') return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (key === 'Y') return new Date(now.getFullYear(), 0, 1).getTime();
  // 'M' — first day of current calendar month
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

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
  const updateTransactionCategoryWithContact = useEPurseStore((s) => s.updateTransactionCategoryWithContact);
  const setTransactionHidden = useEPurseStore((s) => s.setTransactionHidden);
  const deleteTransaction = useEPurseStore((s) => s.deleteTransaction);
  const ignoreTransaction = useEPurseStore((s) => s.ignoreTransaction);
  const unignoreTransaction = useEPurseStore((s) => s.unignoreTransaction);
  const setTransactionSplit = useEPurseStore((s) => s.setTransactionSplit);
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

  // ── Period-aware stats ────────────────────────────────────────────────────
  const LB_CATS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid']);

  const periodStats = useMemo(() => {
    const startMs = periodStart(period);
    const now = new Date();

    // Filter raw transactions within the period window (ignored = excluded everywhere)
    const inPeriod = transactions.filter(
      (t) => !t.isIgnored && new Date(t.createdAt).getTime() >= startMs
    );
    const visibleInPeriod = inPeriod.filter((t) => !t.isHidden);

    // Exclude lent/borrow categories from normal spend/income
    const rawSpend  = inPeriod
                        .filter((t) => t.type === TRANSACTION_TYPES.DEBIT && !LB_CATS.has(t.categoryId))
                        .reduce((s, t) => s + debitDisplayAmount(t), 0);
    const rawIncome = inPeriod
                        .filter((t) => t.type === TRANSACTION_TYPES.CREDIT && !LB_CATS.has(t.categoryId))
                        .reduce((s, t) => s + t.amount, 0);

    // For the Year period we must also pull months older than raw retention
    // (3 months) from monthlyAggregates so the full year is covered.
    let aggSpend = 0, aggIncome = 0;
    if (period === 'Y') {
      const yearStr    = String(now.getFullYear());
      // raw retention cutoff ≈ 3 months ago (first of that month)
      const cutoffDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const cutoffKey  = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}`;
      Object.entries(monthlyAggs).forEach(([k, v]) => {
        if (k.startsWith(yearStr) && k < cutoffKey) {
          aggSpend  += v.totalSpend  || 0;
          aggIncome += v.totalIncome || 0;
        }
      });
    }

    const spend  = rawSpend  + aggSpend;
    const income = rawIncome + aggIncome;

    const recent = [...visibleInPeriod]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);

    return { spend, income, recent, count: visibleInPeriod.length };
  }, [period, transactions, monthlyAggs]);

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


  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const periodTitle = PERIODS.find((p) => p.key === period)?.title ?? 'period';
  const periodNet = periodStats.income - periodStats.spend;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

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
            <View>
              <Text style={styles.greeting}>{greeting}</Text>
              <Text style={styles.userName}>{userName ? `Hi, ${userName} 👋` : 'ePurse 👋'}</Text>
            </View>
            {/* Settings icon — navigates directly to Categories.
                Commented: previous Alert modal flow with SMS Diagnostic option:
                onPress={() =>
                  Alert.alert('Settings', '', [
                    { text: '📂  Categories',    onPress: () => navigation.navigate('Categories') },
                    { text: '🔬  SMS Diagnostic', onPress: () => navigation.navigate('SmsDiagnostic') },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
            */}
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => navigation.navigate('Categories')}
            >
              <Text style={styles.iconText}>⚙</Text>
            </TouchableOpacity>
          </View>

          {/* Balance */}
          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>ePurse net this {periodTitle}</Text>
            <Text style={styles.balanceValue}>{formatCompact(periodNet)}</Text>
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

          {/* ── Period spend / income pills ── */}
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Spent this {periodTitle}</Text>
              <Text style={styles.statValue}>{formatCompact(periodStats.spend)}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statLabel}>Income this {periodTitle}</Text>
              <Text style={styles.statValue}>{formatCompact(periodStats.income)}</Text>
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
        <BudgetWidget onPress={() => navigation.navigate('Insights')} />

        {/* Period transactions */}
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>
            Transactions · this {periodTitle}
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
              onPress={() => navigation.navigate('Transactions', { focusId: t.id })}
              onPressCategory={() => {
                if (t.lbLocked) {
                  setConfirm({ title: 'Category locked', message: 'This transaction is linked to a lent/borrow record and cannot be re-categorised.', primaryText: 'OK' });
                  return;
                }
                setActiveTxn(t);
              }}
              onPressSplitChip={() => setSplitDetailsTxn(t)}
            />
          ))
        )}

        <View style={{ height: TAB_BAR_HEIGHT + 80 }} />
      </ScrollView>

      <FAB onPress={() => navigation.navigate('AddTransaction')} bottomInset={TAB_BAR_HEIGHT + insets.bottom} />

      <CategoryPickerModal
        visible={!!activeTxn}
        categories={categories}
        selectedCategoryId={activeTxn?.categoryId}
        isHidden={!!activeTxn?.isHidden}
        isIgnored={!!activeTxn?.isIgnored}
        canSplit={!!activeTxn && canSplitTransaction(activeTxn)}
        isSplitTxn={!!activeTxn?.isSplit}
        onPressSplit={() => {
          const t = activeTxn;
          setActiveTxn(null);
          setSplitTxn(t);
        }}
        onClose={() => setActiveTxn(null)}
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
            title: hidden ? 'Hide transaction?' : 'Show transaction?',
            message: hidden
              ? 'This transaction will be hidden from default views but still counted in totals.'
              : 'This transaction will be visible again in default views.',
            primaryText: hidden ? 'Hide' : 'Show',
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
  greeting:  { color: '#FFFFFFCC', ...typography.small },
  userName:  { color: '#fff', ...typography.h2, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF22',
  },
  iconText: { color: '#fff', fontSize: 20 },

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

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.card,
  },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptyHelp: {
    ...typography.small, color: colors.textSecondary,
    textAlign: 'center', marginTop: spacing.xs,
  },
});

export default DashboardScreen;
