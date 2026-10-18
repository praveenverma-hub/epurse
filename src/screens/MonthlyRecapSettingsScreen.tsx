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
// Rendered PLAIN, like the rest of the Settings tree — no card fill/shadow;
// each group under it gets a SectionBand (Oct-19-26), same as Notifications.
// =============================================================================

import React, { useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from '../components/AppText';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useEPurseStore, RECAP_OPTION_DEFAULTS, selectRecapMonths } from '../store/ePurseStore';
import { spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import NavListRow from '../components/NavListRow';
import SectionBand from '../components/SectionBand';
import AppSwitch from '../components/AppSwitch';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const RECAP_INCLUDES = [
  { key: 'includeIncome',     icon: 'trending-up-outline',    label: 'Income Sources' },
  { key: 'includeNotCounted', icon: 'remove-circle-outline',  label: 'Money Not Counted as Spend' },
  { key: 'includeGoals',      icon: 'flag-outline',           label: 'Goals Progress' },
  { key: 'includeLb',         icon: 'swap-horizontal-outline', label: 'Lent & Borrowed' },
  { key: 'includeAccounts',   icon: 'card-outline',           label: 'Accounts & Net Worth' },
  { key: 'includeGroups',     icon: 'people-outline',         label: 'Group & Trip Spend' },
  { key: 'includePrivate',    icon: 'eye-off-outline',        label: 'Private Transactions' },
  { key: 'includeTxnList',    icon: 'receipt-outline',        label: 'Full Transaction List (PDF)' },
] as const;

const RecapSwitch = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => {
  const theme = useTheme();
  return (
    <AppSwitch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: theme.primary, false: theme.divider }}
      thumbColor="#fff"
      ios_backgroundColor={theme.divider}
    />
  );
};

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
        <NavListRow
          icon="stats-chart-outline"
          label="Show Monthly Recap"
          chevron={false}
          onPress={() => setShowMonthlyRecap(!showMonthlyRecap)}
          right={<RecapSwitch value={!!showMonthlyRecap} onChange={setShowMonthlyRecap} />}
        />

        {/* Only meaningful while the recap is on — hidden rather than disabled, so
            the section doesn't show controls that can't do anything. */}
        {showMonthlyRecap ? (
          <View style={styles.group}>
            <SectionBand icon="document-text-outline" title="Report Includes" />
            {RECAP_INCLUDES.map(({ key, icon, label }, i) => {
              const on = recapOptions?.[key] ?? RECAP_OPTION_DEFAULTS[key];
              return (
                <NavListRow
                  key={key}
                  icon={icon}
                  label={label}
                  divided={i > 0}
                  chevron={false}
                  onPress={() => setRecapOption(key, !on)}
                  right={<RecapSwitch value={on} onChange={(v) => setRecapOption(key, v)} />}
                />
              );
            })}
          </View>
        ) : null}

        {/* Always reachable, whether or not the recap card/modal is on — the card can be
            dismissed and the notification cleared, this is the way back. */}
        {pastMonths.length > 0 ? (
          <View style={styles.group}>
            <SectionBand icon="time-outline" title="Past Summaries" />
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
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

export default MonthlyRecapSettingsScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.lg },
  hint: { ...typography.small, lineHeight: 18 },
  group: { gap: spacing.xs },
});
