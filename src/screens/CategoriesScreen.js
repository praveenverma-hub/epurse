import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { THEMES } from '../constants/themes';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import GradientButton from '../components/GradientButton';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';

const COLOR_PALETTE = [
  '#FF5A1F', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981',
  '#F59E0B', '#EF4444', '#059669', '#6B7280', '#0EA5E9',
];

const EMOJI_PALETTE = ['🍔', '✈️', '💡', '🛍️', '🥦', '🎬', '💊', '💰', '🎓', '🎁', '🐶', '🚗'];

const CategoriesScreen = ({ navigation }) => {
  const theme = useTheme();
  const tree = useCategoryTree();

  const customParents        = useEPurseStore((s) => s.customParents ?? []);
  const customChildren       = useEPurseStore((s) => s.customChildren ?? []);
  const addCustomParent      = useEPurseStore((s) => s.addCustomParent);
  const addCustomChild       = useEPurseStore((s) => s.addCustomChild);
  const removeCustomCategory = useEPurseStore((s) => s.removeCustomCategory);
  const resetAll             = useEPurseStore((s) => s.resetAll);
  const themeId              = useEPurseStore((s) => s.themeId);
  const setThemeId           = useEPurseStore((s) => s.setThemeId);

  const toast = useToast();
  const [confirm, setConfirm]   = useState(null);
  const [expanded, setExpanded] = useState({});      // { [parentId]: bool }
  // Add form target: null | { kind:'parent' } | { kind:'child', parentId, parentLabel }
  const [addTarget, setAddTarget] = useState(null);
  const [draftName, setDraftName]   = useState('');
  const [draftEmoji, setDraftEmoji] = useState(EMOJI_PALETTE[0]);
  const [draftColor, setDraftColor] = useState(COLOR_PALETTE[0]);

  const customParentIds = new Set(customParents.map((p) => p.id));
  const customChildIds  = new Set(customChildren.map((c) => c.id));

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const openAdd = (target) => {
    setAddTarget(target);
    setDraftName('');
    setDraftEmoji(EMOJI_PALETTE[0]);
    setDraftColor(COLOR_PALETTE[0]);
  };

  const saveAdd = () => {
    const name = draftName.trim();
    if (!isValidName(name)) {
      toast.warning('Invalid name', `Use ${INPUT_LIMITS.NAME_MIN}–${INPUT_LIMITS.CATEGORY_MAX} characters.`);
      return;
    }
    if (addTarget?.kind === 'parent') {
      addCustomParent({ label: name, emoji: draftEmoji, color: draftColor });
    } else if (addTarget?.kind === 'child') {
      addCustomChild(addTarget.parentId, { label: name, emoji: draftEmoji });
    }
    setAddTarget(null);
    toast.success('Category added', `"${name}" is ready to use everywhere.`);
  };

  const confirmDelete = (id, label) => {
    setConfirm({
      title:         'Delete category?',
      message:       `Remove "${label}"? Existing transactions keep their tag; it just won't be offered for new ones.`,
      primaryText:   'Delete',
      secondaryText: 'Cancel',
      destructive:   true,
      onConfirm:     () => { setConfirm(null); removeCustomCategory(id); },
    });
  };

  const isParentAdd = addTarget?.kind === 'parent';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Categories & Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Theme picker ────────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>App theme</Text>
          <Text style={styles.hint}>
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

        {/* ── Category tree ───────────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <Text style={styles.hint}>
            Tap a category to see its sub-categories. Add your own sub-categories or a
            whole new parent — they work everywhere and stay saved across updates.
          </Text>

          {tree.map((parent) => {
            const isOpen = !!expanded[parent.id];
            const parentCustom = customParentIds.has(parent.id);
            return (
              <View key={parent.id} style={styles.parentBlock}>
                <TouchableOpacity
                  style={styles.parentRow}
                  onPress={() => toggle(parent.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.parentEmoji}>{parent.emoji}</Text>
                  <Text style={styles.parentLabel} numberOfLines={1}>{parent.label}</Text>
                  {parentCustom && (
                    <View style={[styles.customTag, { backgroundColor: theme.primary + '1A', borderColor: theme.primary + '44' }]}>
                      <Text style={[styles.customTagText, { color: theme.primaryDark }]}>CUSTOM</Text>
                    </View>
                  )}
                  {parentCustom && (
                    <TouchableOpacity onPress={() => confirmDelete(parent.id, parent.label)} hitSlop={8}>
                      <Text style={styles.delete}>✕</Text>
                    </TouchableOpacity>
                  )}
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.children}>
                    {parent.children.map((child) => {
                      const childCustom = customChildIds.has(child.id);
                      return (
                        <View key={child.id} style={styles.childRow}>
                          <Text style={styles.childEmoji}>{child.emoji}</Text>
                          <Text style={styles.childLabel} numberOfLines={1}>{child.label}</Text>
                          {childCustom && (
                            <TouchableOpacity onPress={() => confirmDelete(child.id, child.label)} hitSlop={8}>
                              <Text style={styles.delete}>✕</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                    <TouchableOpacity
                      style={styles.addSubRow}
                      onPress={() => openAdd({ kind: 'child', parentId: parent.id, parentLabel: parent.label })}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={16} color={theme.primary} />
                      <Text style={[styles.addSubText, { color: theme.primary }]}>Add sub-category</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}

          <TouchableOpacity
            style={[styles.newParentBtn, { borderColor: theme.primary + '55' }]}
            onPress={() => openAdd({ kind: 'parent' })}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
            <Text style={[styles.newParentText, { color: theme.primary }]}>New parent category</Text>
          </TouchableOpacity>
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

      {/* ── Add-category form ─────────────────────────────────────────── */}
      <Modal visible={!!addTarget} transparent animationType="fade" onRequestClose={() => setAddTarget(null)}>
        <View style={styles.formBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddTarget(null)} />
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {isParentAdd ? 'New parent category' : `Add to ${addTarget?.parentLabel || ''}`}
            </Text>

            <TextInput
              value={draftName}
              onChangeText={(t) => setDraftName(sanitizeName(t, INPUT_LIMITS.CATEGORY_MAX))}
              placeholder={isParentAdd ? 'Parent name (e.g. Pets)' : 'Sub-category name (e.g. Vet)'}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={INPUT_LIMITS.CATEGORY_MAX}
              autoFocus
            />

            <Text style={styles.sub}>Pick an emoji</Text>
            <View style={styles.row}>
              {EMOJI_PALETTE.map((e) => (
                <TouchableOpacity
                  key={e}
                  onPress={() => setDraftEmoji(e)}
                  style={[styles.emoji, draftEmoji === e && { borderWidth: 2, borderColor: theme.primary }]}
                >
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {isParentAdd && (
              <>
                <Text style={styles.sub}>Pick a colour</Text>
                <View style={styles.row}>
                  {COLOR_PALETTE.map((c) => {
                    const sel = draftColor === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        onPress={() => setDraftColor(c)}
                        activeOpacity={0.8}
                        style={[styles.swatch, { backgroundColor: c }, sel && styles.swatchSelected]}
                      >
                        {sel && <Text style={styles.swatchCheck}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddTarget(null)} activeOpacity={0.7}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <GradientButton title="Add" onPress={saveAdd} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

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
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, color: colors.textPrimary },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs },
  hint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },
  sub: { ...typography.small, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs, fontWeight: '600' },

  // Tree
  parentBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  parentEmoji: { fontSize: 20 },
  parentLabel: { flex: 1, ...typography.body, fontWeight: '700', color: colors.textPrimary },
  customTag: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  customTagText: { ...typography.tiny, fontWeight: '800', fontSize: 9, letterSpacing: 0.4 },
  delete: { color: colors.danger, fontSize: 16, paddingHorizontal: spacing.xs },

  children: {
    paddingLeft: spacing.lg + 4,
    paddingBottom: spacing.sm,
  },
  childRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    gap: spacing.sm,
  },
  childEmoji: { fontSize: 15 },
  childLabel: { flex: 1, ...typography.small, color: colors.textSecondary, fontWeight: '600' },
  addSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.sm,
  },
  addSubText: { ...typography.small, fontWeight: '700' },

  newParentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  newParentText: { ...typography.body, fontWeight: '700' },

  // Add form
  formBackdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.elevated,
  },
  formTitle: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.md },
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
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  swatchSelected: {
    borderWidth: 2, borderColor: '#fff', transform: [{ scale: 1.18 }],
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  swatchCheck: { color: '#fff', fontWeight: '900', fontSize: 15 },
  formBtns: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  cancelBtn: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  cancelText: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },

  dangerBtn: {
    backgroundColor: '#FEE2E2',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  dangerText: { color: colors.danger, ...typography.bodyBold, fontWeight: '700' },

  // Theme picker
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
