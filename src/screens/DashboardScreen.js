// =============================================================================
// DashboardScreen
// -----------------------------------------------------------------------------
// Layout (top → bottom):
//   1. Gradient header  — greeting + total ePurse balance + month spend pill
//   2. Account chips    — horizontal scroller (Bank / CC / Wallet / Cash)
//   3. Lent / Borrowed  — two side-by-side gradient widgets
//   4. Quick actions    — Add txn / Simulate SMS / Lend / Borrow
//   5. Recent transactions — boxed white cards on grey background
//   6. FAB              — opens manual-entry modal
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  RefreshControl,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import { SAMPLE_MESSAGES } from '../utils/messageParser';

import LentBorrowedWidget from '../components/LentBorrowedWidget';
import TransactionItem from '../components/TransactionItem';
import AccountChip from '../components/AccountChip';
import FAB from '../components/FAB';

const DashboardScreen = ({ navigation }) => {
  const accounts = useEPurseStore((s) => s.accounts);
  const recent = useEPurseStore((s) => s.getRecentTransactions(6));
  const total = useEPurseStore((s) => s.getTotalBalance());
  const lent = useEPurseStore((s) => s.getTotalLent());
  const borrowed = useEPurseStore((s) => s.getTotalBorrowed());
  const monthSpend = useEPurseStore((s) => s.getMonthlySpend());
  const monthIncome = useEPurseStore((s) => s.getMonthlyIncome());
  const ingestMessage = useEPurseStore((s) => s.ingestMessage);

  const [refreshing, setRefreshing] = useState(false);

  // Demo: pretend an SMS just arrived
  const onSimulateSMS = useCallback(() => {
    const msg = SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)];
    const parsed = ingestMessage(msg, { receivedAt: new Date().toISOString() });
    if (parsed) {
      Alert.alert(
        'SMS auto-detected',
        `${parsed.merchant}\n${formatCurrency(parsed.amount)} · ${parsed.type.toUpperCase()}`
      );
    }
  }, [ingestMessage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Could trigger a re-sync here. For now just wait a tick.
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ---------- Gradient header ---------- */}
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.greeting}>{greeting}</Text>
              <Text style={styles.userName}>Welcome back 👋</Text>
            </View>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => navigation.navigate('Categories')}
            >
              <Text style={styles.iconText}>⚙</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.balanceBlock}>
            <Text style={styles.balanceLabel}>Total ePurse Balance</Text>
            <Text style={styles.balanceValue}>{formatCurrency(total)}</Text>

            <View style={styles.statsRow}>
              <View style={styles.statPill}>
                <Text style={styles.statLabel}>This month spent</Text>
                <Text style={styles.statValue}>{formatCurrency(monthSpend)}</Text>
              </View>
              <View style={styles.statPill}>
                <Text style={styles.statLabel}>This month income</Text>
                <Text style={styles.statValue}>{formatCurrency(monthIncome)}</Text>
              </View>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* ---------- Body (scrollable) ---------- */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Accounts chips */}
        <Text style={styles.sectionTitle}>Your accounts</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.accountsRow}
        >
          {accounts.map((a) => (
            <AccountChip key={a.id} account={a} />
          ))}
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
          <QuickAction emoji="💸" label="Add expense" onPress={() => navigation.navigate('AddTransaction')} />
          <QuickAction emoji="📩" label="Simulate SMS" onPress={onSimulateSMS} />
          <QuickAction emoji="📊" label="Analytics" onPress={() => navigation.navigate('Analytics')} />
          <QuickAction emoji="📂" label="All txns" onPress={() => navigation.navigate('Transactions')} />
        </View>

        {/* Recent transactions */}
        <View style={styles.recentHeader}>
          <Text style={styles.sectionTitle}>Recent transactions</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Transactions')}>
            <Text style={styles.viewAll}>View all</Text>
          </TouchableOpacity>
        </View>

        {recent.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>👀</Text>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyHelp}>
              Tap the + button to add a manual entry, or simulate an SMS to see auto-categorisation.
            </Text>
          </View>
        ) : (
          recent.map((t) => (
            <TransactionItem
              key={t.id}
              txn={t}
              onPress={() => navigation.navigate('Transactions', { focusId: t.id })}
            />
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <FAB onPress={() => navigation.navigate('AddTransaction')} />
    </View>
  );
};

// ---- Quick action tile ------------------------------------------------------
const QuickAction = ({ emoji, label, onPress }) => (
  <TouchableOpacity style={styles.qa} activeOpacity={0.8} onPress={onPress}>
    <Text style={styles.qaEmoji}>{emoji}</Text>
    <Text style={styles.qaLabel}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  greeting: { color: '#FFFFFFCC', ...typography.small },
  userName: { color: '#fff', ...typography.h2, marginTop: 2 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF22',
  },
  iconText: { color: '#fff', fontSize: 20 },

  balanceBlock: { marginTop: spacing.xl },
  balanceLabel: { color: '#FFFFFFCC', ...typography.small },
  balanceValue: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
    marginTop: spacing.xs,
    letterSpacing: -0.5,
  },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
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
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

export default DashboardScreen;
