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
  onSelectCategory,
  onToggleHidden,
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

        <TouchableOpacity
          style={[styles.hideBtn, isHidden && styles.unhideBtn]}
          onPress={() => onToggleHidden(!isHidden)}
        >
          <Text style={[styles.hideText, isHidden && styles.unhideText]}>
            {isHidden ? 'Show transaction' : 'Hide transaction'}
          </Text>
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
  hideBtn: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.danger + '16',
    borderWidth: 1,
    borderColor: colors.danger + '55',
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  hideText: { color: colors.danger, ...typography.bodyBold, fontWeight: '700' },
  unhideBtn: {
    backgroundColor: colors.success + '16',
    borderColor: colors.success + '55',
  },
  unhideText: { color: colors.success },
});

export default CategoryPickerModal;
