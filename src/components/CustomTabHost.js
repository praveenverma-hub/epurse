// =============================================================================
// CustomTabHost — reusable tabbed host for custom gradient headers + content.
//
// Props:
//   tabs: [{ key, label, component }]
//   activeTab: current tab key
//   onTabChange: (newKey) => void
//   headerComponent: ReactNode (optional, rendered above tabs)
//   headerGradient: [startColor, endColor]
//   theme: theme object
//   enableSwipe: bool (default true)
// =============================================================================

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { PanGestureHandler } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

export default function CustomTabHost({
  tabs,
  activeTab,
  onTabChange,
  headerComponent,
  enableSwipe = true,
  children, // direct content — use if not using standard header
}) {
  const currentIdx = tabs.findIndex((t) => t.key === activeTab);

  const handlePan = useCallback(async (evt) => {
    if (!enableSwipe) return;
    const { translationX } = evt.nativeEvent;
    const threshold = 50;

    if (translationX > threshold && currentIdx > 0) {
      onTabChange(tabs[currentIdx - 1].key);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } else if (translationX < -threshold && currentIdx < tabs.length - 1) {
      onTabChange(tabs[currentIdx + 1].key);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [currentIdx, tabs, onTabChange, enableSwipe]);

  return (
    <PanGestureHandler onEnded={handlePan}>
      <View style={{ flex: 1 }}>
        {headerComponent}
        {children || tabs[currentIdx]?.component}
      </View>
    </PanGestureHandler>
  );
}
