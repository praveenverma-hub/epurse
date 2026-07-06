// =============================================================================
// EmptyState — shared, consistent no-data / fresh-onboarding placeholder.
//
// Two visual modes (both flat — never a boxed card):
//   • full (default) — fills its parent and centres vertically + horizontally.
//                      Use for a whole-screen / whole-tab empty (put it in a
//                      flex:1 view, or a list whose contentContainer has flexGrow:1).
//   • compact        — smaller, no flex, centred horizontally. Use INSIDE an
//                      existing section/card (e.g. an Analytics section).
//
// Optional CTA button (actionLabel + onAction) tinted with the active theme —
// the single, consistent empty-state button style across the app.
// =============================================================================

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography } from '../constants/theme';
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
  title?: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Transparent, no card chrome — for use inside an existing card. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  emoji,
  title,
  subtitle,
  actionLabel,
  onAction,
  compact = false,
  style,
}) => {
  const theme = useTheme();
  const glyph = icon ? null : (emoji ?? '📭');

  return (
    <View style={[compact ? styles.compact : styles.full, style]}>
      {icon ? (
        <Ionicons name={icon} size={compact ? 30 : 42} color={theme.textMuted} />
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
  btn: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  btnText: {
    ...typography.bodyBold,
    color: '#fff',
    fontWeight: '800' as const,
  },
});
