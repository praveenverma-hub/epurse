// =============================================================================
// GroupExpenseSheet — bottom-sheet shell around GroupExpenseForm.
// Used when tagging an EXISTING transaction to a group from the Activity flow
// (Dashboard / Transactions / DailyQueueStack). The Groups-tab "+" FAB uses the
// full-screen AddGroupExpenseScreen instead — both share GroupExpenseForm.
// =============================================================================
import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import GroupExpenseForm from './GroupExpenseForm';
import type { Group, GroupExpenseData } from '../types/group';

interface GroupExpenseSheetProps {
  visible: boolean;
  /** Target group — must be set when visible. */
  group: Group | null;
  onClose: () => void;
  onAdd: (expenseData: GroupExpenseData) => void;
  /** When tagging an EXISTING transaction, its amount — prefilled and locked here. */
  presetAmount?: number;
}

export default function GroupExpenseSheet({ visible, group, onClose, onAdd, presetAmount }: GroupExpenseSheetProps) {
  if (!group) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.bodyContent}
            >
              <Text style={styles.title}>Add Expense · {group.name}</Text>

              <GroupExpenseForm
                group={group}
                visible={visible}
                presetAmount={presetAmount}
                onAdd={onAdd}
              />

              <TouchableOpacity style={styles.cancel} onPress={onClose}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
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
  title: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md },
  bodyContent: { paddingBottom: spacing.sm },
  cancel:      { marginTop: spacing.sm, alignItems: 'center' },
  cancelTxt:   { ...typography.body, color: colors.textSecondary },
});
