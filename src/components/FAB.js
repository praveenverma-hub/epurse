import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, shadows, spacing } from '../constants/theme';
import { useGradient, useTheme } from '../hooks/useTheme';

const FAB = ({ onPress, icon = '+' }) => {
  const gradient = useGradient();
  const { primary } = useTheme();
  return (
    <TouchableOpacity activeOpacity={0.9} style={[styles.shadow, { shadowColor: primary }]} onPress={onPress}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fab}
      >
        <Text style={styles.icon}>{icon}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  shadow: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    borderRadius: radius.pill,
    ...shadows.fab,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: '#fff', fontSize: 30, fontWeight: '300', lineHeight: 32 },
});

export default FAB;
