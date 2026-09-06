// =============================================================================
// LinkCardToBankSheet — pick which Bank account a Debit Card draws from, to fold
// it in via linkDebitCardToBank (same money, one balance). Extracted from
// AccountsScreen's inline bank-picker Modal — pure refactor, no behavior change,
// so ManageAccountModal can reuse the same sheet.
//
// This component only picks a bank — it does NOT call linkDebitCardToBank or show
// the "can't be auto-undone" confirmation itself. The caller's `onLink(bankId)`
// is expected to close this sheet AND show that confirm (see AccountsScreen).
// =============================================================================

import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, TextStyle>;
import { ACCOUNT_TYPE_EMOJI } from '../constants/categories';
import SheetCloseButton from './SheetCloseButton';

type Account = { id: string; name: string; type: string; mask?: string };

interface LinkCardToBankSheetProps {
  visible: boolean;
  card: Account | null;
  bankAccounts: Account[];
  onLink: (bankId: string) => void;
  onClose: () => void;
}

const LinkCardToBankSheet: React.FC<LinkCardToBankSheetProps> = ({
  visible,
  card,
  bankAccounts,
  onLink,
  onClose,
}) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.pickBackdrop}>
      <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
      <View style={styles.pickSheet}>
        <SheetCloseButton onPress={onClose} variant="absolute" />
        <View style={styles.pickHandle} />
        <Text style={styles.pickTitle}>Link {card?.name} to…</Text>
        <Text style={styles.pickHelp}>
          Pick the bank account this debit card draws from. They'll share one balance and
          be counted once in net worth.
        </Text>
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          {bankAccounts.map((b) => (
            <TouchableOpacity
              key={b.id}
              style={styles.pickRow}
              activeOpacity={0.75}
              onPress={() => onLink(b.id)}
            >
              <Text style={{ fontSize: 20, marginRight: spacing.sm }}>{ACCOUNT_TYPE_EMOJI[b.type]}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickRowName} numberOfLines={1}>{b.name}</Text>
                {b.mask ? <Text style={styles.pickRowSub}>··{b.mask}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.pickCancel} onPress={onClose}>
          <Text style={styles.pickCancelTxt}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

export default LinkCardToBankSheet;

const styles = StyleSheet.create({
  pickBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  pickSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl,
  },
  pickHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center', marginBottom: spacing.md },
  pickTitle:  { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  pickHelp:   { ...typography.small, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.sm },
  pickRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  pickRowName: { ...typography.bodyBold, color: colors.textPrimary },
  pickRowSub:  { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },
  pickCancel:  { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  pickCancelTxt: { ...typography.body, color: colors.textSecondary },
});
