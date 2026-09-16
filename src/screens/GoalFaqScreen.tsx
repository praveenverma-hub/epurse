// GoalFaqScreen — how the Goals feature actually behaves.
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import FaqAccordion, { type FaqItem } from '../components/FaqAccordion';

const GOAL_FAQ: FaqItem[] = [
  {
    id: 'one-time-vs-recurring',
    question: 'What\'s the difference between a one-time and a recurring goal?',
    intro: 'Two shapes a goal can take:',
    bullets: [
      'One-time — has a lifetime target (say ₹50,000 for a laptop) and tracks progress toward it',
      'Recurring — no target, funded fresh every month (say ₹5,000 into savings) until you discontinue it',
    ],
  },
  {
    id: 'how-it-works',
    question: 'How does money actually reach a goal?',
    flow: [
      { icon: 'card-outline', label: 'You spend' },
      { icon: 'pricetags-outline', label: 'Matches its category' },
      { icon: 'trending-up-outline', label: 'Counts toward the goal' },
      { icon: 'trophy-outline', label: 'Target hit, rewarded' },
    ],
  },
  {
    id: 'category-optional',
    question: 'Do I have to link a category to fund a goal?',
    answer: 'No — linking one is optional. It just lets matching spend count toward the goal automatically; you can always add money to a goal manually any time from its own screen.',
  },
  {
    id: 'no-retroactive',
    question: 'If I add a category to a goal later, does it count old spend too?',
    answer: 'No — a category you add later only counts spend from that day forward. It never reaches back and claims money that moved before you added it.',
  },
  {
    id: 'discontinue-vs-delete',
    question: 'Can I pause a recurring goal without losing its history?',
    intro: 'Two ways to stop a goal:',
    bullets: [
      'Discontinue — pauses it; everything already earned and saved stays put, and you can Resume any time',
      'Delete — removes the goal for good, nothing kept',
    ],
  },
  {
    id: 'rewards',
    question: 'Do I earn anything for reaching a goal?',
    intro: 'You earn Reality Points and ePurse Coins for:',
    bullets: [
      'Completing a one-time goal\'s target',
      'Hitting a recurring goal\'s commitment for the month',
    ],
    answer: 'Every goal shows what it\'s currently worth right on its card, before you get there.',
  },
  {
    id: 'overfund',
    question: 'Can I put in more than my target or monthly plan?',
    answer: 'Yes — overfunding is allowed. It just tracks the extra; real money can move however you actually want it to.',
  },
  {
    id: 'free',
    question: 'Is there a limit to how many goals I can create?',
    bullets: [
      'No limit on how many goals you can create',
      'No premium tier — for goals, auto-funding, or the rewards they earn',
    ],
  },
];

interface Props {
  navigation: { goBack: () => void };
}

const GoalFaqScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Goal FAQs"
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
        <FaqAccordion title="FAQs" items={GOAL_FAQ} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
});

export default GoalFaqScreen;
