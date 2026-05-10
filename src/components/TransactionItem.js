import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDateTime } from '../utils/format';
import { debitDisplayAmount, splitParticipantsLabel } from '../utils/split';
import CategoryIcon from './CategoryIcon';

const TransactionItem = ({ txn, onPress, onPressCategory, onPressSplitChip }) => {
  const categories = useEPurseStore((s) => s.categories);
  const category = useMemo(
    () => categories.find((c) => c.id === txn.categoryId) || categories[categories.length - 1],
    [categories, txn.categoryId]
  );

  const isCredit = txn.type === 'credit';
  const sign = isCredit ? '+' : '−';
  const amountColor = isCredit ? colors.success : colors.textPrimary;
  const displayAmount = isCredit ? txn.amount : debitDisplayAmount(txn);
  const splitLabel = txn.isSplit ? splitParticipantsLabel(txn.splitWith) : '';
  const statusChip = getStatusChip(txn.categoryId);
  const cardPressable = typeof onPress === 'function';

  return (
    <TouchableOpacity
      activeOpacity={cardPressable ? 0.8 : 1}
      onPress={cardPressable ? onPress : undefined}
      disabled={!cardPressable}
      style={styles.card}
    >
      <TouchableOpacity
        activeOpacity={onPressCategory ? 0.75 : 1}
        onPress={onPressCategory}
        disabled={!onPressCategory}
        style={styles.categoryTap}
      >
        <CategoryIcon category={category} />
      </TouchableOpacity>

      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1}>
          {txn.merchant}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {category?.name} · {txn.accountType}
            {txn.accountMask ? ` ··${txn.accountMask}` : ''}
          </Text>
          {statusChip ? (
            <View style={[styles.statusChip, { backgroundColor: statusChip.bg, borderColor: statusChip.border }]}>
              <Text style={[styles.statusChipText, { color: statusChip.text }]}>{statusChip.label}</Text>
            </View>
          ) : null}
          {txn.isIgnored ? <Text style={styles.ignoredTag}>IGNORED</Text> : null}
          {!txn.isIgnored && txn.isHidden ? <Text style={styles.hiddenTag}>HIDDEN</Text> : null}
        </View>
        <Text style={styles.time}>{formatDateTime(txn.createdAt)}</Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.amount, { color: amountColor }]}>
          {sign} {formatCurrency(displayAmount)}
        </Text>
        {txn.isSplit ? (
          <TouchableOpacity
            style={styles.splitTag}
            activeOpacity={onPressSplitChip ? 0.8 : 1}
            onPress={onPressSplitChip ? () => onPressSplitChip(txn) : undefined}
            disabled={!onPressSplitChip}
          >
            <View style={styles.splitRow}>
              <Text style={styles.splitIcon}>👥</Text>
              {splitLabel ? (
                <Text style={styles.splitNames} numberOfLines={1}>
                  {splitLabel}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
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
  categoryTap: { borderRadius: radius.md },
  middle: { flex: 1, marginLeft: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary },
  metaRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center' },
  meta: { ...typography.small, color: colors.textSecondary },
  statusChip: {
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  statusChipText: {
    ...typography.tiny,
    fontWeight: '700',
  },
  hiddenTag: {
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.textMuted + '26',
    color: colors.textSecondary,
    ...typography.tiny,
    fontWeight: '700',
  },
  ignoredTag: {
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.warning + '22',
    color: colors.warning,
    ...typography.tiny,
    fontWeight: '700',
  },
  time: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amount: { ...typography.bodyBold, fontWeight: '700' },
  splitTag: {
    marginTop: 4,
    alignItems: 'flex-end',
    backgroundColor: colors.info + '22',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    maxWidth: 120,
  },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 112 },
  splitIcon: { fontSize: 12 },
  splitNames: {
    ...typography.tiny,
    color: colors.textSecondary,
    fontWeight: '600',
    maxWidth: 112,
  },
});

function getStatusChip(categoryId) {
  if (categoryId === 'lent') return { label: 'LENT', bg: colors.success + '18', border: colors.success + '55', text: colors.success };
  if (categoryId === 'borrowed') return { label: 'BORROWED', bg: colors.info + '18', border: colors.info + '55', text: colors.info };
  if (categoryId === 'lent_settled') return { label: 'SETTLED', bg: '#14B8A61A', border: '#14B8A655', text: '#0F766E' };
  if (categoryId === 'borrow_repaid') return { label: 'REPAID', bg: '#6366F11A', border: '#6366F155', text: '#4F46E5' };
  return null;
}

export default TransactionItem;
