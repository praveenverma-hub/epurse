// =============================================================================
// SettlesChips — "Settles: Goa Trip ₹600 · Direct ₹200" on every repayment picker.
// Shown only when the person has an open SHARED-GROUP balance in that direction, so a
// settlement recorded outside the group still closes the group (and syncs to it).
// Preselected (utils/settleAllocation); only the paid amount is ever settled.
// =============================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import type { TextStyle } from 'react-native';
import { useEPurseStore } from '../store/ePurseStore';
import { spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import {
  allocateSettle, hasGroupParts, openSettleParts, preselectSettleParts,
  type LbRowLike, type SettleAllocation, type SettlePart,
} from '../utils/settleAllocation';
import { FormChip, FormChipRow } from './FormField';

const typography = typographyBase as unknown as Record<string, TextStyle>;

export interface SettleChoice {
  parts: SettlePart[];
  /** True when there's a group to choose — otherwise the chips don't show. */
  ask: boolean;
  selected: string[];
  toggle: (key: string) => void;
  /** Rows to write (null when not asking — record it as one plain row). */
  allocation: SettleAllocation[] | null;
}

/** The settlement's parts for this person, preselected and re-preselected when they change. */
export function useSettleChoice(entries: LbRowLike[] | null | undefined, kind: string | null | undefined, amount: number): SettleChoice {
  const groups = useEPurseStore((s: any) => s.groups);
  const parts = useMemo(
    () => (entries && kind ? openSettleParts(entries, kind, groups) : []),
    [entries, kind, groups],
  );
  const ask = hasGroupParts(parts) && amount > 0;
  // null = follow the preselection; a tap pins the user's own pick.
  const [picked, setPicked] = useState<string[] | null>(null);
  const partsKey = parts.map((p) => `${p.key}:${p.open}`).join('|');
  useEffect(() => { setPicked(null); }, [partsKey, amount]);
  const selected = picked ?? preselectSettleParts(parts, amount);
  const toggle = (key: string) => setPicked((cur) => {
    const base = cur ?? selected;
    return base.includes(key) ? base.filter((k) => k !== key) : [...base, key];
  });
  return { parts, ask, selected, toggle, allocation: ask ? allocateSettle(parts, selected, amount) : null };
}

export default function SettlesChips({ choice, accentColor }: { choice: SettleChoice; accentColor?: string }) {
  const theme = useTheme();
  if (!choice.ask || !choice.allocation) return null;
  const name = (a: SettleAllocation) => (a.groupId ? choice.parts.find((p) => p.groupId === a.groupId)?.label : 'Direct');
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>Settles</Text>
      <FormChipRow>
        {choice.parts.map((p) => (
          <FormChip
            key={p.key}
            label={`${p.label} ${formatCurrency(p.open)}`}
            active={choice.selected.includes(p.key)}
            onPress={() => choice.toggle(p.key)}
            accentColor={accentColor}
          />
        ))}
      </FormChipRow>
      {/* Always adds up to exactly what was paid. */}
      <Text style={[styles.result, { color: theme.textSecondary }]}>
        {choice.allocation.map((a) => `${formatCurrency(a.amount)} → ${name(a)}`).join(' · ')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: spacing.sm },
  label: { fontSize: 13, fontWeight: '700' },
  result: { ...typography.small, fontSize: 12 },
});
