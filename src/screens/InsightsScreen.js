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
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, ScrollView, Pressable } from 'react-native';
import Modal from "../components/AppModal";
import { TabView } from 'react-native-tab-view';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme, useGradient } from '../hooks/useTheme';
import { spacing, radius, typography, shadows } from '../constants/theme';
import { useEPurseStore, firstDataMonthKey } from '../store/ePurseStore';
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
  // The sheet animates itself (Modal `animationType="none"`): RN's own `slide` moves
  // the whole window, so the dimmed backdrop slid down WITH the sheet instead of
  // fading — the header snapped bright the instant you tapped. Here only the sheet
  // slides and the backdrop fades, same as the Activity filter sheet.
  const HIDDEN_Y = Dimensions.get('window').height * 0.5;
  const sheetY = useSharedValue(HIDDEN_Y);
  const backdropOpa = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpa.value }));

  const openMonthSheet = () => {
    sheetY.value = HIDDEN_Y;
    backdropOpa.value = 0;
    setMonthSheetVisible(true);
  };
  // Started from the Modal's onShow, not openMonthSheet, so the first part of the
  // slide isn't spent before the Modal is on screen.
  const animateSheetIn = () => {
    sheetY.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    backdropOpa.value = withTiming(0.4, { duration: 260 });
  };
  // The new month is applied only AFTER the sheet has gone — changing it on tap
  // swapped the page behind the backdrop mid-close.
  const finishClose = (offset) => {
    setMonthSheetVisible(false);
    if (offset != null && offset !== monthOffset) setMonthOffset(offset);
  };
  const closeMonthSheet = (offset = null) => {
    sheetY.value = withTiming(
      HIDDEN_Y,
      { duration: 240, easing: Easing.in(Easing.cubic) },
      (finished) => { if (finished) runOnJS(finishClose)(offset); },
    );
    backdropOpa.value = withTiming(0, { duration: 240 });
  };

  // Months before the user's first data can't show anything — the picker greys
  // them out. Memoised over the raw slices (`firstDataMonthKey` scans transactions).
  const pickerTxns   = useEPurseStore((s) => s.transactions);
  const pickerAggs   = useEPurseStore((s) => s.monthlyAggregates);
  const onboardedAt  = useEPurseStore((s) => s.userOnboardedAt);
  const firstMonth   = useMemo(
    () => firstDataMonthKey({ transactions: pickerTxns, monthlyAggregates: pickerAggs, userOnboardedAt: onboardedAt }),
    [pickerTxns, pickerAggs, onboardedAt],
  );
  const monthOptions = useMemo(() => {
    const today = new Date();
    return Array.from({ length: MONTH_PICKER_COUNT }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      return {
        offset: -i,
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
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
          onPress={openMonthSheet}
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
        animationType="none"
        statusBarTranslucent
        onShow={animateSheetIn}
        onRequestClose={() => closeMonthSheet()}
      >
        <Animated.View style={[styles.scrim, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => closeMonthSheet()} />
        </Animated.View>
        <Animated.View style={[styles.sheet, { backgroundColor: theme.card }, sheetStyle]}>
          <SheetCloseButton onPress={() => closeMonthSheet()} variant="absolute" />
          <View style={[styles.handle, { backgroundColor: theme.divider }]} />
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>Select Month</Text>

          <ScrollView contentContainerStyle={styles.sheetList} showsVerticalScrollIndicator={false}>
            {monthOptions.map((m) => {
              const active = m.offset === monthOffset;
              const disabled = !!firstMonth && m.key < firstMonth;
              return (
                <TouchableOpacity
                  key={m.offset}
                  style={[styles.sheetRow, { borderColor: theme.divider }, active && { backgroundColor: theme.primary + '14', borderColor: theme.primary }, disabled && { opacity: 0.4 }]}
                  onPress={() => closeMonthSheet(m.offset)}
                  disabled={disabled}
                  activeOpacity={0.8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active, disabled }}
                >
                  <Text style={[styles.sheetRowText, { color: active ? theme.primary : disabled ? theme.textMuted : theme.textPrimary }, active && { fontWeight: '700' }]}>
                    {m.label}
                  </Text>
                  <View style={styles.sheetCheckSlot}>
                    {active ? <Ionicons name="checkmark" size={18} color={theme.primary} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
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
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: '#000' },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 36,
    maxHeight: '50%',
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
    minHeight: 48,
  },
  // Fixed slot so the checkmark appearing never changes the row's height.
  sheetCheckSlot: { width: 18, height: 18 },
  sheetRowText: { fontSize: 14.5, fontWeight: '600' },
});
