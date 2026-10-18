// =============================================================================
// GoalsStrip — Home's goals: one GoalCard (`compact` — the Goals screen's tile
// without ribbon, buttons or stats) per active goal, in a horizontal strip at
// the Goals grid's own tile width, so two show at once. Behind-plan goals lead —
// the same `goalsBehindPlan` rule as the carousel card and the push — then the
// rest by what's left, finished ones last. Renders nothing without an active
// goal; the carousel's `promo_goals` introduces the feature.
// =============================================================================
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Text } from './AppText';
import type { TextStyle } from 'react-native';

import { useEPurseStore, buildGoalMonthFacts, isGoalInactive } from '../store/ePurseStore';
import { goalsBehindPlan } from '../analytics/nudgeFacts';
import { useTheme } from '../hooks/useTheme';
import { spacing, typography as typographyBase } from '../constants/theme';
import { CARD_SHADOW_PAD } from '../constants/carousel';
import { gridItemWidth } from '../constants/layout';
import { formatCurrency } from '../utils/format';
import SectionHeader from './SectionHeader';
import GoalCard from './GoalCard';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Days into a new month that a carried-over plan is labelled as such. */
const CARRY_TAG_DAYS = 7;
const GAP = spacing.md;

const monthName = (d: Date) => d.toLocaleDateString('en-IN', { month: 'long' });
const mkOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

type Props = {
  onOpenGoal: (goalId: string) => void;
  onViewAll: () => void;
};

export default function GoalsStrip({ onOpenGoal, onViewAll }: Props) {
  const theme = useTheme();
  // Same width as a tile in GoalsScreen's two-column grid.
  const { width } = useWindowDimensions();
  const cardW = gridItemWidth(width - spacing.lg * 2, 2, GAP);
  const goals = useEPurseStore((s: any) => s.goals) as any[];
  const goalPlan = useEPurseStore((s: any) => s.goalPlan);
  const lastGoalPlan = useEPurseStore((s: any) => s.lastGoalPlan);
  const goalContributions = useEPurseStore((s: any) => s.goalContributions);
  const goalHistory = useEPurseStore((s: any) => s.goalHistory);
  const transactions = useEPurseStore((s: any) => s.transactions);
  const groups = useEPurseStore((s: any) => s.groups);
  const getGoalPlanUsage = useEPurseStore((s: any) => s.getGoalPlanUsage);
  const getGoalLifetimeSaved = useEPurseStore((s: any) => s.getGoalLifetimeSaved);

  const now = new Date();
  const planCurrent = goalPlan?.monthKey === mkOf(now);

  const { cards, planned, funded } = useMemo(() => {
    const usage = planCurrent ? getGoalPlanUsage() : null;
    const rows = new Map<string, any>((usage?.perGoal || []).map((r: any) => [r.goalId, r]));
    const t = Date.now();
    const behind = new Set(goalsBehindPlan(buildGoalMonthFacts(useEPurseStore.getState(), t), t).map((g) => g.id));
    const rank = (c: any) => (behind.has(c.goal.id) ? 0 : c.planned > 0 && c.funded >= c.planned ? 3 : c.planned > 0 ? 1 : 2);
    const list = (goals || [])
      .filter((g) => !isGoalInactive(g))
      .map((g) => {
        const r = rows.get(g.id);
        return {
          goal: g,
          planned: r?.planned || 0,
          funded: r?.funded || 0,
          status: behind.has(g.id) ? 'behind' : r?.status,
          lifetime: getGoalLifetimeSaved(g.id),
        };
      })
      .sort((a, b) => rank(a) - rank(b) || (b.planned - b.funded) - (a.planned - a.funded));
    return { cards: list, planned: usage?.planned || 0, funded: usage?.funded || 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planCurrent, goals, goalPlan, goalContributions, goalHistory, transactions, groups, getGoalPlanUsage, getGoalLifetimeSaved]);

  if (cards.length === 0) return null;

  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const carried = planCurrent
    && now.getDate() <= CARRY_TAG_DAYS
    && lastGoalPlan?.monthKey === mkOf(prev)
    && goalPlan.createdAt === goalPlan.lastEditedAt;
  const subtitle = !planCurrent
    ? `Set ${monthName(now)}'s goal plan`
    : carried
      ? `Carried from ${monthName(prev)}`
      : planned > 0
        ? `${formatCurrency(funded)} of ${formatCurrency(planned)} set aside`
        : `${cards.length} active ${cards.length === 1 ? 'goal' : 'goals'}`;

  const card = (c: (typeof cards)[number]) => (
    <GoalCard
      key={c.goal.id}
      variant="compact"
      name={c.goal.name}
      emoji={c.goal.emoji}
      color={c.goal.color}
      planned={c.planned}
      funded={c.funded}
      status={c.status}
      lifetimeSaved={c.lifetime}
      lifetimeTarget={c.goal.lifetimeTarget}
      onPress={() => onOpenGoal(c.goal.id)}
      style={{ width: cardW }}
    />
  );

  return (
    <View>
      <SectionHeader
        icon="flag-outline"
        accentColor={theme.primary}
        title={`Goals · ${monthName(now)}`}
        subtitle={subtitle}
        subtitleRight={(
          <TouchableOpacity onPress={onViewAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.viewAll, { color: theme.primary }]}>View all</Text>
          </TouchableOpacity>
        )}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={cards.length > 2}
        snapToInterval={cardW + GAP}
        decelerationRate="fast"
        // Bleeds to the screen edges; the vertical pad gives the card shadows
        // room inside the list's clip (carousel CARD_SHADOW_PAD).
        style={styles.strip}
        contentContainerStyle={styles.stripContent}
      >
        {cards.map((c) => card(c))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  viewAll: { ...typography.small, fontWeight: '700' },
  // Only the TOP pad is cancelled: the tiles' shadow reaches ~10pt below them, so
  // cancelling the bottom too left ~6pt of clear space above Transactions.
  strip: { marginHorizontal: -spacing.lg, marginTop: -CARD_SHADOW_PAD },
  stripContent: { gap: GAP, paddingHorizontal: spacing.lg, paddingVertical: CARD_SHADOW_PAD },
});
