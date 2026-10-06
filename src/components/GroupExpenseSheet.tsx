// =============================================================================
// GroupExpenseSheet — bottom-sheet shell around GroupExpenseForm.
// Used when tagging an EXISTING transaction to a group from the Activity flow
// (Dashboard / Transactions / DailyQueueStack). The Groups-tab "+" FAB uses the
// full-screen AddGroupExpenseScreen instead — both share GroupExpenseForm.
// =============================================================================
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from "./AppModal";
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import GroupExpenseForm from './GroupExpenseForm';
import SheetCloseButton from './SheetCloseButton';
import FormFooterActions from './FormFooterActions';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import type { Group, GroupExpenseData } from '../types/group';

interface GroupExpenseSheetProps {
  visible: boolean;
  /** Target group — must be set when visible. */
  group: Group | null;
  onClose: () => void;
  onAdd: (expenseData: GroupExpenseData) => void;
  /** When tagging an EXISTING transaction, its amount — prefilled and locked here. */
  presetAmount?: number;
  /**
   * EDIT/COMPLETE mode: prefill from this already-grouped txn (amount, category, who
   * paid, split) so the user can set/adjust "who owes" + category in one place. Used
   * by the review queue for Group-Zone-tagged txns (default: paid by me, equal split).
   */
  editTxn?: any;
  /** Show the in-form category picker (default hidden — set when category isn't chosen elsewhere). */
  showCategory?: boolean;
  /** Lock the payer to "You" (real account debit — see GroupExpenseForm). */
  lockPayerToMe?: boolean;
}

export default function GroupExpenseSheet({ visible, group, onClose, onAdd, presetAmount, editTxn, showCategory = false, lockPayerToMe = false }: GroupExpenseSheetProps) {
  const submitRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  // Guarded here rather than in each of the 3 callers (Dashboard/Transactions/
  // DailyQueueStack) that supply `onAdd` — one fix covers every entry point.
  const { submit, submitting } = useSubmitGuard();
  if (!group) return null;
  const isEdit = !!editTxn;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
          <SheetCloseButton onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView
              style={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.bodyContent}
            >
              <Text style={styles.title}>{isEdit ? 'Who owes?' : 'Add Expense'}</Text>
              {/* Name the group explicitly — matches AddGroupExpenseScreen's header. */}
              <Text style={[styles.subtitle, !isEdit && { marginBottom: spacing.md }]} numberOfLines={1}>
                Group · {group.emoji ? `${group.emoji} ` : ''}{group.name}
              </Text>
              {isEdit ? (
                <Text style={styles.subtitle}>Paid by you by default — set how it splits and the category.</Text>
              ) : null}

              <GroupExpenseForm
                group={group}
                visible={visible}
                presetAmount={presetAmount}
                editTxn={editTxn}
                lockPayerToMe={lockPayerToMe}
                onAdd={(expenseData: GroupExpenseData) => submit(() => onAdd(expenseData))}
                hideCategory={!showCategory}
                hideSubmit
                submitRef={submitRef}
                onReadyChange={setReady}
              />
            </ScrollView>

            {/* Pinned footer — the shared Cancel + submit row. */}
            <View style={styles.footer}>
              <FormFooterActions
                onCancel={onClose}
                submit={ready ? { title: isEdit ? 'Save' : 'Add Expense', onPress: () => submitRef.current?.(), loading: submitting } : null}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss:    { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    maxHeight: '90%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },
  // flexShrink lets the body yield height to the pinned footer when content is tall.
  body: { flexShrink: 1 },
  bodyContent: { paddingBottom: spacing.sm },
  // Pinned footer: Cancel (ghost) + Add (primary) side by side.
  footer: { marginTop: spacing.md },
});
