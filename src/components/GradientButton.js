import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, spacing, typography, shadows } from '../constants/theme';
import { useGradient, useTheme } from '../hooks/useTheme';

const GradientButton = ({
  title,
  onPress,
  loading,
  disabled,
  colors: gColors,   // optional override (e.g. green/purple for lent/borrow)
  style,
  textStyle,
  icon,
}) => {
  const themeGradient = useGradient();
  const palette = useTheme();
  const finalGradient = gColors || themeGradient;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.shadow, { opacity: disabled ? 0.6 : 1 }, style]}
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
            <Text style={[styles.text, { color: palette.textOnGradient }, textStyle]}>{title}</Text>
          </>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  shadow: { ...shadows.elevated, borderRadius: radius.lg },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    gap: spacing.sm,
  },
  text: { ...typography.bodyBold, fontWeight: '700' },
});

export default GradientButton;
