// =============================================================================
// TimeField — the time-of-day row: clock icon + readable time + ›.
//
// DateField's sibling, deliberately built the same way (FormSelectRow trigger,
// Android dialog / iOS sheet-with-a-Done-bar) so a form that asks for a date AND
// a time shows two rows that look like one control, not two different ones.
// Read DateField's header for why the presentation is split per platform; the
// same reasoning applies verbatim here.
// =============================================================================
import React, { useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { FormSelectRow } from './FormField';
import SheetCloseButton from './SheetCloseButton';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

/** "9:05 AM" — the same en-IN, 12-hour form the reminder list and banner use. */
export const formatTimeLabel = (d: Date): string =>
  d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

interface TimeFieldProps {
  /** Only the hour/minute are read; the date part is ignored. */
  value: Date;
  onChange: (date: Date) => void;
  disabled?: boolean;
  /** Tints the clock icon — pass the screen's `theme.primary`. */
  accentColor?: string;
}

export default function TimeField({
  value,
  onChange,
  disabled,
  accentColor = colors.primary,
}: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const openPicker = () => {
    setDraft(value);
    setOpen(true);
  };

  const tint = disabled ? colors.textMuted : accentColor;

  const row = (
    <FormSelectRow
      leading={<Ionicons name="time-outline" size={19} color={tint} />}
      value={formatTimeLabel(value)}
      onPress={openPicker}
      disabled={disabled}
      accentColor={accentColor}
    />
  );

  if (disabled) return row;

  return (
    <>
      {row}

      {/* Android — the system clock dialog is the only presentation it offers. */}
      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={value}
          mode="time"
          display="default"
          onChange={(event: DateTimePickerEvent, d?: Date) => {
            setOpen(false);
            if (event.type === 'set' && d) onChange(d);
          }}
        />
      )}

      {/* iOS — spinner in a bottom sheet; commit on Done, so a half-spun time
          never lands (the inline picker fires onChange on every tick). */}
      {Platform.OS === 'ios' && (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.backdrop}>
            <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={() => setOpen(false)} />
            <SheetCloseButton onPress={() => setOpen(false)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>Pick a time</Text>
              <DateTimePicker
                value={draft}
                mode="time"
                display="spinner"
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

// Sheet chrome mirrors DateField's exactly — the two pickers open from the same
// form and any difference in handle/title/Done reads as a rendering fault.
const styles = StyleSheet.create({
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
