// =============================================================================
// SplitBreakdownLines — each person's ₹ share + a Total, rendered INSIDE the
// Split row of the entry forms' value card (never as a card of its own), so the
// division is visible without opening the split page. Amounts are SHARES; the
// payer is marked "paid ₹<bill>" (wording rule: utils/splitPosition.ts).
// =============================================================================
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, readableOn, spacing, DIVIDER_W } from '../constants/theme';
import { formatCurrency } from '../utils/format';

export interface SplitBreakdownRow {
  name: string;
  /** This person's SHARE. */
  amount: number;
  /** Fronted the bill — labelled "paid ₹<bill>" so their share can't be misread as what they paid. */
  isPayer?: boolean;
}

export default function SplitBreakdownLines({ rows }: { rows: SplitBreakdownRow[] }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <View style={styles.body}>
      {rows.map((r, i) => (
        <View key={`${r.name}_${i}`} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            {r.name}
            {r.isPayer ? <Text style={styles.tag}>{`  paid ${formatCurrency(total)}`}</Text> : null}
          </Text>
          <Text style={styles.amt}>{formatCurrency(r.amount)}</Text>
        </View>
      ))}
      <View style={[styles.row, styles.totalRow]}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalAmt}>{formatCurrency(total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingLeft: spacing.md + 28 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4, gap: spacing.sm },
  name: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.textPrimary },
  tag: { fontSize: 11, fontWeight: '600', color: readableOn(colors.card, colors.success) },
  amt: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  totalRow: { borderTopWidth: DIVIDER_W, borderTopColor: colors.divider, marginTop: 2 },
  totalLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  totalAmt: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
});
