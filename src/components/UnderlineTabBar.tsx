// =============================================================================
// UnderlineTabBar — a plain-text tab switcher with a bottom-border indicator on
// the active tab. For a small, fixed set of SECTIONS on one screen (e.g. a
// detail screen's Transactions / Members / Summary) — not for a pager between
// unrelated screens, and not a segmented pill (that's InlineDropdown's job for
// a 2-5 option CHOICE). Lives on the screen's own white/card surface, unlike
// the gradient-header underline variant in DashboardScreen's period selector.
// =============================================================================
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, spacing, typography as typographyBase, DIVIDER_W } from '../constants/theme';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

export interface UnderlineTab {
  key: string;
  label: string;
}

interface Props {
  tabs: UnderlineTab[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Indicator + active-label colour. Defaults to the static primary. */
  accentColor?: string;
  /** Hairline above the bar. Turn off when the bar sits directly under a header that already has a bottom border (else the two stack into a thick rule). */
  topBorder?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function UnderlineTabBar({ tabs, activeKey, onChange, accentColor = colors.primary, topBorder = true, style }: Props) {
  return (
    <View style={[styles.row, !topBorder && styles.noTopBorder, style]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <TouchableOpacity
            key={t.key}
            style={styles.tab}
            onPress={() => onChange(t.key)}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
          >
            <Text
              style={[styles.label, { color: active ? accentColor : colors.textSecondary }]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
            <View style={[styles.indicator, active && { backgroundColor: accentColor }]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1.5,
    borderTopColor: colors.divider,
    borderBottomWidth: DIVIDER_W,
    borderBottomColor: colors.divider,
  },
  noTopBorder: { borderTopWidth: 0 },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  label: { ...typography.small, fontWeight: '700' },
  indicator: {
    height: 2,
    width: '55%',
    borderRadius: 1,
    marginTop: spacing.xs,
    backgroundColor: 'transparent',
  },
});
