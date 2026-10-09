// =============================================================================
// SplitPositionView — the split section of TxnDetailSheet (plain split AND group
// split). Renders splitPosition().
// Each fact appears ONCE — the bill is already the sheet's big total, so:
//
//   ┌ You lent ₹600 ───────────────────────────┐  ← my net, the one derived number
//   Split 3 Ways                          Share
//   (Y) You · Paid ₹900                    ₹300
//   (R) Rohit · Owes you                   ₹300
//
// Wording rule lives with the model (utils/splitPosition.ts).
// =============================================================================
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, readableOn, spacing } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import { splitPosition, splitRelationLabel } from '../utils/splitPosition';

const LENT_INK = readableOn(colors.card, colors.lent);
const BORROWED_INK = readableOn(colors.card, colors.borrowed);

export default function SplitPositionView({ txn, group, accentColor }: { txn: any; group?: any; accentColor: string }) {
  const pos = splitPosition(txn, { group });
  if (!pos) return null;
  const billLabel = formatCurrency(pos.bill);
  const netInk = pos.net.kind === 'lent' ? LENT_INK : pos.net.kind === 'borrowed' ? BORROWED_INK : colors.textSecondary;
  const headline = pos.net.kind === 'lent'
    ? `You lent ${formatCurrency(pos.net.amount)}`
    : pos.net.kind === 'borrowed'
      ? `You borrowed ${formatCurrency(pos.net.amount)}`
      : pos.yourShare > 0 ? 'All yours — nothing owed' : 'Not involved — nothing owed';

  return (
    <View>
      <View style={[styles.position, { backgroundColor: netInk + '0F', borderColor: netInk + '33' }]}>
        <Text style={[styles.headline, { color: netInk }]}>{headline}</Text>
      </View>

      {/* Everyone on the bill — the number on the right is always a SHARE. */}
      <View style={styles.peopleHead}>
        <Text style={styles.peopleLabel}>Split {pos.people.length} Ways</Text>
        <Text style={styles.peopleLabel}>Share</Text>
      </View>
      {pos.people.map((p) => (
        <View key={p.key} style={styles.personRow}>
          <View style={[styles.avatar, { backgroundColor: accentColor + '1F' }]}>
            <Text style={[styles.avatarTxt, { color: accentColor }]}>{p.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.personMid}>
            <Text style={[styles.personName, p.isMe && { color: accentColor }]} numberOfLines={1}>{p.name}</Text>
            <Text style={[styles.personSub, p.isPayer && styles.personSubPayer]} numberOfLines={1}>
              {splitRelationLabel(p, { billLabel, payerName: pos.payer.name })}
            </Text>
          </View>
          <Text style={[styles.personShare, p.share <= 0 && styles.personShareNone]}>
            {p.share > 0 ? formatCurrency(p.share) : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  position: { borderRadius: radius.md, borderWidth: 1, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, marginBottom: spacing.md },
  headline: { fontSize: 15, fontWeight: '700' },
  peopleHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  peopleLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  personRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs + 2, gap: spacing.sm },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '700' },
  personMid: { flex: 1 },
  personName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  personSub: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginTop: 1 },
  personSubPayer: { color: readableOn(colors.card, colors.success), fontWeight: '600' },
  personShare: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  personShareNone: { color: colors.textMuted, fontWeight: '500' },
});
