import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useTabBarVisibility } from '../context/TabBarVisibilityContext';

/**
 * Wire this to a ScrollView / FlatList to get Swiggy-style hide-on-scroll:
 *   const scrollProps = useTabBarScroll();
 *   <ScrollView {...scrollProps} ...>
 *
 * Hidden-ness is GLOBAL (one ref in TabBarVisibilityContext) while `lastScrollY` is
 * per-screen, so the two can fall out of step. Two safeguards keep the bar from
 * getting stranded off-screen — where it can't be tapped, so nothing can recover it:
 *   • here — reveal + re-baseline whenever the screen regains focus;
 *   • in `AnimatedTabBar` — reveal on every tab change, which also covers the screens
 *     that don't use this hook at all.
 */
export const useTabBarScroll = () => {
  const { hideTabBar, showTabBar } = useTabBarVisibility();
  const lastScrollY = useRef(0);

  useFocusEffect(
    useCallback(() => {
      // Coming back from a pushed screen, `lastScrollY` still holds the offset from
      // before we left. Without re-baselining, the first scroll event computes its
      // delta against a stale value and can hide the bar from a standing start.
      lastScrollY.current = 0;
      showTabBar();
    }, [showTabBar]),
  );

  const onScroll = useCallback(
    (event) => {
      const currentY = event.nativeEvent.contentOffset.y;
      const diff = currentY - lastScrollY.current;
      if (diff > 8 && currentY > 60) {
        hideTabBar();
      } else if (diff < -8 || currentY < 60) {
        showTabBar();
      }
      lastScrollY.current = currentY;
    },
    [hideTabBar, showTabBar],
  );

  return { onScroll, scrollEventThrottle: 16 };
};
