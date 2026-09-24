// =============================================================================
// InsightsScreen — tabbed host for Analytics and Budget.
//
// Uses react-native-tab-view (backed by the native react-native-pager-view) so
// switching between Analytics and Budget is a real finger-tracking swipe with
// sliding panels — not an instant content swap. A shared gradient header with a
// pill switcher rides on top via renderTabBar. Sub-screens receive
// headerless=true so they skip their own nav headers.
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { TabView } from 'react-native-tab-view';

import { useTheme, useGradient } from '../hooks/useTheme';
import { spacing, radius, typography } from '../constants/theme';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';
import BudgetScreen    from './BudgetScreen';
import AnalyticsScreen from './AnalyticsScreen';

const ROUTES = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'budget',    label: 'Budget' },
];

const keyToIndex = (k) => {
  const i = ROUTES.findIndex((r) => r.key === k);
  return i < 0 ? 0 : i;
};

const initialLayout = { width: Dimensions.get('window').width };

export default function InsightsScreen({ navigation, route }) {
  const theme = useTheme();
  const gradient = useGradient();
  const [index, setIndex] = useState(() => keyToIndex(route.params?.defaultTab));

  // Shared month, driving both scenes so "September" means the same thing on
  // Analytics and Budget rather than each screen tracking its own. Budget only
  // reads it for a VIEW of past months (via budgetHistory) — it can't be edited
  // retroactively, so Edit/Remove Plan stay scoped to month 0 inside BudgetScreen.
  const [monthOffset, setMonthOffset] = useState(0); // 0 = this month, -1 = last month
  const monthDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);
  const monthLabel = monthOffset === 0
    ? monthDate.toLocaleDateString('en-IN', { month: 'long' })
    : monthDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const defaultTab = route.params?.defaultTab;
      if (defaultTab) setIndex(keyToIndex(defaultTab));
    });
    return unsubscribe;
  }, [navigation, route.params?.defaultTab]);

  const renderScene = ({ route: r }) => {
    switch (r.key) {
      case 'analytics':
        return <AnalyticsScreen navigation={navigation} headerless monthOffset={monthOffset} />;
      case 'budget':
        return (
          <BudgetScreen
            navigation={navigation}
            headerless
            openPlan={!!route.params?.openPlan}
            monthOffset={monthOffset}
          />
        );
      default:
        return null;
    }
  };

  const renderTabBar = () => (
    <CollapsingHeaderScreen
      collapsible={false}
      gradientColors={gradient}
      title="Insights"
      renderHero={() => (
        <>
          <View style={styles.switcher}>
            {ROUTES.map((t, i) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.switcherBtn, index === i && styles.switcherBtnActive]}
                onPress={() => setIndex(i)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.switcherText,
                  index === i && { color: theme.primary, fontWeight: '700' },
                ]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.monthSwitcher}>
            <TouchableOpacity onPress={() => setMonthOffset((m) => m - 1)} hitSlop={10}>
              <Text style={styles.monthArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <TouchableOpacity
              onPress={() => setMonthOffset((m) => Math.min(0, m + 1))}
              disabled={monthOffset === 0}
              hitSlop={10}
            >
              <Text style={[styles.monthArrow, monthOffset === 0 && { opacity: 0.4 }]}>›</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    />
  );

  return (
    <TabView
      navigationState={{ index, routes: ROUTES }}
      renderScene={renderScene}
      renderTabBar={renderTabBar}
      onIndexChange={setIndex}
      initialLayout={initialLayout}
      swipeEnabled
    />
  );
}

const styles = StyleSheet.create({
  switcher: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF22',
    borderRadius: radius.pill,
    padding: 3,
    marginTop: spacing.md,
  },
  switcherBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.pill,
  },
  switcherBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  switcherText: {
    ...typography.small,
    color: '#FFFFFFCC',
    fontWeight: '600',
  },

  monthSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  monthArrow: { ...typography.h2, color: '#FFFFFF', fontWeight: '700' },
  monthLabel: { ...typography.bodyBold, color: '#FFFFFF', fontWeight: '700', minWidth: 100, textAlign: 'center' },
});
