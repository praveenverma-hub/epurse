// =============================================================================
// StatSplitRow — ONE translucent surface, split by hairline dividers, carrying
// N label/value facts (white-on-gradient — for a screen's own gradient hero).
// Promoted out of DashboardScreen's own Income/Refunds row once AccountsScreen
// needed the identical shape for Assets/Liabilities: two separate pills read as
// two objects competing with the hero figure above them; one segmented block
// is a single object carrying several facts, and can't drift out of alignment
// the way independently-padded pills can.
// =============================================================================
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { spacing, radius, typography as typographyBase, DIVIDER_W } from '../constants/theme';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

export interface StatSplitCell {
  label: string;
  value: string;
}

export default function StatSplitRow({
  cells,
  style,
  align = 'left',
}: {
  cells: StatSplitCell[];
  style?: any;
  /** 'left' (default, matches Home/Accounts) or 'center' — a per-caller axis,
   *  not a redesign of the shared shape, so existing callers are untouched. */
  align?: 'left' | 'center';
}) {
  const centered = align === 'center';
  return (
    <View style={[styles.row, style]}>
      {cells.map((c, i) => (
        <React.Fragment key={c.label}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <View style={[styles.cell, centered && styles.cellCenter]}>
            <Text style={[styles.label, centered && styles.textCenter]}>{c.label}</Text>
            <Text style={[styles.value, centered && styles.textCenter]} numberOfLines={1}>{c.value}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF1F',
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  cell: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  cellCenter: { alignItems: 'center' },
  textCenter: { textAlign: 'center' },
  // Inset top and bottom so it reads as a divider between cells rather than a
  // seam splitting the surface into two shapes.
  divider: {
    width: DIVIDER_W,
    backgroundColor: '#FFFFFF3D',
    marginVertical: spacing.sm,
  },
  label: { color: '#FFFFFFCC', ...typography.tiny, fontWeight: '800', letterSpacing: 0.9 },
  value: { color: '#fff', ...typography.bodyBold, fontWeight: '700', marginTop: 3 },
});
