// The app's ONE accordion motion: the next layout change (a section opening or closing)
// eases instead of jumping. Shared by FaqAccordion and LbEntryForm's collapsible form.
import { LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const animateNextLayout = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
