// =============================================================================
// BellIcon.tsx — notification bell for the dashboard header.
// White line-art bell, always. Adds a small color dot badge when hasUnread.
//
// The chip itself is `HeaderChip` (Aug-26): this file used to own a copy of the
// 42pt circle + fill + border, and its comment said the numbers existed "to
// mirror avatarBtn / vaultBtn" — which is the tell that three files were keeping
// one look in sync by hand. The dot stays here; it's this control's own state.
// =============================================================================

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import HeaderChip from './HeaderChip';

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
  <HeaderChip
    onPress={onPress}
    accessibilityLabel={hasUnread ? `${accessibilityLabel}, unread` : accessibilityLabel}
    style={containerStyle}
    overlay={hasUnread ? (
      <View
        style={[styles.dot, { backgroundColor: dotColor }]}
        accessibilityElementsHidden
      />
    ) : null}
  >
    <Ionicons name="notifications-outline" size={size} color={iconColor} />
  </HeaderChip>
);

const styles = StyleSheet.create({
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
