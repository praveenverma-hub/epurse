import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, radius, shadows, spacing } from '../constants/theme';

const FAB = ({ onPress, icon = '+' }) => (
  <TouchableOpacity activeOpacity={0.9} style={styles.shadow} onPress={onPress}>
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fab}
    >
      <Text style={styles.icon}>{icon}</Text>
    </LinearGradient>
  </TouchableOpacity>
);

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
