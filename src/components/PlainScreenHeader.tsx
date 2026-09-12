// =============================================================================
// PlainScreenHeader — the ONE header for a pushed (non-gradient) screen.
//
// ui-consistency §2 sends every themed GRADIENT header through
// CollapsingHeaderScreen, but the plain white "pushed screen" bar had no owner,
// so five screens hand-rolled it — and they had already drifted: Settings /
// Categories / SpendRules / Backup used an h2 title with a 16pt gutter and no
// edge, while LbPerson used h3 with a 12pt gutter, a card fill and a hairline.
// Same affordance, three looks. This component is the canonical one.
//
// LAYOUT RULE: both side slots are exactly 40pt wide, so the flexed title is
// centred on the SCREEN, not on whatever is left over. A trailing action
// therefore has to occupy the same 40pt slot the spacer would have — which is
// why `right` replaces the spacer instead of being appended after it.
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, typography as typographyBase } from '../constants/theme';

// The JS theme widens fontWeight to `string` (see ui-consistency §1).
const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Width of each side slot. Exported so a caller's custom action can match it. */
export const HEADER_SLOT = 40;

type Props = {
  title: string;
  /** Usually `() => navigation.goBack()`. Omit for a root/modal screen with no back. */
  onBack?: () => void;
  /**
   * Trailing 40pt slot — a gear, an add button. Takes the place of the layout
   * spacer so it costs no extra width and the title stays truly centred.
   */
  right?: React.ReactNode;
  /**
   * Paint a card fill + bottom hairline. For a screen whose body is the page
   * gray and needs the bar visually separated from it (LbPerson's ledger list).
   * Default is flat — the bar shares the screen's background.
   */
  bordered?: boolean;
  /**
   * Override the `bordered` fill/hairline with theme colours (`theme.card` /
   * `theme.divider`) instead of the static default — for a theme-adaptive
   * screen, where the static colour would ignore dark mode. No effect
   * without `bordered`.
   */
  surfaceColor?: string;
  dividerColor?: string;
  /**
   * Suppress `bordered`'s hairline while keeping its fill — for a screen that
   * renders its own content (e.g. a subtitle line) directly below the header
   * and wants the ONE dividing hairline to sit under THAT instead, rather than
   * between the title row and the subtitle. No effect without `bordered`.
   * Default true (the hairline `bordered` has always drawn).
   */
  hairline?: boolean;
  /** Tint for the back chevron. Defaults to the static ink (light bar). */
  tint?: string;
  /** Colour for the title. Defaults to the static ink. */
  titleColor?: string;
  style?: StyleProp<ViewStyle>;
};

const PlainScreenHeader = ({
  title, onBack, right, bordered = false, surfaceColor, dividerColor, hairline = true, tint, titleColor, style,
}: Props) => (
  <View
    style={[
      styles.header,
      bordered && styles.bordered,
      bordered && surfaceColor ? { backgroundColor: surfaceColor } : null,
      bordered && dividerColor ? { borderBottomColor: dividerColor } : null,
      bordered && !hairline ? { borderBottomWidth: 0 } : null,
      style,
    ]}
  >
    {onBack ? (
      <TouchableOpacity
        onPress={onBack}
        hitSlop={10}
        style={styles.slot}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color={tint || colors.textPrimary} />
      </TouchableOpacity>
    ) : (
      <View style={styles.slot} />
    )}

    <Text
      style={[styles.title, titleColor ? { color: titleColor } : null]}
      numberOfLines={1}
    >
      {title}
    </Text>

    {right ?? <View style={styles.slot} />}
  </View>
);

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  bordered: {
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  slot: {
    width: HEADER_SLOT,
    height: HEADER_SLOT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1, textAlign: 'center' },
});

export default PlainScreenHeader;
