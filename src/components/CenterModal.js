import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';

/**
 * Generic centered modal for confirmations and info messages.
 * Buttons: primary + optional secondary.
 */
export default function CenterModal({
  visible,
  title,
  message,
  primaryText = 'OK',
  onPrimary,
  secondaryText,
  onSecondary,
  destructive = false,
  onClose,
}) {
  const theme = useTheme();
  const primaryBg = destructive ? colors.danger : theme.primary;
  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <View style={styles.card}>
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}

          <View style={styles.btnRow}>
            {secondaryText ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                activeOpacity={0.85}
                onPress={onSecondary || onClose}
              >
                <Text style={styles.secondaryText}>{secondaryText}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: primaryBg }]}
              activeOpacity={0.85}
              onPress={onPrimary}
            >
              <Text style={styles.primaryText}>{primaryText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dismiss: { ...StyleSheet.absoluteFillObject },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.elevated,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  title: { ...typography.h3, color: colors.textPrimary, fontWeight: '800' },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  secondaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  secondaryText: { ...typography.bodyBold, color: colors.textSecondary, fontWeight: '800' },
  primaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryText: { ...typography.bodyBold, color: '#fff', fontWeight: '900' },
});

