// =============================================================================
// BorrowReminderModal — schedule a local push notification to remind yourself
//                       to repay a borrowed amount.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Alert, Dimensions,
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

const SCREEN_W = Dimensions.get('window').width;

// ── Indigo/purple SVG banner ──────────────────────────────────────────────────
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

    {/* Background */}
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#rmbg)" />

    {/* Soft glow blobs */}
    <Circle cx="72" cy="55" r="52" fill="#6366F1" opacity="0.18" />
    <Circle cx="268" cy="30" r="40" fill="#818CF8" opacity="0.12" />

    {/* Dot grid top-right */}
    {[0, 1, 2, 3, 4].map((i) =>
      [0, 1, 2].map((j) => (
        <Circle
          key={`d${i}${j}`}
          cx={230 + i * 16}
          cy={12 + j * 16}
          r="1.5"
          fill="#818CF8"
          opacity="0.3"
        />
      ))
    )}

    {/* Bell body */}
    <Path
      d="M72 28 C52 28 40 46 40 66 L104 66 C104 46 92 28 72 28 Z"
      fill="url(#bellFill)"
    />
    {/* Bell top knob */}
    <Circle cx="72" cy="26" r="5" fill="#A5B4FC" />
    <Circle cx="72" cy="23" r="3" fill="#C7D2FE" />
    {/* Bell brim */}
    <Rect x="38" y="66" width="68" height="8" rx="4" fill="#818CF8" />
    {/* Bell clapper */}
    <Ellipse cx="72" cy="78" rx="7" ry="5" fill="#4F46E5" />
    <Circle cx="72" cy="78" r="4" fill="#A5B4FC" />

    {/* Pulse rings radiating from bell */}
    <Circle cx="72" cy="52" r="40" fill="none" stroke="#818CF8" strokeWidth="1" opacity="0.35" />
    <Circle cx="72" cy="52" r="56" fill="none" stroke="#6366F1" strokeWidth="1" opacity="0.15" />

    {/* Calendar card (right side) */}
    <Rect x="168" y="28" width="80" height="66" rx="8" fill="#1E1B4B" opacity="0.7" />
    {/* Calendar header bar */}
    <Rect x="168" y="28" width="80" height="20" rx="8" fill="#4F46E5" opacity="0.9" />
    <Rect x="168" y="40" width="80" height="8" fill="#4F46E5" opacity="0.9" />
    {/* Binding dots on calendar */}
    <Circle cx="190" cy="24" r="4" fill="#818CF8" />
    <Circle cx="228" cy="24" r="4" fill="#818CF8" />
    {/* Calendar day grid — 3×3 */}
    {[0, 1, 2].map((col) =>
      [0, 1, 2].map((row) => {
        const isHighlighted = col === 0 && row === 0;
        return (
          <Circle
            key={`cal${col}${row}`}
            cx={182 + col * 20}
            cy={62 + row * 14}
            r={isHighlighted ? 6 : 4}
            fill={isHighlighted ? '#818CF8' : '#6366F1'}
            opacity={isHighlighted ? 1 : 0.4}
          />
        );
      })
    )}
    {/* "Today" highlight ring */}
    <Circle cx="182" cy="62" r="8" fill="none" stroke="#A5B4FC" strokeWidth="1.5" />

    {/* Rupee coin (floating) */}
    <Circle cx="272" cy="72" r="16" fill="#4F46E5" opacity="0.6" />
    <Circle cx="272" cy="72" r="13" fill="#312E81" opacity="0.5" />
    <Path
      d="M266 68 L278 68 M266 72 L278 72 M268 68 Q268 78 276 80"
      stroke="#A5B4FC"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />

    {/* Sparkle stars */}
    <Path d="M144 18 L146 12 L148 18 L154 20 L148 22 L146 28 L144 22 L138 20 Z" fill="#A5B4FC" opacity="0.8" />
    <Path d="M158 52 L159 48 L160 52 L164 53 L160 54 L159 58 L158 54 L154 53 Z" fill="#C7D2FE" opacity="0.6" />
    <Path d="M140 80 L141 77 L142 80 L145 81 L142 82 L141 85 L140 82 L137 81 Z" fill="#818CF8" opacity="0.5" />

    {/* Bottom accent bar */}
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#4F46E5" opacity="0.6" />
    <Rect x="0" y="104" width="107" height="6" fill="#6366F1" opacity="0.9" />
    <Rect x="107" y="104" width="106" height="6" fill="#818CF8" opacity="0.9" />
    <Rect x="213" y="104" width="107" height="6" fill="#A5B4FC" opacity="0.9" />
  </Svg>
);

// ── Schedule options ──────────────────────────────────────────────────────────
const buildTriggerDate = (key) => {
  const now = new Date();
  const at = (base, hours, minutes = 0) => {
    const d = new Date(base);
    d.setHours(hours, minutes, 0, 0);
    return d;
  };
  if (key === 'tonight') {
    const d = at(now, 21);
    return d > now ? d : at(new Date(now.getTime() + 86400000), 21);
  }
  if (key === 'tomorrow') return at(new Date(now.getTime() + 86400000), 9);
  if (key === 'days3') return at(new Date(now.getTime() + 3 * 86400000), 9);
  if (key === 'week') return at(new Date(now.getTime() + 7 * 86400000), 9);
  return null;
};

const fmtTrigger = (d) => {
  if (!d) return '';
  const datePart = d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const timePart = d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart} · ${timePart}`;
};

const SCHEDULE_OPTIONS = [
  { key: 'tonight',  label: 'Tonight',   sub: '9:00 PM' },
  { key: 'tomorrow', label: 'Tomorrow',  sub: '9:00 AM' },
  { key: 'days3',    label: 'In 3 Days', sub: '9:00 AM' },
  { key: 'week',     label: 'In a Week', sub: '9:00 AM' },
];

// ── Modal ─────────────────────────────────────────────────────────────────────
const BorrowReminderModal = ({ visible, person, onClose }) => {
  const theme = useTheme();
  const [selectedKey, setSelectedKey] = useState(null);

  const notificationIds     = useEPurseStore((s) => s.notificationIds);
  const setNotificationId   = useEPurseStore((s) => s.setNotificationId);
  const clearNotificationId = useEPurseStore((s) => s.clearNotificationId);

  const personKey  = person?.personKey;
  const existingId = personKey ? notificationIds[personKey] : null;
  const netAbs     = person ? Math.abs(person.net) : 0;

  const triggerDate = useMemo(() => buildTriggerDate(selectedKey), [selectedKey]);

  const handleSet = useCallback(async () => {
    if (!triggerDate || !personKey) return;

    const granted = await requestNotificationPermissions();
    if (!granted) {
      Alert.alert(
        'Permission Required',
        'Please allow notifications in your device settings to set payment reminders.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (existingId) await cancelScheduledNotification(existingId);

    try {
      const id = await scheduleBorrowReminder({
        personName: person.person,
        amount: netAbs,
        triggerDate,
      });
      if (id) setNotificationId(personKey, id);
      setSelectedKey(null);
      onClose();
    } catch (_) {
      Alert.alert('Failed', 'Could not schedule the reminder. Please try again.');
    }
  }, [triggerDate, personKey, existingId, person, netAbs, setNotificationId, onClose]);

  const handleCancelReminder = useCallback(async () => {
    if (!existingId) return;
    await cancelScheduledNotification(existingId);
    clearNotificationId(personKey);
    setSelectedKey(null);
    onClose();
  }, [existingId, personKey, clearNotificationId, onClose]);

  const handleClose = useCallback(() => {
    setSelectedKey(null);
    onClose();
  }, [onClose]);

  if (!person) return null;

  const bannerW = SCREEN_W - spacing.lg * 2;
  const bannerH = Math.round(bannerW * (110 / 320));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.headerRow}>
            <BellIconSvg size={18} color={theme.primary} />
            <Text style={styles.title}>Set Reminder</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            {/* Info line */}
            <Text style={styles.infoText}>
              Remind yourself to pay{' '}
              <Text style={styles.infoAmt}>{formatCurrency(netAbs)}</Text>
              {' '}to{' '}
              <Text style={styles.infoPerson}>{person.person}</Text>
            </Text>

            {/* Banner */}
            <View style={[styles.bannerWrap, { width: bannerW, height: bannerH }]}>
              <ReminderBanner w={bannerW} h={bannerH} />
              {/* Text overlay */}
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
                <Text style={styles.existingText}>Reminder already set — tap below to update or cancel</Text>
              </View>
            ) : null}

            {/* Schedule picker */}
            <Text style={styles.sectionLabel}>When to remind you?</Text>
            <View style={styles.chipsGrid}>
              {SCHEDULE_OPTIONS.map((opt) => {
                const isSelected = selectedKey === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.chip,
                      isSelected && {
                        backgroundColor: theme.primary + '20',
                        borderColor: theme.primary,
                      },
                    ]}
                    onPress={() => setSelectedKey(isSelected ? null : opt.key)}
                  >
                    <Text
                      style={[
                        styles.chipLabel,
                        isSelected && { color: theme.primary, fontWeight: '700' },
                      ]}
                    >
                      {opt.label}
                    </Text>
                    <Text style={[styles.chipSub, isSelected && { color: theme.primary }]}>
                      {opt.sub}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Notification preview */}
            {triggerDate ? (
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

            {/* Cancel existing reminder link */}
            {existingId ? (
              <TouchableOpacity style={styles.cancelLink} onPress={handleCancelReminder}>
                <Text style={styles.cancelLinkText}>✕  Cancel existing reminder</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>

          {/* Set Reminder button */}
          <TouchableOpacity
            style={[
              styles.setBtn,
              { backgroundColor: triggerDate ? '#6366F1' : colors.textMuted },
            ]}
            onPress={handleSet}
            disabled={!triggerDate}
            activeOpacity={0.85}
          >
            <BellIconSvg size={16} color="#fff" />
            <Text style={styles.setBtnText}>
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
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <Path
      d="M13.73 21a2 2 0 0 1-3.46 0"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
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
    maxHeight: '90%',
    ...shadows.elevated,
  },
  handle: {
    width: 40,
    height: 4,
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
  title: {
    flex: 1,
    ...typography.h3,
    color: colors.textPrimary,
  },
  closeBtn: {
    color: colors.textSecondary,
    fontSize: 16,
    paddingLeft: spacing.sm,
  },
  scroll: {
    paddingBottom: spacing.md,
  },

  infoText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  infoAmt: {
    color: '#EF4444',
    fontWeight: '800',
  },
  infoPerson: {
    color: colors.textPrimary,
    fontWeight: '700',
  },

  bannerWrap: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: spacing.md,
  },
  bannerPill: {
    backgroundColor: '#00000055',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    alignItems: 'flex-end',
  },
  bannerTitle: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  bannerSub: {
    color: '#FFFFFFCC',
    fontSize: 9,
    marginTop: 1,
  },

  existingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#6366F115',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#6366F133',
    marginBottom: spacing.md,
  },
  existingText: {
    ...typography.tiny,
    color: '#6366F1',
    flex: 1,
  },

  sectionLabel: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  chipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    width: '47%',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
  },
  chipLabel: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  chipSub: {
    ...typography.tiny,
    color: colors.textSecondary,
    marginTop: 2,
  },

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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#6366F115',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  previewBody: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  previewTime: {
    ...typography.tiny,
    color: '#6366F1',
    fontWeight: '700',
    marginTop: 4,
  },

  cancelLink: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  cancelLinkText: {
    ...typography.small,
    color: '#EF4444',
    fontWeight: '600',
  },

  setBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  setBtnText: {
    color: '#fff',
    ...typography.bodyBold,
    fontWeight: '700',
    fontSize: 16,
  },
});
