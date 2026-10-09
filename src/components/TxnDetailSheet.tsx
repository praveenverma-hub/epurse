// =============================================================================
// TxnDetailSheet — THE detail view for every transaction (view-first, then edit):
// plain, split, personal-group and shared-group alike — one sheet, so they all
// show the same rows (Category · Group · Account · Location · Note) and the same
// split section. Pure presentation, no store writes; the Edit pill hands off to
// the full transaction form, except linked lend/borrow entries keep Manage.
// =============================================================================
import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from "./AppModal";
import EditIcon from './EditIcon';
import SheetCloseButton from './SheetCloseButton';
import { useEPurseStore } from '../store/ePurseStore';
import { useCategoryMaps } from '../hooks/useCategoryTree';
import { parentCatIdForTxn } from '../constants/twoTierCategories';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDateTime } from '../utils/format';
import SplitPositionView from './SplitPositionView';
import { locationKey } from '../utils/location';
import { CARD_CONTEXT, txnAccountLabel, txnPayerName } from '../utils/txnCardModel';
import type { GroupSplit } from '../types/group';

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
  type: 'debit' | 'credit' | string;
  categoryId?: string;
  accountId?: string;
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
  groupId?: string;
  groupSplit?: GroupSplit;
  /** Someone else in the group paid — no money left my account. */
  isGroupMemo?: boolean;
  lbLocked?: boolean;
  /** Coarse place stamped at capture time (manual add or a live incoming SMS
   *  only — see services/locationService). City-level only; district/region
   *  are the fallback when the geocoder couldn't name a city. */
  location?: { city?: string | null; district?: string | null; region?: string | null } | null;
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
  /** Unused since the split section moved to SplitPositionView (always "You"); kept for callers. */
  myName?: string;
  /** Same axis as the card's: 'group' (Group Detail) drops the Group row — the page is the group. */
  context?: string;
}


export default function TxnDetailSheet({ txn, onClose, onEdit, context = CARD_CONTEXT.DEFAULT }: TxnDetailSheetProps) {
  const theme = useTheme();
  const categories = useEPurseStore((s: any) => s.categories);
  const groups = useEPurseStore((s: any) => s.groups);
  const accounts = useEPurseStore((s: any) => s.accounts);
  // "Counts as expense" rule — see SpendRulesScreen.
  const excludedExpenseParents = useEPurseStore((s: any) => s.excludedExpenseParents);
  const catMaps = useCategoryMaps();
  const category = useMemo(
    () => (txn ? categories.find((c: any) => c.id === txn.categoryId) : null),
    [categories, txn?.categoryId],
  );

  // Which goal(s), if any, this transaction currently auto-funds — a pure
  // read against the goal's own rule, nothing stored on the transaction (see
  // `getGoalsForTxn`). Grab the FUNCTION via a stable selector and call it
  // inline, same pattern the Goals screen uses for its getters: subscribing
  // to the function's OUTPUT instead would re-render on every store change,
  // since a fresh array is built on every call.
  const getGoalsForTxn = useEPurseStore((s: any) => s.getGoalsForTxn);
  const matchedGoals = useMemo(
    () => (txn ? getGoalsForTxn(txn) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txn?.id, txn?.categoryId, txn?.isIgnored, txn?.isSplitMemo, txn?.merchant, getGoalsForTxn],
  );

  if (!txn) return null;

  const isCredit = txn.type === 'credit';
  const notCounted =
    !isCredit &&
    !!excludedExpenseParents?.length &&
    excludedExpenseParents.includes(parentCatIdForTxn(txn as any, catMaps));
  const sign = isCredit ? '+' : '−';
  const amountColor = isCredit ? colors.income : colors.textPrimary;

  const badges: { label: string; bg: string; color: string }[] = [];
  if (txn.isIgnored) badges.push({ label: 'IGNORED', bg: `${colors.warning}22`, color: colors.warning });
  if (!txn.isIgnored && txn.isHidden) badges.push({ label: 'PRIVATE', bg: `${colors.textMuted}26`, color: colors.textSecondary });
  if (txn.isRefund) badges.push({ label: 'REFUND', bg: colors.incomeSoft, color: colors.income });
  // No SPLIT badge here: this sheet renders the full per-person breakdown below, headed
  // "Split N ways", so a chip saying the same word is pure duplication. (The badge is still
  // right on a transaction ROW — see TransactionItem — where there's no breakdown to read.)
  // No MEMO badge either (Oct-9-26): the split section's "You paid ₹0 · You borrowed ₹X ·
  // You owe Rohit" now says "someone else's money paid" in plain words.
  // Earns its place here (§3e): nothing else in this sheet says the amount is excluded
  // from spend, and this is exactly where someone checks "why isn't this counted?".
  if (notCounted) badges.push({ label: 'EXCLUDED', bg: `${colors.warning}1F`, color: colors.warning });

  const group = txn.groupId ? groups.find((g: any) => g.id === txn.groupId) || null : null;
  const showGroup = !!group && context !== CARD_CONTEXT.GROUP;
  // Someone else paid ⇒ no account of mine moved; the split list's first row names the payer.
  const account = txn.accountId ? accounts.find((a: any) => a.id === txn.accountId) : null;
  const accountLabel = txnPayerName(txn as any, group) ? '' : txnAccountLabel(txn, account);
  const hasSplit = !!txn.groupSplit?.shares?.length || !!txn.isSplit;
  // City-only for now (per user request) — `locationKey` already falls back to
  // district/region when the geocoder couldn't name a city, so this still shows
  // SOMETHING useful rather than nothing on the rare city-less fix.
  const place = locationKey(txn.location);
  const isLastRow = !txn.note && !hasSplit;

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
            {/* Surfaces a link that already exists — a goal's auto-rule was
                matching this transaction before this row existed, it just had
                nowhere to say so. Nothing is stored here; it's a live check
                against every goal's rule (see `getGoalsForTxn`), so editing a
                goal's rule or this transaction's category changes what shows
                here on the very next open, never a stale answer. */}
            {matchedGoals.length > 0 ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Counts toward</Text>
                <Text style={styles.detailValue} numberOfLines={2}>
                  {matchedGoals.map((g: any) => `${g.emoji} ${g.name}`).join('  ·  ')}
                </Text>
              </View>
            ) : null}
            {showGroup ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Group</Text>
                <Text style={styles.detailValue} numberOfLines={1}>
                  {group.emoji ? `${group.emoji} ${group.name}` : group.name}
                </Text>
              </View>
            ) : null}
            {accountLabel ? (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Account</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{accountLabel}</Text>
              </View>
            ) : null}
            {place ? (
              <View style={[styles.detailRow, isLastRow && styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Location</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{place}</Text>
              </View>
            ) : null}
            {/* The USER's note only. Never render `txn.smsText` (the bank message
                body) here — until Jul-31 the parser stored that in `note`, so this row
                showed the whole SMS on every auto-imported transaction. */}
            {txn.note ? (
              <View style={[styles.detailRow, !hasSplit && styles.detailRowLast]}>
                <Text style={styles.detailLabel}>Note</Text>
                <Text style={styles.detailValue} numberOfLines={3}>{txn.note}</Text>
              </View>
            ) : null}

            {/* Split breakdown — the same rows SplitDetailsModal used to show on its
                own, now sitting alongside amount/category/note instead of gating
                them behind a separate view. Inside the same ScrollView (not a
                second one below it) so a long friend list scrolls with everything
                else instead of risking an overflow past the sheet's own maxHeight. */}
            {hasSplit ? (
              <View style={styles.splitSection}>
                <SplitPositionView txn={txn} group={group} accentColor={theme.primary} />
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
  total:    { ...typography.display, marginTop: spacing.sm },
  badgeRow: { flexDirection: 'row', gap: 6, marginTop: spacing.sm },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  badgeText: { ...typography.tiny, fontWeight: '800' },
  // Shrinks to fit the sheet's maxHeight, so a long group member list scrolls with the rows.
  detailList: { marginTop: spacing.lg, flexShrink: 1 },
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
});
