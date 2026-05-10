import React, { useMemo } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency } from '../utils/format';

const pct = (amount, share) => {
  const a = Number(amount) || 0;
  const s = Number(share) || 0;
  if (a <= 0) return 0;
  return Math.round((s / a) * 1000) / 10; // 1 decimal
};

export default function SplitDetailsModal({ visible, txn, myName, onClose, onEdit }) {
  const rows = useMemo(() => {
    if (!txn) return [];
    const total = Number(txn.amount) || 0;
    const mine = typeof txn.myShareAmount === 'number' ? txn.myShareAmount : null;
    const others = Array.isArray(txn.splitWith) ? txn.splitWith : [];
    const sumOthers = others.reduce((s, p) => s + (Number(p.shareAmount) || 0), 0);
    const myShare = mine != null ? mine : Math.max(0, total - sumOthers);

    return [
      {
        key: 'me',
        name: myName || 'You',
        shareAmount: myShare,
        percent: pct(total, myShare),
        isMe: true,
      },
      ...others.map((p, idx) => ({
        key: p.contactId || `o_${idx}`,
        name: p.name || 'Friend',
        shareAmount: Number(p.shareAmount) || 0,
        percent: pct(total, Number(p.shareAmount) || 0),
        isMe: false,
      })),
    ];
  }, [txn, myName]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Split details</Text>
          {txn?.merchant ? (
            <Text style={styles.sub} numberOfLines={1}>
              {txn.merchant} · {formatCurrency(txn.amount)}
            </Text>
          ) : null}

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {rows.map((r) => (
              <View key={r.key} style={styles.row}>
                <View style={styles.rowLeft}>
                  <Text style={[styles.name, r.isMe && styles.me]} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={styles.meta}>{r.percent}%</Text>
                </View>
                <Text style={styles.amt}>{formatCurrency(r.shareAmount)}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.secondaryText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onEdit}
              activeOpacity={0.85}
              disabled={!txn}
            >
              <Text style={styles.primaryText}>Edit split</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
    ...shadows.card,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  sub: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  list: { maxHeight: 360 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    marginBottom: spacing.xs,
  },
  rowLeft: { flex: 1, paddingRight: spacing.md },
  name: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  me: { color: colors.primary },
  meta: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  amt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '800' },
  btnRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  secondaryText: { ...typography.bodyBold, color: colors.textSecondary, fontWeight: '700' },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryText: { ...typography.bodyBold, color: '#fff', fontWeight: '800' },
});

