import React, { createContext, useContext, useRef, useCallback } from 'react';
import { Animated } from 'react-native';

export const TAB_BAR_HEIGHT = 62;

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
