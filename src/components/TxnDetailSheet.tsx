// =============================================================================
// TxnDetailSheet — plain-transaction detail view (view-first, then edit).
// Mirrors GroupTxnDetailSheet / SplitDetailsModal so EVERY transaction card,
// whatever kind it is, shows details before editing — not just group/split
// ones. Pure presentation, no store writes; the Edit pill hands off to
// CategoryPickerModal (the actual manage sheet) just like the other two.
// =============================================================================
import React, { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import EditIcon from './EditIcon';
import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDateTime } from '../utils/format';

// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

interface Txn {
  id: string;
  merchant?: string;
  amount: number;
  type: 'debit' | 'credit';
  categoryId?: string;
  accountType?: string;
  accountMask?: string;
  bankName?: string;
  createdAt?: string;
  note?: string;
  isHidden?: boolean;
  isRefund?: boolean;
  isIgnored?: boolean;
}

interface TxnDetailSheetProps {
  /** The tapped transaction; null when closed. */
  txn: Txn | null;
  onClose: () => void;
  /** Opens the manage sheet (CategoryPickerModal) for this txn. */
  onEdit?: (txn: Txn) => void;
}

export default function TxnDetailSheet({ txn, onClose, onEdit }: TxnDetailSheetProps) {
  const theme = useTheme();
  const categories = useEPurseStore((s: any) => s.categories);
  const category = useMemo(
    () => (txn ? categories.find((c: any) => c.id === txn.categoryId) : null),
    [categories, txn?.categoryId],
  );

  if (!txn) return null;

  const isCredit = txn.type === 'credit';
  const sign = isCredit ? '+' : '−';
  const amountColor = isCredit ? colors.success : colors.textPrimary;

  const badges: { label: string; bg: string; color: string }[] = [];
  if (txn.isIgnored) badges.push({ label: 'IGNORED', bg: `${colors.warning}22`, color: colors.warning });
  if (!txn.isIgnored && txn.isHidden) badges.push({ label: 'PRIVATE', bg: `${colors.textMuted}26`, color: colors.textSecondary });
  if (txn.isRefund) badges.push({ label: 'REFUND', bg: `${colors.success}1A`, color: colors.success });

  const accountLabel = [txn.bankName || txn.accountType, txn.accountMask ? `··${txn.accountMask}` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal visible={!!txn} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.topRow}>
            <Text style={styles.merchant} numberOfLines={1}>{txn.merchant || 'Transaction'}</Text>
            {onEdit ? (
              <TouchableOpacity
                style={[styles.editBtn, { borderColor: theme.primary }]}
                onPress={() => onEdit(txn)}
                hitSlop={10}
                activeOpacity={0.8}
              >
                <EditIcon size={15} color={theme.primary} />
                <Text style={[styles.editTxt, { color: theme.primary }]}>Edit</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {txn.createdAt ? <Text style={styles.date}>{formatDateTime(txn.createdAt)}</Text> : null}
          <Text style={[styles.total, { color: amountColor }]}>{sign} {formatCurrency(txn.amount)}</Text>

          {badges.length > 0 ? (
            <View style={styles.badgeRow}>
              {badges.map((b) => (
                <View key={b.label} style={[styles.badge, { backgroundColor: b.bg }]}>
                  <Text style={[styles.badgeText, { color: b.color }]}>{b.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <ScrollView style={styles.detailList} showsVerticalScrollIndicator={false}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Category</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {category ? `${category.emoji} ${category.name}` : 'Uncategorized'}
              </Text>
            </View>
            {accountLabel ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Account</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{accountLabel}</Text>
              </View>
            ) : null}
            {txn.note ? (
              <View style={[styles.detailRow, styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailValue} numberOfLines={3}>{txn.note}</Text>
              </View>
            ) : null}
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeTxt}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss:  { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '75%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  topRow:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  merchant: { ...typography.h2, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 4,
  },
  editTxt:  { ...typography.small, fontWeight: '700' },
  date:     { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  total:    { ...typography.display, marginTop: spacing.sm },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: spacing.sm },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  badgeText: { ...typography.tiny, fontWeight: '800' },
  detailList: { marginTop: spacing.lg, maxHeight: 260 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: spacing.sm + 1,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  detailValue: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  closeBtn: { marginTop: spacing.lg, alignItems: 'center' },
  closeTxt: { ...typography.body, color: colors.textSecondary },
});
