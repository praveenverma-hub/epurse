// =============================================================================
// LinkContactModal
// Shown when a transaction is re-categorised to 'lent' or 'borrowed'.
// Asks: who is the person? (optional phone for unique matching)
// On confirm the parent creates the lentBorrowed entry linked to the transaction.
// =============================================================================

import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import GradientButton from './GradientButton';

const LinkContactModal = ({
  visible,
  categoryId,   // 'lent' | 'borrowed'
  onConfirm,    // ({ person, phone }) => void
  onSkip,       // () => void — change category without linking
  onClose,      // () => void
}) => {
  const [person, setPerson] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (visible) { setPerson(''); setPhone(''); }
  }, [visible]);

  const isLent = categoryId === 'lent';
  const label = isLent ? 'Who did you lend to?' : 'Who did you borrow from?';
  const hint  = isLent
    ? 'Linking a name/phone tracks the outstanding balance for this person.'
    : 'Linking a name/phone tracks the outstanding balance for this person.';

  const handleConfirm = () => {
    if (!person.trim()) return;
    onConfirm({ person: person.trim(), phone: phone.trim() || null });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          <Text style={styles.title}>{label}</Text>
          <Text style={styles.hint}>{hint}</Text>

          <Text style={styles.fieldLabel}>Person name *</Text>
          <TextInput
            value={person}
            onChangeText={setPerson}
            placeholder="e.g. Rohit"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            autoFocus
          />

          <Text style={styles.fieldLabel}>Phone number (optional)</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Used to match across entries"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            style={styles.input}
          />

          <GradientButton
            title="Link & save"
            onPress={handleConfirm}
            style={{ marginTop: spacing.lg }}
          />

          <TouchableOpacity style={styles.skipBtn} onPress={onSkip}>
            <Text style={styles.skipText}>Skip — just change category</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  hint:  { ...typography.small, color: colors.textSecondary, marginBottom: spacing.sm },
  fieldLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600', marginTop: spacing.sm },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
    marginTop: spacing.xs,
  },
  skipBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  skipText: { ...typography.small, color: colors.textSecondary, textDecorationLine: 'underline' },
});

export default LinkContactModal;
