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
import SheetCloseButton from './SheetCloseButton';
import { useEPurseStore } from '../store/ePurseStore';
import { useCategoryMaps } from '../hooks/useCategoryTree';
import { parentCatIdForTxn } from '../constants/twoTierCategories';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDateTime } from '../utils/format';

// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

interface SplitShare {
  contactId?: string | null;
  name?: string;
  shareAmount?: number;
}

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
  isSplit?: boolean;
  /** Set when a split's payer isn't the user — the txn is then a memo (no money moved). */
  isSplitMemo?: boolean;
  splitPaidBy?: { contactId: string | null; name: string } | null;
  myShareAmount?: number;
  splitWith?: SplitShare[];
}

interface TxnDetailSheetProps {
  /** The tapped transaction; null when closed. */
  txn: Txn | null;
  onClose: () => void;
  /**
   * Opens the full edit form for this txn (AddTransactionScreen, editTxnId mode) —
   * the same screen for split and plain alike, now that the split section lives
   * inline there. Historically split transactions never reached this sheet at all
   * (whole-card tap on a split row went straight to SplitDetailsModal, whose own
   * "Edit split" jumped straight into SplitConfigModal) — this prop is what lets
   * that stop being a separate island.
   */
  onEdit?: (txn: Txn) => void;
  /** "You" — same label SplitDetailsModal used, kept so a split row reads the same. */
  myName?: string;
}

const splitPct = (amount: number, share: number) => {
  const a = Number(amount) || 0;
  const s = Number(share) || 0;
  if (a <= 0) return 0;
  return Math.round((s / a) * 1000) / 10; // 1 decimal
};

export default function TxnDetailSheet({ txn, onClose, onEdit, myName }: TxnDetailSheetProps) {
  const theme = useTheme();
  const categories = useEPurseStore((s: any) => s.categories);
  // "Counts as expense" rule — see SpendRulesScreen.
  const excludedExpenseParents = useEPurseStore((s: any) => s.excludedExpenseParents);
  const catMaps = useCategoryMaps();
  const category = useMemo(
    () => (txn ? categories.find((c: any) => c.id === txn.categoryId) : null),
    [categories, txn?.categoryId],
  );

  // Same row shape SplitDetailsModal computed — this sheet takes over its viewing
  // role, so a split transaction's card tap shows the SAME breakdown it always did,
  // just alongside the rest of the transaction instead of in place of it.
  const splitRows = useMemo(() => {
    if (!txn?.isSplit) return [];
    const total = Number(txn.amount) || 0;
    const others = Array.isArray(txn.splitWith) ? txn.splitWith : [];
    const sumOthers = others.reduce((s, p) => s + (Number(p.shareAmount) || 0), 0);
    const mine = typeof txn.myShareAmount === 'number' ? txn.myShareAmount : Math.max(0, total - sumOthers);
    return [
      { key: 'me', name: myName || 'You', shareAmount: mine, percent: splitPct(total, mine), isMe: true },
      ...others.map((p, idx) => ({
        key: p.contactId || `o_${idx}`,
        name: p.name || 'Friend',
        shareAmount: Number(p.shareAmount) || 0,
        percent: splitPct(total, Number(p.shareAmount) || 0),
        isMe: false,
      })),
    ];
  }, [txn?.isSplit, txn?.amount, txn?.myShareAmount, txn?.splitWith, myName]);

  if (!txn) return null;

  const isCredit = txn.type === 'credit';
  const notCounted =
    !isCredit &&
    !!excludedExpenseParents?.length &&
    excludedExpenseParents.includes(parentCatIdForTxn(txn as any, catMaps));
  const sign = isCredit ? '+' : '−';
  const amountColor = isCredit ? colors.success : colors.textPrimary;

  const badges: { label: string; bg: string; color: string }[] = [];
  if (txn.isIgnored) badges.push({ label: 'IGNORED', bg: `${colors.warning}22`, color: colors.warning });
  if (!txn.isIgnored && txn.isHidden) badges.push({ label: 'PRIVATE', bg: `${colors.textMuted}26`, color: colors.textSecondary });
  if (txn.isRefund) badges.push({ label: 'REFUND', bg: `${colors.success}1A`, color: colors.success });
  // No SPLIT badge here: this sheet renders the full per-person breakdown below, headed
  // "Split N ways", so a chip saying the same word is pure duplication. (The badge is still
  // right on a transaction ROW — see TransactionItem — where there's no breakdown to read.)
  // MEMO stays: "someone else's money paid, nothing left your account" is NOT something the
  // breakdown states, so dropping it would lose real information.
  if (txn.isSplitMemo) badges.push({ label: 'MEMO', bg: `${colors.textMuted}26`, color: colors.textSecondary });
  // Earns its place here (§3e): nothing else in this sheet says the amount is excluded
  // from spend, and this is exactly where someone checks "why isn't this counted?".
  if (notCounted) badges.push({ label: 'NOT COUNTED', bg: `${colors.warning}1F`, color: colors.warning });

  const accountLabel = [txn.bankName || txn.accountType, txn.accountMask ? `··${txn.accountMask}` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal visible={!!txn} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />
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
            {/* The USER's note only. Never render `txn.smsText` (the bank message
                body) here — until Jul-31 the parser stored that in `note`, so this row
                showed the whole SMS on every auto-imported transaction. */}
            {txn.note ? (
              <View style={[styles.detailRow, !txn.isSplit && styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailValue} numberOfLines={3}>{txn.note}</Text>
              </View>
            ) : null}

            {/* Split breakdown — the same rows SplitDetailsModal used to show on its
                own, now sitting alongside amount/category/note instead of gating
                them behind a separate view. Inside the same ScrollView (not a
                second one below it) so a long friend list scrolls with everything
                else instead of risking an overflow past the sheet's own maxHeight. */}
            {txn.isSplit && splitRows.length > 0 ? (
              <View style={styles.splitSection}>
                <Text style={styles.splitSectionTitle}>
                  Split {splitRows.length - 1} way{splitRows.length - 1 === 1 ? '' : 's'}
                  {txn.splitPaidBy?.name ? ` · ${txn.splitPaidBy.name} paid` : ''}
                </Text>
                {splitRows.map((r) => (
                  <View key={r.key} style={styles.splitRow}>
                    <View style={styles.splitRowLeft}>
                      <Text style={[styles.splitName, r.isMe && { color: theme.primary }]} numberOfLines={1}>
                        {r.name}
                      </Text>
                      <Text style={styles.splitMeta}>{r.percent}%</Text>
                    </View>
                    <Text style={styles.splitAmt}>{formatCurrency(r.shareAmount)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>

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
  // Taller than before (was 260) — a split transaction can add several rows below
  // the plain detail fields, and this whole block now scrolls together.
  detailList: { marginTop: spacing.lg, maxHeight: 340 },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: spacing.sm + 1,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  detailValue: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  splitSection: { marginTop: spacing.md },
  splitSectionTitle: { ...typography.small, color: colors.textSecondary, fontWeight: '800', marginBottom: spacing.xs },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    marginBottom: 4,
  },
  splitRowLeft: { flex: 1, paddingRight: spacing.md },
  splitName: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  splitMeta: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  splitAmt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '800' },
});
