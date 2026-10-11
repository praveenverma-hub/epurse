// =============================================================================
// GoalsSummary — Home's one-row glance at this month's goals, under the Budget
// card (Budget caps what leaves, Goals commits what stays). Renders nothing
// without an active goal; the carousel's `promo_goals` introduces the feature.
// =============================================================================
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useEPurseStore, isGoalInactive } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import ProgressBar from './ProgressBar';
import { radius, shadows } from '../constants/theme';
import { formatCurrency } from '../utils/format';

type Goal = { id: string; emoji?: string; archivedAt?: string | null; discontinuedAt?: string | null; duration?: string; achievedAt?: string | null };

const MAX_GLYPHS = 3;
/** Days into a new month that a carried-over plan is labelled as such. */
const CARRY_TAG_DAYS = 7;

const monthName = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long' });

export default function GoalsSummary({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const goals = useEPurseStore((s) => s.goals) as Goal[];
  const goalPlan = useEPurseStore((s) => s.goalPlan);
  const lastGoalPlan = useEPurseStore((s) => s.lastGoalPlan);
  const goalContributions = useEPurseStore((s) => s.goalContributions);
  const transactions = useEPurseStore((s) => s.transactions);
  const groups = useEPurseStore((s) => s.groups);
  const getGoalPlanUsage = useEPurseStore((s) => s.getGoalPlanUsage);

  const active = useMemo(() => (goals || []).filter((g) => !isGoalInactive(g)), [goals]);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const planCurrent = goalPlan?.monthKey === thisMonth;
  const usage = useMemo(
    () => (planCurrent ? getGoalPlanUsage() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planCurrent, goalPlan, goals, goalContributions, transactions, groups, getGoalPlanUsage],
  );

  if (active.length === 0) return null;

  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const carried = planCurrent
    && now.getDate() <= CARRY_TAG_DAYS
    && lastGoalPlan?.monthKey === prevKey
    && goalPlan.createdAt === goalPlan.lastEditedAt;
  const planned = usage?.planned || 0;
  const funded = usage?.funded || 0;
  const note = !planCurrent
    ? `Set ${monthName(now)}'s Goal Plan`
    : carried
      ? `Carried from ${monthName(prev)}`
      : planned > 0 ? null : `${formatCurrency(funded)} set aside this month`;
  const glyphs = active.slice(0, MAX_GLYPHS);
  const extra = active.length - glyphs.length;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.card }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Goals, ${monthName(now)}`}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Goals · {monthName(now)}</Text>
        {planned > 0 ? (
          <Text style={[styles.figure, { color: theme.textSecondary }]}>
            {formatCurrency(funded)} of {formatCurrency(planned)}
          </Text>
        ) : (
          <Text style={[styles.arrow, { color: theme.primary }]}>›</Text>
        )}
      </View>

      {planned > 0 ? (
        <ProgressBar progress={Math.min(funded / planned, 1)} color={theme.primary} height={6} />
      ) : null}

      <View style={styles.footer}>
        <View style={styles.glyphs}>
          {glyphs.map((g) => (
            <View key={g.id} style={[styles.glyph, { backgroundColor: theme.background }]}>
              <Text style={styles.glyphText}>{g.emoji || '🎯'}</Text>
            </View>
          ))}
          {extra > 0 ? <Text style={[styles.extra, { color: theme.textMuted }]}>+{extra}</Text> : null}
        </View>
        {note ? (
          <Text style={[styles.note, { color: planCurrent ? theme.textMuted : theme.primary }]} numberOfLines={1}>{note}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: 16, gap: 12, ...shadows.card },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  // Same as BudgetSummary's title (typography.h3).
  title: { fontSize: 17, fontWeight: '600' },
  figure: { fontSize: 13, fontWeight: '600' },
  arrow: { fontSize: 28, fontWeight: '300', lineHeight: 28 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  glyphs: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  glyph: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontSize: 15 },
  extra: { fontSize: 12, fontWeight: '600' },
  note: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
