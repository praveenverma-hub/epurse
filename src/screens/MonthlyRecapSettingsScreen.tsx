// =============================================================================
// MonthlyRecapSettingsScreen — the monthly-recap on/off switch + what it
// includes.
//
// Pulled out of SettingsScreen (Sep-14-26): that screen used to show this
// toggle and its conditional "Report includes" sub-rows inline, while every
// other Settings row navigated somewhere. Now every row behaves the same way
// — tap, land on a screen or a sheet — and this earns a SCREEN rather than a
// sheet because its row count is conditional (3 sub-toggles that only exist
// while the recap itself is on; ui-consistency §2b).
//
// No SectionHeader repeating "Monthly recap" here — the screen's own title
// already says that (§1a: the screen title counts as a heading).
//
// Rendered PLAIN (Sep-14-26), like the rest of the Settings tree — no card
// fill/shadow; a hairline stands in for the card edge between the toggle and
// its conditional "Report includes" sub-group.
// =============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore, RECAP_OPTION_DEFAULTS, selectRecapMonths } from '../store/ePurseStore';
import { spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import NavListRow from '../components/NavListRow';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const RECAP_INCLUDES = [
  { key: 'includeIncome',   label: 'Income Sources' },
  { key: 'includeNotCounted', label: 'Money Not Counted as Spend' },
  { key: 'includeGoals',    label: 'Goals Progress' },
  { key: 'includeLb',       label: 'Lent & Borrowed' },
  { key: 'includeAccounts', label: 'Accounts & Net Worth' },
  { key: 'includeGroups',   label: 'Group & Trip Spend' },
  { key: 'includePrivate',  label: 'Private Transactions' },
  { key: 'includeTxnList',  label: 'Full Transaction List (PDF)' },
] as const;

interface Props {
  navigation: { goBack: () => void; navigate: (name: string, params?: object) => void };
}

const MonthlyRecapSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const showMonthlyRecap = useEPurseStore((s: any) => s.showMonthlyRecap);
  const setShowMonthlyRecap = useEPurseStore((s: any) => s.setShowMonthlyRecap);
  const recapOptions = useEPurseStore((s: any) => s.recapOptions);
  const setRecapOption = useEPurseStore((s: any) => s.setRecapOption);
  const transactions = useEPurseStore((s: any) => s.transactions);
  const monthlyAggregates = useEPurseStore((s: any) => s.monthlyAggregates);
  // The raw slices, memoised here — `selectRecapMonths` returns a new array, so it
  // must not be handed to the store as a selector (zustand v5 compares by reference).
  const pastMonths = useMemo(
    () => selectRecapMonths({ transactions, monthlyAggregates }) as string[],
    [transactions, monthlyAggregates],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Monthly Recap"
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
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          A month-end summary card, modal and downloadable PDF.
        </Text>
        <View style={styles.row}>
          <Ionicons name="stats-chart-outline" size={18} color={theme.primary} style={styles.rowIcon} />
          <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>Show monthly recap</Text>
          <Switch
            value={!!showMonthlyRecap}
            onValueChange={setShowMonthlyRecap}
            trackColor={{ true: theme.primary, false: theme.divider }}
            thumbColor="#fff"
            ios_backgroundColor={theme.divider}
          />
        </View>

        {/* Only meaningful while the recap is on — hidden rather than disabled, so
            the section doesn't show controls that can't do anything. A hairline
            separates this from the toggle above it — two distinct groups (the
            switch, and what it includes) now that there's no card to imply that
            split on its own. */}
        {showMonthlyRecap ? (
          <>
            <Text style={[styles.sub, { color: theme.textSecondary, borderTopColor: theme.divider }]}>
              Report includes
            </Text>
            {RECAP_INCLUDES.map(({ key, label }) => (
              <View key={key} style={[styles.row, styles.subRow]}>
                <Text style={[styles.subLabel, { color: theme.textPrimary }]}>{label}</Text>
                <Switch
                  value={recapOptions?.[key] ?? RECAP_OPTION_DEFAULTS[key]}
                  onValueChange={(v) => setRecapOption(key, v)}
                  trackColor={{ true: theme.primary, false: theme.divider }}
                  thumbColor="#fff"
                  ios_backgroundColor={theme.divider}
                />
              </View>
            ))}
          </>
        ) : null}

        {/* Always reachable, whether or not the recap card/modal is on — the card can be
            dismissed and the notification cleared, this is the way back. */}
        {pastMonths.length > 0 ? (
          <>
            <Text style={[styles.sub, { color: theme.textSecondary, borderTopColor: theme.divider }]}>
              Past Summaries
            </Text>
            {pastMonths.map((mk, i) => {
              const [y, m] = mk.split('-').map(Number);
              return (
                <NavListRow
                  key={mk}
                  icon="document-text-outline"
                  label={new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                  divided={i > 0}
                  onPress={() => navigation.navigate('MonthlyRecapSummary', { monthKey: mk })}
                />
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default MonthlyRecapSettingsScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  hint: { ...typography.small, marginBottom: spacing.md },
  // The hairline is the section separator that used to be implicit in the
  // card's own edge — a plain page needs it stated, not assumed.
  sub: {
    ...typography.small,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.lg,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabel: { ...typography.body, flex: 1, fontWeight: '600' },
  subRow: { paddingLeft: spacing.xl },
  subLabel: { ...typography.small, flex: 1 },
});
