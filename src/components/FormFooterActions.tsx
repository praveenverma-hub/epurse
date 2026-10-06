// =============================================================================
// FormFooterActions — the pinned footer row of every entry form: an outlined
// Cancel (secondary) beside the filled submit (primary). Used by
// AddTransactionScreen and AddGroupExpenseScreen; the shell
// keeps its own footer band, this is only the row inside it.
// =============================================================================
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BUTTON_H, radius, spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButtonBase from './GradientButton';

const GradientButton = GradientButtonBase as React.FC<{
  title: string; onPress: () => void; flat?: boolean; loading?: boolean; style?: object;
}>;

interface Props {
  onCancel: () => void;
  /** Omit (or null) to hide the submit — e.g. until the mandatory fields are filled. */
  submit?: { title: string; onPress: () => void; loading?: boolean } | null;
}

export default function FormFooterActions({ onCancel, submit }: Props) {
  const theme = useTheme();
  const busy = !!submit?.loading;
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.cancel, { borderColor: theme.primary }, !submit && styles.cancelAlone]}
        onPress={onCancel}
        disabled={busy}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <Text style={[styles.cancelText, { color: theme.primary }]}>Cancel</Text>
      </TouchableOpacity>
      {submit ? (
        <GradientButton flat title={submit.title} onPress={submit.onPress} loading={submit.loading} style={styles.submit} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Same height + radius as GradientButton so the two read as one row.
  cancel: {
    minHeight: BUTTON_H,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelAlone: { flex: 1 },
  cancelText: { fontSize: 15, fontWeight: '700' },
  submit: { flex: 1 },
});
