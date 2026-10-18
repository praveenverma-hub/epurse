// =============================================================================
// GroupFormScreen — full-screen create/edit for a group, built from the shared form
// pieces like the other entry forms (FormField.tsx, FormFooterActions,
// InlineContactPicker). Create: Personal / Shared as folder tabs (the type is fixed
// once made, so edit has none). Name row = the shared IconField (tile → icon + colour).
// Route params: { groupId?, addMember? } — groupId present = edit; addMember opens
// the contact search (Group Detail's Add Member).
// =============================================================================
import React, { useEffect, useState } from 'react';
import {
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '../components/AppText';
import { TabView } from 'react-native-tab-view';
import KeyboardAvoidingView from '../components/AppKeyboardAvoidingView';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, DIVIDER_W } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useUnchanged } from '../hooks/useUnchanged';
import PlainScreenHeader from '../components/PlainScreenHeader';
import UnderlineTabBar from '../components/UnderlineTabBar';
import { FormField, FormSwitchRow, FormTextInput, FormValueCard, FormValueRow } from '../components/FormField';
import FormFooterActions from '../components/FormFooterActions';
import InlineContactPicker, { type InlineContact } from '../components/InlineContactPicker';
import { ChoiceLabel, ColorChoices, EmojiChoices, IconField, TileEmoji } from '../components/IconColorPicker';
import { peekReviewFlowDraft, setReviewFlowDraft } from '../utils/reviewFlowDraft';
import { useEPurseStore } from '../store/ePurseStore';
import { INPUT_LIMITS, sanitizeName, isValidName } from '../utils/validation';
import { memberName } from '../utils/split';
import { titleCaseName } from '../utils/format';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useToast } from '../components/Toast';
import type { Group, GroupMember, GroupType } from '../types/group';

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
const TYPE_ROUTES: { key: GroupType; label: string }[] = [
  { key: 'personal', label: 'Personal' },
  { key: 'shared', label: 'Shared' },
];
const TYPE_HINT: Record<GroupType, string> = {
  personal: 'Track what one thing costs — a house build, a solo trip.',
  shared: 'Split costs with others and see who owes whom.',
};

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
  const [members, setMembers] = useState<GroupMember[]>([]); // for shared, without "me"
  const [pickerOpen, setPickerOpen] = useState(!!route?.params?.addMember);

  // Seed from the existing group once, on mount.
  useEffect(() => {
    if (group) {
      setName(group.name || '');
      setType(group.type || 'personal');
      setEmoji(group.emoji || '🏠');
      setColor(group.color || '#6366F1');
      setExcludeFromTotals(!!group.excludeFromTotals);
      setMembers((group.members || []).filter((m) => !m.isMe));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addMember = (c: InlineContact) =>
    setMembers((prev) => (prev.some((m) => m.contactId === c.id)
      ? prev
      : [...prev, { memberId: `c_${c.id}`, name: c.name, contactId: c.id }]));
  // By memberId: people who joined a live group from their own phone have no contactId.
  const removeMember = (memberId: string) =>
    setMembers((prev) => prev.filter((m) => m.memberId !== memberId));
  // On a live group, people already on the server leave via Leave (at ₹0), not here.
  const onServer = (memberId: string) =>
    !!group?.shared && (!!group.shared.memberMap[memberId] || !!group.shared.fold.members[memberId]);

  const { submit, submitting } = useSubmitGuard();

  const handleSave = () => {
    const cleaned = sanitizeName(name);
    if (!isValidName(cleaned)) return;
    submit(() => {
      // People picked on the Shared tab don't come along if Personal is what's saved.
      const data: CreateGroupData = {
        name: cleaned, type, emoji, color, excludeFromTotals, members: type === 'shared' ? members : [],
      };
      if (isEdit && groupId) {
        updateGroup(groupId, data);
        toast.success('Group updated');
        navigation.goBack();
      } else {
        const id = createGroup(data);
        toast.success('Group created');
        const returnTxnId = route?.params?.returnToGroupTxnId as string | undefined;
        if (returnTxnId) {
          // Personal group from the review queue: nothing left to ask — straight back to Manage.
          if (route?.params?.returnFromQueue && type !== 'shared') {
            setReviewFlowDraft(returnTxnId, { ...peekReviewFlowDraft(returnTxnId), groupId: id, groupSplit: null });
            navigation.goBack();
            return;
          }
          navigation.replace('AddGroupExpense', {
            groupId: id,
            tagTxnId: returnTxnId,
            ...(route?.params?.returnFromQueue ? { fromQueue: true, reviewFlow: true } : {}),
          });
          return;
        }
        // Replace, not push — the form shouldn't sit between the list and the new group.
        navigation.replace('GroupDetail', { groupId: id });
      }
    });
  };

  const nameValid = isValidName(sanitizeName(name));
  const unchanged = useUnchanged({ name: name.trim(), type, emoji, color, excludeFromTotals, members: members.map((m) => m.memberId) }, isEdit);
  const nameError = name.trim().length > 0 && !nameValid;

  const memberRow = (key: string, label: string, onRemove?: () => void) => (
    <View key={key} style={styles.memberRow}>
      <View style={[styles.avatar, { backgroundColor: theme.primary + '1A' }]}>
        <Text style={[styles.avatarTxt, { color: theme.primary }]}>{label.charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={styles.memberName} numberOfLines={1}>{label}</Text>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${label}`}>
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderBody = (bodyType: GroupType, active: boolean) => (
    <>
      {isEdit ? null : <Text style={styles.typeHint}>{TYPE_HINT[bodyType]}</Text>}

      <FormField label="Name">
        <IconField
          tile={<TileEmoji emoji={emoji} />}
          tileColor={color + '22'}
          error={nameError ? `Use at least ${INPUT_LIMITS.NAME_MIN} characters.` : null}
          choices={(
            <>
              <ChoiceLabel first>Icon</ChoiceLabel>
              <EmojiChoices value={emoji} onChange={setEmoji} choices={EMOJIS} />
              <ChoiceLabel>Colour</ChoiceLabel>
              <ColorChoices value={color} onChange={(c) => c && setColor(c)} choices={GROUP_COLORS} />
            </>
          )}
        >
          <FormTextInput
            style={nameError ? { borderColor: colors.danger } : undefined}
            placeholder="Goa Trip, Flatmates…"
            value={name}
            onChangeText={(t) => setName(sanitizeName(t))}
            maxLength={INPUT_LIMITS.NAME_MAX}
            autoFocus={!isEdit && active && !pickerOpen}
          />
        </IconField>
      </FormField>

      {bodyType === 'shared' ? (
        <FormField label="Members">
          <FormValueCard>
            {memberRow('me', 'You')}
            {members.map((m) => memberRow(
              m.memberId,
              titleCaseName(memberName(m)),
              onServer(m.memberId) ? undefined : () => removeMember(m.memberId),
            ))}
            <FormValueRow
              icon="person-add-outline"
              label="Add Member"
              value=""
              accentColor={theme.primary}
              onPress={() => setPickerOpen((v) => !v)}
              trailingIcon={pickerOpen ? 'chevron-up' : 'chevron-forward'}
            >
              {pickerOpen ? (
                <View style={styles.pickerBody}>
                  <InlineContactPicker
                    onPick={addMember}
                    excludeIds={members.map((m) => m.contactId).filter(Boolean) as string[]}
                    accentColor={theme.primary}
                    autoFocus={active && !!route?.params?.addMember}
                  />
                </View>
              ) : null}
            </FormValueRow>
          </FormValueCard>
        </FormField>
      ) : null}

      {/* Mine only — never synced. A shared group's repayments follow it (spendExcluded). */}
      <FormValueCard>
        <FormSwitchRow
          icon="eye-off-outline"
          label="Exclude From Totals"
          hint={bodyType === 'shared'
            ? 'Keep a work trip out of your reports and budget, your repayments too. Only on your phone.'
            : 'Keep a one-off project out of your monthly reports and budget.'}
          value={excludeFromTotals}
          onValueChange={setExcludeFromTotals}
          accentColor={theme.primary}
        />
      </FormValueCard>
    </>
  );

  const typeIndex = type === 'shared' ? 1 : 0;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {/* Its own white SafeAreaView, so the status bar strip sits on the header's white. */}
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        {/* With the folder tabs below, their baseline is the only edge. */}
        <PlainScreenHeader title={isEdit ? 'Edit Group' : 'New Group'} onBack={() => navigation.goBack()} bordered hairline={isEdit} />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {isEdit ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {renderBody(type, true)}
          </ScrollView>
        ) : (
          <>
            <UnderlineTabBar
              variant="folder"
              tabs={TYPE_ROUTES}
              activeKey={type}
              onChange={(k) => setType(k as GroupType)}
              // Shared = the green of the "● Live" dot: this group goes live with others.
              accentColor={type === 'shared' ? theme.success : theme.primary}
            />
            <TabView
              navigationState={{ index: typeIndex, routes: TYPE_ROUTES }}
              renderScene={({ route: r }) => (
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={styles.scroll}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {renderBody(r.key as GroupType, r.key === type)}
                </ScrollView>
              )}
              renderTabBar={() => null}
              onIndexChange={(i) => setType(TYPE_ROUTES[i].key)}
              initialLayout={{ width: Dimensions.get('window').width }}
              swipeEnabled
              style={{ flex: 1 }}
            />
          </>
        )}

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <FormFooterActions
            onCancel={() => navigation.goBack()}
            submit={nameValid && !unchanged ? {
              title: isEdit ? 'Save Changes' : 'Create Group',
              onPress: handleSave,
              loading: submitting,
            } : null}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Gray body under white header/footer bands, same as the other entry forms.
  root: { flex: 1, backgroundColor: colors.background },
  headerSafe: { backgroundColor: colors.card },
  scroll: { padding: spacing.lg, paddingBottom: spacing.lg },
  typeHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.lg },

  // Row height matches FormValueRow, so You / members / Add Member line up as one list.
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '700' },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  pickerBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: DIVIDER_W,
    borderTopColor: colors.divider,
  },
});
