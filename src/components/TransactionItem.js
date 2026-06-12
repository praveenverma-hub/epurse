import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDateTime } from '../utils/format';
import { debitDisplayAmount, splitParticipantsLabel } from '../utils/split';
import CategoryIcon from './CategoryIcon';

const TransactionItem = ({ txn, onPress, onLongPress, onPressCategory, onPressSplitChip, hideGroupChip = false, muted = false }) => {
  const categories = useEPurseStore((s) => s.categories);
  const groups = useEPurseStore((s) => s.groups);
  const category = useMemo(
    () => categories.find((c) => c.id === txn.categoryId) || categories[categories.length - 1],
    [categories, txn.categoryId]
  );
  // Group membership is orthogonal to the status chip — a lent/borrow txn can also
  // sit in a group, so this renders as its OWN chip (group emoji + colour), not in
  // place of the SELF/LENT/BORROWED chip.
  const group = useMemo(
    () => (txn.groupId ? groups.find((g) => g.id === txn.groupId) : null),
    [groups, txn.groupId]
  );

  const isCredit = txn.type === 'credit';
  const sign = isCredit ? '+' : '−';
  const amountColor = isCredit ? colors.success : colors.textPrimary;
  const displayAmount = isCredit ? txn.amount : debitDisplayAmount(txn);
  const splitLabel = txn.isSplit ? splitParticipantsLabel(txn.splitWith) : '';
  const statusChip = getStatusChip(txn);
  const cardPressable = typeof onPress === 'function';

  return (
    <TouchableOpacity
      activeOpacity={cardPressable ? 0.8 : 1}
      onPress={cardPressable ? onPress : undefined}
      disabled={!cardPressable}
      style={[styles.card, muted && styles.cardMuted]}
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
          {!txn.isIgnored && txn.isHidden ? <Text style={styles.hiddenTag}>PRIVATE</Text> : null}
          {!hideGroupChip && group ? (
            <View style={[styles.groupChip, { backgroundColor: (group.color || colors.info) + '1A', borderColor: (group.color || colors.info) + '55' }]}>
              <Text style={styles.groupChipEmoji}>{group.emoji || '🗂'}</Text>
              <Text style={[styles.groupChipText, { color: group.color || colors.info }]} numberOfLines={1}>
                {group.name}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.time}>{formatDateTime(txn.createdAt)}</Text>
      </View>

      <View style={styles.right}>
        <TouchableOpacity
          onLongPress={onLongPress}
          activeOpacity={onLongPress ? 0.6 : 1}
          disabled={!onLongPress}
        >
          <Text style={[styles.amount, { color: amountColor }]}>
            {sign} {formatCurrency(displayAmount)}
          </Text>
        </TouchableOpacity>
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
  // Archived / pre-onboarding rows: flat, recessed card. NO elevation — dimming an
  // elevation-shadow card via a container `opacity` makes Android draw a hard grey
  // shadow box (the "distorted" look). A flat bordered card de-emphasises cleanly.
  cardMuted: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  categoryTap: { borderRadius: radius.md },
  middle: { flex: 1, marginLeft: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary },
  metaRow: { marginTop: 2, flexDirection: 'row', alignItems: 'center' },
  meta: { ...typography.small, color: colors.textSecondary, flexShrink: 1 },
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
  groupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    maxWidth: 130,
  },
  groupChipEmoji: { fontSize: 10, marginRight: 3 },
  groupChipText: {
    ...typography.tiny,
    fontWeight: '700',
    flexShrink: 1,
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

function getStatusChip(txn) {
  const categoryId = txn?.categoryId;
  // Self shows for either the legacy categoryId or the two-tier child label, so
  // both auto-detected and manually-tagged self transfers display the chip.
  if (categoryId === 'self' || txn?.childCategory === 'Self') {
    return { label: 'SELF', bg: '#6B72801A', border: '#6B728055', text: '#6B7280' };
  }
  if (categoryId === 'lent') return { label: 'LENT', bg: colors.success + '18', border: colors.success + '55', text: colors.success };
  if (categoryId === 'borrowed') return { label: 'BORROWED', bg: colors.info + '18', border: colors.info + '55', text: colors.info };
  if (categoryId === 'lent_settled') return { label: 'SETTLED', bg: '#14B8A61A', border: '#14B8A655', text: '#0F766E' };
  if (categoryId === 'borrow_repaid') return { label: 'REPAID', bg: '#6366F11A', border: '#6366F155', text: '#4F46E5' };
  return null;
}

export default TransactionItem;
