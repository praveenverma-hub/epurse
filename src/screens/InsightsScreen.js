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
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Modal, ScrollView, Pressable } from 'react-native';
import { TabView } from 'react-native-tab-view';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, useGradient } from '../hooks/useTheme';
import { spacing, radius, typography, shadows } from '../constants/theme';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';
import SheetCloseButton from '../components/SheetCloseButton';
import BudgetScreen    from './BudgetScreen';
import AnalyticsScreen from './AnalyticsScreen';

// How many months back the picker offers — this screen has no natural bound
// of its own (the old prev/next arrows just let you keep stepping back
// forever), so a plain trailing year matches every other "pick a month"
// affordance in the app.
const MONTH_PICKER_COUNT = 12;

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

  // Bottom-sheet month picker — replaces the old prev/next arrow row. Built
  // from `(year, month - i, 1)` rather than repeatedly decrementing a live
  // Date's own month (what `monthDate` above does for the CURRENT offset only)
  // — that rollover trick is fine one step at a time, but chaining it across
  // 12 steps from today's day-of-month risks a short month skipping/repeating
  // (Date's own overflow handling is exactly correct for a single subtraction
  // from a day-1 anchor, which is all this needs).
  const [monthSheetVisible, setMonthSheetVisible] = useState(false);
  const monthOptions = useMemo(() => {
    const today = new Date();
    return Array.from({ length: MONTH_PICKER_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      return {
        offset: -i,
        label: i === 0
          ? d.toLocaleDateString('en-IN', { month: 'long' })
          : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      };
    });
  }, []);

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
      // Month picker now lives beside the title (was its own prev/next row
      // under the pill switcher) — a chip with a drop-down chevron, opening
      // the bottom sheet below instead of stepping one month at a time.
      headerRight={
        <TouchableOpacity
          style={styles.monthChip}
          onPress={() => setMonthSheetVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Change month, currently ${monthLabel}`}
        >
          <Text style={styles.monthChipText} numberOfLines={1}>{monthLabel}</Text>
          <Ionicons name="chevron-down" size={14} color="#fff" />
        </TouchableOpacity>
      }
      renderHero={() => (
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
      )}
    />
  );

  return (
    <View style={styles.root}>
      <TabView
        navigationState={{ index, routes: ROUTES }}
        renderScene={renderScene}
        renderTabBar={renderTabBar}
        onIndexChange={setIndex}
        initialLayout={initialLayout}
        swipeEnabled
      />

      {/* Month picker bottom sheet — same row-list shape as AccountPickerSheet/
          GroupPickerSheet (handle + title + scrollable rows), not built fresh. */}
      <Modal
        visible={monthSheetVisible}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setMonthSheetVisible(false)}
      >
        <Pressable style={styles.scrim} onPress={() => setMonthSheetVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <SheetCloseButton onPress={() => setMonthSheetVisible(false)} variant="absolute" />
          <View style={[styles.handle, { backgroundColor: theme.divider }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>Select Month</Text>

          <ScrollView contentContainerStyle={styles.sheetList} showsVerticalScrollIndicator={false}>
            {monthOptions.map((m) => {
              const active = m.offset === monthOffset;
              return (
                <TouchableOpacity
                  key={m.offset}
                  style={[styles.sheetRow, { borderColor: theme.divider }, active && { backgroundColor: theme.primary + '14', borderColor: theme.primary }]}
                  onPress={() => { setMonthOffset(m.offset); setMonthSheetVisible(false); }}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.sheetRowText, { color: active ? theme.primary : theme.textPrimary }, active && { fontWeight: '700' }]}>
                    {m.label}
                  </Text>
                  {active ? <Ionicons name="checkmark" size={18} color={theme.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

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

  // Header-right month chip — same on-gradient pill treatment as `switcher`
  // above (`#FFFFFF22` fill), beside the "Insights" title.
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF22',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  monthChipText: { ...typography.small, color: '#fff', fontWeight: '700' },

  // Month-picker bottom sheet — same shape as AccountPickerSheet/GroupPickerSheet.
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: '#00000066' },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 36,
    maxHeight: '70%',
    ...shadows.sheet,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: spacing.md },
  sheetTitle: { fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  sheetList: { gap: 8, paddingBottom: spacing.sm },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sheetRowText: { fontSize: 14.5, fontWeight: '600' },
});
