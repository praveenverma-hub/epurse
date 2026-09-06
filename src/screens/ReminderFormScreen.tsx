// =============================================================================
// ReminderFormScreen — set / edit ONE reminder. The app's only reminder form.
//
// Three entry points share it, which is the whole point: "+ Add" on the
// Reminders screen, and the bell on a lent or a borrowed row in Lent/Borrowed
// (person prefilled). It replaced `BorrowReminderModal`, a bottom sheet that
// could only ever do the borrow case — the presets and the picker logic now live
// in one place instead of being reimplemented per caller.
//
// Route params (all optional):
//   reminderId  — editing an existing reminder instead of creating one
//   kind        — 'custom' | 'lb_borrow'  (default 'custom'). There is no lent
//     kind: money owed TO you is nudged by MESSAGING the person
//     (WhatsAppReminderScreen), not by scheduling an alarm for yourself.
//   presetTitle — prefilled title
//   presetAmount / presetPerson — the balance a lent/borrow reminder is about.
//     Passed STRUCTURED, not as a ready-made sentence, so the form can emphasise
//     the amount and the name in the context line (you cannot bold half of a
//     string that arrived pre-composed) and compose the notification body from
//     the same two values — one source for both.
//   sourceKey   — the personKey a lent/borrow reminder is about
//
// Nothing is scheduled until "Set reminder" is pressed: the store's
// `scheduleReminder` both arms the OS and writes the record, and only records
// what the OS actually accepted (see its own doc comment).
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { colors, radius, spacing, typography as typographyBase, BUTTON_H } from '../constants/theme';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import { formatCurrency } from '../utils/format';
import { REPEAT, describeRepeat, nextOccurrence } from '../utils/reminderSchedule';
import { requestNotificationPermissions } from '../utils/notifications';
import PlainScreenHeader from '../components/PlainScreenHeader';
import ReminderBanner from '../components/ReminderBanner';
import DateField from '../components/DateField';
import TimeField, { formatTimeLabel } from '../components/TimeField';
import { FormField, FormTextInput, FormChipRow, FormChip } from '../components/FormField';
import { useToast } from '../components/Toast';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const SCREEN_W = Dimensions.get('window').width;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The quick answers to "when?", carried over from the borrow sheet — they cover
 * the overwhelming majority of reminders and save the user two pickers.
 * `at` is the hour (24h) each preset lands on.
 */
const PRESETS = [
  { key: 'tonight',  emoji: '🌙', label: 'Tonight',  days: 0, at: 21 },
  { key: 'tomorrow', emoji: '☀️', label: 'Tomorrow', days: 1, at: 9 },
  { key: 'days3',    emoji: '📅', label: '3 days',   days: 3, at: 9 },
] as const;

const REPEAT_OPTIONS = [
  { key: REPEAT.ONCE,    label: 'Once' },
  { key: REPEAT.WEEKLY,  label: 'Weekly' },
  { key: REPEAT.MONTHLY, label: 'Monthly' },
] as const;

const presetMoment = (days: number, hour: number): Date => {
  const d = new Date(Date.now() + days * DAY_MS);
  d.setHours(hour, 0, 0, 0);
  return d;
};

/** Merge a day from one Date with the time from another. */
const combine = (day: Date, time: Date): Date => {
  const d = new Date(day);
  d.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return d;
};

const fullWhen = (ms: number | null): string => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTimeLabel(d)}`;
};

interface Props {
  navigation: { goBack: () => void };
  route: {
    params?: {
      reminderId?: string;
      kind?: string;
      presetTitle?: string;
      presetAmount?: number;
      presetPerson?: string;
      sourceKey?: string;
    };
  };
}

const ReminderFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();

  const {
    reminderId = undefined,
    kind = 'custom',
    presetTitle = '',
    presetAmount = undefined,
    presetPerson = undefined,
    sourceKey = undefined,
  } = route?.params || {};

  const reminders = useEPurseStore((s: any) => s.reminders) as any[];
  const scheduleReminder = useEPurseStore((s: any) => s.scheduleReminder);
  const cancelReminder = useEPurseStore((s: any) => s.cancelReminder);

  const existing = useMemo(
    () => (reminderId ? (reminders || []).find((r) => r.id === reminderId) : null),
    [reminders, reminderId],
  );
  const isEdit = !!existing;

  // Drafts. An edit starts from the stored record; a fresh one from whatever the
  // caller prefilled plus tomorrow 9am, so the form is valid the moment it opens
  // and "Set reminder" is never the first thing to tell you something's missing.
  const initialAnchor = existing ? new Date(existing.anchorAt) : presetMoment(1, 9);
  const [title, setTitle]   = useState<string>(existing?.title || presetTitle);
  const [when, setWhen]     = useState<Date>(initialAnchor);
  const [repeat, setRepeat] = useState<string>(existing?.repeat || REPEAT.ONCE);
  const [presetKey, setPresetKey] = useState<string | null>(isEdit ? null : 'tomorrow');
  const [saving, setSaving] = useState(false);

  // The balance this reminder is about — from the route on a fresh one, from the
  // record on an edit, so the context line reads identically in both modes.
  const amount = existing?.amount ?? presetAmount;
  const person = existing?.person ?? presetPerson;
  const hasBalance = typeof amount === 'number' && !!person;

  // The notification body, composed from the SAME two values the context line
  // emphasises — so what the reminder says and what the form showed can't drift.
  const body = hasBalance
    ? `You owe ${formatCurrency(amount as number)} to ${person}`
    : (existing?.body ?? '');
  const titleValid = isValidName(title);
  // A repeating reminder is always schedulable; a one-off must still be ahead of
  // now, which a preset can stop being if the form is left open past 9pm.
  const nextFire = nextOccurrence(when.getTime(), repeat, Date.now());
  const canSave = titleValid && !!nextFire && !saving;

  const pickPreset = useCallback((key: string, days: number, at: number) => {
    hapticLight();
    setPresetKey(key);
    setWhen(presetMoment(days, at));
  }, []);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    const granted = await requestNotificationPermissions();
    if (!granted) {
      setSaving(false);
      toast.warning('Permission required', 'Allow notifications in your device settings to set reminders.');
      return;
    }
    const record = await scheduleReminder({
      kind,
      title: title.trim(),
      body,
      repeat,
      anchorAt: when.getTime(),
      sourceKey: sourceKey ?? existing?.sourceKey ?? null,
      // Kept on the record so re-opening it can rebuild the same emphasised
      // context line rather than trying to un-compose `body` back into parts.
      amount: hasBalance ? (amount as number) : undefined,
      person: hasBalance ? person : undefined,
      replaceId: reminderId ?? null,
    });
    setSaving(false);
    if (!record) {
      // The OS refused every occurrence — almost always a moment that has just
      // passed. Say so instead of closing as if it worked.
      toast.error('Could not set reminder', 'Pick a time a little further ahead and try again.');
      return;
    }
    toast.success(
      isEdit ? 'Reminder updated' : 'Reminder set',
      repeat === REPEAT.ONCE ? fullWhen(record.anchorAt) : describeRepeat(record.anchorAt, repeat),
    );
    navigation.goBack();
  }, [canSave, kind, title, body, repeat, when, sourceKey, existing, reminderId, isEdit,
      hasBalance, amount, person, scheduleReminder, toast, navigation]);

  const handleDelete = useCallback(async () => {
    if (!reminderId) return;
    await cancelReminder(reminderId);
    toast.success('Reminder removed', 'It won\'t notify you any more.');
    navigation.goBack();
  }, [reminderId, cancelReminder, toast, navigation]);

  const bannerW = SCREEN_W - spacing.lg * 2;
  const bannerH = Math.round(bannerW * (110 / 320));

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <PlainScreenHeader
          title={isEdit ? 'Edit reminder' : 'New reminder'}
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
        />

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* What this reminder is about, stated in words before anything else —
              the old borrow sheet led with exactly this line and losing it made
              the form read like a blank alarm rather than "you owe Rahul ₹1,200".
              The amount and the name are emphasised, which is why they arrive as
              separate params instead of one pre-composed sentence. */}
          {hasBalance ? (
            <Text style={[styles.contextLine, { color: theme.textSecondary }]}>
              {'Remind yourself to pay '}
              <Text style={[styles.contextAmt, { color: theme.danger }]}>
                {formatCurrency(amount as number)}
              </Text>
              {' to '}
              <Text style={[styles.contextStrong, { color: theme.textPrimary }]}>{person}</Text>
            </Text>
          ) : null}

          <View style={[styles.bannerWrap, { width: bannerW, height: bannerH }]}>
            <ReminderBanner w={bannerW} h={bannerH} />
            <View style={styles.bannerOverlay}>
              <View style={styles.bannerPill}>
                <Text style={styles.bannerTitle} numberOfLines={1}>
                  {title.trim() || 'Your reminder'}
                </Text>
                <Text style={styles.bannerSub} numberOfLines={1}>
                  {nextFire ? fullWhen(nextFire) : 'Pick a time ahead of now'}
                  {hasBalance ? ` · ${formatCurrency(amount as number)}` : ''}
                </Text>
              </View>
            </View>
          </View>

          {/* What. For a person-scoped reminder the body is composed by the
              caller (the amount + who), and shown read-only below the title —
              editing it would let the text drift from the actual balance. */}
          <FormField label="Remind me to">
            <FormTextInput
              value={title}
              onChangeText={(t) => setTitle(sanitizeName(t))}
              placeholder="e.g. Pay rent"
              placeholderTextColor={colors.textMuted}
              maxLength={INPUT_LIMITS.NAME_MAX}
              returnKeyType="done"
            />
          </FormField>

          {/* When — presets first, then the exact pickers. Tapping a picker
              clears the preset highlight, because the two would otherwise
              disagree about which one is in effect. */}
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>WHEN</Text>
          <View style={styles.presetRow}>
            {/* Only presets that are still ahead of now. "Tonight" at 9pm is a
                real moment at 6pm and an unsavable one at 10pm — offering a chip
                that lands the form in an error state is worse than not offering
                it, so it drops out of the row instead. */}
            {PRESETS.filter((p) => presetMoment(p.days, p.at).getTime() > Date.now() + 60_000).map((p) => {
              const active = presetKey === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.preset,
                    { borderColor: theme.divider },
                    active && { backgroundColor: theme.primary + '1A', borderColor: theme.primary },
                  ]}
                  onPress={() => pickPreset(p.key, p.days, p.at)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.presetEmoji}>{p.emoji}</Text>
                  <Text
                    style={[styles.presetLabel, { color: theme.textPrimary }, active && { color: theme.primary, fontWeight: '700' }]}
                    numberOfLines={1}
                  >
                    {p.label}
                  </Text>
                  <Text style={[styles.presetSub, { color: active ? theme.primary : theme.textMuted }]}>
                    {p.at > 12 ? `${p.at - 12} PM` : `${p.at} AM`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.pickers}>
            <DateField
              value={when}
              onChange={(d) => { setPresetKey(null); setWhen(combine(d, when)); }}
              minimumDate={new Date()}
              accentColor={theme.primary}
            />
            <TimeField
              value={when}
              onChange={(t) => { setPresetKey(null); setWhen(combine(when, t)); }}
              accentColor={theme.primary}
            />
          </View>

          {/* Repeat. The label under the chips is generated from the ANCHOR, so
              it always names the real day ("Monthly on the 5th") — and admits the
              clamp when the day doesn't exist in every month. */}
          <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>REPEAT</Text>
          <FormChipRow>
            {REPEAT_OPTIONS.map((opt) => (
              <FormChip
                key={opt.key}
                label={opt.label}
                active={repeat === opt.key}
                onPress={() => { hapticLight(); setRepeat(opt.key); }}
                accentColor={theme.primary}
              />
            ))}
          </FormChipRow>
          <Text style={[styles.repeatNote, { color: theme.textSecondary }]}>
            {repeat === REPEAT.ONCE
              ? `Fires once — ${fullWhen(nextFire)}`
              : `${describeRepeat(when.getTime(), repeat)} · next on ${fullWhen(nextFire)}`}
          </Text>

          {isEdit ? (
            <TouchableOpacity
              style={[styles.deleteBtn, { borderColor: theme.danger + '55' }]}
              onPress={handleDelete}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={17} color={theme.danger} />
              <Text style={[styles.deleteTxt, { color: theme.danger }]}>Delete reminder</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        {/* Pinned below the scroll view, per the footer-CTA rule — a Save that
            scrolls away is a Save you have to hunt for. */}
        <View style={[styles.footer, { borderTopColor: theme.divider, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: canSave ? theme.primary : theme.divider }]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.85}
          >
            <Text style={[styles.saveTxt, { color: canSave ? '#fff' : theme.textMuted }]}>
              {saving ? 'Setting…' : isEdit ? 'Save changes' : 'Set reminder'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

export default ReminderFormScreen;

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1 },
  body:      { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },

  bannerWrap: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.sm },
  bannerOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', padding: spacing.md },
  // Painted flat on the fixed indigo art, so these two stay white by design.
  bannerPill: { backgroundColor: '#0000004D', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bannerTitle: { ...typography.bodyBold, color: '#fff', fontWeight: '800' },
  bannerSub:   { ...typography.tiny, color: '#E0E7FF', marginTop: 1 },

  // Mirrors the old borrow sheet's infoText/infoAmt/infoPerson weights, with the
  // amount taking its colour from the theme rather than a hardcoded #EF4444.
  contextLine:   { ...typography.body, marginBottom: spacing.sm, lineHeight: 22 },
  contextAmt:    { fontWeight: '800' },
  contextStrong: { fontWeight: '700' },

  sectionLabel: { ...typography.tiny, fontWeight: '800', letterSpacing: 1.2, marginTop: spacing.md },

  presetRow: { flexDirection: 'row', gap: spacing.sm },
  preset: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: 2,
  },
  presetEmoji: { fontSize: 18 },
  presetLabel: { ...typography.small, fontWeight: '600' },
  presetSub:   { ...typography.tiny },

  pickers: { gap: spacing.sm, marginTop: spacing.sm },

  repeatNote: { ...typography.small, marginTop: spacing.xs, lineHeight: 18 },

  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    minHeight: BUTTON_H,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  deleteTxt: { ...typography.bodyBold, fontWeight: '700' },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    minHeight: BUTTON_H,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  saveTxt: { ...typography.bodyBold, fontWeight: '700', fontSize: 16 },
});
