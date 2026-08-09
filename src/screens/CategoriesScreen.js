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

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import GradientButton from '../components/GradientButton';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import SectionHeader from '../components/SectionHeader';

const COLOR_PALETTE = [
  '#FF5A1F', '#3B82F6', '#8B5CF6', '#EC4899', '#10B981',
  '#F59E0B', '#EF4444', '#059669', '#6B7280', '#0EA5E9',
];

const EMOJI_PALETTE = ['🍔', '✈️', '💡', '🛍️', '🥦', '🎬', '💊', '💰', '🎓', '🎁', '🐶', '🚗'];

// "Own emoji" tile. The DEVICE's emoji keyboard does the picking — no emoji-picker
// dependency to ship or keep current with new Unicode releases.
//
// Measured in UTF-16 units, not "characters": one emoji is often many code points —
// a ZWJ family 👨‍👩‍👦‍👦 is 11 units and 👩🏻‍❤️‍💋‍👨🏿 is 15. Slicing to 1–2 would mangle exactly
// the emoji people pick to be personal. (`Array.from` is no help — it splits code
// points, so it breaks ZWJ sequences too.)
const EMOJI_MAX_UNITS = 16;
// Any cut can land INSIDE a surrogate pair or right after a joiner, leaving a lone
// high surrogate (renders as �, and gets persisted) or a dangling ZWJ. Trim those
// tails off until the string ends on a complete glyph.
// NOT the variation selector U+FE0F: it is a legitimate ending on a COMPLETE emoji —
// it's what forces colour presentation. Stripping it turned ✈️ into ✈ and ❤️ into ❤
// (the monochrome text glyphs), which is why it's excluded here.
const trimBrokenTail = (s) => {
  let out = s;
  let prev;
  do {
    prev = out;
    out = out.replace(/[\uD800-\uDBFF]$/, '').replace(/‍+$/, '');
  } while (out !== prev);
  return out;
};
const sanitizeEmoji = (raw) =>
  trimBrokenTail((raw || '').replace(/\s/g, '').slice(0, EMOJI_MAX_UNITS));
// Deliberately a REJECT-list, not an emoji match: `\p{Extended_Pictographic}` needs
// Unicode property escapes, and a wrong guess about Hermes support would throw at
// runtime inside a modal. Blocking ASCII letters/digits is all that's needed — it
// stops a name ("Pets") being used as the icon and breaking the row layout, while
// letting through every emoji, old and new.
const isEmojiOnly = (s) => !!s && !/[A-Za-z0-9]/.test(s);

const CategoriesScreen = ({ navigation }) => {
  const theme = useTheme();
  const tree = useCategoryTree();

  const customParents        = useEPurseStore((s) => s.customParents ?? []);
  const customChildren       = useEPurseStore((s) => s.customChildren ?? []);
  const addCustomParent      = useEPurseStore((s) => s.addCustomParent);
  const addCustomChild       = useEPurseStore((s) => s.addCustomChild);
  const removeCustomCategory = useEPurseStore((s) => s.removeCustomCategory);
  const resetAll             = useEPurseStore((s) => s.resetAll);

  const toast = useToast();
  const [confirm, setConfirm]   = useState(null);
  const [expanded, setExpanded] = useState({});      // { [parentId]: bool }
  // Add form target: null | { kind:'parent' } | { kind:'child', parentId, parentLabel }
  const [addTarget, setAddTarget] = useState(null);
  const [draftName, setDraftName]   = useState('');
  const [draftEmoji, setDraftEmoji] = useState(EMOJI_PALETTE[0]);
  const [draftColor, setDraftColor] = useState(COLOR_PALETTE[0]);
  const [emojiErr,   setEmojiErr]   = useState(false);
  // Anything not in the palette came from the user's keyboard → the custom tile owns it.
  const usingOwnEmoji = !EMOJI_PALETTE.includes(draftEmoji);

  const customParentIds = new Set(customParents.map((p) => p.id));
  const customChildIds  = new Set(customChildren.map((c) => c.id));

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const openAdd = (target) => {
    setAddTarget(target);
    setDraftName('');
    setDraftEmoji(EMOJI_PALETTE[0]);
    setDraftColor(COLOR_PALETTE[0]);
    setEmojiErr(false);
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
    if (addTarget?.kind === 'parent') {
      addCustomParent({ label: name, emoji, color: draftColor });
    } else if (addTarget?.kind === 'child') {
      addCustomChild(addTarget.parentId, { label: name, emoji });
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
        <Text style={styles.title}>Categories</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Category tree ───────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader
            icon="grid-outline"
            title="Categories"
            accentColor={theme.primary}
            subtitle="Tap a category to see its sub-categories. Add your own sub-categories or a whole new parent — they work everywhere and stay saved across updates."
          />

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
                  onPress={() => { setDraftEmoji(e); setEmojiErr(false); }}
                  style={[styles.emoji, draftEmoji === e && { borderWidth: 2, borderColor: theme.primary }]}
                >
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
              {/* Own emoji — a normal input, so the OS emoji keyboard is the picker.
                  It sits in the SAME row as the palette because it's one more way to
                  answer one question; a separate section would imply a second choice. */}
              <View
                style={[
                  styles.emoji,
                  styles.emojiOwn,
                  usingOwnEmoji && { borderWidth: 2, borderColor: theme.primary },
                  emojiErr && { borderWidth: 2, borderColor: colors.danger },
                ]}
              >
                <TextInput
                  value={usingOwnEmoji ? draftEmoji : ''}
                  onChangeText={(t) => {
                    const e = sanitizeEmoji(t);
                    if (!e) { setEmojiErr(false); setDraftEmoji(EMOJI_PALETTE[0]); return; }
                    if (isEmojiOnly(e)) { setEmojiErr(false); setDraftEmoji(e); }
                    else setEmojiErr(true);   // typed a letter — say so instead of silently ignoring
                  }}
                  placeholder="＋"
                  placeholderTextColor={colors.textMuted}
                  style={styles.emojiOwnInput}
                  maxLength={EMOJI_MAX_UNITS}
                  accessibilityLabel="Use your own emoji"
                />
              </View>
            </View>
            <Text style={[styles.emojiHint, emojiErr && { color: colors.danger }]}>
              {emojiErr
                ? 'Emoji only — tap the 😀 key on your keyboard.'
                : 'Tap ＋ to use any emoji from your keyboard.'}
            </Text>

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
  // Pushed screen → centred title. The 40px spacer opposite the back button
  // makes the side slots equal, so flex + textAlign centres it truly.
  title: { ...typography.h2, color: colors.textPrimary, flex: 1, textAlign: 'center' },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
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
  // Dashed edge marks the "own emoji" tile as an input, not one more preset.
  emojiOwn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.divider,
  },
  emojiOwnInput: {
    width: '100%',
    height: '100%',
    textAlign: 'center',
    fontSize: 22,
    padding: 0,           // Android centres the glyph only without default padding
    color: colors.textPrimary,
  },
  emojiHint: { ...typography.tiny, color: colors.textMuted, marginTop: spacing.xs },
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

});

export default CategoriesScreen;
