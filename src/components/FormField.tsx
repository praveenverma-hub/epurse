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
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, DIVIDER_W } from '../constants/theme';

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

/**
 * The amount input — same surface as FormTextInput, larger type.
 *
 * `compact` drops 28px → 20px. Use it in a SHEET, where the amount is one field
 * among several rather than the screen's subject: at 28px the row stands a head
 * taller than every other field and the form reads as ragged. A full add SCREEN
 * keeps the hero size. Sized here, not overridden at the call site, so the two
 * sizes stay deliberate — see ui-consistency §3b.
 */
export const FormAmountInput: React.FC<TextInputProps & { locked?: boolean; compact?: boolean }> = ({
  style,
  locked,
  compact,
  ...rest
}) => (
  <TextInput
    placeholderTextColor={colors.textMuted}
    keyboardType="decimal-pad"
    editable={!locked}
    style={[
      styles.input,
      compact ? styles.amountInputCompact : styles.amountInput,
      locked && styles.inputLocked,
      style,
    ]}
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
  /** Small muted second line under the value (e.g. "Primary", "4 people"). */
  sublabel?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Show a ✓ instead of the › chevron (a resolved selection). */
  resolved?: boolean;
  /** Tints the border + ✓ when resolved — pass the screen's theme.primary. */
  accentColor?: string;
  /** No border of its own — for a row that sits inside a card that supplies it. */
  bare?: boolean;
}

export const FormSelectRow: React.FC<FormSelectRowProps> = ({
  leading,
  value,
  isPlaceholder,
  sublabel,
  onPress,
  disabled,
  resolved,
  accentColor = colors.primary,
  bare,
}) => (
  <TouchableOpacity
    style={[
      styles.selectRow,
      bare && { borderWidth: 0 },
      resolved && !disabled && !bare && { borderColor: accentColor + '99', borderWidth: 1.5 },
      disabled && styles.inputLocked,
    ]}
    onPress={onPress}
    disabled={disabled || !onPress}
    activeOpacity={0.8}
  >
    {typeof leading === 'string' ? <Text style={styles.selectLeadingEmoji}>{leading}</Text> : leading}
    <View style={styles.selectTextCol}>
      <Text
        style={[styles.selectValue, isPlaceholder ? styles.selectValueMuted : { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {sublabel ? <Text style={styles.selectSublabel} numberOfLines={1}>{sublabel}</Text> : null}
    </View>
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


// ─── FormValueRow / FormValueCard — optional fields as "already filled" values ─

interface FormValueRowProps {
  /** Ionicons glyph, drawn in `accentColor` so it follows the live theme. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Emoji / custom node instead of `icon` (a category's own emoji is data, not chrome). */
  leading?: React.ReactNode;
  label: string;
  /** The current (usually defaulted) value, right-aligned. */
  value: string;
  /** True when `value` is a "nothing chosen" prompt — renders muted. */
  isPlaceholder?: boolean;
  /** Small tag before the value (e.g. "Primary"). */
  badge?: string;
  onPress?: () => void;
  disabled?: boolean;
  accentColor?: string;
  /** Extra content under the row, inside the same card (e.g. the split breakdown). */
  children?: React.ReactNode;
}

/** A one-line "Label ........ value ›" row. The OPTIONAL fields of an entry form
 *  render as these, so the form reads as defaults already in place rather than
 *  as a list of blanks to fill — tap one only to change it. */
export const FormValueRow: React.FC<FormValueRowProps> = ({
  icon,
  leading,
  label,
  value,
  isPlaceholder,
  badge,
  onPress,
  disabled,
  accentColor = colors.primary,
  children,
}) => (
  <View>
    <TouchableOpacity
      style={styles.valueRow}
      onPress={onPress}
      disabled={disabled || !onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      {icon ? <Ionicons name={icon} size={20} color={disabled ? colors.textMuted : accentColor} /> : null}
      {typeof leading === 'string' ? <Text style={styles.valueLeadingEmoji}>{leading}</Text> : leading}
      <Text style={styles.valueLabel}>{label}</Text>
      <View style={styles.valueRight}>
        {badge ? (
          <View style={[styles.valueBadge, { backgroundColor: accentColor + '1A' }]}>
            <Text style={[styles.valueBadgeText, { color: accentColor }]}>{badge}</Text>
          </View>
        ) : null}
        <Text
          style={[styles.valueText, isPlaceholder && styles.valueTextMuted, disabled && styles.valueTextMuted]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
      {disabled ? null : <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
    </TouchableOpacity>
    {children}
  </View>
);

/** One outlined card holding several FormValueRows, divided by hairlines. */
export const FormValueCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.valueCard}>
    {React.Children.toArray(children).map((c, i) => (
      <View key={i} style={i > 0 ? styles.valueDivider : undefined}>{c}</View>
    ))}
  </View>
);

// ─── FormNoteField — optional note as a value row ────────────────────────────

interface FormNoteFieldProps {
  value: string;
  onChangeText: (t: string) => void;
  maxLength?: number;
  accentColor?: string;
}

/** A "Note ... Add" row inside the value card; tapping opens the input right
 *  under it. Always open when a note already exists (edit mode) so it can't hide. */
export const FormNoteField: React.FC<FormNoteFieldProps> = ({
  value,
  onChangeText,
  maxLength,
  accentColor = colors.primary,
}) => {
  const [open, setOpen] = React.useState(false);
  const expanded = open || !!value;
  return (
    <FormValueRow
      icon="create-outline"
      label="Note"
      value={value && !expanded ? value : expanded ? '' : 'Add'}
      isPlaceholder={!value}
      accentColor={accentColor}
      onPress={() => setOpen((v) => !v)}
    >
      {expanded ? (
        <View style={styles.noteBody}>
          <FormTextInput
            value={value}
            onChangeText={onChangeText}
            placeholder="What else should we know?"
            multiline
            maxLength={maxLength}
            autoFocus={open && !value}
          />
        </View>
      ) : null}
    </FormValueRow>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

/** Border for every form control — see `colors.inputBorder` in constants/theme. */
const OUTLINE = colors.inputBorder;

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

  // One surface for every control: OUTLINED — a visible border, no fill, no
  // shadow. Two reasons this beats the old card+shadow treatment: the control
  // inherits whatever surface it sits on, so the same field looks right on the
  // gray screen body (AddTransactionScreen) AND on the white sheet
  // (GroupExpenseSheet); and a form is 6-8 controls in a column, where that many
  // floating cards read as separate sections and drown out the field labels.
  input: {
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: OUTLINE,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '400',
  },
  inputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  // Locked needs a recessed fill, and with no base fill it must be a translucent
  // wash (not `cardAlt`) so it darkens on gray and white alike.
  inputLocked: {
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderColor: colors.divider,
    color: colors.textSecondary,
  },
  amountInput: { fontSize: 28, fontWeight: '800' },
  // Still the most prominent field in the sheet, without towering over the rest.
  amountInputCompact: { fontSize: 20, fontWeight: '800' },

  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: OUTLINE,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectLeadingEmoji: { fontSize: 20 },
  selectTextCol: { flex: 1 },
  selectValue: { fontSize: 15, fontWeight: '400' },
  selectSublabel: { fontSize: 11, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  selectValueMuted: { color: colors.textMuted },
  selectCheck: { fontSize: 16, fontWeight: '700' },
  selectChevron: { fontSize: 20, color: colors.textMuted },


  valueCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: OUTLINE,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  valueDivider: { borderTopWidth: DIVIDER_W, borderTopColor: colors.divider },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  valueLeadingEmoji: { fontSize: 20 },
  valueLabel: { fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  valueRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  valueText: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary, textAlign: 'right' },
  valueTextMuted: { color: colors.textMuted, fontWeight: '500' },
  valueBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill },
  valueBadgeText: { fontSize: 10, fontWeight: '700' },
  noteBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'transparent',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: OUTLINE,
    maxWidth: '100%',
  },
  chipText: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
});
