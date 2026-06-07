// =============================================================================
// AddAccountModal — lets the user manually add a card/account
// =============================================================================

import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView,
} from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { ACCOUNT_TYPES } from '../constants/categories';
import { INPUT_LIMITS, sanitizeName } from '../utils/validation';
import { useToast } from './Toast';

const TYPE_OPTIONS = [
  { key: ACCOUNT_TYPES.CASH,        label: 'Cash',         emoji: '💵' },
  { key: ACCOUNT_TYPES.WALLET,      label: 'Wallet / UPI', emoji: '👛' },
  { key: ACCOUNT_TYPES.DEBIT_CARD,  label: 'Debit Card',   emoji: '🏧' },
  { key: ACCOUNT_TYPES.CREDIT_CARD, label: 'Credit Card',  emoji: '💳' },
  { key: ACCOUNT_TYPES.BANK,        label: 'Bank Account', emoji: '🏦' },
];

const NEEDS_MASK = new Set([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.CREDIT_CARD, ACCOUNT_TYPES.DEBIT_CARD]);
const NEEDS_BANK = new Set([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.CREDIT_CARD, ACCOUNT_TYPES.DEBIT_CARD, ACCOUNT_TYPES.WALLET]);

const AddAccountModal = ({ visible, onClose, onAdd }) => {
  const theme = useTheme();
  const toast = useToast();

  const [selectedType, setSelectedType] = useState(ACCOUNT_TYPES.BANK);
  const [bankName, setBankName]     = useState('');
  const [lastFour, setLastFour]     = useState('');
  const [customName, setCustomName] = useState('');

  const reset = useCallback(() => {
    setSelectedType(ACCOUNT_TYPES.BANK);
    setBankName('');
    setLastFour('');
    setCustomName('');
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleAdd = useCallback(() => {
    const typeKey  = selectedType;
    const bank     = bankName.trim();
    const last4    = lastFour.replace(/\D/g, '').slice(-4);
    const custName = customName.trim();

    // Validation
    if (NEEDS_MASK.has(typeKey) && last4.length !== 4) {
      toast.warning('Missing info', 'Please enter the last 4 digits of your card/account.');
      return;
    }
    if (NEEDS_BANK.has(typeKey) && !bank && !custName) {
      toast.warning('Missing info', 'Please enter a bank or wallet name.');
      return;
    }

    // Build display name
    let name = custName;
    if (!name) {
      if (typeKey === ACCOUNT_TYPES.CASH) {
        name = 'Cash';
      } else if (last4) {
        name = `${bank || typeKey} ··${last4}`;
      } else {
        name = bank || typeKey;
      }
    }

    onAdd({
      type: typeKey,
      name,
      bankName: bank || null,
      mask: last4 || '',
      balance: 0,
    });

    reset();
    onClose();
  }, [selectedType, bankName, lastFour, customName, onAdd, reset, onClose]);

  const needsMask = NEEDS_MASK.has(selectedType);
  const needsBank = NEEDS_BANK.has(selectedType);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>Add Account</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

            {/* Type selector */}
            <Text style={styles.label}>Account Type</Text>
            <View style={styles.typeGrid}>
              {TYPE_OPTIONS.map((opt) => {
                const isSelected = selectedType === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.typeChip,
                      isSelected && { backgroundColor: theme.primary + '18', borderColor: theme.primary },
                    ]}
                    onPress={() => setSelectedType(opt.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.typeEmoji}>{opt.emoji}</Text>
                    <Text
                      style={[
                        styles.typeLabel,
                        isSelected && { color: theme.primary, fontWeight: '700' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Bank / wallet name */}
            {needsBank ? (
              <>
                <Text style={styles.label}>
                  {selectedType === ACCOUNT_TYPES.WALLET ? 'Wallet / Provider Name' : 'Bank Name'}
                </Text>
                <TextInput
                  value={bankName}
                  onChangeText={setBankName}
                  placeholder={selectedType === ACCOUNT_TYPES.WALLET ? 'e.g. Paytm, PhonePe' : 'e.g. HDFC, ICICI, SBI'}
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  autoCapitalize="characters"
                />
              </>
            ) : null}

            {/* Last 4 digits */}
            {needsMask ? (
              <>
                <Text style={styles.label}>Last 4 Digits</Text>
                <TextInput
                  value={lastFour}
                  onChangeText={(v) => setLastFour(v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="e.g. 4567"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  keyboardType="numeric"
                  maxLength={4}
                />
              </>
            ) : null}

            {/* Optional custom name */}
            <Text style={styles.label}>Custom Name (optional)</Text>
            <TextInput
              value={customName}
              onChangeText={(t) => setCustomName(sanitizeName(t))}
              placeholder="Leave blank to auto-generate"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={INPUT_LIMITS.NAME_MAX}
            />

          </ScrollView>

          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: theme.primary }]}
            onPress={handleAdd}
            activeOpacity={0.85}
          >
            <Text style={styles.addBtnText}>Add Account</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default AddAccountModal;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000060',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
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
    backgroundColor: colors.divider,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  title: {
    flex: 1,
    ...typography.h3,
    color: colors.textPrimary,
  },
  closeBtn: {
    color: colors.textSecondary,
    fontSize: 16,
    paddingLeft: spacing.sm,
  },
  scroll: {
    paddingBottom: spacing.md,
  },

  label: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.xs + 2,
    marginTop: spacing.sm,
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
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  typeEmoji: { fontSize: 18 },
  typeLabel: {
    ...typography.small,
    color: colors.textPrimary,
    fontWeight: '600',
  },

  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.divider,
  },

  addBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  addBtnText: {
    color: '#fff',
    ...typography.bodyBold,
    fontWeight: '700',
    fontSize: 16,
  },
});
