// =============================================================================
// GroupPickerSheet — bottom sheet to assign an existing transaction to a group.
// =============================================================================
import React, { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useEPurseStore } from '../store/ePurseStore';
import SheetCloseButton from './SheetCloseButton';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, monthKey } from '../utils/format';
import { countsForSpend, spendContribution } from '../utils/split';
import type { Group } from '../types/group';

// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

interface GroupPickerSheetProps {
  visible: boolean;
  /** The transaction being assigned — used to show amount; null when closed. */
  txn: { merchant?: string; amount: number } | null;
  onClose: () => void;
  /** Called with the chosen group; parent decides whether to open the split sheet next. */
  onPick: (groupId: string, group: Group) => void;
  onCreateNew: () => void;
}

export default function GroupPickerSheet({
  visible,
  txn,
  onClose,
  onPick,
  onCreateNew,
}: GroupPickerSheetProps) {
  const theme = useTheme();
  const groups = useEPurseStore((s: any) => s.groups) as Group[];
  const transactions = useEPurseStore((s: any) => s.transactions) as any[];
  const [selected, setSelected] = useState<string | null>(null);

  // Current-month total per group (your share) — personal groups track monthly,
  // so the subtitle must match the Groups tab's "this month" figure, not all-time.
  const monthTotalByGroup = useMemo(() => {
    const mk = monthKey(new Date());
    const m: Record<string, number> = {};
    for (const t of transactions) {
      if (!t.groupId || t.isIgnored || !countsForSpend(t)) continue;
      if (monthKey(t.createdAt) !== mk) continue;
      m[t.groupId] = (m[t.groupId] || 0) + spendContribution(t); // refund nets the group
    }
    for (const k of Object.keys(m)) if (m[k] < 0) m[k] = 0;
    return m;
  }, [transactions]);

  const handlePick = (g: Group) => {
    setSelected(g.id);
    onPick(g.id, g);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={onClose} />
        <SheetCloseButton onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Add to Group</Text>
          {txn ? (
            <Text style={styles.sub} numberOfLines={1}>
              {txn.merchant} · {formatCurrency(txn.amount)}
            </Text>
          ) : null}

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {groups.length === 0 && (
              <Text style={styles.empty}>No groups yet. Create one below.</Text>
            )}
            {groups.map((g) => (
              <TouchableOpacity
                key={g.id}
                style={[styles.row, selected === g.id && { backgroundColor: theme.primary + '14' }]}
                onPress={() => handlePick(g)}
                activeOpacity={0.75}
              >
                <View style={[styles.iconBox, { backgroundColor: (g.color || '#6366F1') + '22' }]}>
                  <Text style={styles.iconTxt}>{g.emoji || (g.type === 'shared' ? '👥' : '📁')}</Text>
                </View>
                <View style={styles.rowMid}>
                  <Text style={styles.rowName}>{g.name}</Text>
                  <Text style={styles.rowMeta}>
                    {g.type === 'shared'
                      ? `${g.members?.length ?? 0} members · ${formatCurrency(g.totalSpend || 0)} spent`
                      : `Personal · ${formatCurrency(monthTotalByGroup[g.id] || 0)} this month`}
                  </Text>
                </View>
                {selected === g.id && (
                  <Text style={[styles.check, { color: theme.primary }]}>✓</Text>
                )}
              </TouchableOpacity>
            ))}

            {/* Create new */}
            <TouchableOpacity style={styles.newRow} onPress={onCreateNew} activeOpacity={0.75}>
              <View style={[styles.iconBox, { backgroundColor: theme.primary + '18' }]}>
                <Text style={[styles.iconTxt, { color: theme.primary }]}>＋</Text>
              </View>
              <Text style={styles.newLabel}>New group</Text>
            </TouchableOpacity>
          </ScrollView>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismiss:    { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '75%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center', marginBottom: spacing.md,
  },
  title:   { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.xs },
  sub:     { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },
  list:    { marginBottom: spacing.sm },
  empty:   { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    marginBottom: 6,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  iconTxt:   { fontSize: 20 },
  rowMid:    { flex: 1 },
  rowName:   { ...typography.bodyBold, color: colors.textPrimary },
  rowMeta:   { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  check:     { fontWeight: '800', fontSize: 16 },
  newRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.divider,
    marginTop: spacing.xs,
  },
  newLabel:  { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
});
