// =============================================================================
// RemindersScreen — placeholder for the reminders section.
//
// The section is planned, not built. It exists now so the Profile hub can carry
// a real row (labelled SOON) instead of the feature appearing later as a new
// entry the user has to re-learn where to find.
//
// DELIBERATELY NO CONTROLS: the app already schedules local notifications
// (CC bill-due reminders, subscription-hike alerts, Aware Run check-ins) and
// none of them is user-tunable yet. A screen of switches that don't move
// anything is worse than an empty one — so this states what fires today and
// what this screen will own, and nothing else.
//
// When the real thing lands, replace the EmptyState with the list; the route,
// the hub row and the icon (`alarm-outline`) all stay as they are.
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import EmptyState from '../components/EmptyState';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { hapticLight } from '../utils/haptics';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';

// The JS theme widens fontWeight to `string` (ui-consistency §1).
const typography = typographyBase as unknown as Record<string, TextStyle>;

/** What already fires today, so the screen isn't silent about it. */
const ACTIVE_NUDGES = [
  { icon: 'card-outline',          label: 'Credit-card bill due dates' },
  { icon: 'repeat-outline',        label: 'Subscription price changes' },
  { icon: 'flame-outline',         label: 'Aware Run check-in' },
] as const;

interface Props {
  navigation: { goBack: () => void };
}

const RemindersScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={theme.darkMode ? 'light-content' : 'dark-content'} backgroundColor={theme.background} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <PlainScreenHeader
          title="Reminders"
          onBack={() => {
            hapticLight();
            navigation.goBack();
          }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
        />

        <View style={styles.body}>
          <EmptyState
            icon="alarm-outline"
            title="Reminders are on the way"
            subtitle="Soon you'll set your own nudges here — a bill date, a settle-up, a budget check — and choose when each one reaches you."
          />

          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <Text style={[styles.cardTitle, { color: theme.textSecondary }]}>
              ALREADY REMINDING YOU
            </Text>
            {ACTIVE_NUDGES.map(({ icon, label }) => (
              <View key={label} style={styles.row}>
                <Ionicons name={icon} size={16} color={theme.primary} style={styles.rowIcon} />
                <Text style={[styles.rowLabel, { color: theme.textPrimary }]} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  root:      { flex: 1 },
  container: { flex: 1 },
  // flex:1 so EmptyState's `full` mode can centre in what's left of the screen
  // (ui-consistency §3), with the note card pinned under it.
  body:      { flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardTitle: {
    ...typography.tiny,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  // Fixed-width slot so every label starts at the same x whatever the glyph.
  rowIcon:  { width: 20, textAlign: 'center' },
  rowLabel: { ...typography.small, flex: 1 },
});

export default RemindersScreen;
