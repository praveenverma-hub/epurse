import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { THEMES } from '../constants/themes';
import { useTheme } from '../hooks/useTheme';
import GradientButton from '../components/GradientButton';
import CategoryIcon from '../components/CategoryIcon';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import {
  smsSupported,
  hasSmsPermission,
  requestSmsPermission,
} from '../services/smsService';
import { formatDateTime } from '../utils/format';

const COLOR_PALETTE = [
  '#FF5A1F', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981',
  '#F59E0B', '#EF4444', '#059669', '#6B7280', '#0EA5E9',
];

const EMOJI_PALETTE = ['🍔', '✈️', '💡', '🛍️', '🥦', '🎬', '💊', '💰', '🎓', '🎁', '🐶', '🚗'];

const CategoriesScreen = ({ navigation }) => {
  const theme = useTheme();
  const categories = useEPurseStore((s) => s.categories);
  const addCategory = useEPurseStore((s) => s.addCategory);
  const removeCategory = useEPurseStore((s) => s.removeCategory);
  const resetAll = useEPurseStore((s) => s.resetAll);
  const smsAutoImport = useEPurseStore((s) => s.smsAutoImport);
  const setSmsAutoImport = useEPurseStore((s) => s.setSmsAutoImport);
  const lastSmsSync = useEPurseStore((s) => s.lastSmsSync);
  const themeId = useEPurseStore((s) => s.themeId);
  const setThemeId = useEPurseStore((s) => s.setThemeId);

  const toast = useToast();
  /**
   * Centralised confirm dialog driver. Shape:
   *   { title, message, primaryText, destructive?, onConfirm, secondaryText? }
   * Setting non-null mounts <CenterModal>; setting null hides it.
   */
  const [confirm, setConfirm] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [emoji, setEmoji] = useState(EMOJI_PALETTE[0]);
  const [permGranted, setPermGranted] = useState(false);

  // Re-check permission whenever the screen is focused or the toggle moves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await hasSmsPermission();
      if (!cancelled) setPermGranted(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [smsAutoImport]);

  const handleSmsToggle = async (next) => {
    if (!next) {
      setSmsAutoImport(false);
      return;
    }
    if (Platform.OS !== 'android') {
      toast.info(
        'Not supported on iOS',
        'Apple does not allow third-party apps to read SMS. The simulated and paste flows still work everywhere.',
      );
      return;
    }
    if (!smsSupported) {
      toast.warning(
        'Native module missing',
        'SMS auto-import requires a custom dev build. Run `npx expo run:android` (or build via EAS) — Expo Go cannot read SMS.',
      );
      return;
    }
    const { granted, neverAskAgain } = await requestSmsPermission();
    if (granted) {
      setSmsAutoImport(true);
      setPermGranted(true);
    } else if (neverAskAgain) {
      // Two-button confirm — needs a CenterModal, not a toast.
      setConfirm({
        title:         'Permission blocked',
        message:       'You previously selected "Don\'t ask again". Open system settings to grant SMS access.',
        primaryText:   'Open settings',
        secondaryText: 'Cancel',
        onConfirm:     () => { setConfirm(null); Linking.openSettings(); },
      });
    } else {
      toast.info('Permission denied', 'You can enable it later from this screen.');
    }
  };

  const handleAdd = () => {
    if (!name.trim()) {
      toast.warning('Missing name', 'Give the category a name first.');
      return;
    }
    addCategory({ name: name.trim(), color, emoji });
    setName('');
  };

  const handleDelete = (cat) => {
    setConfirm({
      title:         'Delete category?',
      message:       `Remove "${cat.name}"? Existing transactions will keep their tag.`,
      primaryText:   'Delete',
      secondaryText: 'Cancel',
      destructive:   true,
      onConfirm:     () => { setConfirm(null); removeCategory(cat.id); },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Categories & Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ============= Auto-import SMS — HIDDEN =============
            SMS permission is now requested during onboarding (PermissionScreen),
            so this in-app toggle is redundant. Keeping the implementation here
            so we can re-enable a "Manage SMS access" sub-screen later if needed.

        <View style={styles.card}>
          <View style={styles.smsRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Auto-import SMS</Text>
              <Text style={styles.smsHelp}>
                {Platform.OS === 'android'
                  ? 'Reads bank, card and wallet messages from your inbox and adds them as transactions automatically.'
                  : 'Only available on Android. The "Simulate SMS" and "Paste SMS" flows work on every platform.'}
              </Text>
            </View>
            <Switch
              value={smsAutoImport}
              onValueChange={handleSmsToggle}
              trackColor={{ false: colors.divider, true: colors.primary + '88' }}
              thumbColor={smsAutoImport ? colors.primary : '#fff'}
              disabled={Platform.OS !== 'android'}
            />
          </View>

          {Platform.OS === 'android' && (
            <View style={styles.smsStatus}>
              <StatusDot
                ok={permGranted}
                label={permGranted ? 'SMS permission granted' : 'SMS permission not granted'}
              />
              <StatusDot
                ok={smsSupported}
                label={smsSupported ? 'Native module linked' : 'Native module missing — needs dev build'}
              />
              <StatusDot
                ok={!!lastSmsSync}
                label={lastSmsSync ? `Last sync ${formatDateTime(lastSmsSync)}` : 'Never synced'}
                neutral
              />
            </View>
          )}
        </View>
        ============= /Auto-import SMS ============= */}

        {/* ── Theme picker ────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>App theme</Text>
          <Text style={styles.themeHint}>
            Pick an accent — gradients, buttons and highlights update across the app.
          </Text>
          <View style={styles.themeRow}>
            {Object.values(THEMES).map((t) => {
              const active = themeId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setThemeId(t.id)}
                  style={[styles.themeTile, active && { borderColor: t.primary, borderWidth: 2 }]}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={[t.gradientStart, t.gradientEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.themeSwatch}
                  >
                    {active ? <Text style={styles.themeCheck}>✓</Text> : null}
                  </LinearGradient>
                  <Text style={[styles.themeLabel, active && { color: t.primary, fontWeight: '700' }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Add a custom category</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Category name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.sub}>Pick an emoji</Text>
          <View style={styles.row}>
            {EMOJI_PALETTE.map((e) => (
              <TouchableOpacity
                key={e}
                onPress={() => setEmoji(e)}
                style={[styles.emoji, emoji === e && styles.emojiActive]}
              >
                <Text style={{ fontSize: 22 }}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sub}>Pick a colour</Text>
          <View style={styles.row}>
            {COLOR_PALETTE.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  color === c && { borderWidth: 3, borderColor: '#fff', ...shadows.elevated },
                ]}
              />
            ))}
          </View>

          <GradientButton title="Add category" onPress={handleAdd} style={{ marginTop: spacing.md }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your categories</Text>
          {categories.map((c) => (
            <View key={c.id} style={styles.catRow}>
              <CategoryIcon category={c} size={36} />
              <Text style={styles.catName}>{c.name}</Text>
              <TouchableOpacity onPress={() => handleDelete(c)}>
                <Text style={styles.catDelete}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.dangerBtn}
          onPress={() =>
            setConfirm({
              title:         'Reset everything?',
              message:       'This will replace data with seed values.',
              primaryText:   'Reset',
              secondaryText: 'Cancel',
              destructive:   true,
              onConfirm:     () => { setConfirm(null); resetAll(); },
            })
          }
        >
          <Text style={styles.dangerText}>Reset all data</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Confirmation dialog — driven by `confirm` state. */}
      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        secondaryText={confirm?.secondaryText}
        destructive={!!confirm?.destructive}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
        onSecondary={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
};

// Tiny status row used inside the SMS auto-import card.
const StatusDot = ({ ok, label, neutral }) => (
  <View style={styles.statusRow}>
    <View
      style={[
        styles.statusDot,
        {
          backgroundColor: neutral
            ? colors.textMuted
            : ok
            ? colors.success
            : colors.warning,
        },
      ]}
    />
    <Text style={styles.statusLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  backText: { fontSize: 22, color: colors.textPrimary },
  title: { ...typography.h2, color: colors.textPrimary },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
  sub: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs, fontWeight: '600' },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emoji: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  emojiActive: { borderWidth: 2, borderColor: colors.primary },
  swatch: { width: 32, height: 32, borderRadius: 16 },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing.md,
  },
  catName: { flex: 1, ...typography.body, color: colors.textPrimary },
  catDelete: { color: colors.danger, fontSize: 18, paddingHorizontal: spacing.sm },

  dangerBtn: {
    backgroundColor: '#FEE2E2',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  dangerText: { color: colors.danger, ...typography.bodyBold, fontWeight: '700' },

  // SMS auto-import card
  smsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  smsHelp: { ...typography.small, color: colors.textSecondary, marginTop: 4 },
  smsStatus: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: 6,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { ...typography.tiny, color: colors.textSecondary, flex: 1 },

  // Theme picker
  themeHint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md, marginTop: -spacing.xs },
  themeRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  themeTile: {
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: 6,
    flexBasis: '22%',
  },
  themeSwatch: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  themeCheck: { color: '#fff', fontSize: 24, fontWeight: '800' },
  themeLabel: { ...typography.tiny, color: colors.textSecondary, fontWeight: '600' },
});

export default CategoriesScreen;
