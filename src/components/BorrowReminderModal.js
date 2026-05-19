// =============================================================================
// BorrowReminderModal — schedule a local push notification for a borrow repayment.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions, LayoutAnimation,
  Platform, UIManager,
} from 'react-native';
import Svg, {
  Path, Circle, Rect, Ellipse,
  Defs, LinearGradient as SvgGradient, Stop,
} from 'react-native-svg';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import {
  requestNotificationPermissions,
  scheduleBorrowReminder,
  cancelScheduledNotification,
} from '../utils/notifications';
import { useEPurseStore } from '../store/ePurseStore';
import { useToast } from './Toast';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const SCREEN_W = Dimensions.get('window').width;

// ── SVG banner ────────────────────────────────────────────────────────────────
const ReminderBanner = ({ w, h }) => (
  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Defs>
      <SvgGradient id="rmbg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#312E81" />
        <Stop offset="100%" stopColor="#4338CA" />
      </SvgGradient>
      <SvgGradient id="bellFill" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0%" stopColor="#A5B4FC" />
        <Stop offset="100%" stopColor="#6366F1" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#rmbg)" />
    <Circle cx="72" cy="55" r="52" fill="#6366F1" opacity="0.18" />
    <Circle cx="268" cy="30" r="40" fill="#818CF8" opacity="0.12" />
    {[0,1,2,3,4].map((i) => [0,1,2].map((j) => (
      <Circle key={`d${i}${j}`} cx={230+i*16} cy={12+j*16} r="1.5" fill="#818CF8" opacity="0.3" />
    )))}
    <Path d="M72 28 C52 28 40 46 40 66 L104 66 C104 46 92 28 72 28 Z" fill="url(#bellFill)" />
    <Circle cx="72" cy="26" r="5" fill="#A5B4FC" />
    <Circle cx="72" cy="23" r="3" fill="#C7D2FE" />
    <Rect x="38" y="66" width="68" height="8" rx="4" fill="#818CF8" />
    <Ellipse cx="72" cy="78" rx="7" ry="5" fill="#4F46E5" />
    <Circle cx="72" cy="78" r="4" fill="#A5B4FC" />
    <Circle cx="72" cy="52" r="40" fill="none" stroke="#818CF8" strokeWidth="1" opacity="0.35" />
    <Circle cx="72" cy="52" r="56" fill="none" stroke="#6366F1" strokeWidth="1" opacity="0.15" />
    <Rect x="168" y="28" width="80" height="66" rx="8" fill="#1E1B4B" opacity="0.7" />
    <Rect x="168" y="28" width="80" height="20" rx="8" fill="#4F46E5" opacity="0.9" />
    <Rect x="168" y="40" width="80" height="8" fill="#4F46E5" opacity="0.9" />
    <Circle cx="190" cy="24" r="4" fill="#818CF8" />
    <Circle cx="228" cy="24" r="4" fill="#818CF8" />
    {[0,1,2].map((col) => [0,1,2].map((row) => {
      const hi = col === 0 && row === 0;
      return <Circle key={`cal${col}${row}`} cx={182+col*20} cy={62+row*14} r={hi?6:4} fill={hi?'#818CF8':'#6366F1'} opacity={hi?1:0.4} />;
    }))}
    <Circle cx="182" cy="62" r="8" fill="none" stroke="#A5B4FC" strokeWidth="1.5" />
    <Circle cx="272" cy="72" r="16" fill="#4F46E5" opacity="0.6" />
    <Circle cx="272" cy="72" r="13" fill="#312E81" opacity="0.5" />
    <Path d="M266 68 L278 68 M266 72 L278 72 M268 68 Q268 78 276 80" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" fill="none" />
    <Path d="M144 18 L146 12 L148 18 L154 20 L148 22 L146 28 L144 22 L138 20 Z" fill="#A5B4FC" opacity="0.8" />
    <Path d="M158 52 L159 48 L160 52 L164 53 L160 54 L159 58 L158 54 L154 53 Z" fill="#C7D2FE" opacity="0.6" />
    <Path d="M140 80 L141 77 L142 80 L145 81 L142 82 L141 85 L140 82 L137 81 Z" fill="#818CF8" opacity="0.5" />
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#4F46E5" opacity="0.6" />
    <Rect x="0" y="104" width="107" height="6" fill="#6366F1" opacity="0.9" />
    <Rect x="107" y="104" width="106" height="6" fill="#818CF8" opacity="0.9" />
    <Rect x="213" y="104" width="107" height="6" fill="#A5B4FC" opacity="0.9" />
  </Svg>
);

// ── Preset options (3 fixed + custom) ─────────────────────────────────────────
const PRESETS = [
  { key: 'tonight',  emoji: '🌙', label: 'Tonight',  defaultHour: 9, defaultMinute: 0, defaultAmPm: 'PM' },
  { key: 'tomorrow', emoji: '☀️', label: 'Tomorrow', defaultHour: 9, defaultMinute: 0, defaultAmPm: 'AM' },
  { key: 'days3',    emoji: '📅', label: '3 Days',   defaultHour: 9, defaultMinute: 0, defaultAmPm: 'AM' },
];

const computeBaseDate = (key, daysOffset) => {
  const now = new Date();
  if (key === 'tonight')  return new Date(now);
  if (key === 'tomorrow') return new Date(now.getTime() + 86400000);
  if (key === 'days3')    return new Date(now.getTime() + 3 * 86400000);
  if (key === 'custom')   return new Date(now.getTime() + daysOffset * 86400000);
  return null;
};

const buildTrigger = (key, daysOffset, hour, minute, ampm) => {
  const base = computeBaseDate(key, daysOffset);
  if (!base) return null;
  let h24 = hour;
  if (ampm === 'PM' && hour !== 12) h24 += 12;
  if (ampm === 'AM' && hour === 12) h24 = 0;
  base.setHours(h24, minute, 0, 0);
  return base;
};

const fmtDate = (d) =>
  d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const fmtTrigger = (d) => {
  if (!d) return '';
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${fmtDate(d)} · ${time}`;
};

const relativeLabel = (offset) => {
  if (offset === 1)  return 'tomorrow';
  if (offset === 7)  return 'in a week';
  if (offset === 14) return 'in 2 weeks';
  return `in ${offset} days`;
};

// ── Main modal ────────────────────────────────────────────────────────────────
const BorrowReminderModal = ({ visible, person, onClose }) => {
  const toast = useToast();
  const theme = useTheme();
  const [selectedKey, setSelectedKey] = useState(null);
  const [hour,        setHour]        = useState(9);
  const [minute,      setMinute]      = useState(0);
  const [ampm,        setAmPm]        = useState('AM');
  const [daysOffset,  setDaysOffset]  = useState(1);

  const notificationIds     = useEPurseStore((s) => s.notificationIds);
  const setNotificationId   = useEPurseStore((s) => s.setNotificationId);
  const clearNotificationId = useEPurseStore((s) => s.clearNotificationId);

  const personKey  = person?.personKey;
  const existingId = personKey ? notificationIds[personKey] : null;
  const netAbs     = person ? Math.abs(person.net) : 0;

  useEffect(() => {
    if (!visible) setSelectedKey(null);
  }, [visible]);

  const selectKey = useCallback((key) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (selectedKey === key) { setSelectedKey(null); return; }
    const preset = PRESETS.find((p) => p.key === key);
    if (preset) {
      setHour(preset.defaultHour);
      setMinute(preset.defaultMinute);
      setAmPm(preset.defaultAmPm);
    } else {
      setHour(9); setMinute(0); setAmPm('AM'); setDaysOffset(1);
    }
    setSelectedKey(key);
  }, [selectedKey]);

  const triggerDate = useMemo(
    () => buildTrigger(selectedKey, daysOffset, hour, minute, ampm),
    [selectedKey, daysOffset, hour, minute, ampm]
  );

  const isPast = useMemo(
    () => (triggerDate ? triggerDate <= new Date() : false),
    [triggerDate]
  );

  const adjustHour = (delta) =>
    setHour((h) => { let n = h + delta; if (n > 12) n = 1; if (n < 1) n = 12; return n; });

  const adjustMinute = (delta) =>
    setMinute((m) => { let n = m + delta * 5; if (n >= 60) n = 0; if (n < 0) n = 55; return n; });

  const handleClose = useCallback(() => { setSelectedKey(null); onClose(); }, [onClose]);

  const handleSet = useCallback(async () => {
    if (!triggerDate || isPast || !personKey) return;
    const granted = await requestNotificationPermissions();
    if (!granted) {
      toast.warning('Permission required', 'Allow notifications in your device settings to set reminders.');
      return;
    }
    if (existingId) await cancelScheduledNotification(existingId);
    try {
      const id = await scheduleBorrowReminder({ personName: person.person, amount: netAbs, triggerDate });
      if (id) setNotificationId(personKey, id);
      setSelectedKey(null);
      onClose();
    } catch (_) {
      toast.error('Reminder failed', 'Could not schedule the reminder. Please try again.');
    }
  }, [triggerDate, isPast, personKey, existingId, person, netAbs, setNotificationId, onClose]);

  const handleCancelReminder = useCallback(async () => {
    if (!existingId) return;
    await cancelScheduledNotification(existingId);
    clearNotificationId(personKey);
    setSelectedKey(null);
    onClose();
  }, [existingId, personKey, clearNotificationId, onClose]);

  if (!person) return null;

  const bannerW = SCREEN_W - spacing.lg * 2;
  const bannerH = Math.round(bannerW * (110 / 320));
  const editorOpen = !!selectedKey;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <BellIconSvg size={18} color={theme.primary} />
            <Text style={styles.title}>Set Reminder</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {/* Info */}
            <Text style={styles.infoText}>
              Remind yourself to pay{' '}
              <Text style={styles.infoAmt}>{formatCurrency(netAbs)}</Text>
              {' '}to{' '}
              <Text style={styles.infoPerson}>{person.person}</Text>
            </Text>

            {/* Banner */}
            <View style={[styles.bannerWrap, { width: bannerW, height: bannerH }]}>
              <ReminderBanner w={bannerW} h={bannerH} />
              <View style={styles.bannerOverlay}>
                <View style={styles.bannerPill}>
                  <Text style={styles.bannerTitle}>🔔 Payment Due</Text>
                  <Text style={styles.bannerSub}>Don't forget to pay {person.person}</Text>
                </View>
              </View>
            </View>

            {/* Existing badge */}
            {existingId ? (
              <View style={styles.existingBadge}>
                <BellIconSvg size={12} color="#6366F1" />
                <Text style={styles.existingText}>Reminder set — update or cancel below</Text>
              </View>
            ) : null}

            {/* ── Preset chips ── */}
            <Text style={styles.sectionLabel}>When to remind you?</Text>
            <View style={styles.presetsRow}>
              {PRESETS.map((p) => {
                const active = selectedKey === p.key;
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[styles.presetChip, active && { backgroundColor: theme.primary + '1A', borderColor: theme.primary }]}
                    onPress={() => selectKey(p.key)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.presetEmoji}>{p.emoji}</Text>
                    <Text style={[styles.presetLabel, active && { color: theme.primary }]}>{p.label}</Text>
                    <Text style={[styles.presetSub, active && { color: theme.primary + 'AA' }]}>
                      {p.defaultAmPm === 'PM' ? '9 PM' : '9 AM'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Custom chip ── */}
            <TouchableOpacity
              style={[styles.customChip, selectedKey === 'custom' && { backgroundColor: theme.primary + '1A', borderColor: theme.primary }]}
              onPress={() => selectKey('custom')}
              activeOpacity={0.75}
            >
              <Text style={styles.customEmoji}>🗓️</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.customLabel, selectedKey === 'custom' && { color: theme.primary }]}>
                  Custom Date &amp; Time
                </Text>
                <Text style={styles.customSub}>Pick your own day and time</Text>
              </View>
              <Text style={[styles.customArrow, selectedKey === 'custom' && { color: theme.primary }]}>
                {selectedKey === 'custom' ? '▲' : '▼'}
              </Text>
            </TouchableOpacity>

            {/* ── Inline editor (date + time) ── */}
            {editorOpen ? (
              <View style={[styles.editorCard, { borderColor: theme.primary + '33' }]}>

                {/* Date row — only for custom */}
                {selectedKey === 'custom' ? (
                  <>
                    <Text style={styles.editorSectionLabel}>📅  Date</Text>
                    <View style={styles.dateStepper}>
                      <TouchableOpacity
                        style={[styles.stepperBtn, daysOffset <= 1 && { opacity: 0.3 }]}
                        onPress={() => setDaysOffset((d) => Math.max(1, d - 1))}
                        disabled={daysOffset <= 1}
                      >
                        <Text style={styles.stepperArrow}>◀</Text>
                      </TouchableOpacity>
                      <View style={styles.dateValueBox}>
                        <Text style={[styles.dateValueText, { color: theme.primary }]}>
                          {fmtDate(new Date(Date.now() + daysOffset * 86400000))}
                        </Text>
                        <Text style={styles.dateValueSub}>{relativeLabel(daysOffset)}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.stepperBtn}
                        onPress={() => setDaysOffset((d) => Math.min(60, d + 1))}
                      >
                        <Text style={styles.stepperArrow}>▶</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.editorDivider} />
                  </>
                ) : null}

                {/* Time picker */}
                <Text style={styles.editorSectionLabel}>⏰  Time</Text>
                <View style={styles.timePicker}>

                  {/* Hour column */}
                  <View style={styles.timeColumn}>
                    <TouchableOpacity onPress={() => adjustHour(1)} style={styles.timeArrowBtn} activeOpacity={0.6}>
                      <Text style={[styles.timeArrow, { color: theme.primary }]}>▲</Text>
                    </TouchableOpacity>
                    <View style={[styles.timeValueBox2, { borderColor: theme.primary + '44' }]}>
                      <Text style={styles.timeDigit}>{String(hour).padStart(2, '0')}</Text>
                    </View>
                    <TouchableOpacity onPress={() => adjustHour(-1)} style={styles.timeArrowBtn} activeOpacity={0.6}>
                      <Text style={[styles.timeArrow, { color: theme.primary }]}>▼</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.timeColon}>:</Text>

                  {/* Minute column */}
                  <View style={styles.timeColumn}>
                    <TouchableOpacity onPress={() => adjustMinute(1)} style={styles.timeArrowBtn} activeOpacity={0.6}>
                      <Text style={[styles.timeArrow, { color: theme.primary }]}>▲</Text>
                    </TouchableOpacity>
                    <View style={[styles.timeValueBox2, { borderColor: theme.primary + '44' }]}>
                      <Text style={styles.timeDigit}>{String(minute).padStart(2, '0')}</Text>
                    </View>
                    <TouchableOpacity onPress={() => adjustMinute(-1)} style={styles.timeArrowBtn} activeOpacity={0.6}>
                      <Text style={[styles.timeArrow, { color: theme.primary }]}>▼</Text>
                    </TouchableOpacity>
                  </View>

                  {/* AM / PM toggle */}
                  <View style={styles.ampmStack}>
                    <TouchableOpacity
                      style={[styles.ampmBtn, ampm === 'AM' && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                      onPress={() => setAmPm('AM')}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.ampmText, ampm === 'AM' && { color: '#fff', fontWeight: '700' }]}>AM</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ampmBtn, ampm === 'PM' && { backgroundColor: theme.primary, borderColor: theme.primary }]}
                      onPress={() => setAmPm('PM')}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.ampmText, ampm === 'PM' && { color: '#fff', fontWeight: '700' }]}>PM</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {isPast ? (
                  <Text style={styles.pastWarning}>⚠ This time is in the past — pick a future time</Text>
                ) : null}
              </View>
            ) : null}

            {/* Preview */}
            {triggerDate && !isPast ? (
              <View style={styles.previewCard}>
                <View style={styles.previewIconWrap}>
                  <BellIconSvg size={16} color="#6366F1" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.previewTitle}>💸 Payment Reminder</Text>
                  <Text style={styles.previewBody}>
                    You owe ₹{netAbs.toLocaleString('en-IN')} to {person.person}
                  </Text>
                  <Text style={styles.previewTime}>{fmtTrigger(triggerDate)}</Text>
                </View>
              </View>
            ) : null}

            {/* Cancel existing */}
            {existingId ? (
              <TouchableOpacity style={styles.cancelLink} onPress={handleCancelReminder}>
                <Text style={styles.cancelLinkText}>✕  Cancel existing reminder</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>

          {/* CTA */}
          <TouchableOpacity
            style={[styles.setBtn, { backgroundColor: (triggerDate && !isPast) ? '#6366F1' : colors.divider }]}
            onPress={handleSet}
            disabled={!triggerDate || isPast}
            activeOpacity={0.85}
          >
            <BellIconSvg size={16} color="#fff" />
            <Text style={[styles.setBtnText, { color: (triggerDate && !isPast) ? '#fff' : colors.textMuted }]}>
              {existingId ? 'Update Reminder' : 'Set Reminder'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// ── Bell SVG icon ─────────────────────────────────────────────────────────────
const BellIconSvg = ({ size = 20, color = '#6366F1' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
    <Path
      d="M13.73 21a2 2 0 0 1-3.46 0"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    />
  </Svg>
);

export { BellIconSvg };
export default BorrowReminderModal;

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000060',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl + 8,
    maxHeight: '92%',
    ...shadows.elevated,
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: colors.divider,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: { flex: 1, ...typography.h3, color: colors.textPrimary },
  closeBtn: { color: colors.textSecondary, fontSize: 16, paddingLeft: spacing.sm },

  scroll: { paddingBottom: spacing.md },

  infoText: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  infoAmt: { color: '#EF4444', fontWeight: '800' },
  infoPerson: { color: colors.textPrimary, fontWeight: '700' },

  bannerWrap: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: spacing.md },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end', alignItems: 'flex-end', padding: spacing.md,
  },
  bannerPill: {
    backgroundColor: '#00000055', borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 5, alignItems: 'flex-end',
  },
  bannerTitle: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  bannerSub: { color: '#FFFFFFCC', fontSize: 9, marginTop: 1 },

  existingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    backgroundColor: '#6366F115', borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2, paddingVertical: 7,
    borderWidth: 1, borderColor: '#6366F133', marginBottom: spacing.md,
  },
  existingText: { ...typography.tiny, color: '#6366F1', flex: 1 },

  sectionLabel: {
    ...typography.small, color: colors.textSecondary,
    fontWeight: '700', marginBottom: spacing.sm,
  },

  // ── Preset chips ──
  presetsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 3,
  },
  presetEmoji: { fontSize: 18 },
  presetLabel: { ...typography.small, color: colors.textPrimary, fontWeight: '700' },
  presetSub: { ...typography.tiny, color: colors.textSecondary },

  // ── Custom chip ──
  customChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  customEmoji: { fontSize: 20 },
  customLabel: { ...typography.bodyBold, color: colors.textPrimary },
  customSub: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  customArrow: { fontSize: 12, color: colors.textMuted },

  // ── Inline editor card ──
  editorCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  editorSectionLabel: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: 4,
  },
  editorDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.sm,
  },

  // ── Date stepper ──
  dateStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 36, height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  stepperArrow: { fontSize: 14, color: colors.textPrimary },
  dateValueBox: { flex: 1, alignItems: 'center' },
  dateValueText: { ...typography.bodyBold, fontWeight: '700' },
  dateValueSub: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },

  // ── Time picker ──
  timePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  timeColumn: { alignItems: 'center', gap: 4 },
  timeArrowBtn: {
    width: 44, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  timeArrow: { fontSize: 14, fontWeight: '700' },
  timeValueBox2: {
    width: 64, height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.card,
  },
  timeDigit: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  timeColon: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
  },

  // ── AM/PM ──
  ampmStack: { gap: 6, marginLeft: 4 },
  ampmBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.divider,
    backgroundColor: colors.card,
    alignItems: 'center',
    minWidth: 50,
  },
  ampmText: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },

  pastWarning: {
    ...typography.tiny,
    color: '#F59E0B',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  // ── Preview ──
  previewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#6366F133',
    marginBottom: spacing.md,
  },
  previewIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#6366F115',
    alignItems: 'center', justifyContent: 'center',
  },
  previewTitle: { ...typography.bodyBold, color: colors.textPrimary },
  previewBody: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  previewTime: { ...typography.tiny, color: '#6366F1', fontWeight: '700', marginTop: 4 },

  // ── Cancel link ──
  cancelLink: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  cancelLinkText: { ...typography.small, color: '#EF4444', fontWeight: '600' },

  // ── CTA button ──
  setBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  setBtnText: { ...typography.bodyBold, fontWeight: '700', fontSize: 16 },
});
