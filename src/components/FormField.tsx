// =============================================================================
// FormField — the shared field primitives for every transaction entry form.
//
// Both add/edit surfaces consume these so all FOUR flows render identically:
//   plain add / plain edit   → AddTransactionScreen
//   group add / group edit   → GroupExpenseForm (via AddGroupExpenseScreen
//                              full screen + GroupExpenseSheet bottom sheet)
//
// Before this existed, each file hand-rolled its own label/input/row/chip
// styles and they had drifted apart (different amount alignment, card vs
// flat inputs, label-above vs label-inline select rows). Add a new field
// type HERE rather than re-inventing one in a screen.
// =============================================================================
import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, radius, shadows, spacing } from '../constants/theme';

// ─── FormField — labelled wrapper ────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  /** Small muted line under the control (e.g. "From your bank SMS"). */
  hint?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

export const FormField: React.FC<FormFieldProps> = ({ label, hint, children, style }) => (
  <View style={[styles.field, style]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
    {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
  </View>
);

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** Standard single/multi-line text input. */
export const FormTextInput: React.FC<TextInputProps> = ({ style, multiline, ...rest }) => (
  <TextInput
    placeholderTextColor={colors.textMuted}
    multiline={multiline}
    style={[styles.input, multiline && styles.inputMultiline, style]}
    {...rest}
  />
);

/** The big amount input — same surface as FormTextInput, larger type. */
export const FormAmountInput: React.FC<TextInputProps & { locked?: boolean }> = ({
  style,
  locked,
  ...rest
}) => (
  <TextInput
    placeholderTextColor={colors.textMuted}
    keyboardType="decimal-pad"
    editable={!locked}
    style={[styles.input, styles.amountInput, locked && styles.inputLocked, style]}
    {...rest}
  />
);

// ─── FormSelectRow — tap-to-open row (Category, Date, …) ─────────────────────

interface FormSelectRowProps {
  /** Emoji string or an icon node shown at the left. */
  leading?: React.ReactNode;
  /** The current selection, rendered as the row's value. */
  value: string;
  /** True when `value` is a "nothing chosen yet" placeholder — renders muted. */
  isPlaceholder?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Show a ✓ instead of the › chevron (a resolved selection). */
  resolved?: boolean;
  /** Tints the border + ✓ when resolved — pass the screen's theme.primary. */
  accentColor?: string;
}

export const FormSelectRow: React.FC<FormSelectRowProps> = ({
  leading,
  value,
  isPlaceholder,
  onPress,
  disabled,
  resolved,
  accentColor = colors.primary,
}) => (
  <TouchableOpacity
    style={[
      styles.selectRow,
      resolved && !disabled && { borderColor: accentColor + '99', borderWidth: 1.5 },
      disabled && styles.inputLocked,
    ]}
    onPress={onPress}
    disabled={disabled || !onPress}
    activeOpacity={0.8}
  >
    {typeof leading === 'string' ? <Text style={styles.selectLeadingEmoji}>{leading}</Text> : leading}
    <Text
      style={[styles.selectValue, isPlaceholder ? styles.selectValueMuted : { color: colors.textPrimary }]}
      numberOfLines={1}
    >
      {value}
    </Text>
    {disabled ? null : resolved ? (
      <Text style={[styles.selectCheck, { color: accentColor }]}>✓</Text>
    ) : (
      <Text style={styles.selectChevron}>›</Text>
    )}
  </TouchableOpacity>
);

// ─── Chips — segmented / multi-option selectors ──────────────────────────────

export const FormChipRow: React.FC<{ children: React.ReactNode; style?: ViewStyle }> = ({
  children,
  style,
}) => <View style={[styles.chipRow, style]}>{children}</View>;

interface FormChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Optional icon node rendered before the label. */
  icon?: React.ReactNode;
  accentColor?: string;
  style?: ViewStyle;
}

export const FormChip: React.FC<FormChipProps> = ({
  label,
  active,
  onPress,
  icon,
  accentColor = colors.primary,
  style,
}) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.8}
    style={[styles.chip, active && { borderColor: accentColor, backgroundColor: accentColor + '14' }, style]}
  >
    {icon}
    {/* Weight stays constant so selecting a chip only recolours it — a weight
        change would resize the text and make the whole row jump sideways. */}
    <Text
      style={[styles.chipText, active && { color: accentColor }]}
      numberOfLines={1}
      ellipsizeMode="tail"
    >
      {label}
    </Text>
  </TouchableOpacity>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  field: { marginBottom: spacing.lg },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  fieldHint: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // One surface for every control: card fill, hairline border, soft shadow.
  input: {
    ...shadows.card,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '400',
  },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  inputLocked: { backgroundColor: colors.cardAlt, color: colors.textSecondary },
  amountInput: { fontSize: 28, fontWeight: '800' },

  selectRow: {
    ...shadows.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectLeadingEmoji: { fontSize: 20 },
  selectValue: { flex: 1, fontSize: 15, fontWeight: '400' },
  selectValueMuted: { color: colors.textMuted },
  selectCheck: { fontSize: 16, fontWeight: '700' },
  selectChevron: { fontSize: 20, color: colors.textMuted },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    maxWidth: '100%',
  },
  chipText: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
});
