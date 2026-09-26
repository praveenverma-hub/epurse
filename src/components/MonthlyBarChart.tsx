// =============================================================================
// MonthlyBarChart — last-N-months total-by-month bar strip.
// Promoted out of GroupDetailScreen.tsx (its own "Spend Trend" chart) once
// AccountDetailsScreen needed the same shape for a Balance Trend — one shared
// component instead of a second hand-rolled copy (see feedback_shared_components).
// =============================================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

export interface MonthlyBarDatum { key: string; label: string; total: number }

export default function MonthlyBarChart({
  data, color, allowNegative = false, valueFormatter = formatCompact,
}: {
  data: MonthlyBarDatum[];
  color: string;
  /** Bars for a negative total render in `theme.danger` and the caller's
   *  values are expected to already be real (signed) numbers — e.g. an
   *  overdrawn balance — rather than floored at 0 (the group spend-trend
   *  caller floors negatives itself before this ever sees them). */
  allowNegative?: boolean;
  valueFormatter?: (n: number) => string;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...data.map((d) => Math.abs(d.total)));
  const H = 96;
  return (
    <View style={styles.chartRow}>
      {data.map((d) => {
        const h = Math.max(3, (Math.abs(d.total) / max) * H);
        const isNeg = allowNegative && d.total < 0;
        return (
          <View key={d.key} style={styles.chartCol}>
            <Text style={[styles.chartValue, { color: theme.textSecondary }]} numberOfLines={1}>
              {d.total !== 0 ? valueFormatter(d.total) : ''}
            </Text>
            <View style={styles.chartBarTrack}>
              <View
                style={[
                  styles.chartBar,
                  { height: h, backgroundColor: d.total !== 0 ? (isNeg ? theme.danger : color) : theme.divider },
                ]}
              />
            </View>
            <Text style={[styles.chartLabel, { color: theme.textMuted }]}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', height: 96 + 36 },
  chartCol: { flex: 1, alignItems: 'center' },
  chartValue: { ...typography.tiny, marginBottom: 4 },
  chartBarTrack: { flex: 1, justifyContent: 'flex-end' },
  chartBar: { width: 18, borderRadius: 4 },
  chartLabel: { ...typography.tiny, marginTop: 6 },
});
