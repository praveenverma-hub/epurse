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
  StatusBar, RefreshControl, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatCompact } from '../utils/format';
// import { SAMPLE_MESSAGES } from '../utils/messageParser'; // unused while simulate SMS is hidden
import { TRANSACTION_TYPES } from '../constants/categories';

import LentBorrowedWidget from '../components/LentBorrowedWidget';
import TransactionItem from '../components/TransactionItem';
import AccountChip from '../components/AccountChip';
import FAB from '../components/FAB';
import CategoryPickerModal from '../components/CategoryPickerModal';

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
  const accounts        = useEPurseStore((s) => s.accounts);
  const transactions    = useEPurseStore((s) => s.transactions);
  const categories      = useEPurseStore((s) => s.categories);
  const monthlyAggs     = useEPurseStore((s) => s.monthlyAggregates);
  const lent            = useEPurseStore((s) => s.getTotalLent());
  const borrowed        = useEPurseStore((s) => s.getTotalBorrowed());
  const userName        = useEPurseStore((s) => s.userName);
  const lastSmsDate     = useEPurseStore((s) => s.lastSmsDate);
  const ingestMessage   = useEPurseStore((s) => s.ingestMessage);
  const updateTransactionCategory = useEPurseStore((s) => s.updateTransactionCategory);
  const setTransactionHidden = useEPurseStore((s) => s.setTransactionHidden);
  const deleteTransaction = useEPurseStore((s) => s.deleteTransaction);
  const ignoreTransaction = useEPurseStore((s) => s.ignoreTransaction);
  const unignoreTransaction = useEPurseStore((s) => s.unignoreTransaction);

  const [period, setPeriod]     = useState('M');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTxn, setActiveTxn] = useState(null);

  // ── Period-aware stats ────────────────────────────────────────────────────
  const periodStats = useMemo(() => {
    const startMs = periodStart(period);
    const now = new Date();

    // Filter raw transactions within the period window (ignored = excluded everywhere)
    const inPeriod = transactions.filter(
      (t) => !t.isIgnored && new Date(t.createdAt).getTime() >= startMs
    );
    const visibleInPeriod = inPeriod.filter((t) => !t.isHidden);

    const rawSpend  = inPeriod.filter((t) => t.type === TRANSACTION_TYPES.DEBIT)
                               .reduce((s, t) => s + t.amount, 0);
    const rawIncome = inPeriod.filter((t) => t.type === TRANSACTION_TYPES.CREDIT)
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
        colors={[colors.gradientStart, colors.gradientEnd]}
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
                  <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>
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
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Account chips */}
        <Text style={styles.sectionTitle}>Your accounts</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.accountsRow}
        >
          {accounts.map((a) => <AccountChip key={a.id} account={a} />)}
        </ScrollView>

        {/* Lent / Borrowed */}
        <LentBorrowedWidget
          lent={lent}
          borrowed={borrowed}
          onPressLent={() => navigation.navigate('LentBorrowed', { kind: 'lent' })}
          onPressBorrowed={() => navigation.navigate('LentBorrowed', { kind: 'borrowed' })}
        />

        {/* Quick actions */}
        <View style={styles.quickActions}>
          <QuickAction emoji="💸" label="Add"       onPress={() => navigation.navigate('AddTransaction')} />
          {/* Simulate SMS hidden — SMS permission is requested on first launch
          <QuickAction emoji="📩" label="Simulate"  onPress={onSimulateSMS} /> */}
          <QuickAction emoji="📊" label="Analytics" onPress={() => navigation.navigate('Analytics')} />
          <QuickAction emoji="🧾" label="All txns"  onPress={() => navigation.navigate('Transactions')} />
          <QuickAction emoji="🔬" label="Diagnose"  onPress={() => navigation.navigate('SmsDiagnostic')} />
        </View>

        {/* Period transactions */}
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>
            Transactions · this {periodTitle}
            <Text style={styles.txnCount}> ({periodStats.count})</Text>
          </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
            <Text style={styles.viewAll}>View all</Text>
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
              onPressCategory={() => setActiveTxn(t)}
            />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <FAB onPress={() => navigation.navigate('AddTransaction')} />

      <CategoryPickerModal
        visible={!!activeTxn}
        categories={categories}
        selectedCategoryId={activeTxn?.categoryId}
        isHidden={!!activeTxn?.isHidden}
        isIgnored={!!activeTxn?.isIgnored}
        onClose={() => setActiveTxn(null)}
        onSelectCategory={(categoryId) => {
          if (!activeTxn) return;
          updateTransactionCategory(activeTxn.id, categoryId);
          setActiveTxn(null);
        }}
        onToggleHidden={(hidden) => {
          if (!activeTxn) return;
          setTransactionHidden(activeTxn.id, hidden);
          setActiveTxn(null);
        }}
        onDelete={() => {
          if (!activeTxn) return;
          Alert.alert('Delete transaction?', 'This action cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                deleteTransaction(activeTxn.id);
                setActiveTxn(null);
              },
            },
          ]);
        }}
        onIgnore={() => {
          if (!activeTxn) return;
          Alert.alert(
            'Ignore transaction?',
            'This removes it from your balances and every total and chart. It will be treated as if it never happened.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Ignore',
                style: 'destructive',
                onPress: () => {
                  ignoreTransaction(activeTxn.id);
                  setActiveTxn(null);
                },
              },
            ]
          );
        }}
        onRestore={() => {
          if (!activeTxn) return;
          Alert.alert(
            'Restore transaction?',
            'This adds it back to balances, totals, and charts.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Restore',
                onPress: () => {
                  unignoreTransaction(activeTxn.id);
                  setActiveTxn(null);
                },
              },
            ]
          );
        }}
      />
    </View>
  );
};

// ── Quick action tile ─────────────────────────────────────────────────────────
const QuickAction = ({ emoji, label, onPress }) => (
  <TouchableOpacity style={styles.qa} activeOpacity={0.8} onPress={onPress}>
    <Text style={styles.qaEmoji}>{emoji}</Text>
    <Text style={styles.qaLabel}>{label}</Text>
  </TouchableOpacity>
);

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

  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.sm },
  txnCount: { ...typography.small, color: colors.textSecondary, fontWeight: '400' },
  accountsRow: { paddingVertical: spacing.xs, paddingRight: spacing.lg },

  // Quick actions
  quickActions: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    justifyContent: 'space-between',
    ...shadows.card,
  },
  qa: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  qaEmoji: { fontSize: 22 },
  qaLabel: { ...typography.tiny, color: colors.textSecondary, marginTop: 4, fontWeight: '600' },

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
