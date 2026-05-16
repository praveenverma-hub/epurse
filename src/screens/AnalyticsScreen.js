// =============================================================================
// AnalyticsScreen — monthly category breakdown using bar chart + progress rings
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Svg, { Circle, G, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency } from '../utils/format';

const SCREEN_W = Dimensions.get('window').width;

const AnalyticsScreen = ({ navigation, headerless = false }) => {
  const [monthOffset, setMonthOffset] = useState(0); // 0 = this month, -1 = last month
  const date = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const breakdown = useEPurseStore((s) => s.getCategoryBreakdown(date));
  const monthSpend = useEPurseStore((s) => s.getMonthlySpend(date));
  const monthIncome = useEPurseStore((s) => s.getMonthlyIncome(date));

  const monthLabel = date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <View style={styles.container}>
      {!headerless ? (
        <LinearGradient
          colors={[colors.gradientBlueStart, colors.gradientBlueEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <SafeAreaView edges={['top']}>
            <View style={styles.headerRow}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                <Text style={styles.backText}>←</Text>
              </TouchableOpacity>
              <Text style={styles.title}>Analytics</Text>
              <View style={{ width: 40 }} />
            </View>

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
              <SummaryStat label="Earned" value={monthIncome} />
              <SummaryStat label="Net" value={monthIncome - monthSpend} />
            </View>
          </SafeAreaView>
        </LinearGradient>
      ) : (
        /* headerless mode — compact light strip shown inside InsightsScreen */
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
            <SummaryStatLight label="Spent"  value={monthSpend} />
            <SummaryStatLight label="Earned" value={monthIncome} />
            <SummaryStatLight label="Net"    value={monthIncome - monthSpend} />
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {/* Bar chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Spend by category</Text>
          {breakdown.length === 0 ? (
            <Text style={styles.empty}>No spending recorded for this month.</Text>
          ) : (
            <BarChart data={breakdown} />
          )}
        </View>

        {/* Progress rings */}
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

        <View style={{ height: 40 }} />
      </ScrollView>
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
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { fontSize: 22, color: '#fff' },
  title: { color: '#fff', ...typography.h2 },

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

  body: { padding: spacing.lg, marginTop: -spacing.lg },

  section: {
    backgroundColor: colors.card,
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
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

  // Headerless mode — light background month/stats strip
  headerlessStrip: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  monthSwitcherLight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  arrowLight:      { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  monthLabelLight: { color: colors.textPrimary, ...typography.bodyBold, fontWeight: '700' },
  summaryRowLight: { flexDirection: 'row', gap: spacing.sm },
  statBoxLight: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  statLabelLight: { color: colors.textSecondary, ...typography.tiny },
  statValueLight: { color: colors.textPrimary, ...typography.bodyBold, fontWeight: '700', marginTop: 2 },
});

export default AnalyticsScreen;
