import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDateTime } from '../utils/format';
import { debitDisplayAmount, splitParticipantsLabel, groupLbChipKind } from '../utils/split';
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
  // Memo = someone else paid; no money left your account (it's a debt, not spend),
  // so de-emphasise its amount so it doesn't read as a real outflow.
  const isMemo = !!txn.isGroupMemo;
  const amountColor = isCredit ? colors.success : (isMemo ? colors.textMuted : colors.textPrimary);
  const displayAmount = isCredit ? txn.amount : debitDisplayAmount(txn);
  // In a group, a 0 personal share means I owe nothing → "Not involved".
  // Exception: if I'm the payer (fronted the bill, e.g. Full-owed split), I AM
  // involved — show what I actually paid instead.
  const isGroupTxn = !!txn.groupId;
  const iPaidGroup = txn.groupSplit?.paidByMemberId === 'me';
  const notInvolved = isGroupTxn && !isCredit && !iPaidGroup && (Number(displayAmount) || 0) === 0;
  const shownAmount = isGroupTxn && iPaidGroup && (Number(displayAmount) || 0) === 0
    ? (Number(txn.amount) || 0)
    : displayAmount;
  const splitLabel = txn.isSplit ? splitParticipantsLabel(txn.splitWith) : '';
  const statusChip = getStatusChip(txn);
  // A shared-group expense surfaces its lent/borrow framing as its OWN chip (the txn's
  // categoryId is the real spend category, so getStatusChip wouldn't catch it). Replaces
  // the old "Paid by X" text — borrow = I owe a share, lent = I fronted the whole bill.
  const groupLbChip = GROUP_LB_CHIP[groupLbChipKind(txn)] || null;
  // Group badge floats on the top-right corner (half in / half out of the card edge)
  // instead of sitting inline — keeps the meta row uncluttered when several chips
  // (status / lent-borrow / private) are present. Name capped to ~10 chars.
  const showGroupChip = !hideGroupChip && !!group;
  const groupLabel = showGroupChip ? truncateGroupName(group.name) : '';
  const cardPressable = typeof onPress === 'function';

  return (
    <TouchableOpacity
      activeOpacity={cardPressable ? 0.8 : 1}
      onPress={cardPressable ? onPress : undefined}
      disabled={!cardPressable}
      style={[styles.card, muted && styles.cardMuted, showGroupChip && styles.cardWithBadge]}
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
          {groupLbChip ? (
            <View style={[styles.statusChip, { backgroundColor: groupLbChip.bg, borderColor: groupLbChip.border }]}>
              <Text style={[styles.statusChipText, { color: groupLbChip.text }]}>{groupLbChip.label}</Text>
            </View>
          ) : null}
          {txn.isIgnored ? <Text style={styles.ignoredTag}>IGNORED</Text> : null}
          {!txn.isIgnored && txn.isHidden ? <Text style={styles.hiddenTag}>PRIVATE</Text> : null}
          {isMemo ? <Text style={styles.memoTag}>MEMO</Text> : null}
        </View>
        <Text style={styles.time}>{formatDateTime(txn.createdAt)}</Text>
      </View>

      <View style={styles.right}>
        <TouchableOpacity
          onLongPress={onLongPress}
          activeOpacity={onLongPress ? 0.6 : 1}
          disabled={!onLongPress}
        >
          {notInvolved ? (
            <Text style={styles.notInvolved}>Not involved</Text>
          ) : (
            <Text style={[styles.amount, { color: amountColor }]}>
              {sign} {formatCurrency(shownAmount)}
            </Text>
          )}
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

      {/* Floating group badge — straddles the top-right corner (≈50% in / 50% out). */}
      {showGroupChip ? (
        <View
          style={[
            styles.groupChipFloat,
            { backgroundColor: colors.card, borderColor: (group.color || colors.info) + '55' },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.groupChipFloatEmoji}>{group.emoji || '🗂'}</Text>
          <Text style={[styles.groupChipFloatText, { color: group.color || colors.info }]} numberOfLines={1}>
            {groupLabel}
          </Text>
        </View>
      ) : null}
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
    // Let the floating group badge poke above the top edge (don't clip it on Android).
    overflow: 'visible',
    ...shadows.card,
  },
  // When the floating group badge is present it pokes 10 px above the card top
  // (translateY: -10). Without a matching marginTop the badge clips into the card
  // above it; this gap exactly clears the overflow.
  cardWithBadge: { marginTop: 10 },
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
  // Floating corner badge: half above the card's top edge (translateY = -height/2),
  // inset from the right. Solid card-coloured fill + coloured border so it reads as a
  // pill sitting on the edge; small elevation/zIndex so it stays above neighbours.
  groupChipFloat: {
    position: 'absolute',
    top: 0,
    right: 12,
    transform: [{ translateY: -10 }],
    height: 20,
    maxWidth: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    // Match the inline chips' border (radius.sm + colour + '55').
    borderRadius: radius.sm,
    borderWidth: 1,
    zIndex: 3,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  groupChipFloatEmoji: { fontSize: 10, marginRight: 3 },
  groupChipFloatText: {
    ...typography.tiny,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
    includeFontPadding: false,
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
  // Memo = someone else paid; tracked as a debt, not counted in your spend totals
  // (kept quiet/neutral so it reads as "placeholder, not an actual transaction yet").
  memoTag: {
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.textMuted + '1F',
    color: colors.textMuted,
    ...typography.tiny,
    fontWeight: '700',
  },
  time: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  right: { alignItems: 'flex-end' },
  amount: { ...typography.bodyBold, fontWeight: '700' },
  notInvolved: { ...typography.small, color: colors.textMuted, fontStyle: 'italic', fontWeight: '600' },
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

// Cap the floating group badge to ~10 chars so a long group name can't widen the
// corner pill (icon + name). Longer names get an ellipsis.
function truncateGroupName(name) {
  const s = (name || '').trim();
  return s.length > 10 ? `${s.slice(0, 9).trimEnd()}…` : s;
}

// Chip styling for a group expense's lent/borrow framing — same palette as the
// LENT/BORROWED status chips below so a group debt reads identically to a direct one.
const GROUP_LB_CHIP = {
  lent:     { label: 'LENT',     bg: colors.success + '18', border: colors.success + '55', text: colors.success },
  borrowed: { label: 'BORROWED', bg: colors.info + '18',    border: colors.info + '55',    text: colors.info },
};

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
