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
//   • plan set            → the bar, the legend, and what's landed so far
//
// THE SALARY IS TYPED, NOT READ. The app already parses income from SMS, which
// is exactly why this screen asks instead of helping itself: a figure taken
// without being offered reads as surveillance, and the planning maths works
// just as well on a number the user made up. See the memory note on the income
// decision before wiring `getMonthlyIncome` in here.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
import { formatCurrency, monthKey } from '../utils/format';
import {
  ALLOCATION_STEP, allocatedTotal, freeAmount, snapAmount, allocationWithinSalary,
  rescaleAllocations, fundedPct, requiredMonthly, monthsToTarget,
} from '../utils/goalPlan';
import { GOAL_TEMPLATES, MAX_ACTIVE_GOALS, type GoalTemplate } from '../constants/goals';
import { INPUT_LIMITS, sanitizeAmount, parseAmount } from '../utils/validation';
import PlainScreenHeader from '../components/PlainScreenHeader';
import GradientButtonBase from '../components/GradientButton';
import EmptyState from '../components/EmptyState';
import CenterModal from '../components/CenterModal';
import AllocationBar, { type AllocationSegment } from '../components/AllocationBar';
import GoalEditorSheet, { type GoalDraft } from '../components/GoalEditorSheet';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
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

const MONTH_LABEL = (mk: string) => {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

const PACE_COPY: Record<string, string> = {
  funded: 'FUNDED',
  ahead: 'AHEAD',
  on_track: 'ON TRACK',
  behind: 'BEHIND',
};

const GoalsScreen = ({ navigation }: any) => {
  const theme = useTheme();

  const goals = useEPurseStore((s: any) => s.goals);
  const goalPlan = useEPurseStore((s: any) => s.goalPlan);
  const lastGoalPlan = useEPurseStore((s: any) => s.lastGoalPlan);
  const budget = useEPurseStore((s: any) => s.budget);
  const addGoal = useEPurseStore((s: any) => s.addGoal);
  const updateGoal = useEPurseStore((s: any) => s.updateGoal);
  const deleteGoal = useEPurseStore((s: any) => s.deleteGoal);
  const setGoalPlan = useEPurseStore((s: any) => s.setGoalPlan);
  const rolloverGoalPlanIfNeeded = useEPurseStore((s: any) => s.rolloverGoalPlanIfNeeded);
  const getGoalPlanUsage = useEPurseStore((s: any) => s.getGoalPlanUsage);
  const getGoalLifetimeSaved = useEPurseStore((s: any) => s.getGoalLifetimeSaved);
  const addGoalContribution = useEPurseStore((s: any) => s.addGoalContribution);

  const { submit, submitting } = useSubmitGuard();

  // A stale plan from a finished month must be retired before anything reads it.
  useEffect(() => { rolloverGoalPlanIfNeeded(); }, [rolloverGoalPlanIfNeeded]);

  const thisMonth = monthKey(new Date());
  const planIsCurrent = goalPlan?.monthKey === thisMonth;

  // ── local draft ──────────────────────────────────────────────────────────
  // The bar edits a DRAFT, committed by Save. Dragging straight into the store
  // would mean a half-made plan is the live one the moment a finger moves.
  const [salaryText, setSalaryText] = useState('');
  const [editingSalary, setEditingSalary] = useState(false);
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false);
  const [editorFor, setEditorFor] = useState<GoalDraft | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Logging money into a non-auto goal. Auto goals never open this — their
  // progress comes from real spend, and adding a manual figure on top would be
  // the double-count `goalFundedForMonth` deliberately prevents.
  const [fundFor, setFundFor] = useState<{ id: string; name: string } | null>(null);
  const [fundText, setFundText] = useState('');

  const seed = useCallback(() => {
    const src = planIsCurrent ? goalPlan : lastGoalPlan;
    setSalaryText(src?.salary ? String(src.salary) : '');
    setAlloc({ ...(src?.allocations || {}) });
    setDirty(false);
  }, [planIsCurrent, goalPlan, lastGoalPlan]);

  useEffect(() => { seed(); }, [seed]);

  const salary = parseAmount(salaryText);
  const budgetCap = Number(budget?.totalCap) || 0;

  const activeGoals = useMemo(() => goals.filter((g: any) => !g.archivedAt), [goals]);

  /** Spending rides in the same bar so savings and spending read as one split. */
  const segments: AllocationSegment[] = useMemo(() => {
    const rows: AllocationSegment[] = [];
    if (budgetCap > 0) {
      rows.push({ id: '__spend__', label: 'Spending', emoji: '🔒', color: theme.textMuted, value: Math.min(budgetCap, salary), locked: true });
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

  // ── editing ──────────────────────────────────────────────────────────────
  const setOne = useCallback((goalId: string, value: number) => {
    setAlloc((prev) => {
      const room = Math.max(0, salary - (budgetCap > 0 ? Math.min(budgetCap, salary) : 0));
      const next = allocationWithinSalary(room, prev, goalId, value);
      if (next === (prev[goalId] || 0)) return prev;
      const out = { ...prev };
      if (next > 0) out[goalId] = next; else delete out[goalId];
      return out;
    });
    setDirty(true);
  }, [salary, budgetCap]);

  const onChangePair = useCallback(
    (leftId: string, leftValue: number, rightId: string, rightValue: number) => {
      setAlloc((prev) => {
        const out = { ...prev };
        const put = (id: string, v: number) => {
          if (id === FREE_ID || id === '__spend__') return;
          if (v > 0) out[id] = v; else delete out[id];
        };
        put(leftId, leftValue);
        put(rightId, rightValue);
        return out;
      });
      setDirty(true);
    },
    [],
  );

  const applyTemplate = (t: GoalTemplate) => {
    hapticLight();
    const id = addGoal({
      name: t.name, emoji: t.emoji, color: t.color, kind: t.kind, autoParentId: t.autoParentId ?? null,
    });
    if (id && salary > 0) {
      setAlloc((prev) => ({ ...prev, [id]: snapAmount((salary * t.suggestedPct) / 100) }));
      setDirty(true);
    }
  };

  const savePlan = () => submit(() => {
    setGoalPlan({ salary, allocations: alloc });
    setDirty(false);
  });

  const keepLastPlan = () => submit(() => {
    const scaled = rescaleAllocations(lastGoalPlan?.allocations, lastGoalPlan?.salary, lastGoalPlan?.salary);
    setGoalPlan({ salary: lastGoalPlan?.salary || 0, allocations: scaled });
    setDirty(false);
  });

  const commitSalary = () => {
    setEditingSalary(false);
    setSalaryText(String(snapAmount(parseAmount(salaryText))));
    setDirty(true);
  };

  // ── render ───────────────────────────────────────────────────────────────
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
            activeGoals.length > 0 ? (
              <TouchableOpacity
                onPress={() => setEditorFor(null)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Add a goal"
                style={styles.headerBtn}
              >
                <Ionicons name="add" size={26} color={theme.primary} />
              </TouchableOpacity>
            ) : undefined
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
              <Text style={[styles.secTitle, { color: theme.textPrimary }]}>Start with one of these</Text>
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
              <TouchableOpacity
                onPress={() => setEditorFor(null)}
                activeOpacity={0.8}
                style={[styles.addOwn, { borderColor: theme.inputBorder }]}
              >
                <Text style={[styles.addOwnTxt, { color: theme.textSecondary }]}>+ Create your own</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* ── a new month, last plan ready to reuse ─────────────────── */}
              {showRolloverHero ? (
                <View style={[styles.card, { backgroundColor: theme.primary + '12', borderWidth: 1, borderColor: theme.primary + '33' }]}>
                  <Text style={[styles.heroTitle, { color: theme.textPrimary }]}>
                    {MONTH_LABEL(thisMonth)} is here
                  </Text>
                  <Text style={[styles.secSub, { color: theme.textSecondary }]}>
                    Your {MONTH_LABEL(lastGoalPlan.monthKey)} plan is ready to reuse. Nothing is saved
                    until you confirm.
                  </Text>
                  <View style={styles.heroBtns}>
                    <GradientButton title="Keep last month's plan" onPress={keepLastPlan} loading={submitting} />
                  </View>
                </View>
              ) : null}

              {/* ── salary + the bar ─────────────────────────────────────── */}
              <View style={[styles.card, { backgroundColor: theme.card }]}>
                <Text style={[styles.eyebrow, { color: theme.textMuted }]}>MONTHLY SALARY</Text>
                <View style={styles.salaryRow}>
                  <TextInput
                    value={editingSalary ? salaryText : (salary > 0 ? formatCurrency(salary) : '')}
                    onChangeText={(t) => { setSalaryText(sanitizeAmount(t)); setDirty(true); }}
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
                        backgroundColor: editingSalary ? theme.primary + '0F' : 'transparent',
                      },
                    ]}
                    accessibilityLabel="Monthly salary"
                  />
                </View>

                {salary > 0 ? (
                  <View style={styles.barWrap}>
                    <AllocationBar
                      salary={salary}
                      segments={segments}
                      onChangePair={onChangePair}
                      freeId={FREE_ID}
                    />
                    <View style={styles.chipRow}>
                      <View
                        style={[
                          styles.chip,
                          {
                            backgroundColor: over
                              ? theme.danger + '1F'
                              : free === 0 ? theme.success + '1F' : theme.textMuted + '1F',
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
                            ? `${formatCurrency(committed - salary)} over salary`
                            : free === 0 ? 'Fully allocated' : `${formatCurrency(free)} unallocated`}
                        </Text>
                      </View>
                      <Text style={[styles.hint, { color: theme.textMuted }]}>
                        Drag a divider · ₹{ALLOCATION_STEP} steps
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text style={[styles.secSub, { color: theme.textMuted, marginTop: spacing.sm }]}>
                    Enter a figure to start splitting it. It's only used for this plan's maths — type a
                    rough number if you'd rather.
                  </Text>
                )}
              </View>

              {/* ── legend ───────────────────────────────────────────────── */}
              {salary > 0 ? (
                <View style={[styles.card, { backgroundColor: theme.card }]}>
                  <Text style={[styles.secTitle, { color: theme.textPrimary }]}>This month's split</Text>
                  <Text style={[styles.secSub, { color: theme.textSecondary }]}>
                    Tap ± to nudge, or drag the bar above.
                  </Text>

                  {budgetCap > 0 ? (
                    <View style={[styles.lrow, { borderTopColor: theme.divider, borderTopWidth: 0 }]}>
                      <View style={[styles.swatch, { backgroundColor: theme.textMuted + '22' }]}>
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
                    const row = usage?.perGoal?.find((r: any) => r.goalId === g.id);
                    return (
                      <View
                        key={g.id}
                        style={[
                          styles.lrow,
                          { borderTopColor: theme.divider, borderTopWidth: i === 0 && !budgetCap ? 0 : StyleSheet.hairlineWidth },
                        ]}
                      >
                        <TouchableOpacity
                          onPress={() => setEditorFor({
                            id: g.id, name: g.name, emoji: g.emoji, color: g.color,
                            kind: g.kind, lifetimeTarget: g.lifetimeTarget, autoParentId: g.autoParentId,
                          })}
                          style={[styles.swatch, { backgroundColor: g.color + '22' }]}
                          accessibilityLabel={`Edit ${g.name}`}
                        >
                          <Text style={styles.swatchEmoji} allowFontScaling={false}>{g.emoji}</Text>
                        </TouchableOpacity>

                        <View style={styles.flex1}>
                          <Text style={[styles.lname, { color: theme.textPrimary }]} numberOfLines={1}>
                            {g.name}
                          </Text>
                          <Text style={[styles.lmeta, { color: theme.textMuted }]} numberOfLines={1}>
                            {salary > 0 ? `${Math.round((value / salary) * 100)}% of salary` : ''}
                            {row?.auto ? ' · tracks itself' : ''}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => { hapticLight(); setOne(g.id, value - ALLOCATION_STEP); }}
                          disabled={value <= 0}
                          style={[styles.step, { borderColor: theme.inputBorder, opacity: value <= 0 ? 0.35 : 1 }]}
                          accessibilityLabel={`Reduce ${g.name}`}
                        >
                          <Ionicons name="remove" size={13} color={theme.textSecondary} />
                        </TouchableOpacity>

                        <Text style={[styles.lamt, { color: theme.textPrimary }]}>{formatCurrency(value)}</Text>

                        <TouchableOpacity
                          onPress={() => { hapticLight(); setOne(g.id, value + ALLOCATION_STEP); }}
                          disabled={free <= 0}
                          style={[styles.step, { borderColor: theme.inputBorder, opacity: free <= 0 ? 0.35 : 1 }]}
                          accessibilityLabel={`Increase ${g.name}`}
                        >
                          <Ionicons name="add" size={13} color={theme.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  {activeGoals.length < MAX_ACTIVE_GOALS ? (
                    <TouchableOpacity
                      onPress={() => setEditorFor(null)}
                      activeOpacity={0.8}
                      style={[styles.addOwn, { borderColor: theme.inputBorder, marginTop: spacing.md }]}
                    >
                      <Text style={[styles.addOwnTxt, { color: theme.textSecondary }]}>+ Add a goal</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {/* ── reconciliation: the line that ties Budget to Goals ───── */}
              {salary > 0 ? (
                <View style={[styles.recon, { backgroundColor: theme.card, borderColor: theme.divider }]}>
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
              ) : null}

              {/* ── progress, once a plan is live ────────────────────────── */}
              {usage && usage.perGoal.length > 0 ? (
                <View style={[styles.card, { backgroundColor: theme.card }]}>
                  <Text style={[styles.secTitle, { color: theme.textPrimary }]}>Funded so far</Text>
                  <Text style={[styles.secSub, { color: theme.textSecondary }]}>
                    {formatCurrency(usage.funded)} of your {formatCurrency(usage.planned)} plan
                  </Text>

                  {usage.perGoal.map((row: any) => {
                    const g = activeGoals.find((x: any) => x.id === row.goalId);
                    if (!g) return null;
                    const lifetime = g.lifetimeTarget ? getGoalLifetimeSaved(g.id) : 0;
                    const left = g.lifetimeTarget
                      ? monthsToTarget(g.lifetimeTarget, lifetime, row.planned)
                      : null;
                    return (
                      <View key={row.goalId} style={styles.progRow}>
                        <View style={styles.progTop}>
                          <Text style={styles.swatchEmoji} allowFontScaling={false}>{g.emoji}</Text>
                          <Text style={[styles.lname, { color: theme.textPrimary, flex: 1 }]} numberOfLines={1}>
                            {g.name}
                          </Text>
                          <View
                            style={[
                              styles.pace,
                              {
                                backgroundColor:
                                  row.status === 'behind' ? theme.warning + '22'
                                  : row.status === 'funded' ? theme.primary + '1A'
                                  : theme.success + '1A',
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.paceTxt,
                                {
                                  color:
                                    row.status === 'behind' ? theme.warning
                                    : row.status === 'funded' ? theme.primary
                                    : theme.success,
                                },
                              ]}
                            >
                              {PACE_COPY[row.status] || ''}
                            </Text>
                          </View>
                        </View>
                        <View style={[styles.track, { backgroundColor: theme.divider }]}>
                          <View style={[styles.fill, { width: `${row.pct}%`, backgroundColor: g.color }]} />
                        </View>
                        <View style={styles.progBottom}>
                          <Text style={[styles.lmeta, { color: theme.textMuted, flex: 1 }]}>
                            {formatCurrency(row.funded)} of {formatCurrency(row.planned)}
                            {g.lifetimeTarget
                              ? ` · ${formatCurrency(lifetime)} of ${formatCurrency(g.lifetimeTarget)} overall${
                                  left ? ` · ${left} months to go` : ''}`
                              : ''}
                          </Text>
                          {/* Auto goals have no button: their progress is real spend, and a
                              manual top-up on one would be counted twice. */}
                          {row.auto ? (
                            <Text style={[styles.autoTag, { color: theme.textMuted }]}>AUTO</Text>
                          ) : (
                            <TouchableOpacity
                              onPress={() => { hapticLight(); setFundText(''); setFundFor({ id: g.id, name: g.name }); }}
                              activeOpacity={0.75}
                              style={[styles.fundBtn, { borderColor: theme.primary + '55' }]}
                              accessibilityRole="button"
                              accessibilityLabel={`Add money to ${g.name}`}
                            >
                              <Ionicons name="add" size={13} color={theme.primary} />
                              <Text style={[styles.fundTxt, { color: theme.primary }]}>Add money</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {/* ── save ─────────────────────────────────────────────────── */}
              {salary > 0 && (dirty || !planIsCurrent) ? (
                <GradientButton
                  title={planIsCurrent ? 'Update plan' : `Save ${MONTH_LABEL(thisMonth).split(' ')[0]} plan`}
                  onPress={savePlan}
                  loading={submitting}
                  disabled={over}
                />
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <GoalEditorSheet
        visible={editorFor !== undefined}
        initial={editorFor}
        onClose={() => setEditorFor(undefined)}
        onSave={(draft) => {
          if (draft.id) updateGoal(draft.id, draft);
          else addGoal(draft);
          setDirty(true);
        }}
        onDelete={editorFor?.id ? () => setConfirmDelete(editorFor.id!) : undefined}
      />

      {/* Log money into a manual goal. A plain amount prompt rather than a full
          sheet: one number, typed and gone. */}
      <CenterModal
        visible={!!fundFor}
        title={fundFor ? `Add to ${fundFor.name}` : ''}
        message="How much did you put aside?"
        primaryText="Add"
        secondaryText="Cancel"
        onPrimary={() => {
          const amt = parseAmount(fundText);
          if (fundFor && amt > 0) addGoalContribution(fundFor.id, amt);
          setFundFor(null);
        }}
        onSecondary={() => setFundFor(null)}
        onClose={() => setFundFor(null)}
      >
        <TextInput
          value={fundText}
          onChangeText={(t) => setFundText(sanitizeAmount(t))}
          placeholder="0"
          placeholderTextColor={theme.textMuted}
          keyboardType="decimal-pad"
          autoFocus
          maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
          style={[
            styles.fundInput,
            { color: theme.textPrimary, borderColor: theme.inputBorder, backgroundColor: theme.cardAlt },
          ]}
          accessibilityLabel="Amount"
        />
      </CenterModal>

      <CenterModal
        visible={!!confirmDelete}
        title="Remove this goal?"
        message="Its allocation and logged contributions go with it. Money already spent or saved isn't affected."
        primaryText="Remove"
        secondaryText="Keep it"
        destructive
        onPrimary={() => {
          if (confirmDelete) deleteGoal(confirmDelete);
          setConfirmDelete(null);
          setEditorFor(undefined);
        }}
        onSecondary={() => setConfirmDelete(null)}
        onClose={() => setConfirmDelete(null)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  monthLine: { ...typography.tiny, textAlign: 'center', paddingBottom: spacing.sm },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  flex1: { flex: 1 },

  card: { borderRadius: radius.lg, padding: spacing.lg, ...shadows.card },
  secTitle: { ...typography.h3 },
  secSub: { ...typography.small, marginTop: 2, lineHeight: 18 },
  eyebrow: { ...typography.tiny, fontWeight: '700', letterSpacing: 0.7 },
  heroTitle: { ...typography.h2 },
  heroBtns: { marginTop: spacing.md },

  salaryRow: { flexDirection: 'row', alignItems: 'center' },
  // Transparent border at rest so gaining the focus edge shifts nothing.
  salaryInput: {
    ...typography.display,
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: -spacing.sm,
  },

  barWrap: { marginTop: spacing.lg },
  chipRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing.md, gap: spacing.sm,
  },
  chip: { paddingHorizontal: spacing.md - 1, paddingVertical: 6, borderRadius: radius.pill },
  chipTxt: { ...typography.tiny, fontWeight: '700' },
  hint: { ...typography.tiny, flexShrink: 1, textAlign: 'right' },

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

  recon: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, overflow: 'hidden' },
  reconCell: { flex: 1, paddingVertical: spacing.md - 2, paddingHorizontal: spacing.xs, alignItems: 'center' },
  reconK: { ...typography.tiny, fontWeight: '700', letterSpacing: 0.4, fontSize: 9 },
  reconV: { ...typography.small, fontWeight: '700', marginTop: 3 },

  progRow: { marginTop: spacing.lg },
  progTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pace: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: radius.pill },
  paceTxt: { ...typography.tiny, fontWeight: '800', fontSize: 9.5, letterSpacing: 0.3 },
  track: { height: 5, borderRadius: radius.pill, marginTop: spacing.sm, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  progBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  autoTag: { ...typography.tiny, fontWeight: '800', fontSize: 9, letterSpacing: 0.5 },
  fundBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
  },
  fundTxt: { ...typography.tiny, fontWeight: '700' },
  fundInput: {
    ...typography.h2,
    textAlign: 'center',
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.md - 2,
    paddingHorizontal: spacing.md,
  },

  templateWrap: { gap: spacing.sm },
  template: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1,
  },
  templateEmoji: { fontSize: 20 },
  templateName: { ...typography.bodyBold },
  templateHint: { ...typography.tiny, marginTop: 1 },

  addOwn: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radius.md,
    paddingVertical: spacing.md, alignItems: 'center',
  },
  addOwnTxt: { ...typography.small, fontWeight: '600' },
});

export default GoalsScreen;
