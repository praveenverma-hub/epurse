// =============================================================================
// MonthSummaryCard — "View Complete Summary" entry at the top of Insights when a
// PAST month is picked. Renders nothing for the current month or a month with no
// data, so callers just drop it in as the first child and never gate it.
//
// One component for both Insights scenes (Analytics + Budget) — same rule as the
// other shared cards: two callers, one implementation.
// =============================================================================

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useEPurseStore, selectRecapMonths } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, shadows, spacing } from '../constants/theme';
import NavListRow from './NavListRow';

type Props = {
  /** 0 = this month, -1 = last month … (Insights' shared `monthOffset`). */
  monthOffset: number;
};

const MonthSummaryCard = ({ monthOffset }: Props) => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const transactions = useEPurseStore((s: any) => s.transactions);
  const monthlyAggregates = useEPurseStore((s: any) => s.monthlyAggregates);

  const d = useMemo(() => {
    const x = new Date();
    return new Date(x.getFullYear(), x.getMonth() + monthOffset, 1);
  }, [monthOffset]);
  const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  // `selectRecapMonths` returns a new array — memoise over the raw slices, never
  // hand it to the store as a selector (zustand v5 compares by reference).
  const available = useMemo(
    () => monthOffset < 0 && (selectRecapMonths({ transactions, monthlyAggregates }, 24) as string[]).includes(mk),
    [monthOffset, transactions, monthlyAggregates, mk],
  );
  if (!available) return null;

  const month = d.toLocaleDateString('en-IN', { month: 'long' });
  return (
    <View style={[styles.card, { backgroundColor: theme.card }]}>
      <NavListRow
        variant="tile"
        icon="document-text-outline"
        label="View Complete Summary"
        hint={`${month} in one place, ready to download`}
        onPress={() => navigation.navigate('MonthlyRecapSummary', { monthKey: mk })}
      />
    </View>
  );
};

export default MonthSummaryCard;

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, marginBottom: spacing.md, ...shadows.card },
});
