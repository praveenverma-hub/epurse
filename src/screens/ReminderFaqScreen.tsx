// ReminderFaqScreen — how the Reminders feature actually behaves.
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import FaqAccordion, { type FaqItem } from '../components/FaqAccordion';

const REMINDER_FAQ: FaqItem[] = [
  {
    id: 'what-for',
    question: 'What can I set a reminder for?',
    intro: 'Anything you\'d rather not keep in your head:',
    bullets: [
      'A bill or a subscription renewal',
      'A repayment you owe someone',
      'Any custom note for yourself',
    ],
    answer: 'You can optionally tag it to a person and an amount.',
  },
  {
    id: 'how-it-works',
    question: 'What actually happens when I set a reminder?',
    flow: [
      { icon: 'create-outline', label: 'You set it' },
      { icon: 'phone-portrait-outline', label: 'Scheduled on your device' },
      { icon: 'notifications-outline', label: 'Fires on time' },
      { icon: 'repeat-outline', label: 'Repeats, or clears if one-time' },
    ],
  },
  {
    id: 'free',
    question: 'Are reminders free to use?',
    bullets: [
      'No limit on how many you can set',
      'No premium tier — for reminders or for anything else in ePurse',
    ],
  },
  {
    id: 'auto-nudges',
    question: 'Do I get reminded about bills and repayments automatically?',
    answer: 'Yes, at no extra cost — ePurse schedules one on its own for a card bill or an outstanding repayment, the same way a custom reminder works.',
  },
  {
    id: 'repeat',
    question: 'Can a reminder repeat?',
    intro: 'Choose a repeat when you create it:',
    bullets: ['Daily', 'Weekly', 'Monthly'],
    answer: 'It keeps firing on that schedule until you delete it.',
  },
  {
    id: 'offline',
    question: 'Will it notify me if I\'m offline or the app is closed?',
    answer: 'Yes — reminders are scheduled entirely on your device, not sent from a server, so they fire on time even without an internet connection.',
  },
  {
    id: 'stop',
    question: 'How do I stop a reminder?',
    bullets: [
      'Tap the trash icon on its card',
      'Or open it and delete it from there',
    ],
    answer: 'Either way it\'s removed for good.',
  },
];

interface Props {
  navigation: { goBack: () => void };
}

const ReminderFaqScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Reminder FAQs"
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
        <FaqAccordion title="FAQs" items={REMINDER_FAQ} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
});

export default ReminderFaqScreen;
