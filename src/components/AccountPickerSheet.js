// =============================================================================
// AccountPickerSheet — a small themed bottom sheet to pick which account an
// action draws from (e.g. "Repay from which account?"). Optional skip row for a
// "do it without recording money movement" escape.
// =============================================================================

import React, { useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Pressable,
} from 'react-native';

import { radius, spacing, shadows } from '../constants/theme';
import { ACCOUNT_TYPES } from '../constants/categories';
import { formatCurrency } from '../utils/format';
import { useTheme } from '../hooks/useTheme';

const TYPE_EMOJI = {
  [ACCOUNT_TYPES.BANK]:        '🏦',
  [ACCOUNT_TYPES.CREDIT_CARD]: '💳',
  [ACCOUNT_TYPES.DEBIT_CARD]:  '🏧',
  [ACCOUNT_TYPES.WALLET]:      '👛',
  [ACCOUNT_TYPES.CASH]:        '💵',
};

const AccountPickerSheet = ({
  visible,
  title = 'Pick an account',
  subtitle,
  accounts,
  onSelect,
  onClose,
  skipLabel,
  onSkip,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
          {(accounts || []).map((a) => (
            <TouchableOpacity key={a.id} style={styles.row} onPress={() => onSelect?.(a.id)} activeOpacity={0.8}>
              <Text style={styles.rowEmoji}>{TYPE_EMOJI[a.type] || '💳'}</Text>
              <View style={styles.rowMid}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {a.bankName || a.name || a.type}
                  {a.mask ? `  ••${a.mask}` : ''}
                </Text>
                <Text style={styles.rowType} numberOfLines={1}>{a.type}</Text>
              </View>
              <Text style={styles.rowBal} numberOfLines={1}>{formatCurrency(a.balance ?? 0)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {skipLabel && onSkip ? (
          <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.8}>
            <Text style={styles.skipText}>{skipLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
};

export default AccountPickerSheet;

const makeStyles = (t) =>
  StyleSheet.create({
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000066' },
    sheet: {
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      backgroundColor: t.card,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: 36,
      maxHeight: '70%',
      ...shadows.elevated,
    },
    handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.divider, marginBottom: spacing.md },
    title: { color: t.textPrimary, fontSize: 17, fontWeight: '700' },
    subtitle: { color: t.textSecondary, fontSize: 13, marginTop: 2, marginBottom: spacing.sm },
    list: { marginTop: spacing.sm },
    listContent: { gap: 8, paddingBottom: spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.cardAlt,
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 12,
    },
    rowEmoji: { fontSize: 20 },
    rowMid: { flex: 1, minWidth: 0 },
    rowName: { color: t.textPrimary, fontSize: 14.5, fontWeight: '700' },
    rowType: { color: t.textMuted, fontSize: 12, marginTop: 1 },
    rowBal: { color: t.textSecondary, fontSize: 13, fontWeight: '700' },
    skipBtn: { alignItems: 'center', paddingVertical: 14, marginTop: spacing.xs },
    skipText: { color: t.textSecondary, fontSize: 13.5, fontWeight: '600' },
  });
