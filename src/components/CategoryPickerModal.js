import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';

import { colors, radius, spacing, typography } from '../constants/theme';

const CategoryPickerModal = ({
  visible,
  categories,
  selectedCategoryId,
  isHidden,
  isIgnored,
  canSplit,
  isSplitTxn,
  onPressSplit,
  onSelectCategory,
  onToggleHidden,
  onIgnore,
  onRestore,
  onDelete,
  onClose,
}) => (
  <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>Change category</Text>

        <ScrollView showsVerticalScrollIndicator={false} style={styles.list}>
          {categories.map((cat) => {
            const active = selectedCategoryId === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.row, active && styles.rowActive]}
                onPress={() => onSelectCategory(cat.id)}
              >
                <Text style={styles.emoji}>{cat.emoji}</Text>
                <Text style={[styles.rowLabel, active && styles.rowLabelActive]}>{cat.name}</Text>
                {active ? <Text style={styles.check}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {canSplit && !isIgnored && onPressSplit ? (
          <TouchableOpacity style={styles.splitBillBtn} activeOpacity={0.85} onPress={onPressSplit}>
            <Text style={styles.splitBillText}>{isSplitTxn ? 'Edit split' : 'Split bill'}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.hideIgnoreRow}>
          <TouchableOpacity
            style={[styles.hideIgnoreHalf, isHidden ? styles.unhideHalf : styles.hideHalf]}
            onPress={() => onToggleHidden(!isHidden)}
          >
            <Text style={[styles.hideIgnoreText, isHidden && styles.unhideText]}>
              {isHidden ? 'Show' : 'Hide'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.hideIgnoreHalf, isIgnored ? styles.restoreHalf : styles.ignoreHalf]}
            onPress={isIgnored ? onRestore : onIgnore}
          >
            <Text style={isIgnored ? styles.restoreText : styles.ignoreText}>
              {isIgnored ? 'Restore' : 'Ignore'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete}>
          <Text style={styles.deleteText}>Delete transaction</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '78%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  list: { maxHeight: 340 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  rowActive: {
    borderWidth: 1,
    borderColor: colors.primary + '88',
    backgroundColor: colors.primary + '12',
  },
  emoji: { fontSize: 20, marginRight: spacing.sm },
  rowLabel: { flex: 1, ...typography.body, color: colors.textPrimary },
  rowLabelActive: { color: colors.primary, fontWeight: '700' },
  check: { color: colors.primary, fontWeight: '800' },
  splitBillBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.info + '18',
    borderWidth: 1,
    borderColor: colors.info + '55',
  },
  splitBillText: { color: colors.info, ...typography.bodyBold, fontWeight: '700' },
  hideIgnoreRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  hideIgnoreHalf: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hideHalf: {
    backgroundColor: colors.danger + '16',
    borderWidth: 1,
    borderColor: colors.danger + '55',
  },
  unhideHalf: {
    backgroundColor: colors.success + '16',
    borderColor: colors.success + '55',
    borderWidth: 1,
  },
  hideIgnoreText: { color: colors.danger, ...typography.small, fontWeight: '700' },
  unhideText: { color: colors.success },
  ignoreHalf: {
    backgroundColor: colors.warning + '18',
    borderWidth: 1,
    borderColor: colors.warning + '66',
  },
  ignoreText: { color: colors.warning, ...typography.small, fontWeight: '700' },
  restoreHalf: {
    backgroundColor: colors.success + '18',
    borderWidth: 1,
    borderColor: colors.success + '66',
  },
  restoreText: { color: colors.success, ...typography.small, fontWeight: '700' },
  deleteBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  deleteText: { color: '#fff', ...typography.bodyBold, fontWeight: '700' },
});

export default CategoryPickerModal;
