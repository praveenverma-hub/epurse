// =============================================================================
// GroupTxnDetailSheet — the full picture of ONE group transaction:
//   who paid · the total · the per-member split · YOUR position (owed / you owe).
// Pure presentation — reads everything off the txn's groupSplit; no store writes.
// =============================================================================
import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import EditIcon from './EditIcon';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDateTime } from '../utils/format';
import type { GroupSplit } from '../types/group';

// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

interface GroupTxn {
  merchant?: string;
  amount: number;
  createdAt?: string;
  categoryId?: string;
  isGroupMemo?: boolean;
  groupSplit?: GroupSplit;
}

interface GroupTxnDetailSheetProps {
  /** The tapped group transaction; null when closed. */
  txn: GroupTxn | null;
  onClose: () => void;
  /** When provided, an Edit pill opens the prefilled add-group-transaction flow. */
  onEdit?: (txn: GroupTxn) => void;
}

export default function GroupTxnDetailSheet({ txn, onClose, onEdit }: GroupTxnDetailSheetProps) {
  const theme = useTheme();
  if (!txn) return null;

  const amount = Number(txn.amount) || 0;
  const gs = txn.groupSplit;
  const shares = gs?.shares || [];
  const iPaid = gs?.paidByMemberId === 'me';
  const payerName = iPaid ? 'You' : (gs?.paidByName || 'Someone');
  const myShare = Number(shares.find((s) => s.memberId === 'me')?.shareAmount) || 0;
  const othersOwe = shares.filter((s) => s.memberId !== 'me' && (Number(s.shareAmount) || 0) > 0);

  return (
    <Modal visible={!!txn} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Header — full expense */}
          <View style={styles.topRow}>
            <Text style={styles.merchant} numberOfLines={1}>{txn.merchant || 'Group Expense'}</Text>
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
          <Text style={styles.total}>{formatCurrency(amount)}</Text>

          {gs ? (
            <>
              {/* Per-member split */}
              <Text style={styles.sectionLabel}>Split</Text>
              <ScrollView style={styles.splitList} showsVerticalScrollIndicator={false}>
                {shares.map((s) => {
                  const isMe = s.memberId === 'me';
                  const rowIsPayer = s.memberId === gs.paidByMemberId;
                  const label = isMe ? 'You' : (s.name || 'Member');
                  const shareAmt = Number(s.shareAmount) || 0;
                  return (
                    <View key={s.memberId} style={styles.splitRow}>
                      <View style={[styles.avatar, { backgroundColor: theme.primary + '22' }]}>
                        <Text style={[styles.avatarTxt, { color: theme.primary }]}>{label.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={styles.splitNameWrap}>
                        <Text style={[styles.splitName, isMe && styles.splitNameMe]} numberOfLines={1}>{label}</Text>
                        {rowIsPayer ? <Text style={styles.splitPaidTag}>paid the bill</Text> : null}
                      </View>
                      {rowIsPayer ? (
                        <Text style={[styles.splitAmt, { color: colors.success }]}>
                          {shareAmt > 0 ? formatCurrency(shareAmt) : '✓ Paid'}
                        </Text>
                      ) : shareAmt > 0 ? (
                        <Text style={styles.splitAmt}>{formatCurrency(shareAmt)}</Text>
                      ) : (
                        <Text style={styles.splitNotInvolved}>Not involved</Text>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              {/* Your position */}
              <View style={styles.positionBox}>
                <View style={styles.positionTopRow}>
                  <Text style={styles.positionLabel}>Your share</Text>
                  <Text style={styles.positionShare}>{formatCurrency(myShare)}</Text>
                </View>
                {iPaid ? (
                  othersOwe.length > 0 ? (
                    othersOwe.map((s) => (
                      <Text key={s.memberId} style={[styles.oweLine, { color: colors.success }]}>
                        {s.name} owes you {formatCurrency(Number(s.shareAmount) || 0)}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.settledLine}>No one owes you on this one.</Text>
                  )
                ) : (
                  myShare > 0 ? (
                    <Text style={[styles.oweLine, { color: colors.danger }]}>
                      You owe {payerName} {formatCurrency(myShare)}
                    </Text>
                  ) : (
                    <Text style={styles.settledLine}>You don&apos;t owe anything on this one.</Text>
                  )
                )}
              </View>
            </>
          ) : (
            <View style={styles.positionBox}>
              <Text style={styles.personalNote}>Personal expense — no split. Counts as your spend.</Text>
            </View>
          )}

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
    maxHeight: '85%',
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
  total:    { ...typography.display, color: colors.textPrimary, marginTop: spacing.sm },
  sectionLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.lg, marginBottom: spacing.xs },
  splitList: { maxHeight: 220 },
  splitRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.xs + 1,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarTxt:   { fontWeight: '800', fontSize: 12 },
  splitNameWrap: { flex: 1 },
  splitName:   { ...typography.body, color: colors.textPrimary },
  splitNameMe: { fontWeight: '700' },
  splitPaidTag: { ...typography.tiny, color: colors.success, fontWeight: '700', marginTop: 1 },
  splitNotInvolved: { ...typography.small, color: colors.textMuted, fontStyle: 'italic', fontWeight: '600' },
  splitAmt:    { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  positionBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1, borderColor: colors.divider,
  },
  positionTopRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  positionLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  positionShare: { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  oweLine:     { ...typography.body, fontWeight: '700', marginTop: 2 },
  settledLine: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  personalNote:{ ...typography.body, color: colors.textSecondary },
  closeBtn:    { marginTop: spacing.lg, alignItems: 'center' },
  closeTxt:    { ...typography.body, color: colors.textSecondary },
});
