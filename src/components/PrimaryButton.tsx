// =============================================================================
// PrimaryButton — THE filled call-to-action (Oct-10-26; was GradientButton).
//
// A SOLID fill, no shadow, no gradient: the user's call for a brand product — a
// gradient button "is not at all looks good", and a shadow claims a button
// floats when it sits in the page (elevation ladder). The floating + (FAB) keeps
// its own gradient + shadow (user's call).
//
// `tone`: 'primary' (theme.primary) or 'danger' (destructive). `color` overrides
// the fill for a meaning-carrying button (lent/borrowed). Whatever the fill, it
// is darkened until WHITE text on it reads ≥4.5:1 — the theme's own primary
// already does on Violet; this is what keeps a light accent legible.
// Disabled = flat grey fill + grey ink (ui-consistency §3d-i).
//
// `variant="outline"` is the SECONDARY beside a filled one (button hierarchy: one
// filled per group) — same height/radius/type, border + ink in the measured colour.
// =============================================================================
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { colors, radius, readableOn, spacing, typography as typographyBase, BUTTON_H } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { titleCaseLabel } from '../utils/format';

const typography = typographyBase as unknown as Record<string, TextStyle>;

export interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'danger';
  variant?: 'filled' | 'outline';
  /** Fill override for a button whose colour carries meaning (e.g. lent / borrowed). */
  color?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export default function PrimaryButton({
  title, onPress, loading, disabled, tone = 'primary', variant = 'filled', color, icon, style, textStyle, accessibilityLabel,
}: PrimaryButtonProps) {
  const theme = useTheme();
  const base = color || (tone === 'danger' ? colors.danger : theme.primary);
  const outline = variant === 'outline';
  const fill = outline ? colors.card : disabled ? theme.disabledBackground : readableOn('#FFFFFF', base);
  const ink = disabled ? theme.disabledText : outline ? readableOn(colors.card, base) : '#FFFFFF';
  const frame = outline ? { borderWidth: 1.5, borderColor: disabled ? theme.disabledBackground : ink } : null;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      accessibilityLabel={accessibilityLabel}
      style={[styles.btn, { backgroundColor: fill }, frame, style]}
    >
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {icon}
          <Text style={[styles.text, { color: ink }, textStyle]}>{titleCaseLabel(title)}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // The app's ONE button height. Padding stays small and `minHeight` does the
    // work, so this cannot drift from a hand-rolled button beside it — matching
    // paddings does not match heights once a border or a font size differs.
    minHeight: BUTTON_H,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  text: { ...typography.bodyBold, fontWeight: '700' },
});
