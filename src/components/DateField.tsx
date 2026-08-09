// =============================================================================
// DateField — the transaction date row: calendar icon + readable date + ›.
// Renders as a FormSelectRow so it's visually identical to the Category row
// (see FormField.tsx) instead of looking like its own bespoke control.
//
// The native picker is presented on tap, per-platform:
//   Android — the system date dialog (its only mode); commits on "OK".
//   iOS     — an inline calendar in a bottom sheet with a Done bar. iOS has no
//             dialog mode, and its `display="compact"` widget can't be styled
//             to match our rows, so we drive the presentation ourselves and
//             hold a draft until Done (the inline picker fires onChange on
//             every tap, which would otherwise commit half-made selections).
// =============================================================================
import React, { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { FormSelectRow } from './FormField';
import SheetCloseButton from './SheetCloseButton';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { formatDateLabel } from '../utils/format';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

interface DateFieldProps {
  value: Date;
  onChange: (date: Date) => void;
  maximumDate?: Date;
  disabled?: boolean;
  /** Tints the calendar icon — pass the screen's `theme.primary`. */
  accentColor?: string;
  /**
   * `row` (default) — a full labelled FormSelectRow, for the main entry forms.
   * `icon` — a compact calendar button + date, for tight rows (beside the amount
   *   input on the Lent/Borrowed add + edit forms) where a full row would crowd
   *   the card. The date always shows, in the ordinary field text colour —
   *   "Today" / "Yesterday" for the two recent days, else the real date.
   */
  variant?: 'row' | 'icon';
  /**
   * `icon` only. Which surface the surrounding form uses, so the button matches
   * its neighbours (ui-consistency §3b: anything beside an outlined field is
   * outlined too, and the LB *add* form is the deliberate filled exception).
   *   `filled`   — gray fill, borderless. The LB add form.
   *   `outlined` — transparent + 1px border. Any form built on FormField.
   * Getting this wrong is visible: a gray box beside a bordered input reads as
   * a different KIND of control, not as the same field.
   */
  surface?: 'filled' | 'outlined';
}

export default function DateField({
  value,
  onChange,
  maximumDate,
  disabled,
  accentColor = colors.primary,
  variant = 'row',
  surface = 'filled',
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const openPicker = () => {
    setDraft(value);
    setOpen(true);
  };

  const tint = disabled ? colors.textMuted : accentColor;

  const row =
    variant === 'icon' ? (
      <TouchableOpacity
        // No accent wash for a backdated date: the fill is what makes this read as
        // one of the form's inputs, and recolouring it made the field look like a
        // warning rather than a filled-in value.
        style={[styles.iconBtn, surface === 'outlined' && styles.iconBtnOutlined]}
        onPress={openPicker}
        disabled={disabled}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Date: ${formatDateLabel(value)}`}
      >
        {/* Always tinted with the live accent so the calendar reads as tappable. */}
        <Ionicons name="calendar-outline" size={19} color={tint} />
        {/* The date is ALWAYS shown, not just when backdated: an icon-only button
            left the reader guessing which date an LB entry would be filed under,
            and "probably today" is exactly the assumption that produces a
            mis-dated ledger. It's the ordinary field text colour in every case —
            a date is a filled-in value, not a state worth flagging. */}
        <Text style={styles.iconBtnTxt} numberOfLines={1}>
          {formatDateLabel(value)}
        </Text>
      </TouchableOpacity>
    ) : (
      <FormSelectRow
        leading={<Ionicons name="calendar-outline" size={19} color={tint} />}
        value={formatDateLabel(value)}
        onPress={openPicker}
        disabled={disabled}
        accentColor={accentColor}
      />
    );

  if (disabled) return row;

  return (
    <>
      {row}

      {/* Android — the system dialog is the only presentation it offers. */}
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={value}
          mode="date"
          display="default"
          maximumDate={maximumDate}
          onChange={(event: DateTimePickerEvent, d?: Date) => {
            setOpen(false);
            if (event.type === 'set' && d) onChange(d);
          }}
        />
      )}

      {/* iOS — inline calendar in a bottom sheet; commit on Done. */}
      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.backdrop}>
            <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={() => setOpen(false)} />
            <SheetCloseButton onPress={() => setOpen(false)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Pick a date</Text>
              {/* accentColor tints the calendar's own selection ring, so the
                  native picker matches the app's theme too — not just our row. */}
              <DateTimePicker
                value={draft}
                mode="date"
                display="inline"
                maximumDate={maximumDate}
                accentColor={accentColor}
                onChange={(_: DateTimePickerEvent, d?: Date) => d && setDraft(d)}
                style={styles.iosPicker}
              />
              <TouchableOpacity
                style={[styles.doneBtn, { backgroundColor: accentColor }]}
                onPress={() => {
                  setOpen(false);
                  onChange(draft);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.doneTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  // Square-ish trigger sized to sit flush beside a text input in a flex row.
  //
  // `alignSelf: 'stretch'` is what keeps it the SAME HEIGHT as that input, and it
  // has to be here rather than `alignItems` on each row: the two controls carry
  // the same paddingVertical but different font sizes (the edit sheet's amount is
  // 28px, this label is ~13px), so equal padding does NOT mean equal height —
  // which is exactly how the edit sheet ended up with a short date button beside a
  // tall amount box. Stretching matches whatever the sibling turns out to be, so
  // it can't drift again when a font size or padding changes. alignSelf beats the
  // parent's alignItems, so no call site has to opt in.
  iconBtn: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    // FILLED gray, borderless — matches `LentBorrowedScreen`'s inputs. Used only by
    // the two LB forms (add + edit). It deliberately does NOT follow the outlined
    // FormField treatment (`variant="row"` does, via FormSelectRow).
    backgroundColor: colors.background,
    borderRadius: radius.md,
  },
  // Matches FormField's `input`: transparent + 1px inputBorder, for forms built on
  // the shared primitives (the LB EDIT sheet). Overrides the fill above.
  iconBtnOutlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  // Same colour as the form's own input text — this is a value, not an accent.
  iconBtnTxt: { ...typography.small, fontWeight: '700', color: colors.textPrimary },

  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
  iosPicker: { alignSelf: 'stretch' },
  doneBtn: {
    marginTop: spacing.md,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  doneTxt: { ...typography.bodyBold, color: '#fff', fontWeight: '700' },
});
