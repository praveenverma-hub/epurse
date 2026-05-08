import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';

const GradientButton = ({
  title,
  onPress,
  loading,
  disabled,
  colors: gColors = [colors.gradientStart, colors.gradientEnd],
  style,
  textStyle,
  icon,
}) => {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.shadow, { opacity: disabled ? 0.6 : 1 }, style]}
    >
      <LinearGradient
        colors={gColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.btn}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            {icon}
            <Text style={[styles.text, textStyle]}>{title}</Text>
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
  text: {
    color: colors.textOnGradient,
    ...typography.bodyBold,
    fontWeight: '700',
  },
});

export default GradientButton;
