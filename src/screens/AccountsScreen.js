// =============================================================================
// AccountsScreen — dedicated Accounts tab.
//
// Layout:
//   • Gradient header with total balance + eye toggle + add button
//   • CRED-style horizontal card scroll (same cards as before)
//   • Plain account list below for quick balance scanning
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState, View, Text, StyleSheet, ScrollView, TouchableOpacity, StatusBar,
  TextInput, Keyboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useIsFocused } from '@react-navigation/native';

import {
  useEPurseStore,
  selectEPurseNetWorth,
  selectShouldShowAnchorNudge,
} from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import { ACCOUNT_TYPES } from '../constants/categories';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';

import AccountCard    from '../components/AccountCard';
import AddAccountModal from '../components/AddAccountModal';
import CenterModal    from '../components/CenterModal';

const TYPE_ORDER = {
  [ACCOUNT_TYPES.CASH]:        0,
  [ACCOUNT_TYPES.WALLET]:      1,
  [ACCOUNT_TYPES.DEBIT_CARD]:  2,
  [ACCOUNT_TYPES.CREDIT_CARD]: 3,
  [ACCOUNT_TYPES.BANK]:        4,
};

const TYPE_EMOJI = {
  [ACCOUNT_TYPES.BANK]:        '🏦',
  [ACCOUNT_TYPES.CREDIT_CARD]: '💳',
  [ACCOUNT_TYPES.DEBIT_CARD]:  '🏧',
  [ACCOUNT_TYPES.WALLET]:      '👛',
  [ACCOUNT_TYPES.CASH]:        '💵',
};
const TYPE_LABEL = {
  [ACCOUNT_TYPES.BANK]:        'Bank',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'Credit Card',
  [ACCOUNT_TYPES.DEBIT_CARD]:  'Debit Card',
  [ACCOUNT_TYPES.WALLET]:      'Wallet',
  [ACCOUNT_TYPES.CASH]:        'Cash',
};

// Balances reflecting real bank money are gated behind biometric reveal.
const BALANCE_SENSITIVE = new Set([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.DEBIT_CARD]);

export default function AccountsScreen({ navigation }) {
  const theme        = useTheme();
  const isFocused    = useIsFocused();
  const accounts     = useEPurseStore((s) => s.accounts);
  const userName     = useEPurseStore((s) => s.userName);
  const addAccount   = useEPurseStore((s) => s.addAccount);
  const deleteAccount = useEPurseStore((s) => s.deleteAccount);

  const userPhones     = useEPurseStore((s) => s.userPhones);
  const addUserPhone   = useEPurseStore((s) => s.addUserPhone);
  const removeUserPhone = useEPurseStore((s) => s.removeUserPhone);

  const [balancesVisible,    setBalancesVisible]    = useState(false);
  const [addAccountVisible,  setAddAccountVisible]  = useState(false);
  const [confirm,            setConfirm]            = useState(null);
  const [phoneInput,         setPhoneInput]         = useState('');

  const handleAddPhone = () => {
    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 4) return;
    addUserPhone(digits);
    setPhoneInput('');
    Keyboard.dismiss();
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setBalancesVisible(false);
    });
    return () => sub.remove();
  }, []);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)),
    [accounts],
  );

  // Net Worth — your real money across all accounts. Includes private
  // transactions (they reflect actual money movement). See selectEPurseNetWorth
  // in the store for the exclusion rules.
  const totalBalance = useEPurseStore(selectEPurseNetWorth);

  const showAnchorNudge   = useEPurseStore(selectShouldShowAnchorNudge);
  const dismissAnchorNudge = useEPurseStore((s) => s.dismissAnchorNudge);

  const handleToggleBalances = async () => {
    if (balancesVisible) { setBalancesVisible(false); return; }
    try {
      const secLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // Skip auth only if the device has absolutely no security set up.
      // SecurityLevel.NONE (0) = no PIN, no biometrics — safe to allow through.
      // SECRET (1) = PIN/pattern only → prompts device lock.
      // BIOMETRIC_WEAK/STRONG (2/3) → prompts biometrics with PIN fallback.
      if (secLevel > LocalAuthentication.SecurityLevel.NONE) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify to reveal balances',
          cancelLabel:   'Cancel',
          fallbackLabel: 'Use Passcode',
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
              <Text style={styles.headerLabel}>Net Worth</Text>
              <Text style={styles.headerBalance}>
                {balancesVisible ? formatCurrency(totalBalance) : '₹ ••••••'}
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
        {/* First-time anchor nudge — auto-hides once any account is anchored
            or once the user dismisses it. */}
        {showAnchorNudge ? (
          <View style={[styles.nudgeCard, { backgroundColor: theme.card, borderColor: theme.primary + '33' }]}>
            <View style={[styles.nudgeIcon, { backgroundColor: theme.primary + '1A' }]}>
              <Ionicons name="wallet-outline" size={20} color={theme.primary} />
            </View>
            <View style={styles.nudgeBody}>
              <Text style={[styles.nudgeTitle, { color: colors.textPrimary }]}>
                Set your real balances
              </Text>
              <Text style={[styles.nudgeBody2, { color: colors.textSecondary }]}>
                Tap any card below, flip it, and enter the actual balance from your
                bank. Net Worth becomes accurate from that moment on.
              </Text>
            </View>
            <TouchableOpacity
              onPress={dismissAnchorNudge}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* CRED-style cards — hidden when no accounts */}
        {sortedAccounts.length > 0 ? (
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
                showBalance={!BALANCE_SENSITIVE.has(a.type) || balancesVisible}
                holderName={userName}
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
          </ScrollView>
        ) : null}

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
              onPress={() => navigation.navigate('AccountDetails', { accountId: a.id })}
              activeOpacity={0.7}
            >
              <View style={styles.listIcon}>
                <Text style={{ fontSize: 20 }}>{TYPE_EMOJI[a.type] ?? '💳'}</Text>
              </View>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.listName} numberOfLines={1} ellipsizeMode="tail">{a.name}</Text>
                <Text style={styles.listType} numberOfLines={1}>{TYPE_LABEL[a.type] ?? a.type}</Text>
              </View>
              <Text
                style={[styles.listBalance, { color: (a.balance ?? 0) < 0 ? colors.danger : colors.textPrimary }]}
                numberOfLines={1}
              >
                {(!BALANCE_SENSITIVE.has(a.type) || balancesVisible)
                  ? formatCurrency(Math.abs(a.balance ?? 0))
                  : '••••'}
              </Text>
            </TouchableOpacity>
          ))
        )}

        {/* Linked mobile numbers — powers self-transfer detection */}
        <Text style={styles.listTitle}>Your mobile numbers</Text>
        <View style={styles.phoneCard}>
          <Text style={styles.phoneHelp}>
            Add the mobile number(s) linked to your bank accounts. When money moves
            to your own account or number, we'll tag it as a self transfer and keep
            it out of your spending and income totals.
          </Text>

          {userPhones?.length > 0 ? (
            <View style={styles.phoneChips}>
              {userPhones.map((p) => (
                <View key={p} style={styles.phoneChip}>
                  <Text style={styles.phoneChipText}>{p}</Text>
                  <TouchableOpacity
                    onPress={() => removeUserPhone(p)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${p}`}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.phoneInputRow}>
            <TextInput
              style={styles.phoneInput}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="e.g. 9876543210"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              returnKeyType="done"
              onSubmitEditing={handleAddPhone}
              maxLength={15}
            />
            <TouchableOpacity
              style={[styles.phoneAddBtn, phoneInput.replace(/\D/g, '').length < 4 && styles.phoneAddBtnDisabled]}
              onPress={handleAddPhone}
              disabled={phoneInput.replace(/\D/g, '').length < 4}
              activeOpacity={0.8}
            >
              <Text style={styles.phoneAddText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

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

  nudgeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    ...shadows.card,
  },
  nudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeBody: { flex: 1 },
  nudgeTitle: {
    ...typography.bodyBold,
    fontWeight: '700',
    marginBottom: 2,
  },
  nudgeBody2: {
    ...typography.small,
    lineHeight: 18,
  },

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

  phoneCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  phoneHelp: {
    ...typography.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  phoneChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  phoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  phoneChipText: { ...typography.small, color: colors.textPrimary, fontWeight: '600' },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: colors.textPrimary,
  },
  phoneAddBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneAddBtnDisabled: { opacity: 0.4 },
  phoneAddText: { color: colors.card, ...typography.bodyBold, fontWeight: '700' },

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
