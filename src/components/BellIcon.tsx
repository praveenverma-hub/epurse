// =============================================================================
// BellIcon.tsx — notification bell for the dashboard header.
// White line-art bell, always. Adds a small color dot badge when hasUnread.
// 42×42 hit area to mirror avatarBtn / vaultBtn footprint.
// =============================================================================

import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface BellIconProps {
  hasUnread:           boolean;
  onPress:             () => void;
  /** Glyph size in px. Defaults to 22 to mirror the avatar glyph weight. */
  size?:               number;
  /** Bell stroke color. Defaults to solid white. */
  iconColor?:          string;
  /** Unread-badge dot color. Defaults to red. */
  dotColor?:           string;
  containerStyle?:     ViewStyle;
  accessibilityLabel?: string;
}

const DEFAULT_ICON = '#FFFFFF';
const DEFAULT_DOT  = '#EF4444';

const BellIcon: React.FC<BellIconProps> = ({
  hasUnread,
  onPress,
  size               = 22,
  iconColor          = DEFAULT_ICON,
  dotColor           = DEFAULT_DOT,
  containerStyle,
  accessibilityLabel = 'Notifications',
}) => (
  <Pressable
    onPress={onPress}
    hitSlop={8}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    style={({ pressed }) => [
      styles.btn,
      containerStyle,
      pressed && styles.btnPressed,
    ]}
  >
    <Ionicons name="notifications-outline" size={size} color={iconColor} />
    {hasUnread && (
      <View
        style={[styles.dot, { backgroundColor: dotColor }]}
        accessibilityElementsHidden
      />
    )}
  </Pressable>
);

const styles = StyleSheet.create({
  btn: {
    width:           42,
    height:          42,
    borderRadius:    21,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: '#FFFFFF14',
    borderWidth:     1,
    borderColor:     '#FFFFFF22',
  },
  btnPressed: { opacity: 0.7 },
  dot: {
    position:     'absolute',
    top:          8,
    right:        9,
    width:        9,
    height:       9,
    borderRadius: 5,
    borderWidth:  1.5,
    borderColor:  '#FFFFFF',
  },
});

export default BellIcon;
