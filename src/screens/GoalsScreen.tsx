// =============================================================================
// GoalsScreen — plan where the money that DOESN'T get spent goes.
//
// Budget caps what leaves; Goals commits what stays. They share one rhythm on
// purpose: a month starts with no plan, and the user confirms one from a
// prefill (see `rolloverGoalPlanIfNeeded` / `lastBudgetPlan`). Nothing is ever
// carried silently, because a plan you didn't agree to isn't a plan.
//
// Three states, decided by what exists:
//   • no goals            → templates, so the empty state is a launchpad
//   • goals, no plan yet  → last month's split as a one-tap "keep it"
//   • plan set            → the goal tiles, and the plan behind an Edit button
//
// ── VIEW first, EDIT deliberately (Sep-11-26) ────────────────────────────────
// The plan card is read-only until "Edit", and edit mode ends at an explicit
// Save or Cancel — so Cancel is meaningful (the draft was never being written
// to the store mid-edit) and the screen has a resting state.
//
// THE SALARY IS TYPED, NOT READ. The app already parses income from SMS, which
// is exactly why this screen asks instead of helping itself: a figure taken
// without being offered reads as surveillance, and the planning maths works
// just as well on a number the user made up. See the memory note on the income
// decision before wiring `getMonthlyIncome` in here.
//
// ── TWO paths to the same number, on purpose (Sep-12-26) ────────────────────
// A goal's monthly amount briefly became editable ONLY from its own form
// (`GoalFormScreen`, via `updateGoalAllocation`), with this card's bar made
// permanently view-only — one home for the number, to kill the "which screen
// actually owns this" confusion. Asked back: the bar's DRAG (and its legend
// rows' ± steppers) are real again, for fast whole-plan rebalancing without
// leaving this screen. The form field stays too, for setting or checking one
// goal's amount in context with its target/rule. Both write through the same
// clamp (`allocationWithinSalary`, netting out the spending cap) so neither
// path can produce a number the other would reject — they're two doors onto
// one room, not two different rooms. Goals stay listed ABOVE this card:
// they're still the subject, the split is still supporting arithmetic below.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useRewardStore } from '../store/useRewardStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, shadows, withAlpha } from '../constants/theme';
import { formatCurrency, monthKey } from '../utils/format';
import {
  ALLOCATION_STEP, allocatedTotal, snapAmount, allocationWithinSalary,
  rescaleAllocations, monthsToTarget,
} from '../utils/goalPlan';
import { GOAL_TEMPLATES, MAX_ACTIVE_GOALS, TEMPLATE_DURATION, type GoalTemplate } from '../constants/goals';
import { INPUT_LIMITS, sanitizeAmount, parseAmount } from '../utils/validation';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import GradientButtonBase from '../components/GradientButton';
import EmptyState from '../components/EmptyState';
import AllocationBar, { type AllocationSegment } from '../components/AllocationBar';
import GoalCard from '../components/GoalCard';
import GoalFundModal from '../components/GoalFundModal';
import FAB from '../components/FAB';
import InfoIcon from '../components/InfoIcon';
import EditIcon from '../components/EditIcon';
import InfoSheet from '../components/InfoSheet';
import GoalAchievedModal, { type GoalAchievement } from '../components/GoalAchievedModal';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useToast } from '../components/Toast';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// GradientButton.js has no TS declarations, so its inferred prop type demands
// every prop. Same local cast the other TS callers use (AddTransactionScreen,
// CreateGroupModal).
const GradientButton: React.FC<{
  title: string;
  onPress: () => void;
  style?: object;
  loading?: boolean;
  disabled?: boolean;
  colors?: string[];
  textStyle?: any;
  icon?: React.ReactNode;
}> = GradientButtonBase as any;

const FREE_ID = '__free__';
const SPEND_ID = '__spend__';

/** What the (i) in the header explains. Kept here rather than in constants —
 *  it is this screen's own copy, not a shared vocabulary. */
const HOW_IT_WORKS = {
  title: 'How goals work',
  eyebrow: 'Budget caps what leaves · Goals commit what stays',
  body:
    'ONE-TIME goals track a fixed target; RECURRING goals split a monthly amount and '
    + 'carry it forward on their own — set either from the bar or a goal\'s own card.',
  bullets: [
    {
      icon: 'sync-outline' as const,
      label: 'Two ways money counts',
      value: 'Auto-fund matches categories or merchants you name; top-ups let you add a transaction yourself.',
    },
    {
      icon: 'flag-outline' as const,
      label: 'One-time goals get a bonus',
      value: "Reach your target and we'll show it — plus a bonus the month you get there.",
    },
    {
      icon: 'lock-closed-outline' as const,
      label: 'Spending is locked here',
      value: 'The grey segment is your budget cap — change it in Budget, this screen only splits what is left.',
    },
  ],
};

const MONTH_LABEL = (mk: string) => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const GoalsScreen = ({ navigation }: any) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const goals = useEPurseStore((s: any) => s.goals);
  const goalPlan = useEPurseStore((s: any) => s.goalPlan);
  const lastGoalPlan = useEPurseStore((s: any) => s.lastGoalPlan);
  const goalContributions = useEPurseStore((s: any) => s.goalContributions);
  const transactions = useEPurseStore((s: any) => s.transactions);
  const budget = useEPurseStore((s: any) => s.budget);
  const setGoalPlan = useEPurseStore((s: any) => s.setGoalPlan);
  const rolloverGoalPlanIfNeeded = useEPurseStore((s: any) => s.rolloverGoalPlanIfNeeded);
  const getGoalPlanUsage = useEPurseStore((s: any) => s.getGoalPlanUsage);
  const getGoalLifetimeSaved = useEPurseStore((s: any) => s.getGoalLifetimeSaved);
  const getNewlyAchievedGoals = useEPurseStore((s: any) => s.getNewlyAchievedGoals);
  const markGoalAchieved = useEPurseStore((s: any) => s.markGoalAchieved);

  const awardGoalBonus = useRewardStore((s) => s.awardGoalBonus);

  const { submit, submitting } = useSubmitGuard();
  const toast = useToast();

  // A stale plan from a finished month must be retired before anything reads it.
  useEffect(() => { rolloverGoalPlanIfNeeded(); }, [rolloverGoalPlanIfNeeded]);

  const thisMonth = monthKey(new Date());
  const planIsCurrent = goalPlan?.monthKey === thisMonth;

  // ── local draft ──────────────────────────────────────────────────────────
  // Both salary AND allocations edit a DRAFT here, committed by Save — dragging
  // or typing straight into the store would mean a half-made plan is the live
  // one the moment a finger moves. `seed()` re-syncs the draft from whatever's
  // actually stored every time `goalPlan`/`lastGoalPlan` changes identity — so
  // a goal's form writing `updateGoalAllocation` directly (its own, separate
  // edit path) still shows up here the next time this effect runs.
  const [salaryText, setSalaryText] = useState('');
  const [editingSalary, setEditingSalary] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // Logging money into a goal by hand. Open to EVERY goal, including ones that
  // fund themselves: an SMS that never arrives would otherwise leave a goal
  // permanently short with no way to correct it. The modal itself (account
  // picker, category inference, the actual `addTransaction` write) lives in
  // `GoalFundModal` — shared with `GoalDetailScreen`, not reinvented here.
  const [fundGoal, setFundGoal] = useState<any | null>(null);
  const [achievement, setAchievement] = useState<GoalAchievement | null>(null);
  const openForm = useCallback(
    (id?: string) => { hapticLight(); navigation.navigate('GoalForm', id ? { goalId: id } : undefined); },
    [navigation],
  );
  const [reward, setReward] = useState<{ rpAwarded: number; epcAwarded: number; multiplier: number } | null>(null);

  const seed = useCallback(() => {
    const src = planIsCurrent ? goalPlan : lastGoalPlan;
    setSalaryText(src?.salary ? String(src.salary) : '');
    setAlloc({ ...(src?.allocations || {}) });
  }, [planIsCurrent, goalPlan, lastGoalPlan]);

  useEffect(() => { seed(); }, [seed]);

  const salary = parseAmount(salaryText);
  const budgetCap = Number(budget?.totalCap) || 0;

  const activeGoals = useMemo(() => goals.filter((g: any) => !g.archivedAt), [goals]);

  // A month with no confirmed plan has nothing to VIEW, so it opens straight
  // into editing rather than showing an empty read-only card with a button.
  // (Any goal's own monthly amount re-applies automatically at rollover — see
  // `rolloverGoalPlanIfNeeded` — so this only fires when there was nothing to
  // auto-carry, e.g. the very first month, or a plan with no monthly amounts
  // set on anything yet.)
  useEffect(() => {
    if (!planIsCurrent && activeGoals.length > 0) setEditing(true);
  }, [planIsCurrent, activeGoals.length]);

  /** Spending rides in the same bar so savings and spending read as one split.
   *  EVERY goal can carry a monthly figure now (Sep-12-26: a one-time goal
   *  funded steadily toward its target uses the same bar a recurring goal
   *  does) — no duration filter here. */
  const segments: AllocationSegment[] = useMemo(() => {
    const rows: AllocationSegment[] = [];
    if (budgetCap > 0) {
      rows.push({ id: SPEND_ID, label: 'Spending', emoji: '🔒', color: theme.textMuted, value: Math.min(budgetCap, salary), locked: true });
    }
    activeGoals.forEach((g: any) => {
      rows.push({ id: g.id, label: g.name, emoji: g.emoji, color: g.color, value: Number(alloc[g.id]) || 0 });
    });
    return rows;
  }, [activeGoals, alloc, budgetCap, salary, theme.textMuted]);

  const goalTotal = allocatedTotal(alloc);
  const committed = goalTotal + (budgetCap > 0 ? Math.min(budgetCap, salary) : 0);
  const free = Math.max(0, salary - committed);
  const over = committed > salary;

  const usage = planIsCurrent ? getGoalPlanUsage() : null;
  const usageByGoal = useMemo(() => {
    const map = new Map<string, any>();
    (usage?.perGoal || []).forEach((r: any) => map.set(r.goalId, r));
    return map;
  }, [usage]);

  // ── the congratulation ───────────────────────────────────────────────────
  // Ordered so a crash can only ever UNDER-award: credit the bonus, then mark
  // the goal. Marking first would silently swallow the reward.
  useEffect(() => {
    if (achievement) return;                 // one at a time
    const list = getNewlyAchievedGoals();
    if (list.length === 0) return;
    const next = list[0];
    const paid = awardGoalBonus(next.name);
    markGoalAchieved(next.goalId, { bonusAwarded: true });
    setReward(paid);
    setAchievement(next);
  }, [goals, transactions, goalContributions, achievement, getNewlyAchievedGoals, awardGoalBonus, markGoalAchieved]);

  // ── editing ──────────────────────────────────────────────────────────────
  // The steppers' path — mirrors the same clamp `updateGoalAllocation` runs in
  // the store (room = salary minus the locked spending cap minus every OTHER
  // goal's share), but against the local DRAFT, not the live plan, since a
  // stepper here doesn't commit until Save.
  const setOne = useCallback((goalId: string, value: number) => {
    setAlloc((prev) => {
      const room = Math.max(0, salary - (budgetCap > 0 ? Math.min(budgetCap, salary) : 0));
      const next = allocationWithinSalary(room, prev, goalId, value);
      if (next === (prev[goalId] || 0)) return prev;
      const out = { ...prev };
      if (next > 0) out[goalId] = next; else delete out[goalId];
      return out;
    });
  }, [salary, budgetCap]);

  const onChangePair = useCallback(
    (leftId: string, leftValue: number, rightId: string, rightValue: number) => {
      setAlloc((prev) => {
        const out = { ...prev };
        const put = (id: string, v: number) => {
          if (id === FREE_ID || id === SPEND_ID) return;
          if (v > 0) out[id] = v; else delete out[id];
        };
        put(leftId, leftValue);
        put(rightId, rightValue);
        return out;
      });
    },
    [],
  );

  const startEditing = () => { hapticLight(); setEditing(true); };

  const cancelEditing = () => {
    hapticLight();
    seed();                       // throw the draft away, back to what's stored
    setEditingSalary(false);
    setEditing(false);
  };

  // A template is a STARTING POINT, not a silent write — tapping one opens the
  // real form (pre-filled) so the user sees what they're about to create and
  // can change any of it before Save actually adds the goal.
  const applyTemplate = (t: GoalTemplate) => {
    hapticLight();
    navigation.navigate('GoalForm', {
      prefill: {
        name: t.name, emoji: t.emoji, color: t.color, kind: t.kind,
        autoParentId: t.autoParentId ?? null, suggestedPct: t.suggestedPct,
        duration: TEMPLATE_DURATION,
      },
    });
  };

  const savePlan = () => submit(() => {
    setGoalPlan({ salary, allocations: alloc });
    setEditingSalary(false);
    setEditing(false);
    toast.success(planIsCurrent ? 'Plan updated' : `${MONTH_LABEL(thisMonth)} plan saved`);
  });

  const keepLastPlan = () => submit(() => {
    const scaled = rescaleAllocations(lastGoalPlan?.allocations, lastGoalPlan?.salary, lastGoalPlan?.salary);
    setGoalPlan({ salary: lastGoalPlan?.salary || 0, allocations: scaled });
    setEditing(false);
    toast.success(`${MONTH_LABEL(thisMonth)} plan saved`, "Last month's split, carried over.");
  });

  const commitSalary = () => {
    setEditingSalary(false);
    setSalaryText(String(snapAmount(parseAmount(salaryText))));
  };

  const openFund = (g: any) => { hapticLight(); setFundGoal(g); };

  // ── render ───────────────────────────────────────────────────────────────
  // Any goal's monthly amount already auto-carries at rollover (see
  // `rolloverGoalPlanIfNeeded`), so by the time this renders `!planIsCurrent`
  // means there was nothing to auto-carry — no goals, or none had an amount
  // set yet — and this hero would have nothing to offer either.
  const showRolloverHero = !planIsCurrent && !!lastGoalPlan && activeGoals.length > 0;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.root} edges={['top']}>
        <PlainScreenHeader
          title="Goals"
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          right={
            <TouchableOpacity
              onPress={() => { hapticLight(); setInfoOpen(true); }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="How goals work"
              style={styles.headerBtn}
            >
              <InfoIcon size={21} color={theme.textSecondary} />
            </TouchableOpacity>
          }
        />
        <Text style={[styles.monthLine, { color: theme.textMuted }]}>
          {MONTH_LABEL(thisMonth)} · {planIsCurrent ? 'plan set' : 'not set yet'}
        </Text>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>

          {/* ── nothing yet ──────────────────────────────────────────────── */}
          {activeGoals.length === 0 ? (
            <>
              <View style={[styles.card, { backgroundColor: theme.card }]}>
                <EmptyState
                  compact
                  icon="flag-outline"
                  title="Decide where the rest goes"
                  subtitle="Budget caps what you spend. Goals commit what's left — savings, investments, or money you're setting aside to lend."
                />
              </View>
              <SectionHeader
                icon="sparkles-outline"
                title="Start With One Of These"
                subtitle="Tap one and adjust the amount after."
                accentColor={theme.primary}
              />
              <View style={styles.templateWrap}>
                {GOAL_TEMPLATES.map((t) => (
                  <TouchableOpacity
                    key={t.name}
                    onPress={() => applyTemplate(t)}
                    activeOpacity={0.8}
                    style={[styles.template, { backgroundColor: theme.card, borderColor: theme.divider }]}
                  >
                    <Text style={styles.templateEmoji} allowFontScaling={false}>{t.emoji}</Text>
                    <View style={styles.flex1}>
                      <Text style={[styles.templateName, { color: theme.textPrimary }]} numberOfLines={1}>
                        {t.name}
                      </Text>
                      <Text style={[styles.templateHint, { color: theme.textMuted }]} numberOfLines={1}>
                        about {t.suggestedPct}% of salary
                      </Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={20} color={theme.primary} />
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.fabHint, { color: theme.textMuted }]}>
                Or tap + to name your own.
              </Text>
            </>
          ) : (
            <>
              {/* ── a new month, last plan ready to reuse ─────────────────── */}
              {showRolloverHero ? (
                <View style={[styles.card, { backgroundColor: withAlpha(theme.primary, 0.07), borderWidth: 1, borderColor: withAlpha(theme.primary, 0.2) }]}>
                  <Text style={[styles.heroTitle, { color: theme.textPrimary }]}>
                    {MONTH_LABEL(thisMonth)} is here
                  </Text>
                  <Text style={[styles.secSub, { color: theme.textSecondary }]}>
                    Your {MONTH_LABEL(lastGoalPlan.monthKey)} plan is ready to reuse. Nothing is saved
                    until you confirm.
                  </Text>
                  <View style={styles.heroBtns}>
                    <GradientButton title="Keep Last Month's Plan" onPress={keepLastPlan} loading={submitting} />
                  </View>
                </View>
              ) : null}

              {/* ── the goals themselves, first: they're the subject ─────── */}
              <View>
                <SectionHeader
                  icon="flag-outline"
                  title="Your Goals"
                  subtitle={
                    activeGoals.length >= MAX_ACTIVE_GOALS
                      ? `That's the most goals you can run at once (${MAX_ACTIVE_GOALS}).`
                      : usage
                        ? `${formatCurrency(usage.funded)} saved of ${formatCurrency(usage.planned)} planned this month`
                        : 'Set a plan below to start tracking them'
                  }
                  accentColor={theme.primary}
                  style={styles.secHead}
                />
                <View style={styles.grid}>
                  {activeGoals.map((g: any) => {
                    const row = usageByGoal.get(g.id);
                    const planned = row?.planned ?? Number(alloc[g.id]) ?? 0;
                    const lifetime = getGoalLifetimeSaved(g.id);
                    return (
                      <GoalCard
                        key={g.id}
                        name={g.name}
                        emoji={g.emoji}
                        color={g.color}
                        planned={planned}
                        funded={row?.funded ?? 0}
                        status={row?.status}
                        lifetimeSaved={lifetime}
                        lifetimeTarget={g.lifetimeTarget}
                        monthsLeft={
                          g.lifetimeTarget ? monthsToTarget(g.lifetimeTarget, lifetime, planned) : null
                        }
                        achieved={!!g.achievedAt}
                        // The body opens the goal's own detail screen — full
                        // stats plus the same transactions drill-down that
                        // used to live in a sheet here — while the pencil
                        // stays the only way into the EDIT form. They used to
                        // be the SAME tap, so opening a form you hadn't asked
                        // for was the only thing the body did.
                        onPress={() => { hapticLight(); navigation.navigate('GoalDetail', { goalId: g.id }); }}
                        onEdit={() => openForm(g.id)}
                        onAddMoney={() => openFund(g)}
                        style={styles.gridItem}
                      />
                    );
                  })}
                  {/* An odd goal count would leave the last tile double-width. */}
                  {activeGoals.length % 2 === 1 ? <View style={styles.gridItem} /> : null}
                </View>
              </View>

              {/* ── the plan: read-only until Edit ────────────────────────── */}
              <View style={[styles.card, { backgroundColor: theme.card }]}>
                <SectionHeader
                  icon="pie-chart-outline"
                  title="This Month's Split"
                  // While editing it names the one thing that ISN'T
                  // self-evident: that the bar's dividers are draggable, and
                  // there's a ± beside every goal too. Only said once there's
                  // a bar to drag — with no salary typed the card is a single
                  // empty field.
                  subtitle={
                    editing
                      ? (salary <= 0
                          ? 'Enter your salary to start splitting it.'
                          : `Drag a divider, or use ± · ₹${ALLOCATION_STEP} steps`)
                      : 'Add more to reach your goals sooner.'
                  }
                  accentColor={theme.primary}
                  right={
                    editing ? undefined : (
                      <TouchableOpacity
                        onPress={startEditing}
                        hitSlop={8}
                        activeOpacity={0.75}
                        style={[styles.editBtn, { borderColor: withAlpha(theme.primary, 0.45) }]}
                        accessibilityRole="button"
                        accessibilityLabel="Edit this month's plan"
                      >
                        <EditIcon size={12} color={theme.primary} />
                        <Text style={[styles.editTxt, { color: theme.primary }]}>Edit</Text>
                      </TouchableOpacity>
                    )
                  }
                  style={styles.secHead}
                />

                <Text style={[styles.eyebrow, { color: theme.textMuted }]}>MONTHLY SALARY</Text>
                {editing ? (
                  <TextInput
                    value={editingSalary ? salaryText : (salary > 0 ? formatCurrency(salary) : '')}
                    onChangeText={(t) => setSalaryText(sanitizeAmount(t))}
                    onFocus={() => setEditingSalary(true)}
                    onBlur={commitSalary}
                    placeholder="Enter your salary"
                    placeholderTextColor={theme.textMuted}
                    keyboardType="decimal-pad"
                    maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
                    style={[
                      styles.salaryInput,
                      {
                        color: theme.textPrimary,
                        borderColor: editingSalary ? theme.primary : 'transparent',
                        backgroundColor: editingSalary ? withAlpha(theme.primary, 0.06) : 'transparent',
                      },
                    ]}
                    accessibilityLabel="Monthly salary"
                  />
                ) : (
                  <Text style={[styles.salaryRead, { color: theme.textPrimary }]}>
                    {salary > 0 ? formatCurrency(salary) : '—'}
                  </Text>
                )}

                {salary > 0 ? (
                  <View style={styles.barWrap}>
                    <AllocationBar
                      salary={salary}
                      segments={segments}
                      onChangePair={onChangePair}
                      freeId={FREE_ID}
                      disabled={!editing}
                    />
                    <View style={styles.chipRow}>
                      <View
                        style={[
                          styles.chip,
                          {
                            backgroundColor: over
                              ? withAlpha(theme.danger, 0.12)
                              : free === 0 ? withAlpha(theme.success, 0.12) : withAlpha(theme.textMuted, 0.12),
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipTxt,
                            { color: over ? theme.danger : free === 0 ? theme.success : theme.textSecondary },
                          ]}
                        >
                          {over
                            ? `${formatCurrency(committed - salary)} Over Salary`
                            : free === 0 ? 'Fully Allocated' : `${formatCurrency(free)} Unallocated`}
                        </Text>
                      </View>
                    </View>

                    {/* legend / steppers */}
                    {budgetCap > 0 ? (
                      <View style={styles.lrow}>
                        <View style={[styles.swatch, { backgroundColor: withAlpha(theme.textMuted, 0.13) }]}>
                          <Ionicons name="lock-closed" size={14} color={theme.textSecondary} />
                        </View>
                        <View style={styles.flex1}>
                          <Text style={[styles.lname, { color: theme.textPrimary }]}>Spending</Text>
                          <Text style={[styles.lmeta, { color: theme.textMuted }]}>set in Budget</Text>
                        </View>
                        <Text style={[styles.lamt, { color: theme.textSecondary }]}>
                          {formatCurrency(Math.min(budgetCap, salary))}
                        </Text>
                      </View>
                    ) : null}

                    {activeGoals.map((g: any, i: number) => {
                      const value = Number(alloc[g.id]) || 0;
                      const row = usageByGoal.get(g.id);
                      return (
                        <View
                          key={g.id}
                          style={[
                            styles.lrow,
                            {
                              borderTopColor: theme.divider,
                              borderTopWidth: i === 0 && !budgetCap ? 0 : StyleSheet.hairlineWidth,
                            },
                          ]}
                        >
                          <View style={[styles.swatch, { backgroundColor: withAlpha(g.color, 0.13) }]}>
                            <Text style={styles.swatchEmoji} allowFontScaling={false}>{g.emoji}</Text>
                          </View>

                          <View style={styles.flex1}>
                            <Text style={[styles.lname, { color: theme.textPrimary }]} numberOfLines={1}>
                              {g.name}
                            </Text>
                            <Text style={[styles.lmeta, { color: theme.textMuted }]} numberOfLines={1}>
                              {salary > 0 ? `${Math.round((value / salary) * 100)}% of salary` : ''}
                              {/* Where the money came from, named. A goal that both
                                  matches spend AND takes typed entries needs both
                                  visible, or a double entry is invisible. */}
                              {row && row.autoFunded > 0 ? ` · ${formatCurrency(row.autoFunded)} matched` : ''}
                              {row && row.manualFunded > 0 ? ` · ${formatCurrency(row.manualFunded)} added` : ''}
                            </Text>
                          </View>

                          {editing ? (
                            <TouchableOpacity
                              onPress={() => { hapticLight(); setOne(g.id, value - ALLOCATION_STEP); }}
                              disabled={value <= 0}
                              style={[styles.step, { borderColor: theme.inputBorder, opacity: value <= 0 ? 0.35 : 1 }]}
                              accessibilityLabel={`Reduce ${g.name}`}
                            >
                              <Ionicons name="remove" size={13} color={theme.textSecondary} />
                            </TouchableOpacity>
                          ) : null}

                          <Text style={[styles.lamt, { color: theme.textPrimary }]}>{formatCurrency(value)}</Text>

                          {editing ? (
                            <TouchableOpacity
                              onPress={() => { hapticLight(); setOne(g.id, value + ALLOCATION_STEP); }}
                              disabled={free <= 0}
                              style={[styles.step, { borderColor: theme.inputBorder, opacity: free <= 0 ? 0.35 : 1 }]}
                              accessibilityLabel={`Increase ${g.name}`}
                            >
                              <Ionicons name="add" size={13} color={theme.textSecondary} />
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      );
                    })}

                    {/* Reconciliation — the line that ties Budget to Goals.
                        Every one of these four is already ON this card (the
                        salary figure above, Spending/each goal in the rows
                        just above, Free as the chip's own text) — it used to
                        be a SEPARATE bordered card after this one, restating
                        numbers already on screen in a box of its own. Folded
                        in as this card's closing row instead: a divider, then
                        the same four cells, reading as this card's own
                        summary rather than a second card competing for
                        attention at the end of the scroll. */}
                    <View style={[styles.reconRow, { borderTopColor: theme.divider }]}>
                      {[
                        { k: 'Salary', v: salary },
                        { k: 'Spending', v: Math.min(budgetCap, salary) },
                        { k: 'Goals', v: goalTotal },
                        { k: 'Free', v: free },
                      ].map((cell, i) => (
                        <View
                          key={cell.k}
                          style={[
                            styles.reconCell,
                            { borderLeftColor: theme.divider, borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth },
                          ]}
                        >
                          <Text style={[styles.reconK, { color: theme.textMuted }]}>{cell.k.toUpperCase()}</Text>
                          <Text style={[styles.reconV, { color: theme.textPrimary }]} numberOfLines={1}>
                            {formatCurrency(cell.v)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.secSub, { color: theme.textMuted, marginTop: spacing.sm }]}>
                    {editing
                      ? "Enter a figure to start splitting it. It's only used for this plan's maths — type a rough number if you'd rather."
                      : 'Tap Edit to set your salary and see it split.'}
                  </Text>
                )}
              </View>
            </>
          )}
        </ScrollView>

        {/* Pinned rather than inline in the scroll (Sep-12): Save used to sit
            at the very end of the content — past the split card, the
            reconciliation strip AND the full goal grid — so confirming a plan
            with a few goals meant scrolling past everything else on the screen
            first. Same footer-CTA pattern as GoalFormScreen and BudgetPlan's
            Save: a Save that scrolls away is a Save you have to hunt for. */}
        {editing && activeGoals.length > 0 ? (
          <View
            style={[
              styles.footer,
              { borderTopColor: theme.divider, paddingBottom: Math.max(insets.bottom, spacing.lg) },
            ]}
          >
            <View style={styles.saveRow}>
              <TouchableOpacity
                onPress={cancelEditing}
                activeOpacity={0.8}
                style={[styles.cancelBtn, { borderColor: theme.inputBorder }]}
                accessibilityRole="button"
              >
                <Text style={[styles.cancelTxt, { color: theme.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <GradientButton
                title={planIsCurrent ? 'Save Changes' : `Save ${MONTH_LABEL(thisMonth).split(' ')[0]} Plan`}
                onPress={savePlan}
                loading={submitting}
                disabled={over || salary <= 0}
                style={styles.flex1}
              />
            </View>
          </View>
        ) : null}
      </SafeAreaView>

      <GoalFundModal goal={fundGoal} onClose={() => setFundGoal(null)} />

      {/* Adding a goal is the screen's primary action, so it gets the same
          affordance it has on Home rather than a dashed row at the end of a
          list you have to scroll to find. It disappears at the cap — the old
          dashed row enforced that by hiding itself too, and a + that opens a
          form whose Save is refused would be worse. It ALSO disappears while
          editing the plan: the footer's Save/Cancel sits in the same bottom
          corner, and starting a second, unrelated goal mid-edit is exactly
          the moment a floating + would be a false shortcut rather than a
          convenience. */}
      {activeGoals.length < MAX_ACTIVE_GOALS && !editing ? (
        <FAB onPress={() => openForm()} bottomInset={insets.bottom} />
      ) : null}

      <InfoSheet
        visible={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={HOW_IT_WORKS.title}
        eyebrow={HOW_IT_WORKS.eyebrow}
        body={HOW_IT_WORKS.body}
        bullets={HOW_IT_WORKS.bullets}
      />

      <GoalAchievedModal
        visible={!!achievement}
        achievement={achievement}
        reward={reward}
        onClose={() => { setAchievement(null); setReward(null); }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  monthLine: { ...typography.tiny, textAlign: 'center', paddingBottom: spacing.sm },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // Clears the floating + (60pt button + its bottom inset), so the last card
  // isn't parked under it.
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + 72, gap: spacing.lg },
  flex1: { flex: 1 },

  card: { borderRadius: radius.lg, padding: spacing.lg, ...shadows.card },
  secHead: { marginBottom: spacing.md },
  secSub: { ...typography.small, marginTop: 2, lineHeight: 18 },
  eyebrow: { ...typography.tiny, fontWeight: '700', letterSpacing: 0.7 },
  heroTitle: { ...typography.h2 },
  heroBtns: { marginTop: spacing.md },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Two per row at any width: the basis leaves room for one gap between them.
  gridItem: { flexBasis: '47%', flexGrow: 1, maxWidth: '48.5%' },

  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 1, paddingVertical: 4,
  },
  editTxt: { ...typography.tiny, fontWeight: '700' },

  // Transparent border at rest so gaining the focus edge shifts nothing.
  salaryInput: {
    ...typography.display,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: -spacing.sm,
  },
  salaryRead: { ...typography.display, paddingVertical: spacing.xs + 1.5 },

  barWrap: { marginTop: spacing.lg },
  chipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.md, gap: spacing.sm,
  },
  chip: { paddingHorizontal: spacing.md - 1, paddingVertical: 6, borderRadius: radius.pill },
  chipTxt: { ...typography.tiny, fontWeight: '700' },

  lrow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md - 1 },
  swatch: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  swatchEmoji: { fontSize: 16 },
  lname: { ...typography.bodyBold },
  lmeta: { ...typography.tiny, marginTop: 2 },
  lamt: { ...typography.bodyBold, fontWeight: '700', minWidth: 78, textAlign: 'right' },
  step: {
    width: 24, height: 24, borderRadius: radius.sm,
    borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },

  // A closing row inside the split card, not a card of its own — same
  // top-hairline rhythm the legend rows already use, just wider (4 cells).
  reconRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md - 2,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reconCell: { flex: 1, paddingHorizontal: spacing.xs, alignItems: 'center' },
  reconK: { ...typography.tiny, fontWeight: '700', letterSpacing: 0.4, fontSize: 9 },
  reconV: { ...typography.small, fontWeight: '700', marginTop: 3 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cancelBtn: {
    borderWidth: 1.5, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, minHeight: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelTxt: { ...typography.body, fontWeight: '600' },

  templateWrap: { gap: spacing.sm },
  template: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1,
  },
  templateEmoji: { fontSize: 20 },
  templateName: { ...typography.bodyBold },
  templateHint: { ...typography.tiny, marginTop: 1 },

  fabHint: { ...typography.tiny, textAlign: 'center' },
});

export default GoalsScreen;
