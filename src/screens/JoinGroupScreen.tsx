// =============================================================================
// JoinGroupScreen — join a live shared group from an invite link, then say which
// person in it you are (src/sync/groupSync.ts). Route params:
//   { link? }          — prefilled link (a tapped invite — App.js InviteLinkBoot)
//   { claimGroupId }   — skip straight to "Who Are You?" for a group already joined
// =============================================================================
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import KeyboardAvoidingView from '../components/AppKeyboardAvoidingView';
import PlainScreenHeader from '../components/PlainScreenHeader';
import PrimaryButtonBase from '../components/PrimaryButton';
import { FormField, FormTextInput, FormValueCard, FormValueRow } from '../components/FormField';
import { useToast } from '../components/Toast';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useTheme } from '../hooks/useTheme';
import { colors, spacing } from '../constants/theme';
import { useEPurseStore } from '../store/ePurseStore';
import { parseInviteLink } from '../sync/invite';
import { claimMember, getUnclaimedMembers, joinFromLink } from '../sync/groupSync';
import { SyncError } from '../sync/errors';
import { titleCaseName } from '../utils/format';
import type { Group } from '../types/group';

const PrimaryButton = PrimaryButtonBase as React.FC<{
  title: string; onPress: () => void; disabled?: boolean; loading?: boolean; style?: object;
}>;

type Choice = { memberId: string; name: string };

export default function JoinGroupScreen({ navigation, route }: { navigation: any; route: any }) {
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { submit, submitting } = useSubmitGuard();

  const claimGroupId = route?.params?.claimGroupId as string | undefined;
  const [groupId, setGroupId] = useState<string | null>(claimGroupId ?? null);
  const [link, setLink] = useState<string>(route?.params?.link ?? '');
  const [choices, setChoices] = useState<Choice[] | null>(() => (claimGroupId ? getUnclaimedMembers(claimGroupId) : null));
  const [picked, setPicked] = useState<string | null>(null);

  // Another invite tapped while this screen is open arrives as new params, not a new screen.
  const paramLink = route?.params?.link as string | undefined;
  useEffect(() => {
    if (paramLink && !claimGroupId) setLink(paramLink);
  }, [paramLink, claimGroupId]);

  const linkOk = !!parseInviteLink(link.trim());
  const open = (id: string) => navigation.replace('GroupDetail', { groupId: id });

  const join = () => submit(async () => {
    try {
      const { groupId: id, forMember } = await joinFromLink(link);
      const group = (useEPurseStore.getState() as any).groups.find((g: Group) => g.id === id) as Group | undefined;
      if (group?.shared?.myMemberId) { open(id); return; }  // already in it
      const unclaimed = getUnclaimedMembers(id);
      // A link made for one person: take that name without asking — unless someone already has.
      if (forMember && unclaimed.some((c) => c.memberId === forMember)) {
        try {
          await claimMember(id, forMember);
          toast.success('You joined the group');
          open(id);
          return;
        } catch (e) {
          if (!(e instanceof SyncError && e.code === 'CLAIM_TAKEN')) throw e;
        }
      }
      if (!unclaimed.length) {
        await claimMember(id, null);
        toast.success('You joined the group');
        open(id);
        return;
      }
      setGroupId(id);
      setChoices(getUnclaimedMembers(id));
    } catch (e) {
      toast.error('Couldn\'t join', (e as Error).message);
    }
  });

  const claim = () => submit(async () => {
    if (!groupId || !picked) return;
    try {
      await claimMember(groupId, picked === 'new' ? null : picked);
      toast.success('You joined the group');
      open(groupId);
    } catch (e) {
      toast.error('Couldn\'t continue', (e as Error).message);
      if (e instanceof SyncError && e.code === 'CLAIM_TAKEN') {
        setChoices(getUnclaimedMembers(groupId));
        setPicked(null);
      }
    }
  });

  const claiming = !!choices;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <PlainScreenHeader title={claiming ? 'Who Are You?' : 'Join Group'} onBack={() => navigation.goBack()} bordered />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {claiming ? (
            <FormField label="Pick Your Name">
              <FormValueCard>
                {[...choices!.map((c) => ({ key: c.memberId, label: titleCaseName(c.name), icon: 'person-outline' as const })),
                  { key: 'new', label: 'I\'m Not In This List', icon: 'person-add-outline' as const }].map((row) => (
                  <FormValueRow
                    key={row.key}
                    icon={row.icon}
                    label={row.label}
                    value=""
                    onPress={() => setPicked(row.key)}
                    accentColor={theme.primary}
                    trailingIcon={picked === row.key ? 'checkmark-circle' : null}
                  />
                ))}
              </FormValueCard>
            </FormField>
          ) : (
            <FormField label="Invite Link" hint="Ask anyone in the group to send you one from the group's ⋮ menu.">
              <FormTextInput
                value={link}
                onChangeText={setLink}
                placeholder="Paste the invite link"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
            </FormField>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PrimaryButton
            title={claiming ? 'Continue' : 'Join Group'}
            onPress={claiming ? claim : join}
            disabled={claiming ? !picked : !linkOk}
            loading={submitting}
            style={{ width: '100%' }}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerSafe: { backgroundColor: colors.card },
  scroll: { padding: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
