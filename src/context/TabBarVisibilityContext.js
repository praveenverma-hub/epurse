import React, { createContext, useContext, useRef, useCallback } from 'react';
import { Animated } from 'react-native';

export const TAB_BAR_HEIGHT = 62;

/**
 * Bottom padding a scrolling tab screen needs so its last row clears the bar.
 *
 * The bar is `position: absolute`, so content flows under it and every tab screen
 * has to pay this itself. They each guessed instead, and the guesses disagreed:
 * `TAB_BAR_HEIGHT + 24` (Budget), a bare `spacing.xxl * 2` = 64 (Transactions),
 * `TAB_BAR_HEIGHT + 40` (Accounts), and — the actual bug — `spacing.lg` = 16 on
 * AnalyticsScreen, which put the last section of Insights → Analytics BEHIND the
 * bar. Nothing linked any of them to the bar's real height.
 *
 * The bar occupies `TAB_BAR_HEIGHT + max(insets.bottom, 8)` — that `max` mirrors
 * `bottomPad` in AnimatedTabBar and is the part a hand-picked constant can't
 * know, because it varies by device. Everything after it is breathing room, so a
 * row doesn't end flush against the chrome.
 *
 * Screens with a FAB need MORE than this — the FAB sits above the bar. Add its
 * allowance on top rather than inflating this, or the four screens without one
 * inherit a gap they don't need.
 */
export const tabBarClearance = (insetBottom = 0) =>
  TAB_BAR_HEIGHT + Math.max(insetBottom, 8) + 16;

const TabBarVisibilityContext = createContext({
  tabBarAnim: null,
  hideTabBar: () => {},
  showTabBar: () => {},
});

export const TabBarVisibilityProvider = ({ children }) => {
  const tabBarAnim = useRef(new Animated.Value(0)).current;
  const isHidden = useRef(false);

  const hideTabBar = useCallback(() => {
    if (isHidden.current) return;
    isHidden.current = true;
    Animated.timing(tabBarAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [tabBarAnim]);

  const showTabBar = useCallback(() => {
    if (!isHidden.current) return;
    isHidden.current = false;
    Animated.timing(tabBarAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [tabBarAnim]);

  return (
    <TabBarVisibilityContext.Provider value={{ tabBarAnim, hideTabBar, showTabBar }}>
      {children}
    </TabBarVisibilityContext.Provider>
  );
};

export const useTabBarVisibility = () => useContext(TabBarVisibilityContext);
