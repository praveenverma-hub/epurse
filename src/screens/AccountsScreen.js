// =============================================================================
// AccountsScreen — dedicated Accounts tab.
//
// Layout:
//   • Gradient header with total balance + eye toggle + add button
//   • CRED-style horizontal card scroll (same cards as before)
//   • Plain account list below for quick balance scanning
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useIsFocused } from '@react-navigation/native';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatCompact } from '../utils/format';
import { ACCOUNT_TYPES } from '../constants/categories';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';

import AccountCard    from '../components/AccountCard';
import AddAccountModal from '../components/AddAccountModal';
import CenterModal    from '../components/CenterModal';

const TYPE_ORDER = {
  [ACCOUNT_TYPES.CASH]:        0,
  [ACCOUNT_TYPES.WALLET]:      1,
  [ACCOUNT_TYPES.CREDIT_CARD]: 2,
  [ACCOUNT_TYPES.BANK]:        3,
};

const TYPE_EMOJI = { bank: '🏦', credit_card: '💳', wallet: '👛', cash: '💵' };
const TYPE_LABEL = { bank: 'Bank', credit_card: 'Credit Card', wallet: 'Wallet', cash: 'Cash' };

export default function AccountsScreen({ navigation }) {
  const theme        = useTheme();
  const isFocused    = useIsFocused();
  const accounts     = useEPurseStore((s) => s.accounts);
  const userName     = useEPurseStore((s) => s.userName);
  const addAccount   = useEPurseStore((s) => s.addAccount);
  const deleteAccount = useEPurseStore((s) => s.deleteAccount);

  const [balancesVisible,    setBalancesVisible]    = useState(false);
  const [addAccountVisible,  setAddAccountVisible]  = useState(false);
  const [confirm,            setConfirm]            = useState(null);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)),
    [accounts],
  );

  const totalBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0),
    [accounts],
  );

  const handleToggleBalances = async () => {
    if (balancesVisible) { setBalancesVisible(false); return; }
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled  = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify to reveal balances',
          cancelLabel:   'Cancel',
          fallbackLabel: 'Use PIN',
          disableDeviceFallback: false,
        });
        if (!result.success) return;
      }
    } catch (_) {}
    setBalancesVisible(true);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* ── Gradient header ── */}
      <LinearGradient
        colors={[theme.gradientStart, theme.gradientEnd]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerLabel}>Total Balance</Text>
              <Text style={styles.headerBalance}>
                {balancesVisible ? formatCompact(totalBalance) : '₹ ••••••'}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.iconBtn} onPress={handleToggleBalances} activeOpacity={0.7}>
                <Ionicons name={balancesVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setAddAccountVisible(true)} activeOpacity={0.7}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* ── Scrollable body ── */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* CRED-style cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cardsScroll}
          contentContainerStyle={styles.cardsRow}
          snapToInterval={296}
          decelerationRate="fast"
        >
          {sortedAccounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              active={isFocused}
              showBalance={a.type !== ACCOUNT_TYPES.BANK || balancesVisible}
              holderName={userName}
              // onPress={() => navigation.navigate('Transactions', { accountId: a.id })}
              onDelete={() =>
                setConfirm({
                  title: 'Remove account?',
                  message: `Remove "${a.name}"?\n\nTransactions will be kept but unlinked.`,
                  primaryText: 'Remove',
                  destructive: true,
                  secondaryText: 'Cancel',
                  onSecondary: () => setConfirm(null),
                  onConfirm: () => { deleteAccount(a.id); setConfirm(null); },
                })
              }
            />
          ))}

          {/* Add-account card removed — use the + button in the header */}
        </ScrollView>

        {/* Anchor-adjustment hint */}
        {sortedAccounts.length > 0 ? (
          <View style={styles.flipHint}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.flipHintText}>
              Tap the chip or balance on any card to adjust its balance.
            </Text>
          </View>
        ) : null}

        {/* Flat account list */}
        <Text style={styles.listTitle}>All accounts</Text>
        {sortedAccounts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>💳</Text>
            <Text style={styles.emptyTitle}>No accounts yet</Text>
            <Text style={styles.emptyHelp}>Tap + above to add your first account.</Text>
          </View>
        ) : (
          sortedAccounts.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={styles.listRow}
              onPress={() => navigation.navigate('Transactions', { accountId: a.id })}
              activeOpacity={0.7}
            >
              <View style={styles.listIcon}>
                <Text style={{ fontSize: 20 }}>{TYPE_EMOJI[a.type] ?? '💳'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listName}>{a.name}</Text>
                <Text style={styles.listType}>{TYPE_LABEL[a.type] ?? a.type}</Text>
              </View>
              <Text style={[styles.listBalance, { color: (a.balance ?? 0) < 0 ? colors.danger : colors.textPrimary }]}>
                {(a.type !== ACCOUNT_TYPES.BANK || balancesVisible)
                  ? formatCurrency(a.balance ?? 0)
                  : '••••'}
              </Text>
            </TouchableOpacity>
          ))
        )}

        <View style={{ height: TAB_BAR_HEIGHT + 40 }} />
      </ScrollView>

      <AddAccountModal
        visible={addAccountVisible}
        onClose={() => setAddAccountVisible(false)}
        onAdd={(acct) => addAccount(acct)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  headerLabel:   { color: '#FFFFFFCC', ...typography.small },
  headerBalance: { color: '#fff', fontSize: 30, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnText: { color: '#fff', fontSize: 16 },

  body:        { flex: 1, marginTop: -spacing.lg },
  bodyContent: { paddingTop: spacing.lg, paddingHorizontal: spacing.lg },

  cardsScroll: { marginHorizontal: -spacing.lg },
  cardsRow:    {
    paddingTop: 14,
    paddingBottom: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.lg,
  },
  addCardPlaceholder: {
    width: 280, height: 170,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    marginRight: spacing.md,
    gap: spacing.xs,
  },
  addCardPlus:  { fontSize: 32, color: colors.textSecondary, fontWeight: '300', lineHeight: 36 },
  addCardLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },

  flipHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    alignSelf: 'center',
    marginTop: spacing.xs,
    ...shadows.card,
  },
  flipHintText: {
    ...typography.tiny,
    color: colors.textSecondary,
    fontWeight: '500',
    flexShrink: 1,
  },

  listTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
    ...shadows.card,
  },
  listIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  listName:    { ...typography.bodyBold, color: colors.textPrimary },
  listType:    { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  listBalance: { ...typography.bodyBold, color: colors.textPrimary },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadows.card,
  },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.sm },
  emptyHelp:  { ...typography.small, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
});
