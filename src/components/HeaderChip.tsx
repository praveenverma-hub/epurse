// =============================================================================
// HeaderChip — the circular control in a themed gradient header.
//
// There were three of these on the Dashboard with three different treatments: the
// bell (42pt circle, 8% fill, 1pt border), the avatar (42pt circle but 13% fill
// and a 1.5pt border) and the vault (same fill as the bell, but a rounded RECT
// with its own padding, so it was both a different shape and the tallest thing in
// the row). Three shapes inside ~130pt of chrome read as three unrelated widgets.
//
// One component owns the shape, the fill, the tap target and the corner badge, so
// the row reads as one set and a fourth control can't invent a fourth look.
//
// The BADGE is the interesting part: it's an opaque shape on a gradient, and no
// flat colour clears the 3:1 graphical bar on every accent — see
// `badgeOnGradient`, which picks white-or-near-black per theme. The level badge
// used to be a hardcoded violet that measured 1.02:1 on Platinum.
// =============================================================================

import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { badgeOnGradient, typography as typographyBase } from '../constants/theme';
import { useGradient } from '../hooks/useTheme';
import type { TextStyle } from 'react-native';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Diameter. Matches the 44pt tap-target minimum once hitSlop is added. */
export const CHIP_SIZE = 42;

export interface HeaderChipProps {
  onPress: () => void;
  onLongPress?: () => void;
  /** Required: these are icon-only controls, so the label IS the affordance. */
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Small counter pinned bottom-right — a level, a streak day. */
  badge?: string | number;
  /** Extra overlay (BellIcon's unread dot). Not clipped. */
  overlay?: ReactNode;
  style?: ViewStyle;
  children: ReactNode;
}

const HeaderChip: React.FC<HeaderChipProps> = ({
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  badge,
  overlay,
  style,
  children,
}) => {
  // Badge colours follow the ACTIVE gradient, not the accent — the badge sits on
  // the header, so the header is what it has to be legible against.
  const gradient = useGradient();
  const { fill, ink } = badgeOnGradient(gradient);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      // 42 + 2 either side = the 44pt platform minimum. The chips sit in a 10pt
      // gap, so 2 is well inside half the gap and neighbouring targets can't
      // overlap (ui-consistency §8).
      hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [styles.chip, style, pressed && styles.pressed]}
    >
      {children}
      {overlay}
      {badge !== undefined && badge !== null && badge !== '' && (
        <View
          style={[styles.badge, { backgroundColor: fill, borderColor: fill }]}
          // The number is already in the chip's accessibilityLabel, spelled out
          // ("Level 5", "3 day streak"), so announcing a bare "5" adds noise.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[styles.badgeText, { color: ink }]} numberOfLines={1}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
};

export default HeaderChip;

const styles = StyleSheet.create({
  chip: {
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: CHIP_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF14',
    borderWidth: 1,
    borderColor: '#FFFFFF2E',
    // Badges and dots straddle the edge; never clip them.
    overflow: 'visible',
  },
  pressed: { opacity: 0.7 },
  badge: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    // A ring in the badge's own fill separates it from whatever it overlaps.
    borderWidth: 1.5,
  },
  badgeText: {
    ...typography.tiny,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
});
