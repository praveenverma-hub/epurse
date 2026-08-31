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
import { readableOn } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';

export interface BellIconProps {
  hasUnread:           boolean;
  onPress:             () => void;
  /** Glyph size in px. Defaults to 22 to mirror the avatar glyph weight. */
  size?:               number;
  /** Bell stroke color. Defaults to solid white (or the pinned ink when
   *  `onLight`). An explicit value always wins. */
  iconColor?:          string;
  /** The bell sits on the LIGHT pinned bar — forwarded to HeaderChip, and it
   *  flips the default stroke from white to the theme's own ink. */
  onLight?:            boolean;
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
  iconColor,
  dotColor           = DEFAULT_DOT,
  onLight            = false,
  containerStyle,
  accessibilityLabel = 'Notifications',
}) => (
  <HeaderChip
    onPress={onPress}
    onLight={onLight}
    accessibilityLabel={hasUnread ? `${accessibilityLabel}, unread` : accessibilityLabel}
    style={containerStyle}
    overlay={hasUnread ? (
      <View
        style={[styles.dot, { backgroundColor: dotColor }]}
        accessibilityElementsHidden
      />
    ) : null}
  >
    <BellGlyph size={size} color={iconColor} onLight={onLight} />
  </HeaderChip>
);

/** Split out so the stroke colour can read the theme (HeaderChip's own children
 *  are built by the caller, so the default cannot come from a prop default). */
const BellGlyph: React.FC<{ size: number; color?: string; onLight: boolean }> = ({ size, color, onLight }) => {
  const theme = useTheme();
  const ink = color ?? (onLight ? readableOn(theme.card, theme.textPrimary) : DEFAULT_ICON);
  return <Ionicons name="notifications-outline" size={size} color={ink} />;
};

const styles = StyleSheet.create({
  // The white ring separates the dot from whatever is behind the chip. On the
  // gradient that is the contrast it needs; on the pinned light bar it is that
  // bar's own colour, so it reads as spacing rather than a ring. (It would be
  // wrong on a dark-mode `card` — revisit when dark mode ships.)
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
