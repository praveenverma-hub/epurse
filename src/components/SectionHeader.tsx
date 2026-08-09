// =============================================================================
// SectionHeader — the ONE header for a content card / section.
//
// Every card gets the same three parts in the same order: a canonical Ionicon,
// the h3 title, and a subtitle saying what the card answers. Before this, the
// Analytics cards were split into two shapes — five with an emoji + subtitle,
// three with a bare title and nothing else — which read as two different screens
// stacked together.
//
// The icon is CHROME, so it's Ionicons, never emoji (ui-consistency §5): emoji
// render at the OS's mercy, differ per platform and version, carry inconsistent
// optical weight beside text, and can't take the theme accent. An entity's OWN
// emoji (a category's, a group's) is DATA and stays emoji — that rule is not
// what this component is for.
//
// `onInfo` is optional on purpose: a "learn more" affordance is content, not
// decoration. Cards with a genuine explanation get one; the rest don't, rather
// than every card sprouting an icon that opens nothing.
// =============================================================================
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import InfoIcon from './InfoIcon';
import { colors, spacing, typography as typographyBase } from '../constants/theme';
import type { TextStyle } from 'react-native';

// The JS theme widens fontWeight to `string`; cast so spreading typography.* is
// assignable to TextStyle (see ui-consistency §1).
const typography = typographyBase as unknown as Record<string, TextStyle>;

type Props = {
  /** Ionicons name. Reuse the type's canonical icon (ui-consistency §5). */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /**
   * Usually a string. A ReactNode is allowed for the one real case in the app —
   * a title carrying a differently-styled inline count ("Transactions (12)") —
   * so that screen can share this component instead of keeping its own copy.
   * Pass `a11yTitle` alongside it when `onInfo` is set.
   */
  title: React.ReactNode;
  /** Plain-text title for accessibility when `title` is a node. */
  a11yTitle?: string;
  /** What question this card answers. Every card should be able to state one. */
  subtitle?: string;
  /** Tint for the icon. Pass `theme.primary` on themed screens. */
  accentColor?: string;
  /** Renders the shared InfoIcon on the right when provided. */
  onInfo?: () => void;
  /**
   * Trailing slot on the header row — a "View all" link, a count badge, a
   * filter control. The component owns the LAYOUT of a section header; it does
   * not try to know every possible action, which is what kept five screens
   * hand-rolling their own row before this existed.
   */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const SectionHeader = ({
  icon, title, a11yTitle, subtitle, accentColor, onInfo, right, style,
}: Props) => (
  <View style={style}>
    <View style={styles.row}>
      <Ionicons name={icon} size={17} color={accentColor || colors.textSecondary} style={styles.icon} />
      {/* flex + numberOfLines so a long title can't push the trailing slot off-row. */}
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {onInfo ? (
        <TouchableOpacity
          onPress={onInfo}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`About ${a11yTitle ?? (typeof title === 'string' ? title : 'this section')}`}
        >
          <InfoIcon size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ) : null}
      {right}
    </View>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Fixed-width slot so every title starts at the same x whatever the glyph (§5).
  icon: { width: 20, textAlign: 'center' },
  title: { ...typography.h3, color: colors.textPrimary, flex: 1 },
  subtitle: {
    ...typography.small,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 2,
    marginBottom: spacing.md,
  },
});

export default SectionHeader;
