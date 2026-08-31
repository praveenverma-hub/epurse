// =============================================================================
// MonthDivider — the section marker for transaction lists.
//
// Named for its first job (month boundaries) and now also used for GROUP headers
// via `label` — same pill, same rule, one place to restyle.
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
  /** A month boundary — rendered as "June 2026". */
  monthKey?: string;
  /**
   * Arbitrary section label, for a list sectioned by something other than time
   * (Activity's Group by → account / type / category).
   *
   * The same component on purpose: a month boundary and a group header are the
   * same VISUAL device, and two components would drift the first time the pill
   * was restyled. What differs is only where the text comes from — and the rule
   * about WHERE each one may be emitted lives in `utils/txnArrange`, not here.
   * `label` wins if both are given.
   */
  label?: string;
  /** When provided, shows a total inside the pill (right side). */
  total?: number;
  /**
   * Render the total QUIETLY — same colour as the label, lighter weight.
   *
   * For a marker whose total is secondary information (Activity's group headers:
   * you are scanning for the group, the money is context). A personal group's
   * month total is the point of that row, so it stays at full weight.
   *
   * Deliberately NOT `textMuted`: at 2.6:1 on the pill it would fail AA for
   * small text. Dropping the WEIGHT gets the same "don't look at me" effect
   * without making a number unreadable.
   */
  muted?: boolean;
  /** Prefix the total with '+' — the group is money IN, not spend. */
  income?: boolean;
}

export default function MonthDivider({ monthKey, label, total, muted, income }: MonthDividerProps) {
  const showTotal = typeof total === 'number';
  const text = label ?? monthLabel(monthKey ?? '');
  return (
    <View style={styles.row}>
      <View style={styles.line} />
      <View style={styles.pill}>
        <Text style={styles.label} numberOfLines={1}>{text}</Text>
        {showTotal ? (
          <>
            <Text style={styles.dot}>·</Text>
            <Text style={[styles.total, muted && styles.totalMuted]}>
              {income ? '+' : ''}{formatCompact(total as number)}
            </Text>
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
    // The transaction card above already has 12px (spacing.md) bottom margin, so a
    // small top margin here balances the visual gap above (12+2) vs. below (14) the divider.
    marginTop: spacing.xxs,
    marginBottom: spacing.md + 2,
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
    maxWidth: '78%',
  },
  label: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1 },
  dot:   { ...typography.tiny, color: colors.textMuted, fontWeight: '700' },
  total: { ...typography.tiny, color: colors.textPrimary, fontWeight: '800' },
  // Same colour as the label, two weights lighter. See the `muted` prop for why
  // this is not `textMuted`.
  totalMuted: { color: colors.textSecondary, fontWeight: '600' },
});
