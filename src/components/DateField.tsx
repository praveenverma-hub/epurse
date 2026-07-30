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
   * `icon` — a square calendar button for tight rows (e.g. beside the amount
   *   input on the Lent/Borrowed form) where a full row would crowd the card.
   *   It stays icon-only while the date is today and grows to show the date
   *   once it isn't, so a backdated entry can never look like today's.
   */
  variant?: 'row' | 'icon';
}

const isToday = (d: Date) => {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

export default function DateField({
  value,
  onChange,
  maximumDate,
  disabled,
  accentColor = colors.primary,
  variant = 'row',
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const openPicker = () => {
    setDraft(value);
    setOpen(true);
  };

  const backdated = !isToday(value);
  const tint = disabled ? colors.textMuted : accentColor;

  const row =
    variant === 'icon' ? (
      <TouchableOpacity
        style={[
          styles.iconBtn,
          backdated && { borderColor: tint, backgroundColor: tint + '14' },
        ]}
        onPress={openPicker}
        disabled={disabled}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={`Date: ${formatDateLabel(value)}`}
      >
        <Ionicons name="calendar-outline" size={19} color={backdated ? tint : colors.textSecondary} />
        {backdated ? (
          <Text style={[styles.iconBtnTxt, { color: tint }]} numberOfLines={1}>
            {formatDateLabel(value)}
          </Text>
        ) : null}
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
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  iconBtnTxt: { ...typography.small, fontWeight: '700' },

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
