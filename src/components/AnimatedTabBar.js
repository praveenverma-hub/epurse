// =============================================================================
// AnimatedTabBar — the bottom tab bar.
//
// Behaviour:
//   • Outlined icons at rest, filled + accent-derived ink when selected.
//   • Slides down and hides on scroll-down; snaps back on scroll-up.
//   • ALWAYS reveals itself on a tab change (see the effect below) — the hidden
//     state is global, and it slides fully off-screen, so a tab left hidden is
//     untappable and therefore unrecoverable.
//   • `onCenterPress` → an Add button in the middle, level with the tabs: the FAB's
//     gradient circle and white "+" — used when the Accounts tab is off, so four
//     tabs + one Add. No corner frame: that's the scan-to-pay mark in UPI apps.
//   • Position is absolute so page content flows under it. Screens must pay
//     `tabBarClearance(insets.bottom)` as bottom padding — NOT a hand-picked
//     number; see the helper's comment for why three screens each guessed
//     differently and one of them guessed short.
//
// SURFACE: the bar paints from the THEME (`card` / `textPrimary`), not from
// hardcoded hex. It used to be `#FFFFFF` + `#E5E7EB`, which is identical in
// light mode and would have been the one piece of chrome left white when dark
// mode ships. Its top hairline is DERIVED from the ink rather than taken from
// `divider`, because `divider` is tuned to separate rows INSIDE a card — here
// the two surfaces being separated are the bar and a white card scrolling under
// it, which are the same colour. That derivation is now `chromeHairline`, shared
// with the collapsing header's bottom edge: since Aug-30 a pinned header IS this
// same surface (card + hairline + elevation), so the two must match.
//
// ACTIVE INK: never the raw accent. `theme.primary` on this surface measures
// 3.12:1 on Sunset and 1.31:1 on Carbon, so on four of the five accents the
// SELECTED tab was harder to read than the unselected ones (`textSecondary` is
// 4.83:1). Same bug the period selector had; same fix.
// =============================================================================

import React, { useEffect, useMemo } from 'react';
import { View, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { FixedTextScale, Text } from './AppText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useTabBarVisibility, TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
import { useGradient, useTheme } from '../hooks/useTheme';
import PlusGlyph from './PlusGlyph';
import { chromeHairline, readableOn, shadows } from '../constants/theme';

/**
 * Was 18, which is undersized next to a 10px label in a 62pt bar — the platform
 * norm for a tab glyph is 22–24. 22 + 3 gap + ~13 label + 10 padTop = 48, still
 * inside the 62pt content box.
 */
const ICON_SIZE = 22;

const TAB_CONFIG = [
  { name: 'Dashboard',    label: 'Home',     icon: 'home',           iconOutline: 'home-outline' },
  { name: 'Transactions', label: 'Activity', icon: 'receipt',        iconOutline: 'receipt-outline' },
  { name: 'Groups',       label: 'Groups',   icon: 'people',         iconOutline: 'people-outline' },
  { name: 'Insights',     label: 'Insights', icon: 'bar-chart',      iconOutline: 'bar-chart-outline' },
  { name: 'Accounts',     label: 'Accounts', icon: 'card',           iconOutline: 'card-outline' },
];

const CENTER_SIZE = 54;

export default function AnimatedTabBar({ state, navigation, onCenterPress }) {
  const insets = useSafeAreaInsets();
  const theme  = useTheme();
  const gradient = useGradient();
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

  // One ink for the icon AND the label. The label is 10px, so it takes the
  // stricter 4.5 bar and the icon inherits it — two shades of the same accent
  // sitting 3pt apart would read as a rendering fault, not as a hierarchy.
  const activeColor = useMemo(
    () => readableOn(theme.card, theme.primary),
    [theme.card, theme.primary],
  );
  // Shared with the pinned header's bottom edge (`chromeHairline`) — both are
  // card-coloured strips that cards scroll under, and they must not drift apart.
  const hairline = useMemo(() => chromeHairline(theme.card, theme), [theme]);

  // Fixed height bar: labels don't grow with the OS font size.
  return (
    <FixedTextScale>
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: theme.card,
          borderTopColor: hairline,
          paddingBottom: bottomPad,
          height: TAB_BAR_HEIGHT + bottomPad,
          transform: [{ translateY }],
        },
      ]}
    >
      {state.routes.flatMap((route, index) => {
        const isFocused = state.index === index;
        const cfg = TAB_CONFIG.find((t) => t.name === route.name);
        if (!cfg) return [];

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        const ink = isFocused ? activeColor : theme.textSecondary;

        const tab = (
          <TouchableOpacity key={route.key} onPress={onPress} activeOpacity={0.7} style={styles.tab}>
            <Ionicons name={isFocused ? cfg.icon : cfg.iconOutline} size={ICON_SIZE} color={ink} />
            <Text style={[styles.label, { color: ink }]}>{cfg.label}</Text>
          </TouchableOpacity>
        );
        if (!onCenterPress || index !== Math.floor(state.routes.length / 2) - 1) return [tab];
        return [tab, (
          <View key="center-add" style={styles.centerSlot}>
            <TouchableOpacity
              onPress={onCenterPress}
              activeOpacity={0.85}
              style={[styles.centerShadow, { shadowColor: theme.primary }]}
              accessibilityRole="button"
              accessibilityLabel="Add Transaction"
            >
              <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.center}>
                <PlusGlyph size={30} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )];
      })}
    </Animated.View>
    </FixedTextScale>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderTopWidth: 0.5,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Hairline AND shadow, deliberately: content scrolls UNDER the bar, and a white
    // card passing beneath a white bar is separated by nothing else. The
    // elevation was 16 — Android's depth for a dialog — brought to the 8 the
    // platform specs for a bottom bar.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
    gap: 3,
    position: 'relative',
  },
  // Centred on the whole bar (no tab paddingTop) — the circle is the bar's tallest item.
  centerSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerShadow: {
    borderRadius: CENTER_SIZE / 2,
    ...shadows.fab,
  },
  center: {
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
});
