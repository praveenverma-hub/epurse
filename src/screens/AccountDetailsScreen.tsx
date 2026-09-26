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
  AppState,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { spacing, radius, shadows, withAlpha, typography as typographyBase } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { ACCOUNT_TYPES } from '../constants/categories';
import { resolveAccountGradient } from '../utils/accountGradient';
import TransactionItemRaw from '../components/TransactionItem';
import TxnDebugSheet from '../components/TxnDebugSheet';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import EmptyState from '../components/EmptyState';
import InfoSheet from '../components/InfoSheet';
import InfoIcon from '../components/InfoIcon';
import EditIcon from '../components/EditIcon';
import MonthDivider from '../components/MonthDivider';
import { monthKey, formatDate, ordinalDay as ordinal } from '../utils/format';
import { txnBelongsToAccount } from '../utils/accountMatch';
import { useAnchorToast, BalanceAnchorModal } from './OnboardingExperience';
import { IS_STAGE_BUILD } from '../constants/buildVariant';
import SectionHeader from '../components/SectionHeader';
import ProgressBar from '../components/ProgressBar';
import { EMPTY_ARRAY } from '../constants/empty';
import { currentPaymentWindow, currentBillingCycle } from '../utils/dueDate';
import {
  statementRemaining, ccPaymentStatus, PAYMENT_STATUS_LABEL, creditAvailability,
  cycleSpend, lastPayment, dueRelativeText, ccStatusColor,
} from '../utils/ccStatement';
import { monthMoneyFlow, accountBalanceTrend } from '../utils/accountFlow';
import { timeAgo } from '../utils/format';
import MonthlyLineChart from '../components/MonthlyLineChart';

// TransactionItem is plain JS; alias so tsc only requires the props this screen passes.
const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: Txn; onPress?: () => void; onLongPress?: () => void; muted?: boolean;
}>;

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
  primary?: boolean;
  /** Manual "Card Color" pick from AccountFormScreen — a BANK_GRADIENTS key,
   *  never a free-form hex. Wins over every automatic guess in heroGradient. */
  colorKey?: string | null;
  ccPaymentsTracked?: boolean;
  /** Linked debit-card masks folded into this (bank) account — see matchAccount. */
  aliasMasks?: string[];
  /** Stamped when the user corrects a balance — the point before which
   *  reconstructing PAST balances (Balance Trend) can't be trusted. */
  anchoredAt?: number | null;
  // Credit Card insights (account revamp, Sep-2026) — see the store's own
  // doc comments on `setCreditLimit`/`setMinimumDue`/`setAccountCycleDates`
  // and `applyCcCycleInfoToAccount` for how these get populated.
  creditLimit?: number | null;
  statementBalance?: number | null;
  minimumDue?: number | null;
  statementDay?: number | null;
  dueDay?: number | null;
  remainingDue?: number | null;
  lastStatementDate?: string | null;
  lastDueDate?: string | null;
  cycleDaysManual?: boolean;
  pendingCycleDate?: { statementDate: string | null; dueDate: string | null } | null;
  paymentHistory?: { date: number; amount: number }[];
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
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    addListener: (e: string, cb: () => void) => () => void;
  };
  route: { params?: { accountId?: string } };
}

// ── Security ──────────────────────────────────────────────────────────────────

// Mirrors AccountCard's BALANCE_SENSITIVE_TYPES — the account types whose
// balances are hidden when the app is backgrounded.
const SENSITIVE_TYPES = new Set<string>([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.DEBIT_CARD]);

// ── Visual constants ──────────────────────────────────────────────────────────

// Pixels of the card's bottom that tuck behind the pocket sheet.
const POCKET_OVERLAP = 64;

const TYPE_SUBTITLE: Record<string, string> = {
  [ACCOUNT_TYPES.BANK]:        'Savings Account',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'Credit Card',
  [ACCOUNT_TYPES.DEBIT_CARD]:  'Debit Card',
  [ACCOUNT_TYPES.WALLET]:      'Wallet',
  [ACCOUNT_TYPES.CASH]:        'Cash',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  // Historical SMS captured at onboarding — shown ONLY here, for reference. They
  // don't count toward balances or any totals (see store: archivedTransactions).
  const archivedTransactions = useEPurseStore((s: any) => s.archivedTransactions) ?? EMPTY_ARRAY as Txn[];
  const userName    = useEPurseStore((s: any) => s.userName)      as string;

  const account = useMemo(
    () => accounts.find((a) => a.id === accountId),
    [accounts, accountId],
  );

  const isSensitive = !!account && SENSITIVE_TYPES.has(account.type);

  // ── Biometric gate ─────────────────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!isSensitive);
  const [debugTxn, setDebugTxn] = useState<Txn | null>(null);
  // Tap a shared-group row → view-only split detail (no onEdit passed — these
  // rows are archived/onboarding-swept reference data, not meant to be edited).
  const [groupDetailTxn, setGroupDetailTxn] = useState<Txn | null>(null);
  const groups = useEPurseStore((s: any) => s.groups) as { id: string; type: string }[];
  const [authFailed, setAuthFailed]           = useState(false);

  // ── Balance anchoring — tap the balance to set/correct it; header ⓘ explains it.
  // (Replaces the old first-visit anchor chip with an on-demand affordance.)
  const [balanceInfoVisible, setBalanceInfoVisible] = useState(false);
  const {
    modalVisible: anchorVisible,
    openModal: openAnchor,
    closeModal: closeAnchor,
    commitAnchor,
  } = useAnchorToast(account);
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

  // Transactions for this account only.
  //
  // This used to hand-roll its own rule — `accountId` with NO fallback when that
  // id had gone stale, plus an `accountType` equality test on the mask path. Both
  // dropped real rows: a transaction the parser typed as a Debit Card (a known
  // parser gap) on a Bank account vanished from that account's ledger while
  // analytics still counted it, so a card read ~14k in analytics and ~11k here.
  // `resolveTxnAccount` is the store's OWN matcher — the one that assigned
  // `accountId` at ingest — so the ledger can no longer contradict it.
  const belongsToAccount = useCallback(
    (t: Txn) => !t.isIgnored && txnBelongsToAccount(t, account, accounts),
    [account, accounts],
  );

  const ledger = useMemo(() => {
    if (!account) return [];
    return transactions
      .filter(belongsToAccount)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [transactions, account, belongsToAccount]);

  // Historical (pre-onboarding) rows for this account — reference only.
  const archivedLedger = useMemo(() => {
    if (!account) return [];
    return archivedTransactions
      .filter(belongsToAccount)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [archivedTransactions, account, belongsToAccount]);

  // Interleave month dividers into a date-desc row list — only at a month
  // boundary (never above the first group, none when it's all one month).
  const withMonthDividers = (rows: Txn[]): any[] => {
    const out: any[] = [];
    let lastMonth: string | null = null;
    for (const t of rows) {
      const mk = monthKey(t.createdAt);
      if (lastMonth !== null && mk !== lastMonth) {
        out.push({ id: `div-${mk}`, __divider: true, monthKey: mk });
      }
      lastMonth = mk;
      out.push(t);
    }
    return out;
  };

  // Active rows (with month dividers) first, then a labelled "earlier / not
  // counted" block of history. Archived rows stay un-dividered — they're a
  // reference block, already separated by their own header.
  const ledgerData = useMemo(
    () =>
      archivedLedger.length
        ? [...withMonthDividers(ledger), { id: '__earlier_sep__', __sep: true } as any, ...archivedLedger]
        : withMonthDividers(ledger),
    [ledger, archivedLedger],
  );

  // ── Shared nav header ──────────────────────────────────────────────────────
  // The status bar is driven by a DECLARATIVE <StatusBar> (not an imperative
  // setBarStyle) because this screen is pushed on top of the always-mounted tab
  // navigator, whose tabs keep their own <StatusBar barStyle="light-content">
  // entries in RN's global props-stack. An imperative call gets reverted to that
  // merged "light" on the next props-stack recompute. Mounting our own entry last
  // (this screen sits on top) makes "dark" win the merge while shown, and cleanly
  // yields back to the tabs on pop. Dark-mode-aware so text stays legible.
  const renderHeader = () => (
    <>
      <StatusBar
        barStyle={theme.darkMode ? 'light-content' : 'dark-content'}
        backgroundColor={theme.background}
      />
      <View style={styles.navBar}>
      <View style={[styles.navSide, styles.navSideLeft]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.navBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
        </TouchableOpacity>
      </View>
      <Text style={[styles.navTitle, { color: theme.textPrimary }]}>Account Details</Text>
      <View style={[styles.navSide, styles.navSideRight]}>
        {account ? (
          <TouchableOpacity
            onPress={() => setBalanceInfoVisible(true)}
            style={styles.navBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="About balance & anchoring"
          >
            <InfoIcon size={22} color={theme.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      </View>
    </>
  );

  // ── Guard: account missing (e.g. deleted) ─────────────────────────────────
  if (!account) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
        {renderHeader()}
        <EmptyState
          icon="card-outline"
          title="Account not found"
          subtitle="This account may have been removed."
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
  const [gradStart, gradEnd] = resolveAccountGradient(account, theme);
  const networkLabel   = account.network || TYPE_SUBTITLE[account.type] || '';

  // ── Credit Card insights (billing spec) ─────────────────────────────────────
  // All statement / status / limit maths comes from `utils/ccStatement` +
  // `utils/dueDate` — the SAME functions the store and both payment sheets use,
  // so this screen can't disagree with them. `outstanding` reuses the summary's
  // own figure rather than deriving the same number twice.
  const outstanding      = summaryValue;
  const creditLimit      = isCreditCard ? account.creditLimit ?? null : null;
  const avail            = isCreditCard ? creditAvailability(outstanding, creditLimit) : null;
  const hasLimit         = !!avail;
  // UNCLAMPED — over the limit, available goes negative and utilization past
  // 100%; shown as an "Over limit" warning instead of hidden behind ₹0 / 100%.
  const availableCredit  = avail ? avail.availableCredit : null;
  const utilization      = avail ? avail.utilization : null;
  const utilPct          = utilization != null ? Math.round(utilization * 100) : null;
  const overLimit        = !!avail?.overLimit;
  // Same tiers Budget already uses for spend-vs-cap — not new thresholds.
  const utilColor = utilPct == null
    ? theme.primary
    : utilPct >= 100 ? theme.budgetOver
    : utilPct >= 85 ? theme.budgetNearLimit
    : theme.budgetNormal;

  const statementBalance = isCreditCard ? account.statementBalance ?? null : null;
  const minimumDue        = isCreditCard ? account.minimumDue ?? null : null;
  const statementDay       = isCreditCard ? account.statementDay ?? null : null;
  const dueDay             = isCreditCard ? account.dueDay ?? null : null;
  const remainingDue       = isCreditCard ? statementRemaining(account) : null;
  const payStatus          = isCreditCard ? ccPaymentStatus(account) : 'no_statement';
  const payWindow          = isCreditCard ? currentPaymentWindow(account) : null;
  const lastPay            = isCreditCard ? lastPayment(account) : null;
  const partlyPaid = remainingDue != null && statementBalance != null
    && remainingDue > 0 && remainingDue < statementBalance;
  // A card that's 100% dashes has no reason to render — but these fill in on
  // their own from a later parsed bill SMS, so the section grows in over time.
  const hasPaymentDetails = isCreditCard && (statementBalance != null || minimumDue != null
    || statementDay != null || dueDay != null || !!lastPay);
  const dueText = dueRelativeText(payWindow);
  // Status → accent. The label always renders in textPrimary beside a coloured
  // dot, so an amber tier never has to carry text contrast on its own.
  const statusColor = ccStatusColor(payStatus, theme);

  // The BILLING cycle — statement to next statement, the spend period (distinct
  // from the statement→due payment window above).
  const billing    = isCreditCard ? currentBillingCycle(account) : null;
  const cycleSpent = billing ? cycleSpend(ledger, billing.start, billing.end) : 0;
  const cycleLeftText = !billing ? ''
    : billing.daysLeft === 0 ? 'Closes today'
    : `${billing.daysLeft} ${billing.daysLeft === 1 ? 'day' : 'days'} left`;

  // ── Bank/Cash/Debit/Wallet insights ─────────────────────────────────────────
  // Same ledger the transaction list below already builds from `belongsToAccount`
  // — every row that ever moved this account's real balance (self-transfers and
  // LB entries included), not a "spend"-filtered subset (see utils/accountFlow).
  const { moneyIn, moneyOut, netFlow } = !isCreditCard ? monthMoneyFlow(ledger) : { moneyIn: 0, moneyOut: 0, netFlow: 0 };
  const hasFlowThisMonth = !isCreditCard && (moneyIn > 0 || moneyOut > 0);
  // Reconstructing months before an anchor (or before the account's first-ever
  // transaction) has nothing real to show — trimmed rather than padded with a
  // flat, invented history.
  const trendSince = !isCreditCard
    ? (account.anchoredAt ?? (ledger.length ? new Date(ledger[ledger.length - 1].createdAt).getTime() : Date.now()))
    : null;
  const balanceTrend = !isCreditCard
    ? accountBalanceTrend(ledger, rawBalance, { since: trendSince }).filter((b) => b.known)
    : [];
  // A single bar isn't a trend — needs at least 2 known months to be worth a chart.
  const hasBalanceTrend = balanceTrend.length > 1;

  // ── At-a-glance meta — same "Last activity {date} · N entries" idiom
  // LbPersonScreen already uses for its own summary card. `ledger` is already
  // sorted newest-first, so its head is the latest activity with no extra pass.
  const txnCountLabel = ledger.length === 1 ? '1 transaction' : `${ledger.length} transactions`;
  const linkedMasks = account.aliasMasks ?? [];

  // FlatList header: lives entirely inside the pocket sheet — no z-index tricks.
  const listHeaderComponent = (
    <View style={styles.pocketContent}>
      {/* Quick context above the balance — when this account last moved, how
          much history it has, and (bank accounts only) which linked debit
          card(s) are folded into this same balance. The list screen's own
          row shows a shorter version of the first line; nothing here duplicates
          the ledger below, which already carries every date individually. */}
      {ledger.length > 0 ? (
        <Text style={[styles.metaCaption, { color: theme.textMuted }]} numberOfLines={1}>
          Last activity {timeAgo(new Date(ledger[0].createdAt).getTime())} · {txnCountLabel}
        </Text>
      ) : null}
      {linkedMasks.length > 0 ? (
        <View style={styles.linkedRow}>
          <Ionicons name="git-merge-outline" size={13} color={theme.textMuted} />
          <Text style={[styles.linkedText, { color: theme.textMuted }]} numberOfLines={1}>
            Also includes card{linkedMasks.length > 1 ? 's' : ''} ··{linkedMasks.join(', ··')}
          </Text>
        </View>
      ) : null}

      {/* Tap the balance to set/correct it (anchor). The header ⓘ explains how.
          Credit Card accounts skip this — the new "Outstanding" stat tile below
          takes over as the one tap-to-anchor entry point, so the same figure
          isn't shown twice in two different treatments. */}
      {!isCreditCard ? (
        <TouchableOpacity
          style={styles.summaryBox}
          onPress={openAnchor}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Adjust ${summaryLabel.toLowerCase()}`}
        >
          <Text style={styles.summaryLabel}>{summaryLabel}</Text>
          <View style={styles.summaryRight}>
            <Text style={styles.summaryValue}>{formatMoney(summaryValue)}</Text>
            {/* Same 26×26 chip as the card's own edit button (`cardEditBtn`) and
                GoalCard/GoalDetailScreen's pencil — was a bare 20px glyph
                floating beside the value with no chrome of its own. */}
            <View style={styles.summaryEditBtn}>
              <EditIcon size={13} color="#64748B" />
            </View>
          </View>
        </TouchableOpacity>
      ) : null}

      {/* ── Credit Card insights (Sep-2026) — Outstanding is always shown;
          Credit Limit/Available/Utilization only once a limit is set, else one
          wide "add a limit" tile in their place rather than 3 tiles of dashes. */}
      {isCreditCard ? (
        <>
          <SectionHeader icon="stats-chart-outline" title="Overview" accentColor={theme.primary} style={styles.sectionHead} />
          <View style={styles.statGrid}>
            <TouchableOpacity
              style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}
              onPress={openAnchor}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Adjust ${summaryLabel.toLowerCase()}`}
            >
              {/* Same corner-badge idiom as the hero card's own `cardEditBtn` /
                  the old `summaryEditBtn` — a circular chip in the tile's
                  top-right corner, the tap affordance for the one interactive
                  tile in this grid. */}
              <View style={[styles.statEditBadge, { backgroundColor: withAlpha(theme.textMuted, 0.14) }]}>
                <EditIcon size={10} color={theme.textMuted} />
              </View>
              <View style={[styles.statIconWrap, { backgroundColor: withAlpha(theme.borrowed, 0.12) }]}>
                <Ionicons name="cash-outline" size={16} color={theme.borrowed} />
              </View>
              <Text style={[styles.statV, { color: theme.textPrimary }]}>{formatMoney(outstanding)}</Text>
              <Text style={[styles.statK, { color: theme.textMuted }]}>Outstanding</Text>
            </TouchableOpacity>

            {hasLimit ? (
              <>
                <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
                  <View style={[styles.statIconWrap, { backgroundColor: withAlpha(theme.primary, 0.12) }]}>
                    <Ionicons name="card-outline" size={16} color={theme.primary} />
                  </View>
                  <Text style={[styles.statV, { color: theme.textPrimary }]}>{formatMoney(creditLimit as number)}</Text>
                  <Text style={[styles.statK, { color: theme.textMuted }]}>Credit Limit</Text>
                </View>
                {/* Over the limit, this tile flips to the warning itself: how far
                    over, in the danger tone — never a silent ₹0. */}
                <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: overLimit ? withAlpha(theme.danger, 0.4) : theme.divider }]}>
                  <View style={[styles.statIconWrap, { backgroundColor: withAlpha(overLimit ? theme.danger : theme.primary, 0.12) }]}>
                    <Ionicons name={overLimit ? 'alert-circle-outline' : 'wallet-outline'} size={16} color={overLimit ? theme.danger : theme.primary} />
                  </View>
                  <Text style={[styles.statV, { color: overLimit ? theme.danger : theme.textPrimary }]}>
                    {formatMoney(Math.abs(availableCredit as number))}
                  </Text>
                  <Text style={[styles.statK, { color: overLimit ? theme.danger : theme.textMuted }]}>
                    {overLimit ? 'Over Limit By' : 'Available Credit'}
                  </Text>
                </View>
                <View style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}>
                  <View style={[styles.statIconWrap, { backgroundColor: withAlpha(utilColor, 0.12) }]}>
                    <Ionicons name="speedometer-outline" size={16} color={utilColor} />
                  </View>
                  <Text style={[styles.statV, { color: theme.textPrimary }]}>{utilPct}%</Text>
                  <Text style={[styles.statK, { color: theme.textMuted }]}>Utilization</Text>
                  {/* The bar fills to 100% at most (ProgressBar clamps); the % above
                      is the real, possibly >100 figure. */}
                  <ProgressBar progress={utilization as number} color={utilColor} height={5} style={styles.statBar} />
                </View>
              </>
            ) : (
              // Same half-width tile as Outstanding, not a full-width one — a
              // lone wide card here was mostly empty space either way (an
              // icon and two lines in the space of three tiles), and it left
              // Outstanding stranded alone on its own row above it.
              <TouchableOpacity
                style={[styles.statTile, { backgroundColor: theme.card, borderColor: theme.divider }]}
                onPress={() => navigation.navigate('AccountForm', { accountId: account.id })}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Add credit limit"
              >
                <View style={[styles.statIconWrap, { backgroundColor: withAlpha(theme.primary, 0.12) }]}>
                  <Ionicons name="add-circle-outline" size={16} color={theme.primary} />
                </View>
                <Text style={[styles.statV, { color: theme.primary, fontSize: 13 }]}>Add Limit</Text>
                <Text style={[styles.statK, { color: theme.textMuted }]}>See utilization</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      ) : null}

      {/* ── Payment details — the statement, its due date and status. Any ONE
          missing field shows "—"; the card hides only when NOTHING is known. */}
      {hasPaymentDetails ? (
        <>
          <SectionHeader icon="receipt-outline" title="Payment Details" accentColor={theme.primary} style={styles.sectionHead} />
          <View style={[styles.infoCard, { borderColor: theme.inputBorder }]}>
            {payStatus !== 'no_statement' ? (
              <View style={styles.statusRow}>
                <View style={[styles.statusPill, { backgroundColor: withAlpha(statusColor, 0.12) }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusText, { color: theme.textPrimary }]}>{PAYMENT_STATUS_LABEL[payStatus]}</Text>
                </View>
                {payWindow && payStatus !== 'paid' ? (
                  <Text style={[styles.statusSub, { color: theme.textSecondary }]}>
                    Due {formatDate(payWindow.dueDate)} · {dueText}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {[
              ['Statement Balance', statementBalance != null ? formatMoney(statementBalance) : '—'],
              ...(partlyPaid ? [['Remaining Due', formatMoney(remainingDue as number)]] : []),
              ['Minimum Due', minimumDue != null ? formatMoney(minimumDue) : '—'],
              ['Billing Day', statementDay != null ? `the ${ordinal(statementDay)}` : '—'],
              ['Payment Due Day', dueDay != null ? `the ${ordinal(dueDay)}` : '—'],
              ...(lastPay ? [['Last Payment', `${formatMoney(lastPay.amount)} · ${formatDate(lastPay.date)}`]] : []),
            ].map(([label, value], i) => (
              <View
                key={label}
                style={[styles.infoRow, (i > 0 || payStatus !== 'no_statement') && styles.infoRowDivider, { borderTopColor: theme.divider }]}
              >
                <Text style={[styles.infoLabel, { color: theme.textSecondary }]}>{label}</Text>
                <Text style={[styles.infoValue, { color: theme.textPrimary }]}>{value}</Text>
              </View>
            ))}
            {/* Warn, never block — some issuers genuinely run short/long gaps. */}
            {payWindow?.gapUnusual ? (
              <Text style={[styles.gapWarn, { color: theme.textSecondary }]}>
                {payWindow.gapDays} days from statement to due date is unusual — check the billing and due days.
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      {/* ── Current bill cycle — statement to next statement (the spend period).
          Needs only the billing day or a real statement date. */}
      {billing ? (
        <>
          <SectionHeader icon="calendar-outline" title="Current Bill Cycle" accentColor={theme.primary} style={styles.sectionHead} />
          <View style={[styles.infoCard, { borderColor: theme.inputBorder }]}>
            <View style={styles.cycleHeadRow}>
              <Text style={[styles.cycleDates, { color: theme.textPrimary }]} numberOfLines={1}>
                {formatDate(billing.start)} – {formatDate(billing.end)}
              </Text>
              <Text style={[styles.cycleDaysLeft, { color: theme.primary }]}>{cycleLeftText}</Text>
            </View>
            <ProgressBar progress={billing.progress} color={theme.primary} height={6} style={styles.cycleBar} />
            <View style={styles.cycleMoneyRow}>
              <Text style={[styles.cycleMoneyText, { color: theme.textSecondary }]}>
                Spent {formatMoney(cycleSpent)}
              </Text>
              {hasLimit ? (
                <Text style={[styles.cycleMoneyText, { color: overLimit ? theme.danger : theme.textSecondary }]}>
                  {overLimit
                    ? `Over limit by ${formatMoney(Math.abs(availableCredit as number))}`
                    : `Remaining ${formatMoney(availableCredit as number)}`}
                </Text>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      {/* ── Bank/Cash/Debit/Wallet insights — a faded-header "This Month" card
          (Money In / Money Out / Net Flow) and a Balance Trend bar chart.
          Credit Card accounts skip both: their own Payment Details / Bill
          Cycle cards above already cover "where the money's going". */}
      {hasFlowThisMonth ? (
        <View style={[styles.flowCard, { backgroundColor: theme.card, borderColor: theme.divider }]}>
          <View style={[styles.flowHeader, { backgroundColor: withAlpha(theme.primary, 0.08) }]}>
            <Ionicons name="calendar-outline" size={14} color={theme.primary} />
            <Text style={[styles.flowHeaderText, { color: theme.textPrimary }]}>This Month</Text>
          </View>
          <View style={styles.flowBody}>
            <View style={styles.flowStat}>
              <Text style={[styles.flowLabel, { color: theme.textMuted }]}>Money In</Text>
              <Text style={[styles.flowValue, { color: theme.income }]} numberOfLines={1}>
                {formatMoney(moneyIn)}
              </Text>
            </View>
            <View style={[styles.flowDivider, { backgroundColor: theme.divider }]} />
            <View style={styles.flowStat}>
              <Text style={[styles.flowLabel, { color: theme.textMuted }]}>Money Out</Text>
              <Text style={[styles.flowValue, { color: theme.expense }]} numberOfLines={1}>
                {formatMoney(moneyOut)}
              </Text>
            </View>
            <View style={[styles.flowDivider, { backgroundColor: theme.divider }]} />
            <View style={styles.flowStat}>
              <Text style={[styles.flowLabel, { color: theme.textMuted }]}>Net Flow</Text>
              <Text style={[styles.flowValue, { color: netFlow >= 0 ? theme.income : theme.expense }]} numberOfLines={1}>
                {netFlow >= 0 ? '+' : '-'}{formatMoney(Math.abs(netFlow))}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {hasBalanceTrend ? (
        <>
          <SectionHeader icon="trending-up-outline" title="Balance Trend" accentColor={theme.primary} style={styles.sectionHead} />
          <View style={[styles.infoCard, styles.trendCard, { borderColor: theme.inputBorder }]}>
            <MonthlyLineChart data={balanceTrend} color={theme.primary} allowNegative />
          </View>
        </>
      ) : null}

      <SectionHeader icon="receipt-outline" title="Transactions" accentColor={theme.primary} />
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
            <View style={styles.cardTopRight}>
              {/* The one account marked primary (see `ensurePrimary` in
                  ePurseStore.js) — sits BEFORE the network chip, both on the
                  right of the row. Gold matches the EMV chip's own tone
                  (`#F2D38A`) rather than a new arbitrary accent. */}
              {account.primary ? (
                <View style={styles.primeBadge}>
                  <Ionicons name="star" size={10} color="#F2D38A" />
                  <Text style={styles.primeText}>PRIMARY</Text>
                </View>
              ) : null}
              {networkLabel ? (
                <View style={styles.networkBadge}>
                  <Text style={styles.networkText}>{networkLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* EMV chip — pure native styling */}
          <View style={styles.chip}>
            <View style={styles.chipLine} />
            <View style={styles.chipLine} />
          </View>

          <View style={styles.cardBottomRow}>
            <View style={styles.flex1}>
              <Text style={styles.cardNumber}>{`••••  ${last4(account)}`}</Text>
              {userName ? (
                <Text style={styles.cardHolder} numberOfLines={1}>
                  {userName.toUpperCase()}
                </Text>
              ) : null}
            </View>
            {/* Moved off the nav header (Sep-2026), then off the top row onto
                this bottom-right corner — the header now carries only the
                balance-info ⓘ, and "manage this account" lives on the thing
                it manages. In-flow beside the card number (not absolute) so
                it naturally respects the same space-between/paddingBottom
                that already keeps this row clear of the hidden pocket seam.
                White-on-translucent to match this card's own ink
                (networkBadge), not theme.card/textSecondary — the gradient
                card is a bespoke surface, not a themed one. */}
            <TouchableOpacity
              onPress={() => navigation.navigate('AccountForm', { accountId: account.id })}
              hitSlop={10}
              style={styles.cardEditBtn}
              accessibilityRole="button"
              accessibilityLabel="Manage account"
            >
              <EditIcon size={14} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* 3. Pocket sheet — zIndex 5 / elevation 10 paints over the card's lower
              POCKET_OVERLAP px. flex: 1 fills the remaining screen. Upward shadow
              reads as the lip of a physical card sleeve. */}
      <View style={[styles.pocketSheetWrap, { backgroundColor: theme.background }]}>
        <FlatList
          data={ledgerData}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            if ((item as any).__divider) {
              return <MonthDivider monthKey={(item as any).monthKey} />;
            }
            if ((item as any).__sep) {
              return (
                <View style={styles.earlierSep}>
                  <Text style={[styles.earlierSepText, { color: theme.textMuted }]}>
                    Earlier · imported at sign-up (not counted)
                  </Text>
                </View>
              );
            }
            const itemGroup = (item as any).groupId ? groups.find((g) => g.id === (item as any).groupId) : null;
            return (
              <View style={styles.txnRow}>
                <TransactionItem
                  txn={item}
                  muted={!!(item as any).preOnboarding}
                  onPress={itemGroup && itemGroup.type === 'shared' ? () => setGroupDetailTxn(item) : undefined}
                  onLongPress={IS_STAGE_BUILD ? () => setDebugTxn(item) : undefined}
                />
              </View>
            );
          }}
          ListHeaderComponent={listHeaderComponent}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No transactions yet"
              subtitle="Spending and credits on this account will appear here."
            />
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          windowSize={9}
        />
      </View>

      {IS_STAGE_BUILD && (
        <TxnDebugSheet txn={debugTxn} onClose={() => setDebugTxn(null)} />
      )}

      {/* View-only — no onEdit, so the sheet's Edit pill doesn't render. These
          rows are archived/onboarding-swept reference data, not editable here. */}
      <GroupTxnDetailSheet txn={groupDetailTxn as any} onClose={() => setGroupDetailTxn(null)} />

      {/* Tweak / anchor the balance (opened by tapping the balance box). */}
      <BalanceAnchorModal
        visible={anchorVisible}
        accountLabel={`${deriveBankName(account)}${account.mask ? `  •••• ${account.mask}` : ''}`}
        // The card's own `balance` is stored NEGATIVE (a liability); the modal
        // only ever collects a non-negative figure, so it has to be handed
        // the same positive `summaryValue` the "Total Outstanding" label
        // above already shows — not the raw signed balance.
        initialValue={summaryValue}
        isCreditCard={isCreditCard}
        onCancel={closeAnchor}
        onSave={commitAnchor}
      />

      {/* Header ⓘ → the internal mechanics this screen manages that aren't
          obvious on sight — same bar Groups/Goals hold their own "how it
          works" sheets to. "Last activity" needs no bullet (self-evident);
          anchoring and linked-card folding both quietly change what a number
          on screen means, so both stay, worded as short scannable points
          rather than a paragraph. */}
      <InfoSheet
        visible={balanceInfoVisible}
        onClose={() => setBalanceInfoVisible(false)}
        icon={<Ionicons name="information-circle-outline" size={28} color={theme.primary} />}
        title="About this account"
        bullets={[
          {
            icon: 'create-outline',
            label: 'Balance & anchoring',
            value: 'Synced from your bank SMS. If it ever drifts, tap the balance to set the right amount — new transactions adjust from there.',
          },
          {
            icon: 'git-merge-outline',
            label: 'Linked cards',
            value: 'A linked debit card’s money is folded into this balance and ledger, not tracked separately.',
          },
        ]}
      />

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
  // Fixed-width side slots (matched) so the centered title stays centered whether
  // the right side holds one icon or two.
  navSide:      { width: 80, flexDirection: 'row', alignItems: 'center' },
  navSideLeft:  { justifyContent: 'flex-start' },
  navSideRight: { justifyContent: 'flex-end' },

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
    // The physical-card metaphor wants a real drop shadow, and `elevated` IS
    // that — 0.18/y8 was a private number for the same intent.
    ...shadows.elevated,
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
  cardTopRight: { flexDirection: 'row', alignItems: 'center' },
  primeBadge: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             3,
    backgroundColor: '#FFFFFF26',
    borderRadius:    6,
    paddingHorizontal: 8,
    paddingVertical:   3,
  },
  primeText: {
    color:        '#F2D38A',
    fontSize:     10,
    fontWeight:   '800',
    letterSpacing: 0.6,
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
  cardEditBtn: {
    width:           26,
    height:          26,
    borderRadius:    13,
    backgroundColor: '#FFFFFF26',
    alignItems:      'center',
    justifyContent:  'center',
    marginLeft:      spacing.sm,
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
  // Number/holder beside the pencil, bottom-right — `flex-end` so a short,
  // one-line number+holder block still bottom-aligns the button against it.
  cardBottomRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  flex1: { flex: 1 },

  // 3. Pocket sheet
  // zIndex 5 on iOS, elevation 10 on Android — both ensure this View renders over
  // the card's bottom POCKET_OVERLAP slice.
  // borderTopWidth is the slot-seam divider line.
  // Negative-height shadow bleeds upward onto the card bottom (iOS only).
  pocketSheetWrap: {
    flex:            1,
    zIndex:          5,
    // backgroundColor is applied inline from theme.background so the list sits on
    // the same gray as other screens (white TransactionItem cards stand out).
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
  metaCaption: { ...typography.tiny, fontWeight: '600', marginBottom: spacing.xs },
  linkedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginBottom: spacing.md,
  },
  linkedText: { ...typography.tiny, fontWeight: '600', flexShrink: 1 },
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
  summaryRight: { flexDirection: 'row', alignItems: 'center' },
  summaryValue: {
    fontSize:    22,
    fontWeight:  '800',
    color:       '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  summaryEditBtn: {
    width:           26,
    height:          26,
    borderRadius:    13,
    backgroundColor: '#F1F5F9',
    alignItems:      'center',
    justifyContent:  'center',
    marginLeft:      10,
  },

  // ── Credit Card insights (Sep-2026) ─────────────────────────────────────
  sectionHead: { marginTop: spacing.md, marginBottom: spacing.sm },

  // Stat grid — GoalDetailScreen's own 2-column wrap tile, composed here with
  // an icon-in-tinted-circle each tile didn't have there.
  statGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg,
  },
  statTile: {
    flexBasis: '48%', flexGrow: 1,
    borderWidth: 1, borderRadius: radius.md,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  statIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  statV: { ...typography.bodyBold, fontWeight: '800' },
  statK: { ...typography.tiny, marginTop: 2, textAlign: 'center' },
  // Outstanding is the one tappable tile (tap-to-anchor) — this corner badge
  // is its affordance, same idiom as `cardEditBtn`/`summaryEditBtn` elsewhere
  // on this screen, just smaller to fit a compact stat tile.
  statEditBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statBar: { width: '100%', marginTop: spacing.xs },

  // Payment details / bill cycle — same bordered-card language AccountFormScreen
  // uses for its own inline Credit Card section (`ccCard`).
  infoCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  infoRowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  infoLabel: { ...typography.small, fontWeight: '500' },
  infoValue: { ...typography.small, fontWeight: '700' },

  statusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm, paddingVertical: spacing.sm + 2,
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { ...typography.tiny, fontWeight: '700' },
  statusSub: { ...typography.tiny, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  gapWarn: { ...typography.tiny, paddingBottom: spacing.sm + 2, lineHeight: 16 },

  cycleHeadRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm, paddingTop: spacing.md,
  },
  cycleDates: { ...typography.small, fontWeight: '600', flex: 1 },
  cycleDaysLeft: { ...typography.tiny, fontWeight: '800' },
  cycleBar: { marginTop: spacing.sm, marginBottom: spacing.sm },
  cycleMoneyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  cycleMoneyText: { ...typography.tiny, fontWeight: '600' },

  // ── Bank/Cash/Debit/Wallet insights ─────────────────────────────────────
  flowCard: {
    borderRadius: radius.md, borderWidth: 1, overflow: 'hidden', marginBottom: spacing.lg,
  },
  flowHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  flowHeaderText: { ...typography.small, fontWeight: '700' },
  flowBody: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  flowStat: { flex: 1, alignItems: 'center' },
  flowLabel: { ...typography.tiny, fontWeight: '600', marginBottom: 4 },
  flowValue: { ...typography.small, fontWeight: '800', fontVariant: ['tabular-nums'] },
  flowDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 2 },
  trendCard: { paddingTop: spacing.md, paddingBottom: spacing.sm },

  listContent: { paddingBottom: spacing.xxl * 2, flexGrow: 1 },
  txnRow: { paddingHorizontal: 16 },
  earlierSep: {
    paddingHorizontal: 16,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  earlierSepText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

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
    borderRadius:      radius.lg,
  },
  unlockText: { fontSize: 15, fontWeight: '700' },
});

export default AccountDetailsScreen;
