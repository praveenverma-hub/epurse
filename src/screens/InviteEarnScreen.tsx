// InviteEarnScreen — a Profile-hub destination (below Backup), not a Settings
// row, so it takes the app's general card-per-section look, matching its
// sibling BackupScreen.js: the static `colors` palette + `theme.primary` for the accent.
//
// Sharing works today; the EPC reward is gated behind
// STATIC_CONFIG.inviteEarn.enabled until there's a backend to verify an invite
// actually converted (ePurse has none today — fully on-device + Drive backup).
import React from 'react';
import { Share, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { colors, radius, shadows, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { STATIC_CONFIG } from '../config/staticConfig';
import { APP_NAME } from '../constants/appMeta';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import GradientButtonBase from '../components/GradientButton';
import FaqAccordion, { type FaqItem } from '../components/FaqAccordion';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// GradientButton.js has no TS declarations, so its inferred prop type demands
// every prop. Same local cast the other TS callers use (GoalsScreen, etc).
const GradientButton: React.FC<{ title: string; onPress: () => void }> = GradientButtonBase as any;

const INVITE_EARN_ENABLED = STATIC_CONFIG.inviteEarn.enabled;

const INVITE_FAQ: FaqItem[] = [
  {
    id: 'earn-now',
    question: 'Do I earn anything for inviting friends right now?',
    answer: "Not yet — sharing is just sharing for now. EPC rewards for invites are coming soon.",
  },
  {
    id: 'past-invites',
    question: 'Will my past invites count once rewards launch?',
    answer: "We'll announce how to qualify when rewards go live — keep sharing in the meantime.",
  },
];

interface Props {
  navigation: { goBack: () => void };
}

const InviteEarnScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const invite = () => {
    hapticLight();
    Share.share({
      message: `I've been using ${APP_NAME} to track my spending automatically from bank SMS — you might find it useful too.`,
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <PlainScreenHeader title="Invite & Earn" onBack={() => navigation.goBack()} bordered />

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <SectionHeader icon="gift-outline" title="Share ePurse" accentColor={theme.primary} />
          <Text style={styles.hint}>
            {INVITE_EARN_ENABLED
              ? `Share ${APP_NAME} with a friend and earn EPC once they get started.`
              : `Share ${APP_NAME} with people who'd find it useful. EPC rewards for inviting are coming soon.`}
          </Text>
          <GradientButton title="Invite a Friend" onPress={invite} />
        </View>

        <FaqAccordion title="FAQs" items={INVITE_FAQ} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.card },
  scrollBody: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  hint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },
});

export default InviteEarnScreen;
