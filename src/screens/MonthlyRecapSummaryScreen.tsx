// =============================================================================
// MonthlyRecapSummaryScreen — the complete in-app version of a monthly report.
//
// The month-end modal is a glance, not a document viewer. This screen lets the
// user inspect the same source report without first exporting sensitive data.
// The PDF remains an optional portable copy and is protected by an explicit
// destination/security warning before generation.
// =============================================================================

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { selectMonthlyReport, useEPurseStore } from '../store/ePurseStore';
import type { MonthlyReport } from '../utils/monthlyReportHtml';
import { useTheme } from '../hooks/useTheme';
import { exportMonthlyRecap } from '../services/recapExport';
import { formatCompact, formatCurrency } from '../utils/format';
import { radius, shadows, spacing, typography as typographyBase } from '../constants/theme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';

const typography = typographyBase as unknown as Record<string, TextStyle>;

type Props = {
  navigation: { goBack: () => void };
  route: { params?: { monthKey?: string; previewReport?: MonthlyReport } };
};

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.background }]}>
      <Text style={[styles.statLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color: tone || theme.textPrimary }]} numberOfLines={1}>{value}</Text>
    </View>
  );
};

const MonthlyRecapSummaryScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const toast = useToast();
  const previewReport = route.params?.previewReport;
  const monthKey = route.params?.monthKey || previewReport?.monthKey || '';
  const userName = useEPurseStore((s) => s.userName);
  const recapOptions = useEPurseStore((s) => s.recapOptions);
  const transactions = useEPurseStore((s) => s.transactions);
  const budgetHistory = useEPurseStore((s) => s.budgetHistory);
  const monthlyAggregates = useEPurseStore((s) => s.monthlyAggregates);
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const budgetStreak = useEPurseStore((s) => s.budgetStreak);
  const storeReport = useMemo(
    () => selectMonthlyReport(monthKey, recapOptions)(useEPurseStore.getState()) as MonthlyReport,
    [monthKey, recapOptions, transactions, budgetHistory, monthlyAggregates, groups, accounts, budgetStreak],
  );
  const report = previewReport ?? storeReport;
  const [confirmExport, setConfirmExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const download = async () => {
    if (exporting) return;
    setConfirmExport(false);
    setExporting(true);
    try {
      const result = await exportMonthlyRecap(report, userName || undefined);
      if (result.outcome === 'saved') toast.success('Report saved', `PDF saved to ${result.location || 'your device'}.`);
    } catch {
      toast.error('Could not create the report', 'Please try again in a moment.');
    } finally {
      setExporting(false);
    }
  };

  const cf = report.cashflow;
  const netPositive = cf.net >= 0;
  const categoryMax = Math.max(1, ...report.categories.map((c) => c.total));
  const dailyMax = Math.max(1, ...(report.daily || []).map((d) => d.amount));
  const budgetPct = report.budget?.totalCap
    ? Math.min(100, Math.round((report.budget.totalActual / report.budget.totalCap) * 100))
    : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title={`${report.shortLabel} summary`}
        onBack={navigation.goBack}
        tint={theme.textPrimary}
        titleColor={theme.textPrimary}
        bordered
        surfaceColor={theme.card}
        dividerColor={theme.divider}
      />

      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: theme.card, borderColor: `${theme.primary}2E` }]}>
          <Text style={[styles.eyebrow, { color: theme.primary }]}>{report.monthLabel.toUpperCase()}</Text>
          <Text style={[styles.heroLabel, { color: theme.textSecondary }]}>{netPositive ? 'Net saved' : 'Overspent'}</Text>
          <Text style={[styles.heroValue, { color: netPositive ? theme.income : theme.expense }]}>
            {formatCurrency(Math.abs(cf.net))}
          </Text>
          <Text style={[styles.heroSub, { color: theme.textSecondary }]}>
            {Math.round((cf.savingsRate || 0) * 100)}% of income saved
            {cf.spendDeltaPct != null ? ` · ${Math.abs(Math.round(cf.spendDeltaPct))}% ${cf.spendDeltaPct <= 0 ? 'less' : 'more'} spent than last month` : ''}
          </Text>
        </View>

        <View style={styles.statRow}>
          <Stat label="SPENT" value={formatCompact(cf.spent)} />
          <Stat label="INCOME" value={formatCompact(cf.income)} />
          <Stat label="REFUNDS" value={formatCompact(cf.refunds || 0)} />
        </View>

        {report.budget ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.sectionHead}>
              <View>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Budget performance</Text>
                <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>Plan compared with actual spending</Text>
              </View>
              {budgetPct != null ? <Text style={[styles.pct, { color: theme.primary }]}>{budgetPct}%</Text> : null}
            </View>
            {report.budget.totalCap != null ? (
              <>
                <View style={[styles.track, { backgroundColor: theme.divider }]}>
                  <View style={[styles.fill, { width: `${budgetPct || 0}%`, backgroundColor: report.budget.status === 'over' ? theme.danger : theme.primary }]} />
                </View>
                <View style={styles.budgetNumbers}>
                  <Text style={[styles.muted, { color: theme.textSecondary }]}>{formatCurrency(report.budget.totalActual)} spent</Text>
                  <Text style={[styles.strong, { color: report.budget.status === 'over' ? theme.danger : theme.success }]}>
                    {report.budget.status === 'over' ? `${formatCurrency(report.budget.overshoot)} over` : `${formatCurrency(report.budget.saved)} remaining`}
                  </Text>
                </View>
              </>
            ) : null}
            {report.budget.rows.length > 0 ? (
              <View style={styles.list}>
                {report.budget.rows.map((row) => (
                  <View key={row.name} style={styles.categoryTop}>
                    <Text style={[styles.categoryName, { color: theme.textPrimary }]} numberOfLines={1}>{row.name}</Text>
                    <Text style={[styles.muted, { color: row.over ? theme.danger : theme.textSecondary }]}>
                      {formatCompact(row.actual)} / {formatCompact(row.cap)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {report.budget.streak > 0 ? (
              <Text style={[styles.sectionSub, { color: theme.textSecondary, marginTop: spacing.md }]}>
                {report.budget.streak}-month budget streak
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Category breakdown</Text>
          <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>Where your money went</Text>
          <View style={styles.list}>
            {report.categories.map((category) => (
              <View key={category.name} style={styles.categoryRow}>
                <Text style={styles.emoji}>{category.emoji}</Text>
                <View style={styles.categoryBody}>
                  <View style={styles.categoryTop}>
                    <Text style={[styles.categoryName, { color: theme.textPrimary }]}>{category.name}</Text>
                    {category.moverPct != null ? (
                      <Text style={[styles.categoryPct, { color: category.moverPct > 0 ? theme.danger : theme.success, width: undefined }]}>
                        {category.moverPct > 0 ? '▲' : '▼'}{Math.abs(Math.round(category.moverPct))}%
                      </Text>
                    ) : null}
                    <Text style={[styles.categoryAmount, { color: theme.textPrimary }]}>{formatCurrency(category.total)}</Text>
                    <Text style={[styles.categoryPct, { color: theme.textMuted }]}>{Math.round(category.percent)}%</Text>
                  </View>
                  <View style={[styles.categoryTrack, { backgroundColor: `${category.color}20` }]}>
                    <View style={[styles.categoryFill, { width: `${(category.total / categoryMax) * 100}%`, backgroundColor: category.color }]} />
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

        {(report.noSpendDays != null || report.peakDay || report.biggest) ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Monthly patterns</Text>
            <View style={styles.patternGrid}>
              {report.noSpendDays != null ? <Stat label="NO-SPEND DAYS" value={String(report.noSpendDays)} tone={theme.success} /> : null}
              {report.peakDay ? <Stat label="HIGHEST-SPEND DAY" value={`${report.peakDay.weekday} · ${formatCompact(report.peakDay.amount)}`} /> : null}
              {report.biggest ? <Stat label="BIGGEST EXPENSE" value={formatCompact(report.biggest.amount)} /> : null}
            </View>
            {report.weekdayAvg != null && report.weekendAvg != null ? (
              <View style={styles.patternGrid}>
                <Stat label="WEEKDAY AVG" value={formatCompact(report.weekdayAvg)} />
                <Stat label="WEEKEND AVG" value={formatCompact(report.weekendAvg)} />
              </View>
            ) : null}
            {report.daily && report.daily.length > 0 ? (
              <View style={styles.dailyBars}>
                {report.daily.map((d) => (
                  <View
                    key={d.day}
                    style={[styles.dailyBar, {
                      height: Math.max(2, (d.amount / dailyMax) * 56),
                      backgroundColor: d.amount > 0 ? theme.primary : theme.divider,
                    }]}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {report.merchants && report.merchants.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Top Merchants</Text>
            {report.merchants.map((m) => (
              <View key={m.name} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]} numberOfLines={1}>{m.name}</Text>
                <Text style={[styles.muted, { color: theme.textMuted, marginRight: spacing.sm }]}>{m.count} txns</Text>
                <Text style={[styles.strong, { color: theme.textPrimary }]}>{formatCurrency(m.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.subscriptions.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.sectionHead}>
              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Subscriptions</Text>
              <Text style={[styles.strong, { color: theme.textPrimary }]}>{formatCurrency(report.subscriptionTotal)}</Text>
            </View>
            {report.subscriptions.map((sub) => (
              <View key={sub.merchant} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]} numberOfLines={1}>{sub.merchant}</Text>
                {sub.priceHike ? (
                  <Text style={[styles.muted, { color: theme.danger, marginRight: spacing.sm }]}>
                    ▲ {formatCompact((sub.hikeTo || 0) - (sub.hikeFrom || 0))}
                  </Text>
                ) : null}
                <Text style={[styles.strong, { color: theme.textPrimary }]}>{formatCurrency(sub.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.paymentMethods && report.paymentMethods.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Payment Methods</Text>
            {report.paymentMethods.map((pm) => (
              <View key={pm.label} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]} numberOfLines={1}>{pm.label}</Text>
                <Text style={[styles.strong, { color: theme.textPrimary }]}>{formatCurrency(pm.total)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.highlights.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Highlights</Text>
            {report.highlights.map((h) => (
              <View key={h.text} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Ionicons
                  name={h.kind === 'pos' ? 'checkmark-circle-outline' : h.kind === 'neg' ? 'alert-circle-outline' : 'information-circle-outline'}
                  size={18}
                  color={h.kind === 'pos' ? theme.success : h.kind === 'neg' ? theme.danger : theme.textSecondary}
                  style={{ marginRight: spacing.sm }}
                />
                <Text style={[styles.simpleName, { color: theme.textPrimary }]}>{h.text}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.groupSpend.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Groups and trips</Text>
            {report.groupSpend.map((group) => (
              <View key={group.name} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={styles.emoji}>{group.emoji}</Text>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]}>{group.name}</Text>
                <Text style={[styles.strong, { color: theme.textPrimary }]}>{formatCurrency(group.total)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.incomeSources && report.incomeSources.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Income Sources</Text>
            <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>What your income is made of</Text>
            <View style={styles.list}>
              {report.incomeSources.map((i) => (
                <View key={i.name} style={styles.categoryRow}>
                  <Text style={styles.emoji}>{i.emoji}</Text>
                  <View style={styles.categoryBody}>
                    <View style={styles.categoryTop}>
                      <Text style={[styles.categoryName, { color: theme.textPrimary }]} numberOfLines={1}>{i.name}</Text>
                      <Text style={[styles.categoryAmount, { color: theme.income }]}>{formatCurrency(i.total)}</Text>
                      <Text style={[styles.categoryPct, { color: theme.textMuted }]}>{Math.round(i.percent)}%</Text>
                    </View>
                    <View style={[styles.categoryTrack, { backgroundColor: `${i.color}20` }]}>
                      <View style={[styles.categoryFill, { width: `${i.percent}%`, backgroundColor: i.color }]} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {report.notCounted ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Not Counted as Spend</Text>
            <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>Money that moved but isn’t in Spent</Text>
            <View style={styles.patternGrid}>
              <Stat label="MONEY OUT" value={formatCompact(report.notCounted.totalOut)} />
              <Stat label="MONEY IN" value={formatCompact(report.notCounted.totalIn)} />
            </View>
            {report.notCounted.rows.map((row) => (
              <View key={row.name} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]} numberOfLines={1}>{row.name}</Text>
                <Text style={[styles.strong, { color: theme.textPrimary }]}>
                  {[row.out ? `out ${formatCompact(row.out)}` : null, row.in ? `in ${formatCompact(row.in)}` : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.goals?.length > 0 ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Goals</Text>
            <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>Set aside this month</Text>
            <View style={styles.list}>
              {report.goals.map((g) => {
                const pct = g.planned > 0 ? Math.min(100, Math.round((g.funded / g.planned) * 100)) : 100;
                return (
                  <View key={g.id} style={styles.categoryRow}>
                    <Text style={styles.emoji}>{g.emoji}</Text>
                    <View style={styles.categoryBody}>
                      <View style={styles.categoryTop}>
                        <Text style={[styles.categoryName, { color: theme.textPrimary }]} numberOfLines={1}>{g.name}</Text>
                        <Text style={[styles.categoryAmount, { color: theme.textPrimary }]}>
                          {formatCompact(g.funded)}{g.planned > 0 ? ` / ${formatCompact(g.planned)}` : ''}
                        </Text>
                      </View>
                      <View style={[styles.categoryTrack, { backgroundColor: `${g.color}20` }]}>
                        <View style={[styles.categoryFill, { width: `${pct}%`, backgroundColor: g.color }]} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {report.lb ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Lent & Borrowed</Text>
            <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>Outstanding now</Text>
            <View style={styles.patternGrid}>
              <Stat label="OWED TO YOU" value={formatCompact(report.lb.owedToYou)} tone={theme.lent} />
              <Stat label="YOU OWE" value={formatCompact(report.lb.youOwe)} tone={theme.borrowed} />
            </View>
            {report.lb.lent || report.lb.borrowed || report.lb.settledBack || report.lb.repaid ? (
              <Text style={[styles.sectionSub, { color: theme.textSecondary, marginTop: spacing.md }]}>
                This month:{' '}
                {[
                  report.lb.lent ? `lent ${formatCompact(report.lb.lent)}` : null,
                  report.lb.borrowed ? `borrowed ${formatCompact(report.lb.borrowed)}` : null,
                  report.lb.settledBack ? `received back ${formatCompact(report.lb.settledBack)}` : null,
                  report.lb.repaid ? `repaid ${formatCompact(report.lb.repaid)}` : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            {report.lb.people.map((p) => (
              <View key={p.name} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]} numberOfLines={1}>{p.name}</Text>
                <Text style={[styles.strong, { color: p.net > 0 ? theme.lent : theme.borrowed }]}>
                  {p.net > 0 ? 'owes you ' : 'you owe '}{formatCurrency(Math.abs(p.net))}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {report.accounts ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Accounts & Net Worth</Text>
            <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>Balances now</Text>
            <View style={styles.patternGrid}>
              <Stat label="NET WORTH" value={formatCompact(report.accounts.netWorth)} />
              <Stat label="ASSETS" value={formatCompact(report.accounts.assets)} />
              <Stat label="LIABILITIES" value={formatCompact(report.accounts.liabilities)} />
            </View>
            {report.accounts.rows.map((a) => (
              <View key={a.label + a.type} style={[styles.simpleRow, { borderBottomColor: theme.divider }]}>
                <Text style={[styles.simpleName, { color: theme.textPrimary }]} numberOfLines={1}>{a.label}</Text>
                <Text style={[styles.strong, { color: a.balance < 0 ? theme.danger : theme.textPrimary }]}>
                  {a.balance < 0 ? '−' : ''}{formatCurrency(Math.abs(a.balance))}{a.isCard && a.balance < 0 ? ' due' : ''}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.plan, { backgroundColor: `${theme.primary}12`, borderColor: `${theme.primary}35` }]}>
          <Ionicons name="sparkles-outline" size={22} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Planning ahead</Text>
            <Text style={[styles.sectionSub, { color: theme.textSecondary }]}>
              Suggested budget for next month, from your {formatCompact(report.plan.avgSpend)} recent average
              {report.plan.watchCategories.length ? `. Watch ${report.plan.watchCategories.slice(0, 2).join(' & ')} — over this month.` : '.'}
            </Text>
          </View>
          <Text style={[styles.planValue, { color: theme.primary }]}>{formatCompact(report.plan.suggestedBudget)}</Text>
        </View>

        <Pressable
          onPress={() => setConfirmExport(true)}
          disabled={exporting}
          style={({ pressed }) => [styles.download, { backgroundColor: theme.primary }, pressed && { opacity: 0.9 }]}
        >
          {exporting ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={18} color="#fff" />}
          <Text style={styles.downloadText}>{exporting ? 'Creating PDF…' : 'Download PDF report'}</Text>
        </Pressable>
        <Text style={[styles.privacy, { color: theme.textMuted }]}>The PDF is created on this device and is not uploaded by ePurse.</Text>
      </ScrollView>

      <CenterModal
        visible={confirmExport}
        title="Download private report?"
        message="This PDF may contain sensitive financial information. ePurse creates it on this device and does not upload it. After you save or share it, its security depends on the location or app you choose. Please store and share it carefully."
        primaryText="Download PDF"
        secondaryText="Cancel"
        onPrimary={download}
        onSecondary={() => setConfirmExport(false)}
        onClose={() => setConfirmExport(false)}
      />
    </SafeAreaView>
  );
};

export default MonthlyRecapSummaryScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  hero: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, ...shadows.card },
  eyebrow: { ...typography.tiny, fontWeight: '900', letterSpacing: 1.2 },
  heroLabel: { ...typography.small, marginTop: spacing.md, fontWeight: '700' },
  heroValue: { fontSize: 34, fontWeight: '900', letterSpacing: -0.8, marginTop: 2 },
  heroSub: { ...typography.small, marginTop: spacing.xs, lineHeight: 19 },
  statRow: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, minWidth: 0, borderRadius: radius.md, padding: spacing.md },
  statLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  statValue: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  card: { borderRadius: radius.lg, padding: spacing.lg, ...shadows.card },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sectionTitle: { ...typography.h3, fontWeight: '800' },
  sectionSub: { ...typography.small, marginTop: 2 },
  pct: { fontSize: 20, fontWeight: '900' },
  track: { height: 9, borderRadius: 5, overflow: 'hidden', marginTop: spacing.lg },
  fill: { height: '100%', borderRadius: 5 },
  budgetNumbers: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  muted: { ...typography.small },
  strong: { ...typography.small, fontWeight: '800' },
  list: { marginTop: spacing.md, gap: spacing.md },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emoji: { fontSize: 20, width: 28, textAlign: 'center' },
  categoryBody: { flex: 1 },
  categoryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  categoryName: { ...typography.small, fontWeight: '700', flex: 1 },
  categoryAmount: { ...typography.small, fontWeight: '800' },
  categoryPct: { ...typography.tiny, width: 30, textAlign: 'right' },
  categoryTrack: { height: 5, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  categoryFill: { height: '100%', borderRadius: 3 },
  dailyBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 56, marginTop: spacing.md },
  dailyBar: { flex: 1, borderRadius: 1.5 },
  patternGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  simpleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  simpleName: { ...typography.small, fontWeight: '700', flex: 1 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg },
  planValue: { fontSize: 20, fontWeight: '900' },
  download: { minHeight: 48, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  downloadText: { color: '#fff', ...typography.bodyBold, fontWeight: '800' },
  privacy: { ...typography.tiny, textAlign: 'center', lineHeight: 16 },
});
