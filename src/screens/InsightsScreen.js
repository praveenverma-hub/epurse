// =============================================================================
// InsightsScreen — tabbed host for Analytics and Budget.
//
// Uses react-native-tab-view (backed by the native react-native-pager-view) so
// switching between Analytics and Budget is a real finger-tracking swipe with
// sliding panels — not an instant content swap. A shared gradient header with a
// pill switcher rides on top via renderTabBar. Sub-screens receive
// headerless=true so they skip their own nav headers.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TabView } from 'react-native-tab-view';

import { useTheme } from '../hooks/useTheme';
import { spacing, radius, typography } from '../constants/theme';
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
  const [index, setIndex] = useState(() => keyToIndex(route.params?.defaultTab));

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
        return <AnalyticsScreen navigation={navigation} headerless />;
      case 'budget':
        return (
          <BudgetScreen
            navigation={navigation}
            headerless
            openPlan={!!route.params?.openPlan}
          />
        );
      default:
        return null;
    }
  };

  const renderTabBar = () => (
    <LinearGradient
      colors={[theme.gradientStart, theme.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.header}
    >
      <SafeAreaView edges={['top']}>
        <Text style={styles.screenTitle}>Insights</Text>
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
      </SafeAreaView>
    </LinearGradient>
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
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
  },
  screenTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  switcher: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF22',
    borderRadius: radius.pill,
    padding: 3,
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
});
