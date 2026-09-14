// HelpSupportScreen — general app FAQ + a way to reach a real person.
import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { SUPPORT_EMAIL } from '../constants/appMeta';
import PlainScreenHeader from '../components/PlainScreenHeader';
import FaqAccordion, { type FaqItem } from '../components/FaqAccordion';
import NavListRow from '../components/NavListRow';
import { hapticLight } from '../utils/haptics';

const APP_FAQ: FaqItem[] = [
  {
    id: 'how-reads-sms',
    question: 'How does ePurse read my transactions?',
    answer: 'On Android, ePurse reads your bank SMS on-device to detect and categorise transactions automatically. iOS doesn\'t allow apps to read SMS, so you add transactions manually there.',
  },
  {
    id: 'sms-privacy',
    question: 'Is my SMS data uploaded anywhere?',
    answer: 'No — messages are parsed entirely on your device. If you set up a backup, only the transactions ePurse extracted are included, never the raw SMS text.',
  },
  {
    id: 'wrong-category',
    question: "Why doesn't a transaction show the right category?",
    answer: 'Tap it to change the category — ePurse remembers similar merchants going forward. You can also add your own categories in Settings → Categories.',
  },
  {
    id: 'excluded-meaning',
    question: 'What does "Excluded" mean on a transaction?',
    answer: "That category is turned off in Settings → Expense Inclusions, so it doesn't count toward your spend total — the transaction itself is still there.",
  },
  {
    id: 'no-sms',
    question: 'Can I use ePurse without SMS access?',
    answer: 'Yes — add transactions manually any time, on Android or iOS.',
  },
];

interface Props {
  navigation: { goBack: () => void };
}

const HelpSupportScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const contactSupport = () => {
    hapticLight();
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('ePurse support')}`);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Help & Support"
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
        <FaqAccordion title="FAQs" items={APP_FAQ} />

        <View style={styles.contactWrap}>
          <NavListRow
            icon="mail-outline"
            label="Contact Support"
            hint="Something not working? Email us and we'll take a look."
            onPress={contactSupport}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  contactWrap: { marginTop: spacing.lg },
});

export default HelpSupportScreen;
