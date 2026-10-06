// =============================================================================
// SplitTotalHint — "allocated X of Y · Z left" line under a split's share
// inputs, so nobody has to add the shares up by hand to see what remains.
// Shared by the plain and group split pages.
// =============================================================================
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import { isFullyAllocated, leftToAllocate } from '../utils/splitShares';

interface Props {
  /** `percent` shares are out of 100; `amount` shares are out of `total` ₹. */
  mode: 'percent' | 'amount';
  /** Sum of the shares currently entered (% or ₹, per `mode`). */
  sum: number;
  /** The whole bill, in ₹. Used for `amount` mode. */
  total: number;
}

export default function SplitTotalHint({ mode, sum, total }: Props) {
  const target = mode === 'percent' ? 100 : total;
  const left = leftToAllocate(sum, target);
  const done = isFullyAllocated(sum, target, mode);
  const fmt = (n: number) => (mode === 'percent' ? `${Math.round(n * 100) / 100}%` : formatCurrency(n));

  return (
    <View style={styles.row}>
      <Text style={styles.sum}>
        {fmt(sum)} of {fmt(target)}
      </Text>
      <Text style={[styles.status, done ? styles.ok : left > 0 ? styles.warn : styles.bad]}>
        {done ? '✓ Fully allocated' : left > 0 ? `${fmt(left)} left to allocate` : `${fmt(-left)} over`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs, gap: spacing.sm },
  sum: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  status: { fontSize: 12, fontWeight: '700' },
  ok: { color: colors.success },
  warn: { color: colors.warning },
  bad: { color: colors.danger },
});
