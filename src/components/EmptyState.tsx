// =============================================================================
// EmptyState — shared, consistent no-data / fresh-onboarding placeholder.
//
// Two visual modes (both flat — never a boxed card):
//   • full (default) — fills its parent and centres vertically + horizontally.
//                      Use for a whole-screen / whole-tab empty (put it in a
//                      flex:1 view, or a list whose contentContainer has flexGrow:1).
//   • compact        — smaller, no flex, centred horizontally. Use INSIDE an
//                      existing section/card (e.g. an Analytics section).
//   • inline         — a ROW shaped like the list it sits in: TransactionItem's muted
//                      card (flat, bordered, 44pt rounded tile, 15/600 title). For an
//                      empty that sits ABOVE other rows instead of replacing them
//                      (Home's new month, above last month's).
//
// Optional CTA button (actionLabel + onAction) tinted with the active theme —
// the single, consistent empty-state button style across the app.
// =============================================================================

import React from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Text } from './AppText';
import { Ionicons } from '@expo/vector-icons';

import { colors, mix, radius, readableOn, spacing, typography, BUTTON_H } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';

interface EmptyStateProps {
  /**
   * Expo (Ionicons) glyph — PREFERRED. Reuse the type's canonical icon so empties
   * match the rest of the app (e.g. groups → 'people-outline', accounts →
   * 'card-outline', transactions → 'receipt-outline', analytics → 'bar-chart-outline').
   */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Fallback pictograph when no themed icon fits. `icon` wins if both are set. */
  emoji?: string;
  /** Overrides the default glyph size (42 full / 30 compact) for a hero empty. */
  iconSize?: number;
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Transparent, no card chrome — for use inside an existing card. */
  compact?: boolean;
  /** One left-aligned row; `icon` only (no emoji, no CTA). See the header. */
  inline?: boolean;
  style?: StyleProp<ViewStyle>;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  emoji,
  iconSize,
  title,
  subtitle,
  actionLabel,
  onAction,
  compact = false,
  inline = false,
  style,
}) => {
  const theme = useTheme();
  const glyph = icon ? null : (emoji ?? '📭');

  if (inline) {
    // Greyed throughout — it's a blank state. ONE grey for both lines: the lightest that still
    // reads (≈4.8:1 vs 15.6 for body text); a lighter one fails AA, so size/weight split them.
    const tile = mix(theme.textMuted, 0.14, theme.background);
    const ink = readableOn(theme.background, theme.textSecondary);
    return (
      <View style={[styles.inline, { backgroundColor: theme.background, borderColor: theme.divider }, style]}>
        {icon ? (
          <View style={[styles.inlineTile, { backgroundColor: tile }]}>
            <Ionicons name={icon} size={iconSize ?? 20} color={readableOn(tile, theme.textMuted, 3)} />
          </View>
        ) : null}
        <View style={styles.inlineCopy}>
          {title ? <Text style={[styles.inlineTitle, { color: ink }]} numberOfLines={1}>{title}</Text> : null}
          {subtitle ? <Text style={[styles.inlineSubtitle, { color: ink }]} numberOfLines={2}>{subtitle}</Text> : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[compact ? styles.compact : styles.full, style]}>
      {icon ? (
        <Ionicons name={icon} size={iconSize ?? (compact ? 30 : 42)} color={theme.textMuted} />
      ) : glyph ? (
        <Text style={[styles.emoji, compact && styles.emojiCompact]}>{glyph}</Text>
      ) : null}
      {title ? (
        <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      ) : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: theme.primary }]}
          onPress={onAction}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

export default EmptyState;

const styles = StyleSheet.create({
  // Full-screen: flat (no card chrome), fills parent, centres both axes.
  full: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  compact: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  // Mirrors TransactionItem's `card` + `cardMuted` + CategoryIcon, so it reads as a row of that list.
  inline: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, marginBottom: spacing.md,
  },
  inlineTile: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  inlineCopy: { flex: 1 },
  inlineTitle: { fontSize: 15, fontWeight: '500' as const },
  inlineSubtitle: { fontSize: 13, fontWeight: '400' as const, marginTop: 2 },
  emoji: { fontSize: 44 },
  emojiCompact: { fontSize: 32 },
  title: {
    ...typography.h3,
    fontWeight: '600' as const,
    color: colors.textPrimary,
    textAlign: 'center' as const,
    marginTop: spacing.sm,
  },
  titleCompact: { ...typography.bodyBold, fontWeight: '700' as const },
  subtitle: {
    ...typography.small,
    fontWeight: '400' as const,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginTop: spacing.xs,
    lineHeight: 18,
    maxWidth: 300,
  },
  // Same height + type as PrimaryButton (auto-width here).
  btn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xs,
    minHeight: BUTTON_H,
    justifyContent: 'center',
    borderRadius: radius.lg,
  },
  btnText: {
    ...typography.bodyBold,
    color: '#fff',
    fontWeight: '700' as const,
  },
});
