// =============================================================================
// AccountDetailsScreen — bank card ledger with biometric step-up + background lock.
//
// Layout hierarchy (strict, no overlapping regressions):
//   SafeAreaView
//     navBar            — back + centered title
//     cardStage         — card auto-sized, marginBottom: -64 pulls pocket up
//     pocketSheetWrap   — zIndex 5, flex: 1, upward shadow masks card bottom
//       FlatList
//         ListHeader    — summaryBox + "Transactions" title
//         rows          — TransactionItem per ledger entry
//
// The negative marginBottom on cardStage causes pocketSheetWrap to start 64 px
// inside the card's lower edge. pocketSheetWrap's zIndex 5 / elevation 10
// paints over that overlapping slice, creating the card-in-pocket depth effect
// with zero layout flow disruption to anything below it.
//
// Security: biometric step-up on mount; re-lock on background; re-prompt on return.
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
import { AccountAnchorBanner } from './OnboardingExperience';

// TransactionItem is plain JS; alias so tsc only requires the props this screen passes.
const TransactionItem = TransactionItemRaw as React.ComponentType<{ txn: Txn }>;

// ── Types ─────────────────────────────────────────────────────────────────────

type Account = {
  id: string;
  type: string;
  name?: string;
  mask?: string;
  bankName?: string;
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

// ── Security ──────────────────────────────────────────────────────────────────

// Mirrors AccountCard's BALANCE_SENSITIVE_TYPES — the account types whose
// balances are hidden when the app is backgrounded.
const SENSITIVE_TYPES = new Set<string>([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.DEBIT_CARD]);

// ── Visual constants ──────────────────────────────────────────────────────────

// Pixels of the card's bottom that tuck behind the pocket sheet.
const POCKET_OVERLAP = 64;

const BANK_GRADIENTS: Record<string, [string, string]> = {
  ICICI: ['#9E2A1B', '#D4502E'],
  HDFC:  ['#0B4DA2', '#1E66C7'],
  SBI:   ['#15489B', '#2E73D1'],
  AXIS:  ['#7A1F2B', '#A8324A'],
  KOTAK: ['#9A1B2F', '#C8324A'],
  IDFC:  ['#7A1B5C', '#A83289'],
  PNB:   ['#0E5B4A', '#138A6E'],
  YES:   ['#0C3C8C', '#1E5FD0'],
  RBL:   ['#5B2A86', '#8047C2'],
};

const FALLBACK_PALETTES: [string, string][] = [
  ['#1F1147', '#5B247A'],
  ['#0F2027', '#2C5364'],
  ['#061236', '#0D2E6E'],
  ['#0A1F11', '#153A28'],
  ['#130F08', '#2D2010'],
  ['#0E1020', '#1A2040'],
];

const TYPE_SUBTITLE: Record<string, string> = {
  [ACCOUNT_TYPES.BANK]:        'Savings Account',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'Credit Card',
  [ACCOUNT_TYPES.DEBIT_CARD]:  'Debit Card',
  [ACCOUNT_TYPES.WALLET]:      'Wallet',
  [ACCOUNT_TYPES.CASH]:        'Cash',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const hashIndex = (seed: string, mod: number): number => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
};

const heroGradient = (account: Account, theme: any): [string, string] => {
  const key = (account.bankName || account.name || '').toUpperCase();
  // Indian Bank → exact emerald token from the active theme palette.
  if (key.includes('INDIAN')) return [theme.gradientGreenStart, theme.gradientGreenEnd];
  const matched = Object.keys(BANK_GRADIENTS).find((b) => key.includes(b));
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

// 2-decimal paise formatter. The shared formatCurrency() rounds to whole rupees.
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

// ── Component ─────────────────────────────────────────────────────────────────

const AccountDetailsScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const accountId = route?.params?.accountId;

  const accounts    = useEPurseStore((s: any) => s.accounts)     as Account[];
  const transactions = useEPurseStore((s: any) => s.transactions) as Txn[];
  const userName    = useEPurseStore((s: any) => s.userName)      as string;

  const account = useMemo(
    () => accounts.find((a) => a.id === accountId),
    [accounts, accountId],
  );

  const isSensitive = !!account && SENSITIVE_TYPES.has(account.type);

  // ── Biometric gate ─────────────────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!isSensitive);
  const [authFailed, setAuthFailed]           = useState(false);
  // Guards the iOS biometric overlay blip (briefly flips AppState → 'inactive')
  // so the AppState listener does not re-lock and re-prompt while a prompt is open.
  const authInFlight = useRef(false);

  const authenticate = useCallback(async () => {
    if (!isSensitive) { setIsAuthenticated(true); return; }
    if (authInFlight.current) return;
    authInFlight.current = true;
    setAuthFailed(false);
    try {
      const secLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // No enrollment — don't trap unenrolled users (consistent with AccountCard).
      if (secLevel <= LocalAuthentication.SecurityLevel.NONE) {
        setIsAuthenticated(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage:          'Verify to view account details',
        cancelLabel:            'Cancel',
        fallbackLabel:          'Use Passcode',
        disableDeviceFallback:  false,
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isSensitive) authenticate(); }, []);

  // Re-lock on leaving foreground; re-prompt on return.
  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (authInFlight.current) return;
      if (next === 'background' || next === 'inactive') {
        if (isSensitive) setIsAuthenticated(false);
      } else if (next === 'active' && prev !== 'active') {
        if (isSensitive) authenticate();
      }
    });
    return () => sub.remove();
  }, [isSensitive, authenticate]);

  useEffect(() => {
    const apply = () => {
      StatusBar.setBarStyle('dark-content');
      if (Platform.OS === 'android') StatusBar.setBackgroundColor(theme.background);
    };
    apply();
    const unsub = navigation.addListener('focus', apply);
    return unsub;
  }, [navigation, theme.background]);

  // Transactions for this account only. Prefer direct accountId link; fall back
  // to type + mask for legacy rows that predate stable account ids.
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
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [transactions, account]);

  // ── Shared nav header ──────────────────────────────────────────────────────
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

  // ── Guard: account missing (e.g. deleted) ─────────────────────────────────
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

  // ── Locked state ───────────────────────────────────────────────────────────
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
              ? "Verification was cancelled or failed. Try again to view this account."
              : "Verify your identity to view this account's balance and ledger."}
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

  // ── Unlocked layout ────────────────────────────────────────────────────────
  const isCreditCard   = account.type === ACCOUNT_TYPES.CREDIT_CARD;
  const rawBalance     = account.balance ?? 0;
  const summaryLabel   = isCreditCard ? 'Total Outstanding' : 'Available Balance';
  const summaryValue   = isCreditCard ? Math.abs(rawBalance) : rawBalance;
  const [gradStart, gradEnd] = heroGradient(account, theme);
  const networkLabel   = account.network || TYPE_SUBTITLE[account.type] || '';

  // FlatList header: lives entirely inside the pocket sheet — no z-index tricks.
  const listHeaderComponent = (
    <View style={styles.pocketContent}>
      {/* First-visit nudge: prompt the user to anchor their live balance.
          Self-hides once the account is anchored or the toast is dismissed. */}
      <AccountAnchorBanner account={account as any} position="top" />
      <View style={styles.summaryBox}>
        <Text style={styles.summaryLabel}>{summaryLabel}</Text>
        <Text style={styles.summaryValue}>{formatMoney(summaryValue)}</Text>
      </View>
      <Text style={styles.sectionTitle}>Transactions</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>

      {/* 1. Nav header */}
      {renderHeader()}

      {/* 2. Card stage — auto-sizes to content; marginBottom: -POCKET_OVERLAP
              pulls the pocket sheet up so it overlaps the card's lower slice. */}
      <View style={styles.cardStage}>
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

          {/* EMV chip — pure native styling */}
          <View style={styles.chip}>
            <View style={styles.chipLine} />
            <View style={styles.chipLine} />
          </View>

          <View>
            <Text style={styles.cardNumber}>{`••••  ${last4(account)}`}</Text>
            {userName ? (
              <Text style={styles.cardHolder} numberOfLines={1}>
                {userName.toUpperCase()}
              </Text>
            ) : null}
          </View>
        </LinearGradient>
      </View>

      {/* 3. Pocket sheet — zIndex 5 / elevation 10 paints over the card's lower
              POCKET_OVERLAP px. flex: 1 fills the remaining screen. Upward shadow
              reads as the lip of a physical card sleeve. */}
      <View style={styles.pocketSheetWrap}>
        <FlatList
          data={ledger}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.txnRow}>
              <TransactionItem txn={item} />
            </View>
          )}
          ListHeaderComponent={listHeaderComponent}
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
      </View>

    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1 },

  // 1. Nav header
  navBar: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical:   spacing.sm,
  },
  navBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },

  // 2. Card stage
  // marginBottom: -POCKET_OVERLAP is the single structural trick — it shifts the
  // pocket sheet up so it overlaps the card bottom. No siblings or children are
  // affected beyond that vertical shift.
  cardStage: {
    alignItems:   'center',
    paddingTop:   spacing.sm,
    marginBottom: -POCKET_OVERLAP,
  },
  card: {
    width:        '84%',
    aspectRatio:  1.586,
    borderRadius: 16,
    padding:      spacing.lg,
    // paddingBottom pushes content up so space-between distributes only within
    // the visible slice above the pocket seam (POCKET_OVERLAP px are hidden).
    paddingBottom: POCKET_OVERLAP + 8,
    justifyContent: 'space-between',
    elevation:    6,
    shadowColor:  '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  cardTopRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
  },
  cardBank: {
    flex:        1,
    color:       '#FFFFFF',
    fontSize:    16,
    fontWeight:  '700',
    letterSpacing: 1,
  },
  networkBadge: {
    backgroundColor: '#FFFFFF26',
    borderRadius:    6,
    paddingHorizontal: 8,
    paddingVertical:   3,
    marginLeft:      spacing.sm,
  },
  networkText: {
    color:        '#FFFFFF',
    fontSize:     11,
    fontWeight:   '700',
    letterSpacing: 0.5,
  },
  chip: {
    width:           40,
    height:          30,
    borderRadius:    6,
    backgroundColor: '#F2D38A',
    paddingVertical:   6,
    paddingHorizontal: 5,
    justifyContent:  'space-between',
  },
  chipLine: { height: 2, borderRadius: 1, backgroundColor: '#00000022' },
  cardNumber: {
    color:        '#FFFFFF',
    fontSize:     20,
    fontWeight:   '600',
    letterSpacing: 2,
    fontVariant:  ['tabular-nums'],
  },
  cardHolder: {
    color:        '#FFFFFFCC',
    fontSize:     12,
    fontWeight:   '600',
    letterSpacing: 1,
    marginTop:    6,
  },

  // 3. Pocket sheet
  // zIndex 5 on iOS, elevation 10 on Android — both ensure this View renders over
  // the card's bottom POCKET_OVERLAP slice.
  // borderTopWidth is the slot-seam divider line.
  // Negative-height shadow bleeds upward onto the card bottom (iOS only).
  pocketSheetWrap: {
    flex:            1,
    zIndex:          5,
    backgroundColor: '#FFFFFF',
    borderTopWidth:  1,
    borderColor:     '#ECEFF1',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: -10 },
    shadowOpacity:   0.06,
    shadowRadius:    12,
    elevation:       10,
  },

  // Header rendered inside the FlatList (clean — no z-index concerns here)
  pocketContent: {
    paddingTop:        20,
    paddingHorizontal: 16,
    paddingBottom:     4,
  },
  summaryBox: {
    paddingHorizontal: 16,
    paddingVertical:   14,
    backgroundColor:   '#FFFFFF',
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       '#F1F5F9',
    marginBottom:      20,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
  },
  summaryLabel: {
    fontSize:   14,
    fontWeight: '500',
    color:      '#64748B',
  },
  summaryValue: {
    fontSize:    22,
    fontWeight:  '800',
    color:       '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  sectionTitle: {
    fontSize:    16,
    fontWeight:  '700',
    color:       '#1E293B',
    marginBottom: 12,
  },

  listContent: { paddingBottom: spacing.xxl * 2 },
  txnRow: { paddingHorizontal: 16 },
  emptyLedger: { marginTop: spacing.lg },
  missingState: { marginTop: spacing.xxl },

  // Lock state
  lockWrap: {
    flex:              1,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: spacing.xl,
  },
  lockBadge: {
    width:          72,
    height:         72,
    borderRadius:   36,
    borderWidth:    1,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   spacing.lg,
  },
  lockTitle: { fontSize: 18, fontWeight: '700', marginBottom: spacing.sm },
  lockSub: {
    fontSize:    14,
    fontWeight:  '400',
    textAlign:   'center',
    lineHeight:  20,
    marginBottom: spacing.xl,
  },
  unlockBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: spacing.xl,
    paddingVertical:   spacing.md,
    borderRadius:      radius.pill,
  },
  unlockText: { fontSize: 15, fontWeight: '700' },
});

export default AccountDetailsScreen;
