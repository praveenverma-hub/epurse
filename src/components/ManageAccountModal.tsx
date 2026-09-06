// =============================================================================
// ManageAccountModal — the "Manage Transaction" pattern (CategoryPickerModal),
// applied to accounts: one bottom sheet consolidating rename, type change,
// linking a debit card to its bank, read-only account details, and delete.
//
// Reads the account LIVE from the store by `accountId` (not a snapshot prop),
// so a rename/type-change made from inside the sheet reflects immediately.
// Unlink/unmerge is intentionally NOT built — linkDebitCardToBank stays one-way
// (see the store's own doc comment on that action).
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, TextStyle>;
import { useTheme } from '../hooks/useTheme';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_EMOJI, ACCOUNT_TYPE_LABEL } from '../constants/categories';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import SheetCloseButton from './SheetCloseButton';
import CenterModal from './CenterModal';
import LinkCardToBankSheet from './LinkCardToBankSheet';

type Account = {
  id: string;
  type: string;
  name: string;
  bankName?: string | null;
  mask?: string;
  aliasMasks?: string[];
  dueDay?: number;
  statementDay?: number;
};

interface ManageAccountModalProps {
  accountId: string | null;
  visible: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

const TYPE_OPTIONS = [
  ACCOUNT_TYPES.CASH,
  ACCOUNT_TYPES.WALLET,
  ACCOUNT_TYPES.DEBIT_CARD,
  ACCOUNT_TYPES.CREDIT_CARD,
  ACCOUNT_TYPES.BANK,
];

/** "5" → "5th" (only used here — no other screen needs a bill-cycle day spelled out). */
const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

const ManageAccountModal: React.FC<ManageAccountModalProps> = ({
  accountId,
  visible,
  onClose,
  onDeleted,
}) => {
  const theme = useTheme();
  const accounts = useEPurseStore((s: any) => s.accounts) as Account[];
  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
  const bankAccounts = useMemo(
    () => accounts.filter((a) => a.type === ACCOUNT_TYPES.BANK),
    [accounts],
  );
  const renameAccount = useEPurseStore((s: any) => s.renameAccount);
  const setAccountType = useEPurseStore((s: any) => s.setAccountType);
  const deleteAccount = useEPurseStore((s: any) => s.deleteAccount);
  const linkDebitCardToBank = useEPurseStore((s: any) => s.linkDebitCardToBank);

  const [nameDraft, setNameDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState<string>(ACCOUNT_TYPES.BANK);
  const [linkSheetVisible, setLinkSheetVisible] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string; message: string; primaryText: string; destructive?: boolean;
    secondaryText?: string; onSecondary?: () => void; onConfirm: () => void;
  } | null>(null);

  // Both drafts reset to the live account whenever a different one opens.
  // Nothing commits to the store until "Save changes" is pressed — a rename or a
  // type change are meaningful account edits, not something that should apply
  // silently mid-edit (e.g. on every keystroke or the moment a chip is tapped).
  useEffect(() => {
    if (visible) {
      setNameDraft(account?.name || '');
      setTypeDraft(account?.type || ACCOUNT_TYPES.BANK);
    }
  }, [visible, account?.id]);

  if (!account) return null;

  const nameValid = isValidName(nameDraft);
  const nameChanged = nameValid && nameDraft.trim() !== account.name;
  const typeChanged = typeDraft !== account.type;
  const hasChanges = nameChanged || typeChanged;
  // Block Save entirely while the name draft is invalid — even if the only real
  // change is the type — rather than silently discarding a bad name on save.
  const canSave = hasChanges && nameValid;

  const handleSaveChanges = () => {
    const trimmedName = nameDraft.trim();
    const applyRename = () => {
      if (nameChanged) renameAccount(account.id, trimmedName);
    };

    // Saving always ends the sheet — same "commit and close" contract as Delete
    // and Link below, not a reopen. Cancelling the type-change confirm is the
    // only path that returns you to the sheet (sheetVisible ungates once the
    // confirm clears with nothing committed).
    if (!typeChanged) {
      applyRename();
      onClose();
      return;
    }

    // Changing type is the one edit here with a real side effect (switching TO
    // Credit Card resets its outstanding-balance tracking — see setAccountType),
    // so it always gets its own confirmation, on top of requiring "Save changes".
    setConfirm({
      title: 'Change account type?',
      message:
        `Change "${account.name}" from ${ACCOUNT_TYPE_LABEL[account.type]} to `
        + `${ACCOUNT_TYPE_LABEL[typeDraft]}?`
        + (typeDraft === ACCOUNT_TYPES.CREDIT_CARD
          ? '\n\nIts balance tracking will reset — you\'ll need to confirm the outstanding amount again.'
          : ''),
      primaryText: 'Save',
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        applyRename();
        setAccountType(account.id, typeDraft);
        setConfirm(null);
        onClose();
      },
    });
  };

  const handleDelete = () => {
    setConfirm({
      title: 'Delete account?',
      message: `Delete "${account.name}"?\n\nTransactions will be kept but unlinked.`,
      primaryText: 'Delete',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        deleteAccount(account.id);
        setConfirm(null);
        onClose();
        onDeleted?.();
      },
    });
  };

  const handlePickBank = (bankId: string) => {
    const bank = bankAccounts.find((b) => b.id === bankId);
    setLinkSheetVisible(false);
    if (!bank) return;
    setConfirm({
      title: 'Link card to bank?',
      message: `We'll treat "${account.name}" as part of "${bank.name}" — one balance, counted once. This can't be auto-undone.`,
      primaryText: 'Link them',
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => {
        linkDebitCardToBank(account.id, bankId);
        setConfirm(null);
        onClose();
      },
    });
  };

  const linkedMasks = account.aliasMasks || [];
  const hasCycleInfo = account.type === ACCOUNT_TYPES.CREDIT_CARD && !!(account.dueDay || account.statementDay);
  const hasDetails = !!(account.bankName || account.mask || linkedMasks.length > 0 || hasCycleInfo);

  // Two native <Modal>s stacked at once is unreliable (the rest of the app never
  // does it — CenterModal confirmations elsewhere always close the sheet behind
  // them first, e.g. DailyQueueStack's handleDelete). So this sheet hides itself
  // — rather than staying visible underneath — whenever the link picker or a
  // confirmation is up, and reappears the instant that clears (cancel or confirm),
  // which is what actually makes Save/Delete/Link tappable at all.
  const sheetVisible = visible && !linkSheetVisible && !confirm;

  return (
    <>
      <Modal visible={sheetVisible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.overlay}>
          <SheetCloseButton onPress={onClose} />
          <View style={[styles.sheet, { backgroundColor: theme.card }]}>
            <View style={[styles.handle, { backgroundColor: theme.divider }]} />

            <View style={styles.headerRow}>
              <Text style={styles.headerEmoji}>{ACCOUNT_TYPE_EMOJI[account.type] || '💳'}</Text>
              <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
                {account.name}
              </Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
              {/* Rename — draft only; commits with everything else on "Save changes" */}
              <Text style={[styles.label, { color: theme.textSecondary }]}>Account name</Text>
              <TextInput
                value={nameDraft}
                onChangeText={(t) => setNameDraft(sanitizeName(t))}
                placeholder="Account name"
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.textPrimary, borderColor: theme.divider, backgroundColor: theme.background }]}
                maxLength={INPUT_LIMITS.NAME_MAX}
                returnKeyType="done"
              />

              {/* Type — draft only; same rule */}
              <Text style={[styles.label, { color: theme.textSecondary }]}>Account type</Text>
              <View style={styles.typeGrid}>
                {TYPE_OPTIONS.map((t) => {
                  const isSelected = typeDraft === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[
                        styles.typeChip,
                        { borderColor: theme.divider },
                        isSelected && { backgroundColor: theme.primary + '18', borderColor: theme.primary },
                      ]}
                      onPress={() => setTypeDraft(t)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.typeEmoji}>{ACCOUNT_TYPE_EMOJI[t]}</Text>
                      <Text
                        style={[
                          styles.typeLabel,
                          { color: theme.textPrimary },
                          isSelected && { color: theme.primary, fontWeight: '700' },
                        ]}
                      >
                        {ACCOUNT_TYPE_LABEL[t]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Read-only details — only shown when there's something real to say */}
              {hasDetails ? (
                <>
                  <Text style={[styles.label, { color: theme.textSecondary }]}>Account details</Text>
                  <View style={[styles.detailsCard, { backgroundColor: theme.background }]}>
                    {account.bankName || account.mask ? (
                      <Text style={[styles.detailLine, { color: theme.textPrimary }]}>
                        {account.bankName || account.type}
                        {account.mask ? `  ··${account.mask}` : ''}
                      </Text>
                    ) : null}
                    {linkedMasks.length > 0 ? (
                      <Text style={[styles.detailLine, { color: theme.textSecondary }]}>
                        {linkedMasks.length} card{linkedMasks.length > 1 ? 's' : ''} linked: {linkedMasks.map((m) => `··${m}`).join(', ')}
                      </Text>
                    ) : null}
                    {hasCycleInfo ? (
                      <Text style={[styles.detailLine, { color: theme.textSecondary }]}>
                        Bill cycle:
                        {account.statementDay ? ` closes around the ${ordinal(account.statementDay)}` : ''}
                        {account.dueDay ? ` · due around the ${ordinal(account.dueDay)}` : ''}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : null}

              {/* Link to a bank — Debit Card only */}
              {account.type === ACCOUNT_TYPES.DEBIT_CARD && bankAccounts.length > 0 ? (
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    { backgroundColor: theme.primary + '18', borderColor: theme.primary + '55' },
                  ]}
                  onPress={() => setLinkSheetVisible(true)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="git-merge-outline" size={18} color={theme.primary} style={styles.actionBtnIcon} />
                  <Text style={[styles.actionBtnText, { color: theme.primary }]}>Link Now</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>

            {/* Pinned footer, paired in one row — same 1:4 icon-button/filled-button
                language CategoryPickerModal uses for delete + a labelled action.
                Rename/type are drafts until Save is pressed; delete always stays
                live and one tap away from its own confirmation. */}
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteIconBtn, { backgroundColor: theme.danger }]}
                onPress={handleDelete}
                activeOpacity={0.85}
                accessibilityLabel="Delete account"
              >
                <Ionicons name="trash-outline" size={20} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.actionBtn,
                  styles.saveActionFill,
                  { backgroundColor: canSave ? theme.primary : theme.divider },
                ]}
                onPress={handleSaveChanges}
                disabled={!canSave}
                activeOpacity={0.85}
              >
                <Text style={[styles.actionBtnText, { color: canSave ? '#fff' : theme.textMuted }]}>
                  Save changes
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <LinkCardToBankSheet
        visible={linkSheetVisible}
        card={account}
        bankAccounts={bankAccounts}
        onClose={() => setLinkSheetVisible(false)}
        onLink={handlePickBank}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />
    </>
  );
};

export default ManageAccountModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000060',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl + 8,
    maxHeight: '85%',
    ...shadows.elevated,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerEmoji: { fontSize: 24 },
  title: { flex: 1, ...typography.h3, fontWeight: '700' },

  scroll: { paddingBottom: spacing.md },

  label: {
    ...typography.small,
    fontWeight: '700',
    marginBottom: spacing.xs + 2,
    marginTop: spacing.sm,
  },

  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    borderWidth: 1,
  },

  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeChip: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  typeEmoji: { fontSize: 18 },
  typeLabel: { ...typography.small, fontWeight: '600' },

  detailsCard: {
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  detailLine: { ...typography.small, lineHeight: 18 },

  // Matches CategoryPickerModal's action-button language (Manage Transaction) —
  // a filled/tinted, full-width, centered pill, never a bare bordered row.
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: spacing.sm,
  },
  actionBtnIcon: { marginRight: spacing.sm },
  actionBtnText: { ...typography.bodyBold, fontWeight: '700' },
  // Delete (icon-only, 20%) + Save changes (labelled, 80%) in one row — the exact
  // 1:4 split CategoryPickerModal uses for delete + its paired group action.
  // Pinned below the ScrollView, not inside it (BudgetPlanScreen's footer convention).
  footerRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  deleteIconBtn: { flex: 1, marginTop: 0 },
  saveActionFill: { flex: 4, marginTop: 0 },
});
