// =============================================================================
// LbEntryDetailSheet — what EVERY row on the person ledger opens (view first,
// then act — same rule as TxnDetailSheet). The tap is always this sheet; only
// its one button differs by where the entry came from:
//   editable (manual, or a booked Repayment) → Edit · other txn-backed → View
//   Transaction · group → Open Group
// so "why can't I edit this here" is answered once, in the sheet, not on every row.
// A txn-backed entry also shows the Account its money moved through.
// =============================================================================
import React, { useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Modal from './AppModal';
import EditIcon from './EditIcon';
import SheetCloseButton from './SheetCloseButton';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDate, firstName, titleCaseName } from '../utils/format';
import { ENTRY_LABEL } from '../constants/lbEntries';
import {
  lbEntrySign, lbEntrySource, lbEntryTitle, lbEntryTone,
  type LbDisplayEntry, type LbEntryTone,
} from '../utils/lbEntryDisplay';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Amount/icon ink for a row tone — the row and this sheet share it. */
export const lbToneInk = (tone: LbEntryTone, theme: { lent: string; borrowed: string }) =>
  tone === 'lent' ? theme.lent : tone === 'borrowed' || tone === 'outflow' ? theme.borrowed : colors.textPrimary;

interface SourceTxn { id: string; merchant?: string; source?: string }

interface Props {
  /** The tapped row; null = closed. */
  entry: LbDisplayEntry | null;
  person: string;
  /** The transaction behind a 'txn' entry, when it still exists. */
  sourceTxn?: SourceTxn | null;
  /** Edited here (manual row, or a booked Repayment whose edit moves its expense too). */
  editable: boolean;
  /** The account the backing transaction moved, e.g. "HDFC ··1111". */
  accountLabel?: string;
  onClose: () => void;
  onEdit: (entry: LbDisplayEntry) => void;
  onViewTxn: (txn: SourceTxn) => void;
  onOpenGroup: (entry: LbDisplayEntry) => void;
}

const HINT = {
  txn: 'Linked to a transaction — edit it there so your account balance stays right.',
  group: "Comes from this group's expenses — change them in the group.",
} as const;

export default function LbEntryDetailSheet({ entry, person, sourceTxn, editable, accountLabel, onClose, onEdit, onViewTxn, onOpenGroup }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'ios' ? insets.bottom : 0;
  // Keep painting the last entry while the sheet slides away, and stay mounted so
  // iOS fires onDismiss — the follow-up sheet must open only after this one is gone.
  const last = useRef<LbDisplayEntry | null>(null);
  if (entry) last.current = entry;
  const shown = entry || last.current;
  const pending = useRef<(() => void) | null>(null);

  const runPending = () => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  };
  const act = (fn: () => void) => {
    pending.current = fn;
    onClose();
    if (Platform.OS !== 'ios') runPending();
  };

  if (!shown) return null;
  const source = lbEntrySource(shown);
  const ink = lbToneInk(lbEntryTone(shown), theme as any);
  const who = firstName(titleCaseName(person)) || 'They';

  const rows: { label: string; value: string }[] = shown.isGroupLine
    ? [
        { label: 'Group', value: shown.groupName || 'Group' },
        { label: 'Balance', value: shown.kind === 'lent' ? `${who} owes you` : `You owe ${who}` },
      ]
    : [
        { label: 'Type', value: (ENTRY_LABEL as Record<string, string>)[shown.kind] || shown.kind },
        { label: 'Person', value: titleCaseName(person) },
        // A booked Repayment's merchant is just "Repaid Rohit" — the Type row already says it.
        ...(source === 'txn' && sourceTxn && !editable
          ? [{ label: 'From', value: `${sourceTxn.merchant || 'Transaction'}${sourceTxn.source === 'sms' ? ' · Bank SMS' : ''}` }]
          : []),
        ...(accountLabel ? [{ label: 'Account', value: accountLabel }] : []),
        ...(shown.settledAt ? [{ label: 'Status', value: `Settled ${formatDate(shown.settledAt)}` }] : []),
      ];

  const action =
    source === 'group' ? { title: 'Open Group', run: () => onOpenGroup(shown) }
    : editable ? { title: 'Edit', run: () => onEdit(shown) }
    : sourceTxn ? { title: 'View Transaction', run: () => onViewTxn(sourceTxn) }
    : null;
  const ctaInk = theme.primary;

  return (
    <Modal
      visible={!!entry}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      onDismiss={Platform.OS === 'ios' ? runPending : undefined}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: spacing.xl + bottomInset }]}>
          <View style={styles.handle} />
          {/* Action pill top-right — same spot and shape as TxnDetailSheet's Edit. */}
          <View style={styles.topRow}>
            <Text style={styles.title} numberOfLines={2}>{lbEntryTitle(shown)}</Text>
            {action ? (
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: ctaInk }]}
                onPress={() => act(action.run)}
                hitSlop={10}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                {editable && source !== 'group'
                  ? <EditIcon size={15} color={ctaInk} />
                  : <Ionicons name="open-outline" size={15} color={ctaInk} />}
                <Text style={[styles.actionTxt, { color: ctaInk }]}>{action.title}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.date}>
            {shown.isGroupLine ? `Last activity ${formatDate(shown.date)}` : formatDate(shown.date)}
          </Text>
          <Text style={[styles.amount, { color: ink }]}>{lbEntrySign(shown)} {formatCurrency(shown.amount)}</Text>

          <View style={styles.detailList}>
            {rows.map((r, i) => (
              <View key={r.label} style={[styles.detailRow, i === rows.length - 1 && styles.detailRowLast]}>
                <Text style={styles.detailLabel}>{r.label}</Text>
                <Text style={styles.detailValue} numberOfLines={2}>{r.value}</Text>
              </View>
            ))}
          </View>

          {source !== 'manual' && !editable ? <Text style={styles.hint}>{HINT[source]}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

// Same sheet frame as TxnDetailSheet, so the two read as one family.
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    minHeight: '30%',
    maxHeight: '85%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 4,
  },
  actionTxt: { ...typography.small, fontWeight: '700' },
  date: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  amount: { ...typography.display, marginTop: spacing.sm },
  detailList: { marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: spacing.sm + 1,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
  detailValue: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  hint: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md },
});
