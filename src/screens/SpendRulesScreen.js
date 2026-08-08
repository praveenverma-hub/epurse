// =============================================================================
// SpendRulesScreen — "which categories count as expenses".
//
// A per-category on/off list that decides what feeds Spent, the category
// breakdown, spending pace, budget actuals and the Activity totals. Distinct from
// Ignore (drop a single wrong transaction) and Private (hide it): this is a
// standing rule about a whole category, and the transactions stay fully visible —
// they just carry a NOT COUNTED tag instead of adding to your spend.
//
// Two decisions worth keeping:
//
// • PARENT-level only. Not a simplification — a data constraint. Most
//   sub-categories have no `legacyId` of their own (Food Delivery / Fast Food /
//   Restaurants all resolve to legacy `food`), transactions don't always carry a
//   `childCategory`, and compaction keeps history as legacy `byCategory`. A
//   sub-category rule would silently fail on SMS rows and on anything past 90 days.
//
// • A FULL list with switches, not an "add an exclusion" picker. In a finance app a
//   hidden exclusion is the worst kind of bug: if ₹8k of groceries stops counting,
//   that has to be visible at a glance, not something you remember doing. The store
//   persists the EXCLUDED ids so a newly added category defaults to counted.
// =============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import { NON_BUDGETABLE_PARENT_IDS } from '../constants/twoTierCategories';
import InfoIcon from '../components/InfoIcon';

const SpendRulesScreen = ({ navigation }) => {
  const theme = useTheme();
  const tree = useCategoryTree();            // built-ins + the user's custom parents
  const excluded = useEPurseStore((s) => s.excludedExpenseParents);
  const setExpenseParentCounted = useEPurseStore((s) => s.setExpenseParentCounted);
  const resetSpendRules = useEPurseStore((s) => s.resetSpendRules);

  const excludedSet = useMemo(() => new Set(excluded || []), [excluded]);

  // Transfers / Income are structurally not expenses (NON_BUDGETABLE_PARENT_IDS) and
  // never reach the spend totals, so offering a switch would imply a control that
  // does nothing. They're listed as fixed rows instead, which answers "why isn't
  // Income here?" without pretending it's configurable.
  const rows = useMemo(
    () => tree.map((p) => ({ ...p, fixed: NON_BUDGETABLE_PARENT_IDS.has(p.id) })),
    [tree],
  );
  const configurable = rows.filter((r) => !r.fixed);
  const excludedCount = configurable.filter((r) => excludedSet.has(r.id)).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Counts as expense</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.hint}>
            Turn a category off and its transactions stop adding to Spent, your category
            breakdown and budget — they stay in your list, tagged{' '}
            <Text style={styles.hintStrong}>NOT COUNTED</Text>.
          </Text>

          <View style={[styles.noteRow, { backgroundColor: theme.primary + '0F', borderColor: theme.primary + '33' }]}>
            <InfoIcon size={14} color={theme.primary} />
            <Text style={[styles.noteText, { color: theme.primary }]}>
              Balances always update. This only changes what counts as spending.
            </Text>
          </View>

          {configurable.map((p, i) => {
            const counted = !excludedSet.has(p.id);
            return (
              <View key={p.id} style={[styles.row, i > 0 && styles.rowDivided]}>
                {/* The category's OWN emoji — data, not chrome (see §5). */}
                <Text style={styles.rowEmoji}>{p.emoji}</Text>
                <View style={styles.rowTextWrap}>
                  <Text style={styles.rowLabel} numberOfLines={1}>{p.label}</Text>
                  <Text
                    style={[styles.rowState, !counted && { color: colors.warning }]}
                    numberOfLines={1}
                  >
                    {counted ? 'Counted in expenses' : 'Not counted'}
                  </Text>
                </View>
                <Switch
                  value={counted}
                  onValueChange={(v) => setExpenseParentCounted(p.id, v)}
                  trackColor={{ true: theme.primary, false: colors.divider }}
                  thumbColor="#fff"
                  ios_backgroundColor={colors.divider}
                />
              </View>
            );
          })}
        </View>

        {/* Always-excluded, shown so their absence above isn't a mystery. */}
        <View style={styles.card}>
          <View style={styles.sectionHead}>
            <Ionicons name="lock-closed-outline" size={17} color={colors.textMuted} />
            <Text style={styles.sectionTitle}>Never counted</Text>
          </View>
          <Text style={styles.hint}>
            These move money between places rather than spending it, so they're excluded
            everywhere and can't be switched on.
          </Text>
          {rows.filter((r) => r.fixed).map((p, i) => (
            <View key={p.id} style={[styles.row, i > 0 && styles.rowDivided]}>
              <Text style={styles.rowEmoji}>{p.emoji}</Text>
              <View style={styles.rowTextWrap}>
                <Text style={[styles.rowLabel, styles.rowLabelMuted]} numberOfLines={1}>{p.label}</Text>
              </View>
              <Ionicons name="lock-closed-outline" size={15} color={colors.textMuted} />
            </View>
          ))}
        </View>

        {excludedCount > 0 ? (
          <TouchableOpacity style={styles.resetBtn} onPress={resetSpendRules} activeOpacity={0.8}>
            <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.resetText}>
              Count everything again ({excludedCount} off)
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h2, color: colors.textPrimary, flex: 1, textAlign: 'center' },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sectionTitle: { ...typography.h3, color: colors.textPrimary },
  hint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },
  hintStrong: { fontWeight: '700', color: colors.textPrimary },

  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  noteText: { ...typography.tiny, fontWeight: '600', flex: 1 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  rowEmoji: { fontSize: 18 },
  // flex + numberOfLines so a long custom category name can't push the switch off.
  rowTextWrap: { flex: 1 },
  rowLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  rowLabelMuted: { color: colors.textSecondary },
  rowState: { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },

  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  resetText: { ...typography.bodyBold, color: colors.textSecondary, fontWeight: '700' },
});

export default SpendRulesScreen;
