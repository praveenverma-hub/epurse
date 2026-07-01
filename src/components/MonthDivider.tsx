// =============================================================================
// MonthDivider — a month boundary marker for date-desc transaction lists.
//
// A thin rule across the row with a centred rounded pill naming the month. Pass
// `total` to also show that month's spend inside the pill (used by personal
// groups — "June 2026 · ₹12.5k"). Without `total` it's a plain labelled line
// (Activity + Account Details). Purely presentational.
// =============================================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { formatCompact } from '../utils/format';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

/** 'YYYY-MM' → "June 2026". */
function monthLabel(monthKey: string): string {
  const [y, m] = String(monthKey).split('-').map(Number);
  if (!y || !m) return '';
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

interface MonthDividerProps {
  monthKey: string;
  /** When provided, shows the month's total inside the pill (right side). */
  total?: number;
}

export default function MonthDivider({ monthKey, total }: MonthDividerProps) {
  const showTotal = typeof total === 'number';
  return (
    <View style={styles.row}>
      <View style={styles.line} />
      <View style={styles.pill}>
        <Text style={styles.label}>{monthLabel(monthKey)}</Text>
        {showTotal ? (
          <>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.total}>{formatCompact(total as number)}</Text>
          </>
        ) : null}
      </View>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  label: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.3 },
  dot:   { ...typography.tiny, color: colors.textMuted, fontWeight: '700' },
  total: { ...typography.tiny, color: colors.textPrimary, fontWeight: '800' },
});
