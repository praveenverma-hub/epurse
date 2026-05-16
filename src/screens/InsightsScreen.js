// =============================================================================
// InsightsScreen — tabbed host for Budget and Analytics.
//
// Provides a shared gradient header with a Budget | Analytics pill switcher.
// Sub-screens receive headerless=true so they skip their own nav headers.
// =============================================================================

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../hooks/useTheme';
import { colors, spacing, radius, typography } from '../constants/theme';
import BudgetScreen    from './BudgetScreen';
import AnalyticsScreen from './AnalyticsScreen';

const INNER_TABS = [
  { key: 'budget',    label: 'Budget' },
  { key: 'analytics', label: 'Analytics' },
];

export default function InsightsScreen({ navigation }) {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState('budget');

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Shared gradient header */}
      <LinearGradient
        colors={[theme.gradientStart, theme.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']}>
          <Text style={styles.screenTitle}>Insights</Text>

          {/* Inner pill switcher */}
          <View style={styles.switcher}>
            {INNER_TABS.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.switcherBtn, activeTab === t.key && styles.switcherBtnActive]}
                onPress={() => setActiveTab(t.key)}
                activeOpacity={0.8}
              >
                <Text style={[
                  styles.switcherText,
                  activeTab === t.key && { color: theme.primary, fontWeight: '700' },
                ]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Sub-screen content — headers suppressed */}
      {activeTab === 'budget' ? (
        <BudgetScreen navigation={navigation} headerless />
      ) : (
        <AnalyticsScreen navigation={navigation} headerless />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  screenTitle: {
    color: '#FFFFFF',
    ...typography.h2,
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
