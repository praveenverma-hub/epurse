// =============================================================================
// GroupFormScreen — full-screen create/edit for a group (Sep-25-26: replaced
// the old CreateGroupModal bottom sheet, on user request — "add and edit group
// now will be full screen"). Same plain-header + scroll-body + pinned-footer
// shell as AddGroupExpenseScreen/AddTransactionScreen; the form fields
// themselves are unchanged from the old modal.
// Route params: { groupId? } — present = edit, absent = create.
// =============================================================================
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { colors, radius, searchFill, shadows, spacing, typography as typographyBase } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme } from '../hooks/useTheme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import GradientButtonBase from '../components/GradientButton';
import { useEPurseStore } from '../store/ePurseStore';
import { fetchContactsForPicker, getContactsPermissionStatus } from '../services/contactsService';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useToast } from '../components/Toast';
import type { Group, GroupMember, GroupType } from '../types/group';

const GradientButton = GradientButtonBase as React.FC<{
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
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

const EMOJIS = ['🏠', '✈️', '🎉', '🍕', '💼', '🏋️', '🚗', '📚', '🌴', '🎮'];
const GROUP_COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#3B82F6', '#8B5CF6', '#EC4899', '#06B6D4'];
const TYPE_OPTIONS: GroupType[] = ['personal', 'shared'];

export default function GroupFormScreen({ navigation, route }: { navigation: any; route: any }) {
  const groupId = route?.params?.groupId as string | undefined;
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const groups = useEPurseStore((s: any) => s.groups) as Group[];
  const createGroup = useEPurseStore((s: any) => s.createGroup) as (d: CreateGroupData) => string;
  const updateGroup = useEPurseStore((s: any) => s.updateGroup) as (id: string, patches: Partial<Group>) => void;
  const group = groupId ? groups.find((g) => g.id === groupId) || null : null;
  const isEdit = !!groupId;

  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('personal');
  const [emoji, setEmoji] = useState('🏠');
  const [color, setColor] = useState('#6366F1');
  const [excludeFromTotals, setExcludeFromTotals] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]); // for shared
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<PickerContact[]>([]);
  const [loading, setLoading] = useState(false);

  // Seed from the existing group once, on mount — a screen has no `visible`
  // prop to re-key off like the old modal did.
  useEffect(() => {
    if (group) {
      setName(group.name || '');
      setType(group.type || 'personal');
      setEmoji(group.emoji || '🏠');
      setColor(group.color || '#6366F1');
      setExcludeFromTotals(!!group.excludeFromTotals);
      // strip the built-in "me" member before showing
      setMembers((group.members || []).filter((m) => !m.isMe));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => { if (type === 'shared') loadContacts(); }, [type, loadContacts]);

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

  const { submit, submitting } = useSubmitGuard();

  const handleSave = () => {
    const cleaned = sanitizeName(name);
    if (!isValidName(cleaned)) return; // needs NAME_MIN..NAME_MAX chars
    submit(() => {
      const data: CreateGroupData = { name: cleaned, type, emoji, color, excludeFromTotals, members };
      if (isEdit && groupId) {
        updateGroup(groupId, data);
        toast.success('Group updated');
        navigation.goBack();
      } else {
        const id = createGroup(data);
        toast.success('Group created');
        // Replace, not push — the form shouldn't sit in the back stack between
        // the list and the new group's own detail screen.
        navigation.replace('GroupDetail', { groupId: id });
      }
    });
  };

  const nameValid = isValidName(sanitizeName(name));

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="dark" />
      <PlainScreenHeader title={isEdit ? 'Edit Group' : 'New Group'} onBack={() => navigation.goBack()} bordered />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                style={[styles.search, { backgroundColor: searchFill(theme) }]}
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

        {/* Pinned footer — single primary action, matching AddGroupExpenseScreen/
            AddTransactionScreen (the back chevron already covers "Cancel"). */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <GradientButton
            title={isEdit ? 'Save Changes' : 'Create Group'}
            onPress={handleSave}
            disabled={!nameValid}
            loading={submitting}
            style={{ width: '100%' }}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.lg },

  nameInput: {
    backgroundColor: colors.card,
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
    backgroundColor: colors.card,
  },
  typeChipTxt:  { ...typography.body, color: colors.textSecondary },
  typeHint:     { ...typography.tiny, color: colors.textMuted, marginBottom: spacing.sm },
  sectionLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '700', marginTop: spacing.sm, marginBottom: spacing.xs },
  emojiRow:     { flexDirection: 'row', marginBottom: spacing.sm },
  emojiChip: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8, borderWidth: 1.5, borderColor: 'transparent',
    backgroundColor: colors.card,
  },
  emojiTxt:     { fontSize: 22 },
  emojiCustom:  { fontSize: 22, textAlign: 'center', color: colors.textPrimary, padding: 0 },
  colorRow:     { flexDirection: 'row', gap: 12, marginBottom: spacing.md, flexWrap: 'wrap' },
  colorDot:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  // Selected = scale up + white inner ring + dark outer ring (visible on any colour) + a check.
  colorDotSelected: {
    borderWidth: 2, borderColor: '#fff',
    transform: [{ scale: 1.18 }],
    ...shadows.pop,
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
    backgroundColor: colors.card,
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
    ...shadows.pop,
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
