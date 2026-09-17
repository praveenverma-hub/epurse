// =============================================================================
// MyProfileScreen — opened by tapping the avatar on Profile's hero card.
//
// Draft-then-Save, same contract as ManageAccountModal: nothing commits to the
// store until Save is pressed. Name + phone are editable; email is read-only —
// it comes from the Google account the app is signed in with, not something
// typed here (see useGoogleSession/GoogleSignInPanel for how that's obtained).
//
// Phone used to be collected during onboarding; it moved here so onboarding's
// registration step only asks for a name and a Google sign-in.
// =============================================================================
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/Toast';
import { radius, spacing, typography as typographyBase, BUTTON_H } from '../constants/theme';
import { INPUT_LIMITS, sanitizeName, isValidName, sanitizePhone, isValidPhone } from '../utils/validation';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';

interface Props {
  navigation: { goBack: () => void };
}

const MyProfileScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const toast = useToast();

  const userName = useEPurseStore((s: any) => s.userName ?? '') as string;
  const userPhones = useEPurseStore((s: any) => s.userPhones ?? []) as string[];
  const googleAccount = useEPurseStore((s: any) => s.googleAccount) as { email: string | null } | null;
  const setUserName = useEPurseStore((s: any) => s.setUserName);
  const setUserPhones = useEPurseStore((s: any) => s.setUserPhones);

  const [nameDraft, setNameDraft] = useState(userName);
  const [phoneDraft, setPhoneDraft] = useState(userPhones[0] || '');

  const nameValid = isValidName(nameDraft);
  // Phone stays optional here — a blank draft is valid; a non-blank one must be a real number.
  const phoneValid = phoneDraft === '' || isValidPhone(phoneDraft);
  const nameChanged = nameDraft.trim() !== userName;
  const phoneChanged = phoneDraft !== (userPhones[0] || '');
  const canSave = (nameChanged || phoneChanged) && nameValid && phoneValid;

  const handleSave = () => {
    if (!canSave) return;
    if (nameChanged) setUserName(nameDraft.trim());
    if (phoneChanged) setUserPhones(phoneDraft ? [phoneDraft] : []);
    toast.success('Saved', 'Your profile was updated.');
    navigation.goBack();
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.root, { backgroundColor: theme.card }]} edges={['top']}>
        <PlainScreenHeader
          title="My Profile"
          onBack={() => navigation.goBack()}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          bordered
          surfaceColor={theme.card}
          dividerColor={theme.divider}
        />

        <ScrollView
          style={[styles.scrollBody, { backgroundColor: theme.background }]}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <SectionHeader icon="person-outline" title="Your Details" accentColor={theme.primary} />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Full name</Text>
            <TextInput
              style={[
                styles.input,
                { borderColor: theme.divider, color: theme.textPrimary, backgroundColor: theme.background },
                nameDraft.length > 0 && !nameValid && { borderColor: theme.danger },
              ]}
              placeholder="e.g. Praveen Verma"
              placeholderTextColor={theme.textSecondary}
              value={nameDraft}
              onChangeText={(t) => setNameDraft(sanitizeName(t))}
              autoCapitalize="words"
              maxLength={INPUT_LIMITS.NAME_MAX}
            />

            <Text style={[styles.label, { color: theme.textSecondary }]}>Mobile number</Text>
            <View style={[
              styles.phoneWrap,
              { borderColor: theme.divider, backgroundColor: theme.background },
              phoneDraft.length > 0 && !phoneValid && { borderColor: theme.danger },
            ]}>
              <Text style={[styles.phonePrefix, { color: theme.textPrimary }]}>+91</Text>
              <View style={[styles.phoneDivider, { backgroundColor: theme.divider }]} />
              <TextInput
                style={[styles.phoneInput, { color: theme.textPrimary }]}
                placeholder="10-digit number"
                placeholderTextColor={theme.textSecondary}
                value={phoneDraft}
                onChangeText={(t) => setPhoneDraft(sanitizePhone(t))}
                keyboardType="number-pad"
                maxLength={INPUT_LIMITS.PHONE_LEN}
              />
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <SectionHeader icon="mail-outline" title="Account" subtitle="Connected with Google" accentColor={theme.primary} />
            <View style={styles.row}>
              <Ionicons name="mail-outline" size={20} color={theme.textSecondary} style={styles.rowIcon} />
              <Text style={[styles.rowValue, { color: theme.textPrimary }]} numberOfLines={1}>
                {googleAccount?.email || 'Not signed in'}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.card, borderTopColor: theme.divider }]}>
          <Pressable
            style={[styles.saveBtn, { backgroundColor: canSave ? theme.primary : theme.divider }]}
            disabled={!canSave}
            onPress={handleSave}
            accessibilityRole="button"
            accessibilityLabel="Save changes"
          >
            <Text style={[
              styles.saveBtnText,
              { color: canSave ? theme.textOnGradient : theme.textSecondary },
            ]}>
              Save
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
};

const typography = typographyBase as unknown as Record<string, any>;

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  label: { ...typography.tiny, fontWeight: '600', marginBottom: spacing.sm, marginTop: spacing.md },
  input: {
    borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16,
  },
  phoneWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.lg,
  },
  phonePrefix: { fontSize: 16, fontWeight: '600' },
  phoneDivider: { width: 1, height: 22, marginHorizontal: spacing.md },
  phoneInput: { flex: 1, fontSize: 16, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  rowIcon: { width: 22, textAlign: 'center' },
  rowValue: { ...typography.body, fontWeight: '600', flex: 1 },
  footer: { padding: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
  saveBtn: { minHeight: BUTTON_H, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: 16, fontWeight: '700' },
});

export default MyProfileScreen;
