// =============================================================================
// NavListRow — the ONE "tap to go somewhere" row.
//
// icon · label (+ hint) · optional badge · chevron. Settings had this shape
// hand-rolled (four style keys and a text "›"), and the new Profile hub needed
// the same row a size up, which is exactly the case the shared-component rule
// covers: one component, extended along a NAMED axis (`variant`), never a
// special case per caller.
//
// The chevron is an Ionicon, not a text "›" — a glyph rendered from the font
// stack varies in weight and baseline per platform, and can't take a tint
// (icons rule). Colours come from useTheme() so the row is correct on both the
// static light screens (Settings) and the theme-adaptive ones (Profile, Shop).
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import {
  colors, radius, spacing, mix, withAlpha, readableOn,
  typography as typographyBase,
} from '../constants/theme';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Alpha of the tinted icon tile behind a `variant="tile"` glyph. */
export const TILE_FILL_ALPHA = 0.12;

type Props = {
  /** Reuse the destination's canonical icon (ui-consistency §5). */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** One line saying what's behind the row. Truncates rather than wrapping. */
  hint?: string;
  onPress?: () => void;
  /**
   * 'plain' — bare glyph in a fixed 22pt slot. A dense settings list.
   * 'tile'  — glyph on a tinted rounded square. A short hub list where each row
   *           is a destination in its own right and needs to be scannable.
   */
  variant?: 'plain' | 'tile';
  /** Hairline above the row. For rows stacked inside one card. */
  divided?: boolean;
  /** Icon ink. Defaults to the theme accent. */
  tint?: string;
  /** Small neutral pill before the chevron — a count, a "SOON". */
  badge?: string;
  /** Extra trailing content, before the chevron. */
  right?: React.ReactNode;
  /** Set false for a row that toggles/acts in place rather than navigating. */
  chevron?: boolean;
  /** `warn` paints the hint in the warning colour — an exclusion the user should see. */
  hintTone?: 'default' | 'warn';
  style?: StyleProp<ViewStyle>;
};

const NavListRow = ({
  icon,
  label,
  hint,
  onPress,
  variant = 'plain',
  divided = false,
  tint,
  badge,
  right,
  chevron = true,
  hintTone = 'default',
  style,
}: Props) => {
  const theme = useTheme();
  const accent = tint || theme.primary;
  const tile = variant === 'tile';

  // The glyph and the badge text sit on an accent-tinted fill, NOT on the card,
  // and that fill lifts the surface toward the ink. Measuring against `card`
  // read 3.12:1 on Orange while the tile itself was 2.71:1 — the wrong pair.
  const tintedSurface = mix(accent, TILE_FILL_ALPHA, theme.card);

  return (
    <TouchableOpacity
      style={[
        styles.row,
        tile && styles.rowTile,
        divided && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider },
        style,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
    >
      {tile ? (
        <View style={[styles.tile, { backgroundColor: withAlpha(accent, TILE_FILL_ALPHA) }]}>
          <Ionicons name={icon} size={20} color={readableOn(tintedSurface, accent, 3)} />
        </View>
      ) : (
        <Ionicons name={icon} size={18} color={accent} style={styles.glyph} />
      )}

      {/* flex:1 + numberOfLines so a long label can't push the chevron off-row
          (input-validation skill's overflow rule). */}
      <View style={styles.textWrap}>
        <Text style={[styles.label, tile && styles.labelTile, { color: theme.textPrimary }]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text
            style={[
              styles.hint,
              { color: hintTone === 'warn' ? colors.warning : theme.textSecondary },
              hintTone === 'warn' && styles.hintWarn,
            ]}
            numberOfLines={1}
          >
            {hint}
          </Text>
        ) : null}
      </View>

      {badge ? (
        <View style={[styles.badge, { backgroundColor: withAlpha(accent, TILE_FILL_ALPHA) }]}>
          <Text style={[styles.badgeText, { color: readableOn(tintedSurface, accent, 4.5) }]} numberOfLines={1}>
            {badge}
          </Text>
        </View>
      ) : null}

      {right}

      {chevron && onPress ? (
        <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  // A hub row is a destination, not a line item — it gets the taller box.
  rowTile: { paddingVertical: spacing.md },
  // Fixed-width slot so every label starts at the same x whatever the glyph (§5).
  glyph: { width: 22, textAlign: 'center' },
  tile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: { flex: 1 },
  label: { ...typography.body, fontWeight: '600' },
  labelTile: { ...typography.bodyBold },
  hint: { ...typography.tiny, marginTop: 1 },
  hintWarn: { fontWeight: '700' },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    maxWidth: '40%',
  },
  badgeText: { ...typography.tiny, fontWeight: '800', letterSpacing: 0.4 },
});

export default NavListRow;
