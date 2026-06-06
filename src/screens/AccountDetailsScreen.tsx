// =============================================================================
// AccountDetailsScreen — premium "card-in-slot" ledger view for a single
// bank / debit account or credit card, with biometric step-up + background
// lock for sensitive (real-money) accounts.
//
// Layout (top → bottom):
//   1. Lightweight top nav header  — back arrow (left) + centered title.
//   2. "Card slot" hero            — bank-branded card whose bottom third slips
//                                    behind a foreground page surface (z-index +
//                                    soft top shadow) so it reads as nestled in
//                                    a secure sleeve.
//   3. Matte summary surface       — calm charcoal balance figure, no alarm tones.
//   4. Divider + ledger feed       — transactions filtered to this account.
//
// Security:
//   • Biometric step-up on mount for sensitive accounts (Bank / Debit Card).
//   • Re-lock the instant the app leaves the foreground; re-prompt on return.
//
// NOTE: this app's useTheme() returns a FLAT palette (theme.textPrimary,
// theme.background, theme.card, theme.divider, theme.gradientGreenStart …) —
// there is no `theme.colors.*` namespace — so the spec's textPrimary/background
// map directly onto those flat keys.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Platform,
  AppState,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';

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

// ── Security: which account types carry real money worth gating ──────────────
// Mirrors AccountCard's BALANCE_SENSITIVE_TYPES — Bank + Debit Card balances are
// the figures hidden when the app is backgrounded elsewhere in the app.
const SENSITIVE_TYPES = new Set<string>([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.DEBIT_CARD]);

// ── Visual constants ─────────────────────────────────────────────────────────
// How far the bottom of the card tucks behind the foreground sleeve (~1/3 of the
// card height for a standard ID-1 ratio card at typical phone widths).
const CARD_PEEK = 60;

// Bank-branding gradients. Indian Bank intentionally pulls the theme's emerald
// token (handled in heroGradient) so it matches the dashboard colorway exactly.
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

const heroGradient = (account: Account, theme: any): [string, string] => {
  const key = (account.bankName || account.name || '').toUpperCase();
  // Indian Bank → exact emerald token from the active theme palette.
  if (key.includes('INDIAN')) return [theme.gradientGreenStart, theme.gradientGreenEnd];
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

  const isSensitive = !!account && SENSITIVE_TYPES.has(account.type);

  // ── Biometric gate ────────────────────────────────────────────────────────
  // Non-sensitive accounts are open immediately; sensitive ones start locked.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!isSensitive);
  const [authFailed, setAuthFailed] = useState(false);
  // Guards against the iOS biometric overlay (which briefly flips AppState to
  // 'inactive') re-locking and re-prompting in a loop while a prompt is open.
  const authInFlight = useRef(false);

  const authenticate = useCallback(async () => {
    if (!isSensitive) {
      setIsAuthenticated(true);
      return;
    }
    if (authInFlight.current) return;
    authInFlight.current = true;
    setAuthFailed(false);
    try {
      const secLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // No biometrics / passcode enrolled — we can't step up, so don't trap the
      // user out of their own ledger (consistent with AccountCard's behaviour).
      if (secLevel <= LocalAuthentication.SecurityLevel.NONE) {
        setIsAuthenticated(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Verify to view account details',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });
      setIsAuthenticated(result.success);
      setAuthFailed(!result.success);
    } catch {
      setIsAuthenticated(false);
      setAuthFailed(true);
    } finally {
      authInFlight.current = false;
    }
  }, [isSensitive]);

  // Prompt once on mount for sensitive accounts.
  useEffect(() => {
    if (isSensitive) authenticate();
    // Mount-only: authenticate is stable for a given account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Background lifecycle: re-lock on leaving foreground, re-prompt on return.
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (authInFlight.current) return; // ignore the biometric-overlay blip
      if (next === 'background' || next === 'inactive') {
        // Trip the lock the moment we leave 'active'.
        if (isSensitive) setIsAuthenticated(false);
      } else if (next === 'active' && prev !== 'active') {
        // Returning to the foreground → re-verify before revealing figures.
        if (isSensitive) authenticate();
      }
    });
    return () => sub.remove();
  }, [isSensitive, authenticate]);

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

  // ── Locked state: freeze the layout tree behind the biometric gate ────────
  if (isSensitive && !isAuthenticated) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        {renderHeader()}
        <View style={styles.lockWrap}>
          <View style={[styles.lockBadge, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Ionicons name="lock-closed" size={30} color={theme.textPrimary} />
          </View>
          <Text style={[styles.lockTitle, { color: theme.textPrimary }]}>
            Locked for your security
          </Text>
          <Text style={[styles.lockSub, { color: theme.textSecondary }]}>
            {authFailed
              ? 'Verification was cancelled or failed. Try again to view this account.'
              : 'Verify your identity to view this account’s balance and ledger.'}
          </Text>
          <TouchableOpacity
            style={[styles.unlockBtn, { backgroundColor: theme.textPrimary }]}
            onPress={authenticate}
            activeOpacity={0.85}
          >
            <Ionicons name="finger-print" size={18} color={theme.card} />
            <Text style={[styles.unlockText, { color: theme.card }]}>Unlock</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isCreditCard = account.type === ACCOUNT_TYPES.CREDIT_CARD;
  const rawBalance = account.balance ?? 0;
  const summaryLabel = isCreditCard ? 'Total Outstanding' : 'Available Balance';
  const summaryValue = isCreditCard ? Math.abs(rawBalance) : rawBalance;

  const [gradStart, gradEnd] = heroGradient(account, theme);
  const networkLabel = account.network || TYPE_SUBTITLE[account.type] || '';

  // ── Layered header: card (LAYER 1) tucking behind the foreground sleeve
  //    (LAYER 2). The sleeve's negative-offset top shadow casts onto the card
  //    bottom, selling the "embedded in a slot" depth illusion. ──────────────
  const ListHeader = (
    <View style={styles.heroZone}>
      {/* LAYER 1 — the bank card, bottom third slipping downward */}
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

      {/* LAYER 2 — foreground sleeve. Higher z-index + top shadow paints over
          the card's lower third. */}
      <View style={[styles.foreground, { backgroundColor: theme.background }]}>
        {/* The slot seam */}
        <View style={[styles.slotLine, { backgroundColor: theme.divider }]} />

        {/* 3 ── Matte, calm summary surface (no alarm colours) */}
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: theme.card, borderColor: theme.divider },
          ]}
        >
          <Text style={[styles.summaryLabel, { color: theme.textSecondary }]}>
            {summaryLabel}
          </Text>
          <Text style={[styles.summaryValue, { color: theme.textPrimary }]}>
            {formatMoney(summaryValue)}
          </Text>
        </View>

        {/* 4 ── Separation divider */}
        <View style={[styles.divider, { backgroundColor: theme.divider }]} />

        <Text style={[styles.ledgerTitle, { color: theme.textPrimary }]}>
          Transactions
        </Text>
      </View>
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
  listContent: { paddingBottom: spacing.xxl * 2 },

  // 2 ── Card-slot hero zone
  heroZone: {
    // Children stack with explicit z-index; allow the card shadow to bleed.
    paddingTop: spacing.sm,
  },
  // LAYER 1 — bank card
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: -CARD_PEEK, // bottom ~1/3 slips beneath the foreground sleeve
    aspectRatio: 1.586, // standard ID-1 bank-card ratio
    borderRadius: 16,
    padding: spacing.lg,
    justifyContent: 'space-between',
    zIndex: 1,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
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

  // LAYER 2 — foreground sleeve that masks the card's lower third
  foreground: {
    zIndex: 2,
    elevation: 12, // ensure it paints over the card on Android too
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: CARD_PEEK + spacing.sm, // clear the tucked card area
    paddingHorizontal: spacing.lg,
    // Soft top shadow → reads as the lip of a card sleeve.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  slotLine: {
    height: 4,
    width: 48,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.lg,
    opacity: 0.9,
  },

  // 3 ── Summary surface (matte / calm)
  summaryCard: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
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

  // Locked state
  lockWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  lockBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  lockTitle: { fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  lockSub: {
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  unlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  unlockText: { fontSize: 15, fontWeight: '700' },
});

export default AccountDetailsScreen;
