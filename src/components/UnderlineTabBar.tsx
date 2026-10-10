// =============================================================================
// UnderlineTabBar — a plain-text tab switcher with a bottom-border indicator on
// the active tab. For a small, fixed set of SECTIONS on one screen (e.g. a
// detail screen's Transactions / Members / Summary) — not for a pager between
// unrelated screens, and not a segmented pill (that's InlineDropdown's job for
// a 2-5 option CHOICE). Lives on the screen's own white/card surface, unlike
// the gradient-header underline variant in DashboardScreen's period selector.
//
// variant 'folder' (Add/Edit Transaction's Expense/Income): the active tab is an
// open-bottomed outline whose sides run into one baseline across the bar, all in
// the accent — the form below reads as the section that tab opens. Its inside is
// `colors.background`, the same as the form area, so tab and section are one shape.
//
// tone 'dark' (underline variant only): the bar is filled with `accentColor` (the
// theme colour) and the labels + underline are white — for a bar that sits on a
// coloured surface rather than the page's white one.
// =============================================================================
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radius, readableOn, spacing, typography as typographyBase, DIVIDER_W } from '../constants/theme';

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
  /** 'underline' (default) or 'folder' — see the header. */
  variant?: 'underline' | 'folder';
  /** 'light' (default) or 'dark' — see the header. */
  tone?: 'light' | 'dark';
  style?: StyleProp<ViewStyle>;
}

export default function UnderlineTabBar({ tabs, activeKey, onChange, accentColor = colors.primary, topBorder = true, variant = 'underline', tone = 'light', style }: Props) {
  if (variant === 'folder') {
    const edge = { borderBottomWidth: FOLDER_W, borderBottomColor: accentColor };
    return (
      <View style={[styles.folderRow, style]} accessibilityRole="tablist">
        <View style={[styles.folderEdge, edge]} />
        {tabs.map((t) => {
          const active = t.key === activeKey;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.folderTab, active ? [styles.folderTabActive, { borderColor: accentColor }] : edge]}
              onPress={() => onChange(t.key)}
              activeOpacity={0.7}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
            >
              <Text
                style={[styles.label, { color: active ? readableOn(colors.background, accentColor) : colors.textSecondary }]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={[styles.folderEdge, edge]} />
      </View>
    );
  }
  const dark = tone === 'dark';
  return (
    <View
      style={[styles.row, !topBorder && styles.noTopBorder, dark && [styles.rowDark, { backgroundColor: accentColor }], style]}
      accessibilityRole="tablist"
    >
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
              style={[styles.label, { color: dark ? (active ? DARK_INK : DARK_INK_QUIET) : active ? accentColor : colors.textSecondary }]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
            <View style={[styles.indicator, active && { backgroundColor: dark ? DARK_INK : accentColor }]} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Heavier than a hairline: this line IS the section's top edge, not a divider.
const FOLDER_W = 1.5;
const DARK_INK = '#FFFFFF';
const DARK_INK_QUIET = 'rgba(255,255,255,0.72)';

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
  rowDark: { borderTopWidth: 0, borderBottomWidth: 0 },
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
  folderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.card,
    paddingTop: spacing.sm,
  },
  // Baseline beyond the tabs, inset to the form's side padding.
  folderEdge: { width: spacing.lg, alignSelf: 'stretch' },
  folderTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  // Top + sides only; the open bottom is where the baseline breaks. borderTop
  // matches the inactive tabs' borderBottom, so both are the same height.
  folderTabActive: {
    backgroundColor: colors.background,
    borderTopWidth: FOLDER_W,
    borderLeftWidth: FOLDER_W,
    borderRightWidth: FOLDER_W,
    // Same radius as the form's cards below.
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
});
