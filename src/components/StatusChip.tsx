// The small tinted status chip (NOT SYNCED, IGNORED, REFUND…) — transaction cards and
// Lent/Borrowed rows. The ink is MEASURED against the card so amber/green stay legible
// (raw warning amber is ~2:1 on white).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { colors, radius, readableOn } from '../constants/theme';

export type ChipTone = 'warning' | 'income' | 'lent' | 'borrowed' | 'neutral';

const tone = (hue: string, bg?: string) => ({ bg: bg || hue + '1F', ink: readableOn(colors.card, hue) });
const CHIP_TONE: Record<ChipTone, { bg: string; ink: string }> = {
  warning:  tone(colors.warning),
  income:   tone(colors.income),
  lent:     tone(colors.lent, colors.lentSoft),
  borrowed: tone(colors.borrowed, colors.borrowedSoft),
  neutral:  { bg: colors.textMuted + '1F', ink: colors.textSecondary },
};

export default function StatusChip({ label, tone: t }: { label: string; tone: ChipTone }) {
  return (
    <View style={[styles.chip, { backgroundColor: CHIP_TONE[t].bg }]}>
      <Text style={[styles.chipText, { color: CHIP_TONE[t].ink }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, flexShrink: 0 },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
});
