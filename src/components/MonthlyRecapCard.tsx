// =============================================================================
// MonthlyRecapCard — the compact, no-scroll month-end summary.
// -----------------------------------------------------------------------------
// Shows only the glance (net saved, spent vs income, budget verdict, top
// category, a category ribbon) + a Download button. All the depth lives in the
// PDF the button generates (buildMonthlyReportHtml → expo-print → share sheet).
// Reused both on the Dashboard (persistent card) and inside MonthlyRecapModal.
// All figures come from the single source selectMonthlyReport(monthKey).
// =============================================================================

import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore, selectMonthlyReport } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatCompact } from '../utils/format';
import { useToast } from './Toast';
import { exportMonthlyRecap } from '../services/recapExport';

interface Palette {
  card: string; primary: string; divider: string; background: string;
  textPrimary: string; textSecondary: string; textMuted: string;
  success: string; danger: string;
}

export interface MonthlyRecapCardProps {
  monthKey: string;
  /** Show a "NEW" badge (first surfacing this month). */
  isNew?: boolean;
  /** Optional dismiss affordance (Dashboard shows it; modal hides it). */
  onDismiss?: () => void;
  /** Called after a successful export (e.g. to also close a modal). */
  onDownloaded?: () => void;
}

const MonthlyRecapCard: React.FC<MonthlyRecapCardProps> = ({ monthKey, isNew, onDismiss, onDownloaded }) => {
  const theme = useTheme() as Palette;
  const toast = useToast();
  const userName = useEPurseStore((s) => s.userName);

  // Recompute only when the inputs the report depends on actually change,
  // rather than returning a fresh object on every store update.
  const transactions      = useEPurseStore((s) => s.transactions);
  const budgetHistory     = useEPurseStore((s) => s.budgetHistory);
  const monthlyAggregates = useEPurseStore((s) => s.monthlyAggregates);
  const groups            = useEPurseStore((s) => s.groups);
  const accounts          = useEPurseStore((s) => s.accounts);
  const budgetStreak      = useEPurseStore((s) => s.budgetStreak);
  const recapOptions      = useEPurseStore((s) => s.recapOptions);
  const report = useMemo(
    () => selectMonthlyReport(monthKey, recapOptions)(useEPurseStore.getState()),
    [monthKey, recapOptions, transactions, budgetHistory, monthlyAggregates, groups, accounts, budgetStreak],
  );

  const [busy, setBusy] = useState(false);

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await exportMonthlyRecap(report, userName);
      if (res.outcome === 'saved') toast.success('Report saved', `PDF saved to ${res.location || 'your device'}.`);
      onDownloaded?.();
    } catch (e) {
      toast.error('Could not create the report', 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const cf = report.cashflow;
  const net = cf.net;
  const netPositive = net >= 0;
  const rate = Math.round((cf.savingsRate || 0) * 100);
  const styles = makeStyles(theme);

  // Category ribbon — top slices as a single stacked bar.
  const ribbonTotal = report.categories.reduce((s, c) => s + c.total, 0) || 1;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.head}>
        <View style={styles.badge}>
          <View style={styles.badgeIcon}><Ionicons name="bar-chart" size={15} color={theme.primary} /></View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{report.shortLabel} recap</Text>
            <Text style={styles.subtitle} numberOfLines={1}>Your month in numbers</Text>
          </View>
        </View>
        {isNew ? (
          <View style={styles.newPill}><Text style={styles.newPillText}>NEW</Text></View>
        ) : onDismiss ? (
          <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Dismiss recap">
            <Ionicons name="close" size={18} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {/* Hero: net saved + savings rate */}
      <View style={styles.hero}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heroLabel}>{netPositive ? 'Net saved' : 'Overspent'}</Text>
          <Text style={[styles.heroVal, { color: netPositive ? theme.success : theme.danger }]} numberOfLines={1}>
            {formatCurrency(Math.abs(net))}
          </Text>
        </View>
        <View style={[styles.rate, { backgroundColor: `${theme.success}1A` }]}>
          <Text style={[styles.rateVal, { color: theme.success }]}>{rate}%</Text>
          <Text style={[styles.rateLbl, { color: theme.success }]}>SAVED</Text>
        </View>
      </View>

      {/* Two mini stats */}
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statLbl}>SPENT</Text>
          <View style={styles.statRow}>
            <Text style={styles.statVal} numberOfLines={1}>{formatCompact(cf.spent)}</Text>
            {cf.spendDeltaPct != null && (
              <Text style={[styles.delta, { color: cf.spendDeltaPct < 0 ? theme.success : theme.danger, backgroundColor: `${cf.spendDeltaPct < 0 ? theme.success : theme.danger}1A` }]}>
                {cf.spendDeltaPct < 0 ? '▼' : '▲'}{Math.abs(Math.round(cf.spendDeltaPct))}%
              </Text>
            )}
          </View>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLbl}>INCOME</Text>
          <Text style={styles.statVal} numberOfLines={1}>{formatCompact(cf.income)}</Text>
        </View>
      </View>

      {/* Budget verdict + top category */}
      {(report.budget || report.categories[0]) && (
        <View style={styles.verdict}>
          {report.budget && report.budget.totalCap != null && (
            report.budget.status === 'over'
              ? <Text style={[styles.vPill, { color: theme.danger, backgroundColor: `${theme.danger}1A` }]}>{formatCompact(report.budget.overshoot)} over</Text>
              : <Text style={[styles.vPill, { color: theme.success, backgroundColor: `${theme.success}1A` }]}>{formatCompact(report.budget.saved)} under</Text>
          )}
          {report.budget && report.budget.streak > 0 && <Text style={styles.streak}>🔥 {report.budget.streak}</Text>}
          {report.categories[0] && (
            <Text style={styles.topCat} numberOfLines={1}>Top · {report.categories[0].emoji} {report.categories[0].name}</Text>
          )}
        </View>
      )}

      {/* Category ribbon */}
      {report.categories.length > 0 && (
        <View style={styles.ribbon}>
          {report.categories.slice(0, 8).map((c, i) => (
            <View key={i} style={{ width: `${(c.total / ribbonTotal) * 100}%`, backgroundColor: c.color, height: '100%' }} />
          ))}
        </View>
      )}

      {/* Download */}
      <Pressable
        onPress={handleDownload}
        disabled={busy}
        style={({ pressed }) => [styles.dlBtn, { backgroundColor: theme.primary }, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityLabel="Download monthly report as PDF"
      >
        {busy
          ? <ActivityIndicator color="#fff" size="small" />
          : <><Ionicons name="download-outline" size={17} color="#fff" /><Text style={styles.dlText}>Download report</Text></>}
      </Pressable>
      <Text style={styles.foot}>Full breakdown, charts &amp; plan-vs-actual in the PDF</Text>
    </View>
  );
};

export default MonthlyRecapCard;

const makeStyles = (theme: Palette) => StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: `${theme.primary}2E`,
    ...shadows.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
  badgeIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.primary}1F` },
  title: { ...typography.bodyBold, color: theme.textPrimary, fontWeight: '800' },
  subtitle: { ...typography.tiny, fontWeight: '500', color: theme.textMuted, marginTop: 1 },
  newPill: { backgroundColor: theme.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  newPillText: { color: '#fff', fontSize: 9.5, fontWeight: '900', letterSpacing: 0.4 },

  hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 14 },
  heroLabel: { ...typography.tiny, color: theme.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  heroVal: { fontSize: 29, fontWeight: '800', letterSpacing: -0.6, marginTop: 3 },
  rate: { alignItems: 'center', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 6 },
  rateVal: { fontSize: 17, fontWeight: '800' },
  rateLbl: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5, opacity: 0.9 },

  stats: { flexDirection: 'row', gap: 8, marginTop: 14 },
  stat: { flex: 1, backgroundColor: theme.background, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9 },
  statLbl: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.3, color: theme.textMuted },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  statVal: { fontSize: 15, fontWeight: '800', color: theme.textPrimary, flexShrink: 1 },
  delta: { fontSize: 10, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },

  verdict: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  vPill: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  streak: { fontSize: 12, fontWeight: '700', color: theme.textMuted },
  topCat: { fontSize: 12, fontWeight: '600', color: theme.textSecondary, marginLeft: 'auto', flexShrink: 1 },

  ribbon: { flexDirection: 'row', height: 8, borderRadius: 5, overflow: 'hidden', marginTop: 12, backgroundColor: theme.divider },

  dlBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 12, marginTop: 14 },
  dlText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  foot: { fontSize: 10.5, color: theme.textMuted, textAlign: 'center', marginTop: 9 },
});
