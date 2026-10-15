// =============================================================================
// JoinGroupScreen — join a live shared group from an invite link (src/sync/groupSync.ts).
// Nobody is asked "who are you": a link made for one person makes you that person,
// any other makes you a new one — the inviter decides. A person's link names them, so
// whoever it was forwarded to can tap "I'm Not Priya" and join as themselves. Route params:
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
import { titleCaseName } from '../utils/format';
import { joinFromLink } from '../sync/groupSync';

const PrimaryButton = PrimaryButtonBase as React.FC<{
  title: string; onPress: () => void; disabled?: boolean; loading?: boolean; style?: object; variant?: 'filled' | 'outline';
}>;

export default function JoinGroupScreen({ navigation, route }: { navigation: any; route: any }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { submit, submitting } = useSubmitGuard();
  const [link, setLink] = useState<string>(route?.params?.link ?? '');
  const [asNew, setAsNew] = useState(false);

  // Another invite tapped while this screen is open arrives as new params, not a new screen.
  const paramLink = route?.params?.link as string | undefined;
  useEffect(() => {
    if (paramLink) setLink(paramLink);
  }, [paramLink]);

  const parsed = parseInviteLink(link.trim());
  const forName = parsed?.name ? titleCaseName(parsed.name) : null;

  const join = (newPerson: boolean) => submit(async () => {
    setAsNew(newPerson);
    try {
      const id = await joinFromLink(link, { asNew: newPerson });
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
          {forName ? (
            <View style={styles.row}>
              <PrimaryButton
                title={`I'm Not ${forName}`}
                variant="outline"
                onPress={() => join(true)}
                disabled={submitting && !asNew}
                loading={submitting && asNew}
                style={styles.half}
              />
              <PrimaryButton
                title={`Join as ${forName}`}
                onPress={() => join(false)}
                disabled={submitting && asNew}
                loading={submitting && !asNew}
                style={styles.half}
              />
            </View>
          ) : (
            <PrimaryButton
              title="Join Group"
              onPress={() => join(false)}
              disabled={!parsed}
              loading={submitting}
              style={{ width: '100%' }}
            />
          )}
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
  row: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
});
