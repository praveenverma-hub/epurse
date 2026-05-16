import { useRef } from 'react';
import { useTabBarVisibility } from '../context/TabBarVisibilityContext';

/**
 * Wire this to a ScrollView / FlatList to get Swiggy-style hide-on-scroll:
 *   const scrollProps = useTabBarScroll();
 *   <ScrollView {...scrollProps} ...>
 */
export const useTabBarScroll = () => {
  const { hideTabBar, showTabBar } = useTabBarVisibility();
  const lastScrollY = useRef(0);

  const onScroll = (event) => {
    const currentY = event.nativeEvent.contentOffset.y;
    const diff = currentY - lastScrollY.current;
    if (diff > 8 && currentY > 60) {
      hideTabBar();
    } else if (diff < -8 || currentY < 60) {
      showTabBar();
    }
    lastScrollY.current = currentY;
  };

  return { onScroll, scrollEventThrottle: 16 };
};
