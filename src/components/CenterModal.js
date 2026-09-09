import React from 'react';
import { ActivityIndicator, Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

/**
 * Generic centered modal for confirmations and info messages.
 * Buttons: primary + optional secondary.
 *
 * ~30 call sites drive real writes (settle/delete/pay/link) from `onPrimary`,
 * each supplying its own handler with no guard of its own — so the double-tap
 * guard lives HERE once, rather than in every caller. Covers sync handlers
 * (the vast majority — a `set()` completes before the modal even finishes
 * closing) and async ones the same way.
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
  /**
   * Optional content between the message and the buttons — a single input, a
   * short list. A NAMED SLOT, not a special case: a confirm dialog that also
   * asks for one value is the same affordance, and forking a second dialog
   * component for it is exactly what the shared-component rule forbids.
   * Keep it small; anything taller than a couple of rows wants a bottom sheet.
   * Defaulted so TS doesn't infer it as REQUIRED for the ~30 existing callers
   * that pass no children (this file is JS, so its prop type is inferred).
   */
  children = /** @type {React.ReactNode} */ (null),
}) {
  const theme = useTheme();
  const primaryBg = destructive ? colors.danger : theme.primary;
  const { submit, submitting } = useSubmitGuard();

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={submitting ? undefined : onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} disabled={submitting} />
        <View style={styles.card}>
          {!!title && <Text style={styles.title}>{title}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}
          {children ? <View style={styles.slot}>{children}</View> : null}

          <View style={styles.btnRow}>
            {secondaryText ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                activeOpacity={0.85}
                onPress={() => submit(() => (onSecondary || onClose)())}
                disabled={submitting}
              >
                <Text style={styles.secondaryText}>{secondaryText}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: primaryBg }, submitting && styles.primaryBtnBusy]}
              activeOpacity={0.85}
              onPress={() => submit(() => onPrimary?.())}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryText}>{primaryText}</Text>}
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
  slot: { marginTop: spacing.md },
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
  primaryBtnBusy: { opacity: 0.85 },
  primaryText: { ...typography.bodyBold, color: '#fff', fontWeight: '900' },
});

