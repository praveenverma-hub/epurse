import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { Text, TextInput } from '../components/AppText';
import Modal from "../components/AppModal";
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows, DIVIDER_W } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import PrimaryButton from '../components/PrimaryButton';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { EMPTY_ARRAY } from '../constants/empty';
import { ChoiceLabel, ColorChoices, EmojiChoices, IconField, TileEmoji } from '../components/IconColorPicker';
import { isEmojiOnly } from '../utils/emojiInput';

const COLOR_PALETTE = [
  '#FF5A1F', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981',
  '#F59E0B', '#EF4444', '#059669', '#6B7280', '#0EA5E9',
];

const EMOJI_PALETTE = ['🍔', '✈️', '💡', '🛍️', '🥦', '🎬', '💊', '💰', '🎓', '🎁', '🐶', '🚗'];

const CategoriesScreen = ({ navigation }) => {
  const theme = useTheme();
  const tree = useCategoryTree();

  const customParents        = useEPurseStore((s) => s.customParents) ?? EMPTY_ARRAY;
  const customChildren       = useEPurseStore((s) => s.customChildren) ?? EMPTY_ARRAY;
  const addCustomParent      = useEPurseStore((s) => s.addCustomParent);
  const addCustomChild       = useEPurseStore((s) => s.addCustomChild);
  const removeCustomCategory = useEPurseStore((s) => s.removeCustomCategory);
  const resetAll             = useEPurseStore((s) => s.resetAll);

  const toast = useToast();
  const { submit, submitting } = useSubmitGuard();
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
    // Never persist a half-typed / rejected emoji — fall back to the palette default
    // so a category can't end up with a blank icon everywhere it's shown.
    const emoji = isEmojiOnly(draftEmoji) ? draftEmoji : EMOJI_PALETTE[0];
    submit(() => {
      if (addTarget?.kind === 'parent') {
        addCustomParent({ label: name, emoji, color: draftColor });
      } else if (addTarget?.kind === 'child') {
        addCustomChild(addTarget.parentId, { label: name, emoji });
      }
      setAddTarget(null);
      toast.success('Category added', `"${name}" is ready to use everywhere.`);
    });
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
      <StatusBar style="dark" />
      <PlainScreenHeader title="Categories" onBack={() => navigation.goBack()} bordered />

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Category tree ───────────────────────────────────────────── */}
        {/* One group, so no heading — the screen title already says Categories. */}
        <Text style={styles.hint}>
          Tap a category to see its sub-categories. Add your own sub-categories or a whole new parent — they work everywhere and stay saved across updates.
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
                      onPress={() => openAdd({ kind: 'child', parentId: parent.id, parentLabel: parent.label, parentColor: parent.color })}
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

            {/* A sub-category takes its parent's colour, so it only picks an icon. */}
            <IconField
              tile={<TileEmoji emoji={draftEmoji} />}
              tileColor={(isParentAdd ? draftColor : addTarget?.parentColor || colors.primary) + '22'}
              choices={(
                <>
                  <ChoiceLabel first>Icon</ChoiceLabel>
                  <EmojiChoices value={draftEmoji} onChange={setDraftEmoji} choices={EMOJI_PALETTE} />
                  {isParentAdd ? (
                    <>
                      <ChoiceLabel>Colour</ChoiceLabel>
                      <ColorChoices value={draftColor} onChange={(c) => c && setDraftColor(c)} choices={COLOR_PALETTE} />
                    </>
                  ) : null}
                </>
              )}
            >
              <TextInput
                value={draftName}
                onChangeText={(t) => setDraftName(sanitizeName(t, INPUT_LIMITS.CATEGORY_MAX))}
                placeholder={isParentAdd ? 'Parent name (e.g. Pets)' : 'Sub-category name (e.g. Vet)'}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                maxLength={INPUT_LIMITS.CATEGORY_MAX}
                autoFocus
              />
            </IconField>

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddTarget(null)} activeOpacity={0.7} disabled={submitting}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <PrimaryButton title="Add" onPress={saveAdd} loading={submitting} />
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
  // SafeAreaView paints the safe-area top inset (the notch/status-bar strip on
  // iOS is real screen area, not padding) — must match the header's `bordered`
  // fill or the status bar sits on a stray gray sliver above a white header.
  container: { flex: 1, backgroundColor: colors.card },
  scrollBody: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  hint: { ...typography.small, color: colors.textSecondary, lineHeight: 18, marginBottom: spacing.md },

  // Tree
  parentBlock: {
    borderTopWidth: DIVIDER_W,
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
    borderWidth: 1,
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
    // Inline in the page next to `card`-rung rows, not floating over them.
    ...shadows.card,
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

});

export default CategoriesScreen;
