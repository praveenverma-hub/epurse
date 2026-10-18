import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { LinearGradient } from 'expo-linear-gradient';
import PlusGlyph from './PlusGlyph';

import { radius, shadows, spacing } from '../constants/theme';
import { useGradient, useTheme } from '../hooks/useTheme';

const FAB_SIZE = 60;
/** Bottom padding a scroll list needs for its last row to clear the FAB. */
export const FAB_CLEARANCE = FAB_SIZE + spacing.md;

const FAB = ({ onPress, icon = '+', bottomInset = 0, accessibilityLabel = 'Add' }) => {
  const gradient = useGradient();
  const { primary } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      style={[styles.shadow, { shadowColor: primary, bottom: spacing.xl + bottomInset }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.fab}
      >
        {/* The shared drawn "+" (same as the tab bar's Add) — a text "+" sits
            optically high and shifts with font padding. */}
        {icon === '+' ? (
          <PlusGlyph size={34} />
        ) : (
          <Text style={styles.icon}>{icon}</Text>
        )}
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
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { color: '#fff', fontSize: 30, fontWeight: '300', lineHeight: 32 },
});

export default FAB;
