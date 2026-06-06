// =============================================================================
// AccountDetailsScreen — uniform ledger view for a single bank/debit account or
// credit card.
//
// Layout (top → bottom):
//   1. Lightweight top nav header  — back arrow (left) + centered title.
//   2. Premium hardware card hero  — native-styled, bank-branded card face
//                                    (no image assets): bank top-left, network
//                                    top-right, masked number near the bottom.
//   3. Account summary surface     — dynamic balance label + value.
//   4. Divider + ledger feed       — transactions filtered to this account.
//
// All visual values come from the active theme palette (useTheme) and the
// static spacing/radius token scales. NOTE: this app's useTheme() returns a
// FLAT palette (theme.textPrimary, theme.card, theme.divider, …) — there is no
// `theme.colors.*` namespace — so the spec's surface/border tokens map to
// card/divider here.
// =============================================================================

import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { spacing, radius } from '../constants/theme';
import { ACCOUNT_TYPES } from '../constants/categories';
import TransactionItemRaw from '../components/TransactionItem';
import EmptyState from '../components/EmptyState';

// TransactionItem is plain JS; only `txn` is required at runtime (the row's tap
// handlers are optional). Alias it to a precise type for this screen.
const TransactionItem = TransactionItemRaw as React.ComponentType<{ txn: Txn }>;

// ── Types ────────────────────────────────────────────────────────────────────

type Account = {
  id: string;
  type: string;
  name?: string;
  mask?: string;
  bankName?: string;
  /** Card network (RuPay / Visa / Mastercard). Optional — not always captured. */
  network?: string;
  balance: number;
  color?: string;
  ccPaymentsTracked?: boolean;
};

type Txn = {
  id: string;
  accountId?: string;
  accountType?: string;
  accountMask?: string;
  isIgnored?: boolean;
  createdAt: string | number;
  [key: string]: unknown;
};

interface Props {
  navigation: { goBack: () => void; addListener: (e: string, cb: () => void) => () => void };
  route: { params?: { accountId?: string } };
}

// ── Bank-branding palettes (gradient pairs) ──────────────────────────────────
// Solid-feel gradients tuned to common Indian bank colours. Falls back to the
// account's own colour, then a deterministic premium palette keyed off the id.

const BANK_GRADIENTS: Record<string, [string, string]> = {
  ICICI: ['#9E2A1B', '#D4502E'], // terracotta red
  HDFC: ['#0B4DA2', '#1E66C7'],
  SBI: ['#15489B', '#2E73D1'],
  AXIS: ['#7A1F2B', '#A8324A'],
  KOTAK: ['#9A1B2F', '#C8324A'],
  IDFC: ['#7A1B5C', '#A83289'],
  PNB: ['#0E5B4A', '#138A6E'],
  YES: ['#0C3C8C', '#1E5FD0'],
  RBL: ['#5B2A86', '#8047C2'],
  INDIAN: ['#0E5B4A', '#138A6E'],
};

const FALLBACK_PALETTES: [string, string][] = [
  ['#1F1147', '#5B247A'], // midnight violet
  ['#0F2027', '#2C5364'], // deep teal
  ['#061236', '#0D2E6E'], // sapphire navy
  ['#0A1F11', '#153A28'], // midnight forest
  ['#130F08', '#2D2010'], // midnight gold
  ['#0E1020', '#1A2040'], // onyx steel
];

const TYPE_SUBTITLE: Record<string, string> = {
  [ACCOUNT_TYPES.BANK]: 'Savings Account',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'Credit Card',
  [ACCOUNT_TYPES.DEBIT_CARD]: 'Debit Card',
  [ACCOUNT_TYPES.WALLET]: 'Wallet',
  [ACCOUNT_TYPES.CASH]: 'Cash',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const hashIndex = (seed: string, mod: number): number => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
};

const heroGradient = (account: Account): [string, string] => {
  const key = (account.bankName || account.name || '').toUpperCase();
  const matched = Object.keys(BANK_GRADIENTS).find((bank) => key.includes(bank));
  if (matched) return BANK_GRADIENTS[matched];
  if (account.color) return [account.color, account.color];
  return FALLBACK_PALETTES[hashIndex(account.id || key, FALLBACK_PALETTES.length)];
};

const deriveBankName = (account: Account): string => {
  if (account.bankName) return account.bankName.toUpperCase();
  if (account.name?.includes('··')) {
    const head = account.name.split('··')[0].trim();
    if (head) return head.toUpperCase();
  }
  return (account.name || TYPE_SUBTITLE[account.type] || 'ACCOUNT').toUpperCase();
};

const last4 = (account: Account): string => {
  const digits = (account.mask || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : '••••';
};

// Currency with paise (e.g. ₹16,748.65). The shared formatCurrency() rounds to
// whole rupees, so we format locally for the precise summary figure.
const formatMoney = (value: number): string => {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `₹${n.toFixed(2)}`;
  }
};

// ── Component ────────────────────────────────────────────────────────────────

const AccountDetailsScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const accountId = route?.params?.accountId;

  const accounts = useEPurseStore((s: any) => s.accounts) as Account[];
  const transactions = useEPurseStore((s: any) => s.transactions) as Txn[];
  const userName = useEPurseStore((s: any) => s.userName) as string;

  const account = useMemo(
    () => accounts.find((a) => a.id === accountId),
    [accounts, accountId],
  );

  // Keep the status bar legible over the light screen surface.
  useEffect(() => {
    const apply = () => {
      StatusBar.setBarStyle('dark-content');
      if (Platform.OS === 'android') StatusBar.setBackgroundColor(theme.background);
    };
    apply();
    const unsub = navigation.addListener('focus', apply);
    return unsub;
  }, [navigation, theme.background]);

  // Transactions for THIS account only. Prefer the direct accountId link; fall
  // back to type + mask for legacy rows that predate stable account ids.
  const ledger = useMemo(() => {
    if (!account) return [];
    return transactions
      .filter((t) => {
        if (t.isIgnored) return false;
        if (t.accountId) return t.accountId === account.id;
        if (account.mask && t.accountMask) {
          return t.accountMask === account.mask && t.accountType === account.type;
        }
        return false;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }, [transactions, account]);

  // ── Top navigation header (shared by all states) ─────────────────────────
  const renderHeader = () => (
    <View style={styles.navBar}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.navBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={22} color={theme.textPrimary} />
      </TouchableOpacity>
      <Text style={[styles.navTitle, { color: theme.textPrimary }]}>Account Details</Text>
      <View style={styles.navBtn} />
    </View>
  );

  // ── Guard: account missing (e.g. deleted) ────────────────────────────────
  if (!account) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        {renderHeader()}
        <EmptyState
          emoji="💳"
          title="Account not found"
          subtitle="This account may have been removed."
          style={styles.missingState}
        />
      </SafeAreaView>
    );
  }

  const isCreditCard = account.type === ACCOUNT_TYPES.CREDIT_CARD;
  const rawBalance = account.balance ?? 0;
  const summaryLabel = isCreditCard ? 'Total Outstanding' : 'Available Balance';
  const summaryValue = isCreditCard ? Math.abs(rawBalance) : rawBalance;
  const summaryColor =
    isCreditCard && Math.abs(rawBalance) > 0
      ? theme.danger
      : rawBalance < 0
        ? theme.danger
        : theme.textPrimary;

  const [gradStart, gradEnd] = heroGradient(account);
  const networkLabel = account.network || TYPE_SUBTITLE[account.type] || '';

  // ── Hero + summary + divider live in the list header so the whole screen
  //    scrolls as one performant FlatList. ──────────────────────────────────
  const ListHeader = (
    <View style={styles.body}>
      {/* 2 ── Premium hardware card hero */}
      <LinearGradient
        colors={[gradStart, gradEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <View style={styles.cardTopRow}>
          <Text style={styles.cardBank} numberOfLines={1}>
            {deriveBankName(account)}
          </Text>
          {networkLabel ? (
            <View style={styles.networkBadge}>
              <Text style={styles.networkText}>{networkLabel}</Text>
            </View>
          ) : null}
        </View>

        {/* EMV chip — pure native styling, sells the "hardware" feel */}
        <View style={styles.chip}>
          <View style={styles.chipLine} />
          <View style={styles.chipLine} />
        </View>

        <View style={styles.cardBottom}>
          <Text style={styles.cardNumber}>{`••••  ${last4(account)}`}</Text>
          {userName ? (
            <Text style={styles.cardHolder} numberOfLines={1}>
              {userName.toUpperCase()}
            </Text>
          ) : null}
        </View>
      </LinearGradient>

      {/* 3 ── Account summary surface */}
      <View
        style={[
          styles.summaryCard,
          { backgroundColor: theme.card, borderColor: theme.divider },
        ]}
      >
        <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
          {summaryLabel}
        </Text>
        <Text style={[styles.summaryValue, { color: summaryColor }]}>
          {formatMoney(summaryValue)}
        </Text>
      </View>

      {/* 4 ── Separation divider */}
      <View style={[styles.divider, { backgroundColor: theme.divider }]} />

      <Text style={[styles.ledgerTitle, { color: theme.textPrimary }]}>
        Transactions
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      {renderHeader()}

      <FlatList
        data={ledger}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransactionItem txn={item} />}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
          <EmptyState
            compact
            emoji="🧾"
            title="No transactions yet"
            subtitle="Spending and credits on this account will appear here."
            style={styles.emptyLedger}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        windowSize={9}
      />
    </SafeAreaView>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // 1 ── Top nav header
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  navBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },

  // Scroll body
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },
  body: { paddingTop: spacing.sm },

  // 2 ── Hero card
  card: {
    width: '100%',
    aspectRatio: 1.586, // standard ID-1 bank-card ratio
    borderRadius: 16,
    padding: spacing.lg,
    justifyContent: 'space-between',
    // soft elevation so the card lifts off the surface
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBank: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  networkBadge: {
    backgroundColor: '#FFFFFF26',
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: spacing.sm,
  },
  networkText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  chip: {
    width: 40,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#F2D38A',
    paddingVertical: 6,
    paddingHorizontal: 5,
    justifyContent: 'space-between',
  },
  chipLine: { height: 2, borderRadius: 1, backgroundColor: '#00000022' },
  cardBottom: {},
  cardNumber: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  cardHolder: {
    color: '#FFFFFFCC',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: 6,
  },

  // 3 ── Summary surface
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryLabel: { fontSize: 14, fontWeight: '500' },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  // 4 ── Divider + ledger
  divider: { height: 1, marginVertical: 16 },
  ledgerTitle: { fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },

  emptyLedger: { marginTop: spacing.lg },
  missingState: { marginTop: spacing.xxl },
});

export default AccountDetailsScreen;
