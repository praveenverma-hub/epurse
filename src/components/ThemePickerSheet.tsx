// =============================================================================
// ThemePickerSheet — pick an accent theme.
//
// Pulled out of SettingsScreen (Sep-14-26), as part of making every Settings
// row behave the same way: tap a row, get a screen or a sheet, never inline
// content sitting directly on the Settings list. A theme swatch grid is a
// short, self-contained, non-growing decision (ui-consistency §2b) — five
// tiles, nothing conditional, nowhere further to navigate — so it's a sheet,
// not a pushed screen.
// =============================================================================

import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius, spacing, shadows } from '../constants/theme';
import { THEMES } from '../constants/themes';
import { useTheme } from '../hooks/useTheme';
import SheetCloseButton from './SheetCloseButton';

interface Props {
  visible: boolean;
  currentThemeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const ThemePickerSheet: React.FC<Props> = ({ visible, currentThemeId, onSelect, onClose }) => {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.card }]}>
        <SheetCloseButton onPress={onClose} variant="absolute" />
        <View style={[styles.handle, { backgroundColor: theme.divider }]} />
        <Text style={[styles.title, { color: theme.textPrimary }]}>Appearance</Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Pick an accent — gradients, buttons and highlights update across the app.
        </Text>

        <View style={styles.grid}>
          {Object.values(THEMES).map((t: any) => {
            const active = currentThemeId === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => onSelect(t.id)}
                style={[styles.tile, active && { borderColor: t.primary, borderWidth: 2 }]}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${t.label} theme`}
              >
                <LinearGradient
                  // `gradientStops` so Platinum's swatch shows its sheen, not a flat pair.
                  colors={t.gradientStops || [t.gradientStart, t.gradientEnd]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.swatch}
                >
                  {active ? <Text style={styles.check}>✓</Text> : null}
                </LinearGradient>
                <Text
                  style={[
                    styles.label,
                    { color: theme.textSecondary },
                    active && { color: t.primary, fontWeight: '700' },
                  ]}
                  numberOfLines={1}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </Modal>
  );
};

export default ThemePickerSheet;

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: '#00000066' },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 36,
    ...shadows.sheet,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: spacing.lg },

  grid: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  tile: {
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: 6,
    flexBasis: '22%',
  },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  check: { color: '#fff', fontSize: 24, fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '600' },
});
