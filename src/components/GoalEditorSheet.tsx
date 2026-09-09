// =============================================================================
// GoalEditorSheet — create or edit one goal.
//
// Name, glyph, colour, kind, and an optional lifetime target. The lifetime
// target is what unlocks the "finish by August 2027" line on the card, but it
// stays OPTIONAL: plenty of goals are open-ended ("keep topping up the
// emergency fund"), and demanding a second number at setup would turn a
// one-field task into a form.
//
// Input rules follow the input-validation skill: maxLength caps typing,
// sanitize* cleans each keystroke, isValid* gates the submit.
// =============================================================================

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Pressable,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import {
  INPUT_LIMITS, sanitizeName, isValidName, sanitizeAmount, parseAmount,
} from '../utils/validation';
import {
  GOAL_COLORS, GOAL_KIND_META, GOAL_KINDS, DEFAULT_GOAL_EMOJI, type GoalKind,
} from '../constants/goals';
import SheetCloseButton from './SheetCloseButton';
import GradientButtonBase from './GradientButton';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// GradientButton.js has no TS declarations, so its inferred prop type demands
// every prop. Same local cast the other TS callers use (AddTransactionScreen,
// CreateGroupModal).
const GradientButton: React.FC<{
  title: string;
  onPress: () => void;
  style?: object;
  loading?: boolean;
  disabled?: boolean;
  colors?: string[];
  textStyle?: any;
  icon?: React.ReactNode;
}> = GradientButtonBase as any;


/** Glyphs offered for a goal. A goal's emoji is DATA, so it stays an emoji —
 *  the icons rule's stated exception, same as a category's or a group's. */
const EMOJI_CHOICES = ['🎯', '🛟', '📈', '✈️', '🏠', '🎓', '🚗', '💍', '🤝', '💻', '🏥', '🎁'];

export interface GoalDraft {
  id?: string;
  name: string;
  emoji: string;
  color: string;
  kind: GoalKind;
  lifetimeTarget: number | null;
  autoParentId?: string | null;
}

interface Props {
  visible: boolean;
  /** Existing goal to edit; omit to create. */
  initial?: GoalDraft | null;
  onClose: () => void;
  onSave: (draft: GoalDraft) => void;
  onDelete?: () => void;
}

const GoalEditorSheet: React.FC<Props> = ({ visible, initial, onClose, onSave, onDelete }) => {
  const theme = useTheme();
  const { submit, submitting } = useSubmitGuard();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(DEFAULT_GOAL_EMOJI);
  const [color, setColor] = useState(GOAL_COLORS[0]);
  const [kind, setKind] = useState<GoalKind>(GOAL_KINDS.SAVING);
  const [target, setTarget] = useState('');
  const [showError, setShowError] = useState(false);

  // Re-seed whenever the sheet opens. This is ONE long-lived instance whose
  // `visible` prop toggles, so without this an edit would show the last goal's
  // values (the same staleness that put a stray checkmark in GroupPickerSheet).
  useEffect(() => {
    if (!visible) return;
    setName(initial?.name ?? '');
    setEmoji(initial?.emoji ?? DEFAULT_GOAL_EMOJI);
    setColor(initial?.color ?? GOAL_COLORS[0]);
    setKind(initial?.kind ?? GOAL_KINDS.SAVING);
    setTarget(initial?.lifetimeTarget ? String(initial.lifetimeTarget) : '');
    setShowError(false);
  }, [visible, initial]);

  const nameOk = isValidName(name);

  const handleSave = () => {
    if (!nameOk) { setShowError(true); return; }
    submit(() => {
      onSave({
        id: initial?.id,
        name: name.trim(),
        emoji,
        color,
        kind,
        lifetimeTarget: target ? parseAmount(target) || null : null,
        autoParentId: initial?.autoParentId ?? null,
      });
      onClose();
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <SheetCloseButton onPress={onClose} />

        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <View style={[styles.handle, { backgroundColor: theme.divider }]} />
          <Text style={[styles.title, { color: theme.textPrimary }]}>
            {initial?.id ? 'Edit goal' : 'New goal'}
          </Text>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* ── name ─────────────────────────────────────────────────── */}
            <Text style={[styles.label, { color: theme.textSecondary }]}>Name</Text>
            <TextInput
              value={name}
              onChangeText={(t) => { setName(sanitizeName(t)); setShowError(false); }}
              placeholder="Emergency Fund"
              placeholderTextColor={theme.textMuted}
              maxLength={INPUT_LIMITS.NAME_MAX}
              style={[
                styles.input,
                {
                  color: theme.textPrimary,
                  backgroundColor: theme.cardAlt,
                  borderColor: showError && !nameOk ? theme.danger : theme.inputBorder,
                },
              ]}
            />
            {showError && !nameOk ? (
              <Text style={[styles.err, { color: theme.danger }]}>
                Give the goal a name of at least {INPUT_LIMITS.NAME_MIN} characters.
              </Text>
            ) : null}

            {/* ── kind ─────────────────────────────────────────────────── */}
            <Text style={[styles.label, { color: theme.textSecondary }]}>Type</Text>
            <View style={styles.kindRow}>
              {(Object.keys(GOAL_KIND_META) as GoalKind[]).map((k) => {
                const meta = GOAL_KIND_META[k];
                const on = kind === k;
                return (
                  <TouchableOpacity
                    key={k}
                    onPress={() => { hapticLight(); setKind(k); }}
                    activeOpacity={0.8}
                    style={[
                      styles.kindChip,
                      {
                        borderColor: on ? theme.primary : theme.inputBorder,
                        backgroundColor: on ? theme.primary + '14' : 'transparent',
                      },
                    ]}
                  >
                    <Ionicons
                      name={meta.icon}
                      size={15}
                      color={on ? theme.primary : theme.textSecondary}
                    />
                    <Text
                      style={[styles.kindTxt, { color: on ? theme.primary : theme.textSecondary }]}
                      numberOfLines={1}
                    >
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.kindHint, { color: theme.textMuted }]}>
              {GOAL_KIND_META[kind].hint}
            </Text>

            {/* ── glyph ────────────────────────────────────────────────── */}
            <Text style={[styles.label, { color: theme.textSecondary }]}>Icon</Text>
            <View style={styles.emojiWrap}>
              {EMOJI_CHOICES.map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => { hapticLight(); setEmoji(e); }}
                  activeOpacity={0.75}
                  style={[
                    styles.emojiBtn,
                    {
                      borderColor: emoji === e ? theme.primary : 'transparent',
                      backgroundColor: emoji === e ? theme.primary + '10' : theme.cardAlt,
                    },
                  ]}
                  accessibilityLabel={`Icon ${e}`}
                >
                  <Text style={styles.emojiTxt} allowFontScaling={false}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── colour ───────────────────────────────────────────────── */}
            <Text style={[styles.label, { color: theme.textSecondary }]}>Colour</Text>
            <View style={styles.emojiWrap}>
              {GOAL_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => { hapticLight(); setColor(c); }}
                  activeOpacity={0.75}
                  style={[
                    styles.swatch,
                    { backgroundColor: c, borderColor: color === c ? theme.textPrimary : 'transparent' },
                  ]}
                  accessibilityLabel={`Colour ${c}`}
                >
                  {color === c ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
                </TouchableOpacity>
              ))}
            </View>

            {/* ── optional lifetime target ─────────────────────────────── */}
            <Text style={[styles.label, { color: theme.textSecondary }]}>
              Overall target <Text style={{ color: theme.textMuted }}>· optional</Text>
            </Text>
            <TextInput
              value={target}
              onChangeText={(t) => setTarget(sanitizeAmount(t))}
              placeholder="e.g. 300000"
              placeholderTextColor={theme.textMuted}
              keyboardType="decimal-pad"
              maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
              style={[
                styles.input,
                { color: theme.textPrimary, backgroundColor: theme.cardAlt, borderColor: theme.inputBorder },
              ]}
            />
            <Text style={[styles.kindHint, { color: theme.textMuted }]}>
              Set one and we'll tell you the month you'll finish.
            </Text>

            <View style={styles.actions}>
              <GradientButton
                title={initial?.id ? 'Save changes' : 'Add goal'}
                onPress={handleSave}
                loading={submitting}
              />
              {initial?.id && onDelete ? (
                <TouchableOpacity
                  onPress={onDelete}
                  style={styles.deleteBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={[styles.deleteTxt, { color: theme.danger }]}>Delete goal</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '88%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  title: { ...typography.h2, marginBottom: spacing.md },
  label: {
    ...typography.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  input: {
    ...typography.body,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  err: { ...typography.tiny, marginTop: spacing.xs },

  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  kindTxt: { ...typography.tiny, fontWeight: '700', flexShrink: 1 },
  kindHint: { ...typography.tiny, marginTop: spacing.xs },

  emojiWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emojiBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  emojiTxt: { fontSize: 20 },
  swatch: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5,
  },

  actions: { marginTop: spacing.xl, gap: spacing.sm },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.md },
  deleteTxt: { ...typography.body, fontWeight: '600' },
});

export default GoalEditorSheet;
