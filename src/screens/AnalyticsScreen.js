// =============================================================================
// AnalyticsScreen — monthly category breakdown using bar chart + progress rings
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Svg, { Circle, G, Rect } from 'react-native-svg';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { selectTransactions } from '../store/ePurseStore';
import { NON_SPEND_CATEGORY_IDS, ACCOUNT_TYPES } from '../constants/categories';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, isSameMonth } from '../utils/format';
import { debitDisplayAmount, isGroupExcluded, countsForSpend, spendContribution } from '../utils/split';
import {
  getDailyCumulative,
  getMerchantBubbles,
  detectSubscriptions,
  buildCategoryBreakdown,
} from '../analytics/behavioralSelectors';
import GhostLineChart from '../components/GhostLineChart';
import HabitLeakMatrix from '../components/HabitLeakMatrix';
import SubscriptionHeartbeat from '../components/SubscriptionHeartbeat';
import SmartLedger from '../components/SmartLedger';
import GroupInsightCarousel from '../components/GroupInsightCarousel';
import EmptyState from '../components/EmptyState';
import InfoSheet from '../components/InfoSheet';
import InfoIcon from '../components/InfoIcon';

const SCREEN_W = Dimensions.get('window').width;

// Explainers for the behavioural cards (tap the ⓘ on each section header).
const SECTION_INFO = {
  pace: {
    title: 'Spending Pace',
    body: 'Your running total for this month (solid) drawn against last month at the same point (dashed "ghost"). If the solid line sits above the ghost, you\'re spending faster than last month; below means you\'re pacing slower.',
  },
  habit: {
    title: 'Habit Leaks',
    body: 'Merchants you paid more than once this month, sized by how much they add up to. Small repeat charges (a daily coffee, frequent deliveries) quietly leak money — this surfaces them so you can spot the pattern.',
  },
  heartbeat: {
    title: 'Subscription Heartbeat',
    body: 'A monthly timeline of recurring charges (Netflix, Spotify, rent…) on the day they hit. Charges dated later than today are dimmed — they\'re expected, not yet paid. A red pulse flags a detected price hike.',
  },
  whatif: {
    title: 'What-if Ledger',
    body: 'Toggle categories off to instantly see what this month would look like without them — the adjusted total counts down and shows how much you\'d have saved. It\'s a preview only: nothing is deleted. Group expenses count just your personal share.',
  },
  groups: {
    title: 'Spend by group',
    body: 'Swipe the strip to pick a group — each card shows who owes whom (Owed to you in mint, You owe in grey) and your share of the group\'s spend this month. The category chart just below re-draws for the selected group; swipe back to "All spending" for everything. Tap View details to open the group.',
  },
};

const AnalyticsScreen = ({ navigation, headerless = false }) => {
  const theme = useTheme();
  const [monthOffset, setMonthOffset] = useState(0); // 0 = this month, -1 = last month
  const [infoKey, setInfoKey] = useState(null); // which section explainer is open
  // Group carousel focus — null = all spending. Drives the reactive line + bar charts.
  const [focusedGroupId, setFocusedGroupId] = useState(null);
  const date = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const transactions = useEPurseStore(selectTransactions);
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const categories = useEPurseStore((s) => s.categories);

  // Drop transactions tagged to a group flagged "exclude from totals" (and group
  // memos) before the chart selectors run — so the spend pace, merchant bubbles
  // and subscription detection match the Spent/Earned summary, which already
  // excludes them via getMonthlySpend / getCategoryBreakdown.
  const visibleTxns = useMemo(
    () => transactions.filter((t) => !t.isIgnored && !isGroupExcluded(t, groups)),
    [transactions, groups],
  );
  const dailyData = useMemo(() => getDailyCumulative(visibleTxns, date), [visibleTxns, date]);
  const merchantBubbles = useMemo(() => getMerchantBubbles(visibleTxns, date), [visibleTxns, date]);
  const allSubscriptions = useMemo(() => detectSubscriptions(visibleTxns), [visibleTxns]);

  const breakdown = useEPurseStore((s) => s.getCategoryBreakdown(date));
  const monthSpend = useEPurseStore((s) => s.getMonthlySpend(date));
  const monthIncome = useEPurseStore((s) => s.getMonthlyIncome(date));
  const monthRefund = useEPurseStore((s) => s.getMonthlyRefunds(date));

  // ── Group focus (from the carousel in the "Spend by group" card) ─────────────
  // Focusing a group re-draws ONLY the category chart in that same card from that
  // group's month transactions (from raw `transactions` — group memos are stripped
  // out of `visibleTxns`). The Pace chart and rings below stay whole-month.
  const focusedGroup = useMemo(
    () => (focusedGroupId ? groups.find((g) => g.id === focusedGroupId) || null : null),
    [focusedGroupId, groups],
  );
  const focusedGroupTxns = useMemo(
    () =>
      focusedGroupId
        ? transactions.filter(
            (t) => t.groupId === focusedGroupId && !t.isIgnored && isSameMonth(t.createdAt, date),
          )
        : [],
    [focusedGroupId, transactions, date],
  );
  const groupBreakdown = useMemo(
    () => buildCategoryBreakdown(focusedGroupTxns, categories),
    [focusedGroupTxns, categories],
  );

  // Category dataset for the "Spend by group" card (group-scoped when focused).
  const barData  = focusedGroupId ? groupBreakdown : breakdown;
  const focusKey = focusedGroupId || 'all'; // remount key → morph transition

  const openGroupDetails = (gid) => {
    if (navigation) navigation.navigate('Groups', { focusGroupId: gid });
  };

  // If the focused group is deleted while viewing, fall back to all-spending.
  useEffect(() => {
    if (focusedGroupId && !groups.some((g) => g.id === focusedGroupId)) {
      setFocusedGroupId(null);
    }
  }, [focusedGroupId, groups]);

  // Per-account spend breakdown — one bar per INDIVIDUAL bank / card (not lumped
  // by type). Resolves each txn to its account by id, then mask/aliasMasks (a
  // linked debit card rolls into its bank); maskless txns with no account fall
  // back to a type bucket. Mirrors getMonthlySpend filters (debit, same month,
  // no NON_SPEND_CATS, no group memos) and uses the user's share for group txns.
  const NON_SPEND = NON_SPEND_CATEGORY_IDS;

  // Selected-month debit spends for the What-if Ledger (same filters as the summary:
  // debit, this month, not group-excluded, not a non-spend category). Personal share
  // is applied inside SmartLedger via debitDisplayAmount.
  const whatIfTxns = useMemo(
    () =>
      visibleTxns.filter(
        // Expenses + refunds (refunds net their category in the ledger below).
        (t) => countsForSpend(t) && isSameMonth(t.createdAt, date) && !NON_SPEND.has(t.categoryId),
      ),
    [visibleTxns, date], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const accountBreakdown = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const byMask = new Map();
    accounts.forEach((a) => {
      if (a.mask) byMask.set(a.mask, a);
      (a.aliasMasks || []).forEach((m) => byMask.set(m, a));
    });
    const buckets = {};
    transactions.forEach((t) => {
      if (!countsForSpend(t)) return;               // expense debit or refund credit
      if (!isSameMonth(t.createdAt, date)) return;
      if (NON_SPEND.has(t.categoryId)) return;
      if (isGroupExcluded(t, groups)) return;
      const acct =
        (t.accountId && byId.get(t.accountId)) ||
        (t.accountMask && byMask.get(t.accountMask)) ||
        null;
      const key  = acct ? acct.id : (t.accountType || 'Unknown');
      const acctType = acct ? acct.type : (t.accountType || null);
      if (!buckets[key]) {
        // Bank label without a trailing mask (the parser bakes "··4523" into name);
        // we re-append the number ourselves + a short type tag ("ICICI CC").
        const base = acct ? (acct.bankName || acct.name || acct.type) : (t.accountType || 'Unknown');
        const bankLabel = base.replace(/\s*[·•*xX]*\s*\d{3,6}\s*$/, '').trim() || base;
        buckets[key] = {
          name: bankLabel,
          // Type tag only for a resolved account; a lumped type bucket's name IS the type.
          typeTag: acct ? (ACCT_TYPE_TAG[acctType] || '') : '',
          // Trailing mask ("account number") — resolved accounts only, so a type
          // bucket doesn't claim one specific card's digits.
          mask: acct ? (acct.mask || null) : null,
          total: 0,
          color: acct?.color,
        };
      }
      buckets[key].total += spendContribution(t);   // refund nets the account down
    });
    return Object.values(buckets)
      .map((b) => ({ ...b, total: Math.max(0, b.total) }))
      .filter((b) => b.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [transactions, date, groups, accounts]);

  const monthLabel = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  // Empty-state flags. `noDataEver` = truly fresh user (no transactions at all)
  // → one prominent placeholder. Otherwise each section handles its own month
  // having no data (e.g. browsing back to a quiet month).
  const noDataEver = transactions.length === 0;
  const hasPace =
    monthSpend > 0 ||
    (Array.isArray(dailyData?.current) && dailyData.current.some((v) => v > 0)) ||
    (Array.isArray(dailyData?.ghost) && dailyData.ghost.some((v) => v > 0));
  const hasBubbles = merchantBubbles.length > 0;
  const hasSubs = allSubscriptions.length > 0;

  return (
    <View style={styles.container}>
      {!headerless ? (
        <CollapsingHeaderScreen
          collapsible={false}
          gradientColors={[colors.gradientBlueStart, colors.gradientBlueEnd]}
          onBack={() => navigation.goBack()}
          title="Analytics"
          renderHero={() => (
            <>
              <View style={styles.monthSwitcher}>
                <TouchableOpacity onPress={() => setMonthOffset((m) => m - 1)}>
                  <Text style={styles.arrow}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.monthLabel}>{monthLabel}</Text>
                <TouchableOpacity
                  onPress={() => setMonthOffset((m) => Math.min(0, m + 1))}
                  disabled={monthOffset === 0}
                >
                  <Text style={[styles.arrow, monthOffset === 0 && { opacity: 0.4 }]}>›</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.summaryRow}>
                <SummaryStat label="Spent" value={monthSpend} />
                <SummaryStat label="Income" value={monthIncome} />
                <SummaryStat label="Refunds" value={monthRefund} />
              </View>
            </>
          )}
        />
      ) : (
        /* headerless — plain strip, no gradient (InsightsScreen already provides one) */
        <View style={styles.headerlessStrip}>
          <View style={styles.monthSwitcherLight}>
            <TouchableOpacity onPress={() => setMonthOffset((m) => m - 1)}>
              <Text style={styles.arrowLight}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabelLight}>{monthLabel}</Text>
            <TouchableOpacity
              onPress={() => setMonthOffset((m) => Math.min(0, m + 1))}
              disabled={monthOffset === 0}
            >
              <Text style={[styles.arrowLight, monthOffset === 0 && { opacity: 0.3 }]}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.summaryRowLight}>
            <SummaryStatLight label="Spent"   value={monthSpend} />
            <SummaryStatLight label="Income"  value={monthIncome} />
            <SummaryStatLight label="Refunds" value={monthRefund} />
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.body, headerless && { marginTop: 0, paddingTop: spacing.md }]}
        showsVerticalScrollIndicator={false}
      >
        {noDataEver ? (
          <EmptyState
            icon="bar-chart-outline"
            title="No analytics yet"
            subtitle="Once your transactions start flowing in, you'll see category breakdowns, spending pace, habit leaks and subscriptions here."
            actionLabel="Add a transaction"
            onAction={navigation ? () => navigation.navigate('AddTransaction') : undefined}
          />
        ) : (
          <>
            {/* Whole-month "Spend by category" bar chart. When the user has groups,
                this lives inside the "Spend by group" card at the BOTTOM instead. */}
            {groups.length === 0 && breakdown.length > 2 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Spend by category</Text>
                <BarChart data={breakdown} />
              </View>
            ) : null}

            {/* Progress rings + rows — whole-month category breakdown */}
            {breakdown.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Category breakdown</Text>
                <View style={styles.ringsRow}>
                  {breakdown.slice(0, 4).map((c) => (
                    <ProgressRing key={c.id} category={c} />
                  ))}
                </View>

                {breakdown.map((c) => (
                  <View key={c.id} style={styles.row}>
                    <View style={[styles.rowDot, { backgroundColor: c.color }]} />
                    <Text style={styles.rowLabel}>
                      {c.emoji} {c.name}
                    </Text>
                    <Text style={styles.rowAmount}>{formatCurrency(c.total)}</Text>
                    <Text style={styles.rowPercent}>{c.percent.toFixed(0)}%</Text>
                  </View>
                ))}
              </View>
            ) : null}

             {/* Account-wise expenses */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Spend by account</Text>
              {accountBreakdown.length === 0 ? (
                <EmptyState
                  compact
                  icon="card-outline"
                  title="No spending this month"
                  subtitle="Switch months above, or add an expense to see the breakdown."
                />
              ) : (
                <HorizontalBarChart data={accountBreakdown} />
              )}
            </View>

            {/* ── Behavioral Insights ── */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>📈 Spending Pace</Text>
                <TouchableOpacity onPress={() => setInfoKey('pace')} hitSlop={10}>
                  <InfoIcon size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionSubtitle}>Your trajectory vs last month — drag to compare any day.</Text>
              {hasPace ? (
                <GhostLineChart data={dailyData} />
              ) : (
                <EmptyState compact icon="trending-up-outline" title="No pace to plot yet" subtitle="Spending this month and last will chart here." />
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>⚡ Habit Leaks</Text>
                <TouchableOpacity onPress={() => setInfoKey('habit')} hitSlop={10}>
                  <InfoIcon size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionSubtitle}>Frequency vs. spend — find the sneaky drains. Tap a bubble.</Text>
              {hasBubbles ? (
                <HabitLeakMatrix bubbles={merchantBubbles} />
              ) : (
                <EmptyState compact icon="flash-outline" title="No habit leaks found" subtitle="Repeat merchants for this month will appear here." />
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>💓 Subscription Heartbeat</Text>
                <TouchableOpacity onPress={() => setInfoKey('heartbeat')} hitSlop={10}>
                  <InfoIcon size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionSubtitle}>Recurring charges visualised as an EKG. Scroll to explore.</Text>
              {hasSubs ? (
                <SubscriptionHeartbeat subscriptions={allSubscriptions} date={date} />
              ) : (
                <EmptyState compact icon="pulse-outline" title="No recurring charges detected" subtitle="Subscriptions like Netflix or Spotify will show up after a couple of cycles." />
              )}
            </View>

            {/* ── What-if Ledger (second-to-last) ── */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>🔮 What-if Ledger Playground</Text>
                <TouchableOpacity onPress={() => setInfoKey('whatif')} hitSlop={10}>
                  <InfoIcon size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={styles.sectionSubtitle}>Toggle categories to see your month without them.</Text>
              <SmartLedger transactions={whatIfTxns} />
            </View>

            {/* ── Spend by group — carousel selector + its category chart in ONE card (last) ── */}
            {groups.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Text style={[styles.sectionTitle, styles.sectionTitleInline]}>👥 Spend by group</Text>
                  <TouchableOpacity onPress={() => setInfoKey('groups')} hitSlop={10}>
                    <InfoIcon size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {/* Group selector strip */}
                <GroupInsightCarousel
                  date={date}
                  focusedGroupId={focusedGroupId}
                  onFocusChange={setFocusedGroupId}
                  transactions={transactions}
                  allSpendTotal={monthSpend}
                />

                {/* Its category chart — morphs (crossfade + height) on group change */}
                <Text style={styles.groupChartHead} numberOfLines={1}>
                  {focusedGroup ? `${focusedGroup.emoji} ${focusedGroup.name} · by category` : 'All spending · by category'}
                </Text>
                <Animated.View
                  key={`groupbar-${focusKey}`}
                  entering={FadeIn.duration(300)}
                  exiting={FadeOut.duration(150)}
                  layout={LinearTransition.springify().damping(18)}
                >
                  {barData.length > 0 ? (
                    <BarChart data={barData} />
                  ) : (
                    <EmptyState
                      compact
                      icon="receipt-outline"
                      title={focusedGroup ? 'No spend for this group' : 'No spending this month'}
                      subtitle={focusedGroup ? 'No transactions this month.' : 'Add an expense to see the breakdown.'}
                    />
                  )}
                </Animated.View>

                {focusedGroup ? (
                  <TouchableOpacity
                    style={[styles.viewDetailsBtn, { borderColor: theme.primary + '55' }]}
                    onPress={() => openGroupDetails(focusedGroup.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.viewDetailsText, { color: theme.primary }]} numberOfLines={1}>
                      View {focusedGroup.name} details
                    </Text>
                    <Ionicons name="arrow-forward" size={16} color={theme.primary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      <InfoSheet
        visible={!!infoKey}
        onClose={() => setInfoKey(null)}
        title={infoKey ? SECTION_INFO[infoKey].title : ''}
        body={infoKey ? SECTION_INFO[infoKey].body : ''}
      />
    </View>
  );
};

// ----------------------------------------------------------------------------
const SummaryStat = ({ label, value }) => (
  <View style={styles.statBox}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statValue}>{formatCurrency(value)}</Text>
  </View>
);

const SummaryStatLight = ({ label, value }) => (
  <View style={styles.statBoxLight}>
    <Text style={styles.statLabelLight}>{label}</Text>
    <Text style={[styles.statValueLight, value < 0 && { color: colors.danger }]}>
      {formatCurrency(value)}
    </Text>
  </View>
);

// Palette for the 5 account bars — distinct colours so each account reads clearly.
const HBAR_COLORS = ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#EC4899'];

// Short type suffix appended to a resolved account's bank name ("ICICI CC").
const ACCT_TYPE_TAG = {
  [ACCOUNT_TYPES.CREDIT_CARD]: 'CC',
  [ACCOUNT_TYPES.DEBIT_CARD]: 'Debit',
  [ACCOUNT_TYPES.BANK]: 'Bank',
  [ACCOUNT_TYPES.WALLET]: 'Wallet',
  [ACCOUNT_TYPES.CASH]: 'Cash',
};

// ---- HorizontalBarChart ----------------------------------------------------
// Shows top-5 accounts as horizontal bars (thinner than the vertical category chart).
// Left: fixed-width account name. Middle: proportional fill. Right: amount.
const HorizontalBarChart = ({ data }) => {
  const top5 = data.slice(0, 5);
  const maxVal = Math.max(...top5.map((d) => d.total), 1);

  return (
    <View style={{ gap: 10 }}>
      {top5.map((d, i) => {
        const pct = d.total / maxVal;
        // Use the account's own colour when available so bars match the cards;
        // fall back to the palette for type-bucket rows without an account.
        const barColor = d.color || HBAR_COLORS[i % HBAR_COLORS.length];
        // Compact: FIRST word of the bank + the number → "ICICI ••4523". Drops the
        // type tag and any extra bank words ("ICICI Bank Credit Card" → "ICICI").
        // Type-only buckets (no mask, e.g. Cash / Digital Wallet) keep their full label.
        const shortBank = (d.name || '').trim().split(/\s+/)[0] || d.name;
        const label = d.mask ? `${shortBank} ••${d.mask}` : (d.name || '');
        return (
          <View key={i} style={styles.hBarRow}>
            <Text style={styles.hBarLabel} numberOfLines={1}>{label}</Text>
            <View style={styles.hBarTrack}>
              <View style={[styles.hBarFill, { width: `${pct * 100}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.hBarAmount}>{formatCurrency(d.total)}</Text>
          </View>
        );
      })}
    </View>
  );
};

// ---- BarChart ---------------------------------------------------------------
const BarChart = ({ data }) => {
  const maxVal = Math.max(...data.map((d) => d.total));
  const chartWidth = SCREEN_W - spacing.lg * 4;
  const chartHeight = 180;
  const barW = Math.min(34, chartWidth / data.length - 12);
  const slot = chartWidth / data.length;

  return (
    <View>
      <Svg width={chartWidth} height={chartHeight}>
        {data.map((d, i) => {
          const h = (d.total / maxVal) * (chartHeight - 30);
          const x = i * slot + (slot - barW) / 2;
          const y = chartHeight - h - 18;
          return (
            <G key={d.id}>
              <Rect x={x} y={y} width={barW} height={h} rx={6} fill={d.color} />
            </G>
          );
        })}
      </Svg>
      <View style={[styles.barLabels, { width: chartWidth }]}>
        {data.map((d, i) => (
          <View key={d.id} style={{ width: slot, alignItems: 'center' }}>
            <Text style={styles.barEmoji}>{d.emoji}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

// ---- Progress ring ---------------------------------------------------------
const ProgressRing = ({ category, size = 70, stroke = 7 }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * (Math.min(100, category.percent) / 100);
  return (
    <View style={styles.ring}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={category.color + '22'}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={category.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash}, ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.ringInner}>
        <Text style={{ fontSize: 18 }}>{category.emoji}</Text>
      </View>
      <Text style={styles.ringLabel} numberOfLines={1}>
        {category.percent.toFixed(0)}%
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    backgroundColor: '#FFFFFF22',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  arrow: { color: '#fff', fontSize: 22, fontWeight: '700' },
  monthLabel: { color: '#fff', ...typography.bodyBold, fontWeight: '700' },

  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF1F',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  statLabel: { color: '#FFFFFFCC', ...typography.tiny },
  statValue: { color: '#fff', ...typography.bodyBold, fontWeight: '700', marginTop: 2 },

  body: { padding: spacing.lg, marginTop: -spacing.lg, flexGrow: 1 },

  section: {
    backgroundColor: colors.card,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  // Sub-heading for the category chart inside the "Spend by group" card.
  groupChartHead: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  viewDetailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  viewDetailsText: { ...typography.small, fontWeight: '700' },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  sectionTitleInline: { marginBottom: 0, flexShrink: 1 },
  sectionSubtitle: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },

  barLabels: { flexDirection: 'row', marginTop: spacing.xs },
  barEmoji: { fontSize: 18 },

  ringsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.lg,
  },
  ring: { alignItems: 'center', position: 'relative' },
  ringInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringLabel: { ...typography.tiny, color: colors.textSecondary, marginTop: 4, fontWeight: '600' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  rowDot: { width: 8, height: 8, borderRadius: 4, marginRight: spacing.md },
  rowLabel: { flex: 1, ...typography.body, color: colors.textPrimary },
  rowAmount: { ...typography.bodyBold, color: colors.textPrimary, marginRight: spacing.md },
  rowPercent: { ...typography.small, color: colors.textSecondary, width: 36, textAlign: 'right' },

  // Headerless mode — plain strip, no gradient
  headerlessStrip: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  monthSwitcherLight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  arrowLight:      { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  monthLabelLight: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  summaryRowLight: { flexDirection: 'row', gap: spacing.sm },
  statBoxLight: {
    flex: 1,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  statLabelLight:  { ...typography.tiny, color: colors.textSecondary },
  statValueLight:  { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },

  // Horizontal bar chart — account name | bar | amount in one row
  hBarRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hBarLabel:  { width: 128, ...typography.tiny, color: colors.textSecondary, fontWeight: '600' },
  hBarTrack:  { flex: 1, height: 18, backgroundColor: colors.divider + '66', borderRadius: radius.sm, overflow: 'hidden' },
  hBarFill:   { height: '100%', borderRadius: radius.sm },
  hBarAmount: { width: 72, ...typography.tiny, color: colors.textPrimary, fontWeight: '700', textAlign: 'right' },
});

export default AnalyticsScreen;
