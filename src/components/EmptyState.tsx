// =============================================================================
// EmptyState — shared, consistent no-data / fresh-onboarding placeholder.
//
// Two visual modes:
//   • card (default) — standalone rounded card with shadow. Use on screen body.
//   • compact        — transparent, no card/shadow. Use INSIDE an existing card
//                      (e.g. an Analytics section that is already a card).
//
// Optional CTA button (actionLabel + onAction) tinted with the active theme.
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

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';

interface EmptyStateProps {
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
  emoji = '📭',
  title,
  subtitle,
  actionLabel,
  onAction,
  compact = false,
  style,
}) => {
  const theme = useTheme();

  return (
    <View style={[compact ? styles.compact : styles.card, style]}>
      {emoji ? (
        <Text style={[styles.emoji, compact && styles.emojiCompact]}>{emoji}</Text>
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    ...shadows.card,
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
