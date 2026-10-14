// =============================================================================
// JoinGroupScreen — join a live shared group from an invite link (src/sync/groupSync.ts).
// Nobody is asked "who are you": a link made for one person makes you that person,
// any other makes you a new one — the inviter decides. Route params:
//   { link? } — prefilled link (a tapped invite — App.js InviteLinkBoot)
// =============================================================================
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import KeyboardAvoidingView from '../components/AppKeyboardAvoidingView';
import PlainScreenHeader from '../components/PlainScreenHeader';
import PrimaryButtonBase from '../components/PrimaryButton';
import { FormField, FormTextInput } from '../components/FormField';
import { useToast } from '../components/Toast';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { colors, spacing } from '../constants/theme';
import { parseInviteLink } from '../sync/invite';
import { joinFromLink } from '../sync/groupSync';

const PrimaryButton = PrimaryButtonBase as React.FC<{
  title: string; onPress: () => void; disabled?: boolean; loading?: boolean; style?: object;
}>;

export default function JoinGroupScreen({ navigation, route }: { navigation: any; route: any }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { submit, submitting } = useSubmitGuard();
  const [link, setLink] = useState<string>(route?.params?.link ?? '');

  // Another invite tapped while this screen is open arrives as new params, not a new screen.
  const paramLink = route?.params?.link as string | undefined;
  useEffect(() => {
    if (paramLink) setLink(paramLink);
  }, [paramLink]);

  const linkOk = !!parseInviteLink(link.trim());

  const join = () => submit(async () => {
    try {
      const id = await joinFromLink(link);
      toast.success('You joined the group');
      navigation.replace('GroupDetail', { groupId: id });
    } catch (e) {
      toast.error('Couldn\'t join', (e as Error).message);
    }
  });

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <PlainScreenHeader title="Join Group" onBack={() => navigation.goBack()} bordered />
      </SafeAreaView>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PrimaryButton
            title="Join Group"
            onPress={join}
            disabled={!linkOk}
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
