// =============================================================================
// AnimatedTabBar — Swiggy-inspired bottom tab bar.
//
// Behaviour:
//   • Outlined icons at rest, filled + theme-primary when selected.
//   • Slides down and hides on scroll-down; snaps back on scroll-up.
//   • ALWAYS reveals itself on a tab change (see the effect below) — the hidden
//     state is global, and it slides fully off-screen, so a tab left hidden is
//     untappable and therefore unrecoverable.
//   • Position is absolute so page content flows under it (screens must
//     add bottom padding equal to TAB_BAR_HEIGHT + safeArea.bottom).
// =============================================================================

import React, { useEffect } from 'react';
import { View, TouchableOpacity, Text, Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTabBarVisibility, TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
import { useTheme } from '../hooks/useTheme';
import { colors } from '../constants/theme';

const TAB_CONFIG = [
  { name: 'Dashboard',    label: 'Home',     icon: 'home',           iconOutline: 'home-outline' },
  { name: 'Transactions', label: 'Activity', icon: 'receipt',        iconOutline: 'receipt-outline' },
  { name: 'Groups',       label: 'Groups',   icon: 'people',         iconOutline: 'people-outline' },
  { name: 'Insights',     label: 'Insights', icon: 'bar-chart',      iconOutline: 'bar-chart-outline' },
  { name: 'Accounts',     label: 'Accounts', icon: 'card',           iconOutline: 'card-outline' },
];

export default function AnimatedTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  const theme  = useTheme();
  const { tabBarAnim, showTabBar } = useTabBarVisibility();

  /**
   * Reveal on every tab change — the backstop for "the bar vanished and never came
   * back". Hidden-ness lives in one global ref, but only SOME screens wire
   * `useTabBarScroll` (Dashboard, Groups). Scroll down on one of those to hide the
   * bar, then land on a screen that doesn't wire it — e.g. Dashboard's account chips
   * and "View all" push straight to Transactions — and nothing was left to call
   * `showTabBar()`. Since the bar translates FULLY off-screen it can't be tapped to
   * recover, so it stayed hidden until the app was relaunched.
   *
   * Fixing it here rather than in each screen is deliberate: this runs for every tab
   * regardless of what the destination screen remembers to wire up, so a future
   * screen can't reintroduce the bug by omission.
   */
  useEffect(() => {
    showTabBar();
  }, [state.index, showTabBar]);

  const bottomPad = Math.max(insets.bottom, 8);

  const translateY = tabBarAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [0, TAB_BAR_HEIGHT + bottomPad + 8],
  });

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingBottom: bottomPad, height: TAB_BAR_HEIGHT + bottomPad, transform: [{ translateY }] },
      ]}
    >
      {state.routes.map((route, index) => {
        const isFocused = state.index === index;
        const cfg = TAB_CONFIG.find((t) => t.name === route.name);
        if (!cfg) return null;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        const activeColor = theme.primary;

        return (
          <TouchableOpacity key={route.key} onPress={onPress} activeOpacity={0.7} style={styles.tab}>
            <Ionicons
              name={isFocused ? cfg.icon : cfg.iconOutline}
              size={18}
              color={isFocused ? activeColor : colors.textSecondary}
            />
            <Text style={[styles.label, { color: isFocused ? activeColor : colors.textSecondary }]}>
              {cfg.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0.5,
    borderTopColor: '#E5E7EB',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 16,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    gap: 3,
    position: 'relative',
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
