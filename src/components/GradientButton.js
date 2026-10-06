import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, spacing, typography, shadows, BUTTON_H } from '../constants/theme';
import { useGradient, useTheme } from '../hooks/useTheme';
import { titleCaseLabel } from '../utils/format';

const GradientButton = ({
  title,
  onPress,
  loading,
  disabled,
  colors: gColors,   // optional override (e.g. green/purple for lent/borrow)
  style,
  textStyle,
  icon,
  flat,   // no drop shadow — for CTAs pinned in a form footer
}) => {
  const themeGradient = useGradient();
  const palette = useTheme();
  const finalGradient = gColors || themeGradient;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[flat ? styles.flat : styles.shadow, { opacity: disabled ? 0.6 : 1 }, style]}
    >
      <LinearGradient
        colors={finalGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.btn}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            {icon}
            <Text style={[styles.text, { color: palette.textOnGradient }, textStyle]}>
              {titleCaseLabel(title)}
            </Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  shadow: { ...shadows.elevated, borderRadius: radius.lg },
  // Every shadow key zeroed: an override only replaces the keys it names, and a
  // surviving Android `elevation` paints a hard rectangle (ui-consistency §3b).
  flat: { borderRadius: radius.lg, shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
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

export default GradientButton;
