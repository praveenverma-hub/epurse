import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButtonBase from './GradientButton';
import SheetCloseButton from './SheetCloseButton';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { fetchContactsForPicker, getContactsPermissionStatus } from '../services/contactsService';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import type { Group, GroupMember, GroupType } from '../types/group';

// GradientButton.js has no TS declarations — cast to the props we use.
const GradientButton = GradientButtonBase as React.FC<{
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: object;
}>;

interface PickerContact {
  id: string;
  name: string;
  searchText?: string;
  phones?: string[];
}

export interface CreateGroupData {
  name: string;
  type: GroupType;
  emoji: string;
  color: string;
  excludeFromTotals: boolean;
  members: GroupMember[];
}

interface CreateGroupModalProps {
  visible: boolean;
  /** Existing group when editing; null/undefined when creating. */
  group?: Group | null;
  onClose: () => void;
  onSave: (data: CreateGroupData) => void;
}

const EMOJIS = ['🏠', '✈️', '🎉', '🍕', '💼', '🏋️', '🚗', '📚', '🌴', '🎮'];
const GROUP_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4'];
const TYPE_OPTIONS: GroupType[] = ['personal', 'shared'];

export default function CreateGroupModal({ visible, group, onClose, onSave }: CreateGroupModalProps) {
  const theme = useTheme();

  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('personal');
  const [emoji, setEmoji] = useState('🏠');
  const [color, setColor] = useState('#6366F1');
  const [excludeFromTotals, setExcludeFromTotals] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]); // for shared
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [loading, setLoading] = useState(false);

  // Populate from existing group when editing
  useEffect(() => {
    if (!visible) return;
    if (group) {
      setName(group.name || '');
      setType(group.type || 'personal');
      setEmoji(group.emoji || '🏠');
      setColor(group.color || '#6366F1');
      setExcludeFromTotals(!!group.excludeFromTotals);
      // strip the built-in "me" member before showing
      setMembers((group.members || []).filter((m) => !m.isMe));
    } else {
      setName('');
      setType('personal');
      setEmoji('🏠');
      setColor('#6366F1');
      setExcludeFromTotals(false);
      setMembers([]);
    }
    setQuery('');
  }, [visible, group]);

  const loadContacts = useCallback(async () => {
    if (type !== 'shared') return;
    setLoading(true);
    try {
      const ok = await getContactsPermissionStatus();
      if (ok) setContacts(await fetchContactsForPicker());
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { if (visible && type === 'shared') loadContacts(); }, [visible, type, loadContacts]);

  const filtered = contacts.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return (c.searchText || c.name.toLowerCase()).includes(q);
  }).slice(0, 3);

  const toggleMember = (c: PickerContact) => {
    setMembers((prev) => {
      const exists = prev.find((m) => m.contactId === c.id);
      if (exists) return prev.filter((m) => m.contactId !== c.id);
      return [...prev, { memberId: `c_${c.id}`, name: c.name, contactId: c.id }];
    });
    setQuery('');
  };

  const removeMember = (contactId: string | null | undefined) =>
    setMembers((prev) => prev.filter((m) => m.contactId !== contactId));

  const handleSave = () => {
    const cleaned = sanitizeName(name);
    if (!isValidName(cleaned)) return; // needs NAME_MIN..NAME_MAX chars
    onSave({ name: cleaned, type, emoji, color, excludeFromTotals, members });
  };

  const nameValid = isValidName(sanitizeName(name));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.bodyContent}
          >
          <Text style={styles.title}>{group ? 'Edit Group' : 'New Group'}</Text>

          {/* Name */}
          <TextInput
            style={[styles.nameInput, name.trim().length > 0 && !nameValid && styles.nameInputError]}
            placeholder="Group name…"
            placeholderTextColor={colors.textMuted}
            value={name}
            onChangeText={(t) => setName(sanitizeName(t))}
            maxLength={INPUT_LIMITS.NAME_MAX}
            autoFocus={!group}
          />
          {name.trim().length > 0 && !nameValid && (
            <Text style={styles.nameError}>
              Group name must be at least {INPUT_LIMITS.NAME_MIN} characters.
            </Text>
          )}

          {/* Type toggle — only when CREATING. A group's type is fixed once made
              (changing personal↔shared would orphan members/balances), so it's
              hidden on edit. */}
          {!group && (
            <>
              <View style={styles.typeRow}>
                {TYPE_OPTIONS.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, type === t && { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}
                    onPress={() => setType(t)}
                  >
                    <Text style={[styles.typeChipTxt, type === t && { color: theme.primary, fontWeight: '700' }]}>
                      {t === 'personal' ? '👤 Personal' : '👥 Shared'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {type === 'personal' && (
                <Text style={styles.typeHint}>Just you — track costs under a theme (house build, solo trip…).</Text>
              )}
              {type === 'shared' && (
                <Text style={styles.typeHint}>Multiple people — split expenses and track who owes whom.</Text>
              )}
            </>
          )}

          {/* Emoji row */}
          <Text style={styles.sectionLabel}>Icon</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.emojiRow}>
            {/* Type any emoji — highlighted when the icon isn't one of the presets. */}
            <TextInput
              style={[
                styles.emojiChip,
                styles.emojiCustom,
                !EMOJIS.includes(emoji) && { borderColor: theme.primary, backgroundColor: theme.primary + '14' },
              ]}
              value={EMOJIS.includes(emoji) ? '' : emoji}
              // Take the LAST glyph typed so a new emoji REPLACES the current one
              // (taking the first kept the old one, so the field looked unclearable).
              onChangeText={(t) => {
                const chars = Array.from(t.trim());
                const e = chars[chars.length - 1];
                if (e) setEmoji(e);
              }}
              placeholder="⌨️"
              placeholderTextColor={colors.textMuted}
              maxLength={8}
            />
            {EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                style={[styles.emojiChip, emoji === e && { borderColor: theme.primary, backgroundColor: theme.primary + '14' }]}
                onPress={() => setEmoji(e)}
              >
                <Text style={styles.emojiTxt}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Color row */}
          <Text style={styles.sectionLabel}>Colour</Text>
          <View style={styles.colorRow}>
            {GROUP_COLORS.map((c) => {
              const sel = color === c;
              return (
                <TouchableOpacity
                  key={c}
                  style={[styles.colorDot, { backgroundColor: c }, sel && styles.colorDotSelected]}
                  onPress={() => setColor(c)}
                  activeOpacity={0.8}
                >
                  {sel && <Text style={styles.colorCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Members (shared only) */}
          {type === 'shared' && (
            <>
              <Text style={styles.sectionLabel}>Members</Text>

              {members.length > 0 && (
                <View style={styles.membersBox}>
                  <View style={[styles.memberChip, { backgroundColor: theme.primary + '18', borderColor: theme.primary + '44' }]}>
                    <Text style={[styles.memberChipTxt, { color: theme.primary }]}>👤 You</Text>
                  </View>
                  {members.map((m) => (
                    <TouchableOpacity
                      key={m.contactId}
                      style={[styles.memberChip, { backgroundColor: theme.primary + '18', borderColor: theme.primary + '44' }]}
                      onPress={() => removeMember(m.contactId)}
                    >
                      <Text style={[styles.memberChipTxt, { color: theme.primary }]}>{m.name}</Text>
                      <Text style={styles.memberRemove}>×</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TextInput
                style={styles.search}
                placeholder="Search contacts…"
                placeholderTextColor={colors.textMuted}
                value={query}
                onChangeText={setQuery}
              />
              {loading && <ActivityIndicator color={theme.primary} style={{ marginVertical: spacing.sm }} />}
              {filtered.map((c) => {
                const on = !!members.find((m) => m.contactId === c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.contactRow, on && { backgroundColor: theme.primary + '12' }]}
                    onPress={() => toggleMember(c)}
                  >
                    <View style={[styles.avatar, { backgroundColor: theme.primary + '22' }]}>
                      <Text style={[styles.avatarTxt, { color: theme.primary }]}>{c.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={styles.contactName} numberOfLines={1}>{c.name}</Text>
                    {on && <Text style={[styles.check, { color: theme.primary }]}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* Exclude toggle (personal only) */}
          {type === 'personal' && (
            <TouchableOpacity style={styles.toggleRow} onPress={() => setExcludeFromTotals(!excludeFromTotals)}>
              <View style={styles.toggleLeft}>
                <Text style={styles.toggleLabel}>Exclude from main totals</Text>
                <Text style={styles.toggleHint}>Group spend won&apos;t count in monthly reports or budget</Text>
              </View>
              <View style={[styles.toggle, excludeFromTotals && { backgroundColor: theme.primary }]}>
                <View style={[styles.toggleThumb, excludeFromTotals && styles.toggleThumbOn]} />
              </View>
            </TouchableOpacity>
          )}

          </ScrollView>

          {/* Pinned footer — Cancel + Save side by side. */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <GradientButton
              title={group ? 'Save Changes' : 'Create Group'}
              onPress={handleSave}
              disabled={!nameValid}
              style={styles.submitBtn}
            />
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:       { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss:        { flex: 1 },
  // flexShrink lets the body yield height to the pinned footer when content is tall.
  body:           { flexShrink: 1 },
  bodyContent:    { paddingBottom: spacing.sm },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    maxHeight: '90%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  title:    { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md },
  nameInput: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    ...typography.h3,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  nameInputError: { borderColor: colors.danger },
  nameError: {
    ...typography.tiny,
    color: colors.danger,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  typeRow:      { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  typeChip: {
    flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.pill,
    alignItems: 'center', borderWidth: 1.5, borderColor: colors.divider,
    backgroundColor: colors.background,
  },
  typeChipTxt:  { ...typography.body, color: colors.textSecondary },
  typeHint:     { ...typography.tiny, color: colors.textMuted, marginBottom: spacing.sm },
  sectionLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
  emojiRow:     { flexDirection: 'row', marginBottom: spacing.sm },
  emojiChip: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8, borderWidth: 1.5, borderColor: 'transparent',
    backgroundColor: colors.background,
  },
  emojiTxt:     { fontSize: 22 },
  emojiCustom:  { fontSize: 22, textAlign: 'center', color: colors.textPrimary, padding: 0 },
  colorRow:     { flexDirection: 'row', gap: 12, marginBottom: spacing.md, flexWrap: 'wrap' },
  colorDot:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  // Selected = scale up + white inner ring + dark outer ring (visible on any colour) + a check.
  colorDotSelected: {
    borderWidth: 2, borderColor: '#fff',
    transform: [{ scale: 1.18 }],
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  colorCheck:   { color: '#fff', fontWeight: '900', fontSize: 15 },
  membersBox:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  // accent bg/border/text applied inline via theme.primary
  memberChip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1,
  },
  memberChipTxt: { ...typography.small, fontWeight: '700' },
  memberRemove:  { marginLeft: 6, color: colors.danger, fontWeight: '800', fontSize: 14 },
  search: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.textPrimary,
    ...typography.body,
    marginBottom: spacing.xs,
    borderWidth: 1, borderColor: colors.divider,
  },
  contactRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, paddingHorizontal: spacing.sm,
    borderRadius: radius.md, marginBottom: 4,
  },
  // selected-row tint applied inline via theme.primary
  avatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarTxt:    { fontWeight: '800' },
  contactName:  { flex: 1, ...typography.body, color: colors.textPrimary },
  check:        { fontWeight: '800' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm, marginTop: spacing.xs,
  },
  toggleLeft:   { flex: 1 },
  toggleLabel:  { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  toggleHint:   { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: colors.divider,
    padding: 3, justifyContent: 'center',
  },
  toggleThumb: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  cancelBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.divider,
  },
  cancelTxt: { ...typography.bodyBold, color: colors.textSecondary, fontWeight: '700' },
  submitBtn: { flex: 1 },
});
