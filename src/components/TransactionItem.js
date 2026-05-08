import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDateTime } from '../utils/format';
import CategoryIcon from './CategoryIcon';

const TransactionItem = ({ txn, onPress }) => {
  const categories = useEPurseStore((s) => s.categories);
  const category = useMemo(
    () => categories.find((c) => c.id === txn.categoryId) || categories[categories.length - 1],
    [categories, txn.categoryId]
  );

  const isCredit = txn.type === 'credit';
  const sign = isCredit ? '+' : '−';
  const amountColor = isCredit ? colors.success : colors.textPrimary;

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={styles.card}>
      <CategoryIcon category={category} />

      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1}>
          {txn.merchant}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {category?.name} · {txn.accountType}
            {txn.accountMask ? ` ··${txn.accountMask}` : ''}
          </Text>
        </View>
        <Text style={styles.time}>{formatDateTime(txn.createdAt)}</Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.amount, { color: amountColor }]}>
          {sign} {formatCurrency(txn.amount)}
        </Text>
        {txn.isSplit ? (
          <View style={styles.splitTag}>
            <Text style={styles.splitText}>SPLIT</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm + 2,
    ...shadows.card,
  },
  middle: { flex: 1, marginLeft: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary },
  metaRow: { marginTop: 2 },
  meta: { ...typography.small, color: colors.textSecondary },
  time: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amount: { ...typography.bodyBold, fontWeight: '700' },
  splitTag: {
    marginTop: 4,
    backgroundColor: colors.info + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  splitText: { ...typography.tiny, color: colors.info, fontWeight: '700' },
});

export default TransactionItem;
