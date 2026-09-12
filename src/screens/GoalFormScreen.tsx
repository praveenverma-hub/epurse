// =============================================================================
// GoalFormScreen — create or edit ONE goal. The app's only goal form.
//
// Was `GoalEditorSheet`, a bottom sheet. It became a pushed screen for two
// reasons, and the second one was a live bug:
//
//   1. It outgrew a sheet. Name, glyph, colour, kind, target AND an auto-funding
//      rule with a row per category is a form, not a prompt — ui-consistency
//      §2b: pick by GROWTH, not by weight.
//   2. **Delete did nothing.** The sheet was itself a `<Modal>`, and its delete
//      confirmation was a second `<Modal>` rendered as a sibling while the first
//      was still visible. Two native modals don't reliably stack (§8b), so the
//      confirm never appeared and the button read as broken. A pushed screen is
//      not a modal, so its confirm is the only one on screen.
//
// Input rules follow the input-validation skill: maxLength caps typing,
// sanitize* cleans each keystroke, isValid* gates the submit.
//
// ── the monthly amount lives here too (Sep-12-26) ────────────────────────────
// Save writes both: the goal itself, and (if a plan exists for this month)
// its allocation via `updateGoalAllocation`. GoalsScreen's split bar ALSO
// edits this same number (drag/steppers) — the two are meant to coexist, see
// that screen's own header comment for why that's safe.
//
// ── DURATION: One-Time vs Recurring (Sep-12-26) ──────────────────────────────
// A second axis from `kind` (kind is what the money is FOR; duration is
// whether it has a finish line) — chosen FIRST, because it decides which ONE
// of Overall Target / Monthly Contribution shows next, never both. A
// Recurring goal's monthly figure re-applies automatically at rollover
// without waiting for a monthly confirmation, unlike everything else in
// Goals — see `rolloverGoalPlanIfNeeded` in the store.
//
// Route params:
//   goalId — editing an existing goal instead of creating one (optional)
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import {
  radius, spacing, typography as typographyBase, BUTTON_H,
} from '../constants/theme';
import {
  INPUT_LIMITS, sanitizeName, isValidName, sanitizeAmount, parseAmount,
} from '../utils/validation';
import { allocatedTotal, snapAmount } from '../utils/goalPlan';
import { formatCurrency, monthKey } from '../utils/format';
import {
  GOAL_COLORS, GOAL_KIND_META, GOAL_KINDS, DEFAULT_GOAL_EMOJI, GOAL_MERCHANT_LIMIT,
  GOAL_DURATIONS, GOAL_DURATION_META, type GoalKind, type GoalDuration,
} from '../constants/goals';
import { useCategoryTree } from '../hooks/useCategoryTree';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { FormSelectRow } from '../components/FormField';
import CenterModal from '../components/CenterModal';
import GoalCategoryPickerModal from '../components/GoalCategoryPickerModal';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useToast } from '../components/Toast';
import { hapticLight } from '../utils/haptics';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** Glyphs offered for a goal. A goal's emoji is DATA, so it stays an emoji —
 *  the icons rule's stated exception, same as a category's or a group's. */
const EMOJI_CHOICES = ['🎯', '🛟', '📈', '✈️', '🏠', '🎓', '🚗', '💍', '🤝', '💻', '🏥', '🎁'];

const GoalFormScreen = ({ navigation, route }: any) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { submit, submitting } = useSubmitGuard();
  const toast = useToast();

  const goalId: string | undefined = route?.params?.goalId;
  // A template row on the empty-goals state navigates here with a starting
  // point instead of creating the goal silently — the user still SEES and can
  // adjust the name/glyph/colour/rule/suggested amount before anything is
  // written. Only read when creating; an edit always seeds from the real goal.
  const prefill = route?.params?.prefill as
    | {
        name?: string; emoji?: string; color?: string; kind?: GoalKind;
        autoParentId?: string | null; suggestedPct?: number; duration?: GoalDuration;
      }
    | undefined;
  const goals = useEPurseStore((s: any) => s.goals);
  const addGoal = useEPurseStore((s: any) => s.addGoal);
  const updateGoal = useEPurseStore((s: any) => s.updateGoal);
  const deleteGoal = useEPurseStore((s: any) => s.deleteGoal);
  const goalPlan = useEPurseStore((s: any) => s.goalPlan);
  const budget = useEPurseStore((s: any) => s.budget);
  const updateGoalAllocation = useEPurseStore((s: any) => s.updateGoalAllocation);

  const existing = useMemo(
    () => (goalId ? goals.find((g: any) => g.id === goalId) : null),
    [goalId, goals],
  );
  const isEdit = !!existing;

  const tree = useCategoryTree();

  // A goal's MONTHLY amount lives here now, not in a separate "split" screen
  // (Sep-12-26) — the two numbers a goal has (lifetime target, monthly
  // commitment) both live where you'd look for either. But a monthly amount
  // only means something against a confirmed plan for THIS month; there is
  // nothing to commit it into otherwise, so the field is read-only guidance
  // until one exists.
  const planIsCurrent = goalPlan?.monthKey === monthKey(new Date());
  const budgetCap = Number(budget?.totalCap) || 0;
  const planRoom = planIsCurrent
    ? Math.max(0, (Number(goalPlan.salary) || 0) - (budgetCap > 0 ? Math.min(budgetCap, Number(goalPlan.salary) || 0) : 0))
    : 0;
  const otherAllocations = useMemo(() => {
    const o = { ...(goalPlan?.allocations || {}) };
    if (existing) delete o[existing.id];
    return o;
  }, [goalPlan, existing]);
  const freeRoom = Math.max(0, planRoom - allocatedTotal(otherAllocations));

  // Seeded ONCE from the route's goal. A pushed screen is mounted fresh per
  // visit, so there is no stale-instance problem to guard against here — that
  // was the sheet's `visible`-toggle hazard, and it left with the sheet.
  const [name, setName] = useState(existing?.name ?? prefill?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? prefill?.emoji ?? DEFAULT_GOAL_EMOJI);
  const [color, setColor] = useState(existing?.color ?? prefill?.color ?? GOAL_COLORS[0]);
  const [kind, setKind] = useState<GoalKind>(existing?.kind ?? prefill?.kind ?? GOAL_KINDS.SAVING);
  // DURATION decides whether the Overall Target field exists at all — a
  // Monthly Contribution is available on BOTH (Sep-12-26, revised same day: a
  // one-time goal funded steadily every month toward its target is the
  // common case, not an edge case). Kept as its own axis from `kind`: `kind`
  // is what the money is FOR, `duration` is whether it has a finish line.
  const [duration, setDuration] = useState<GoalDuration>(
    existing?.duration ?? prefill?.duration ?? GOAL_DURATIONS.RECURRING,
  );
  const isOneTime = duration === GOAL_DURATIONS.ONE_TIME;
  const [target, setTarget] = useState(existing?.lifetimeTarget ? String(existing.lifetimeTarget) : '');
  const [monthly, setMonthly] = useState(() => {
    if (existing) {
      return planIsCurrent && goalPlan?.allocations?.[existing.id]
        ? String(goalPlan.allocations[existing.id])
        : '';
    }
    // A template's "suggested %" used to seed a draft allocation directly;
    // now it just pre-fills this field, clamped to what's actually free —
    // still a starting point, never something written without a Save.
    if (!planIsCurrent || !prefill?.suggestedPct) return '';
    const suggested = Math.min(freeRoom, snapAmount((Number(goalPlan.salary) * prefill.suggestedPct) / 100));
    return suggested > 0 ? String(suggested) : '';
  });
  const [showError, setShowError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Auto-funding rule, held as three independent lists because the match is an
  // OR: a parent, a single sub-category, or a merchant keyword each count on
  // their own. Keeping them separate is what lets "Investments OR Zerodha"
  // exist without inventing a query language.
  const [parentIds, setParentIds] = useState<string[]>(
    existing?.autoRule?.parentIds ?? (prefill?.autoParentId ? [prefill.autoParentId] : []),
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(existing?.autoRule?.categoryIds ?? []);
  const [merchants, setMerchants] = useState<string[]>(existing?.autoRule?.merchants ?? []);
  const [merchantText, setMerchantText] = useState('');
  // The category tree itself is what grows unboundedly, not this form — see
  // GoalCategoryPickerModal's own header comment. Selections still live HERE
  // (parentIds/categoryIds above); the sheet edits them directly.
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  const nameOk = isValidName(name);
  const ruleCount = parentIds.length + categoryIds.length + merchants.length;

  // One line for the select row — every chosen parent's label, or a chosen
  // child's own label when only that child (not the whole parent) is picked.
  // `numberOfLines` on the row truncates it if it ever runs long; there is no
  // need to cap it manually.
  const categorySummary = useMemo(() => {
    const names: string[] = [];
    tree.forEach((p) => {
      if (parentIds.includes(p.id)) { names.push(p.label); return; }
      p.children.forEach((c) => {
        if (c.legacyId && categoryIds.includes(c.legacyId)) names.push(c.label);
      });
    });
    return names.join(', ');
  }, [tree, parentIds, categoryIds]);

  // Switching TO Recurring clears the target — Recurring never has one, so a
  // value typed before flipping back never leaks in as a stale target. The
  // Monthly Contribution field is common to both durations now, so it is
  // never cleared by this switch.
  const chooseDuration = (d: GoalDuration) => {
    hapticLight();
    setDuration(d);
    if (d === GOAL_DURATIONS.RECURRING) setTarget('');
  };

  const addMerchant = () => {
    const key = merchantText.trim();
    if (!key || merchants.length >= GOAL_MERCHANT_LIMIT) return;
    // Case-insensitive dedupe — the matcher folds case anyway, so "Zerodha"
    // and "ZERODHA" as two chips would be one rule shown twice.
    if (merchants.some((m) => m.toLowerCase() === key.toLowerCase())) { setMerchantText(''); return; }
    hapticLight();
    setMerchants([...merchants, key]);
    setMerchantText('');
  };

  const handleSave = () => {
    if (!nameOk) { setShowError(true); return; }
    submit(() => {
      const patch = {
        name: name.trim(),
        emoji,
        color,
        kind,
        duration,
        // Recurring never keeps a target — that field is force-cleared here,
        // not just hidden, so switching TO Recurring can't leave a stale
        // target for the ribbon to read. One-Time keeps whatever target (and
        // separately, whatever monthly figure — see below) was set.
        lifetimeTarget: isOneTime && target ? parseAmount(target) || null : null,
        autoRule: ruleCount > 0 ? { parentIds, categoryIds, merchants } : null,
      };
      let gid: string | undefined = existing?.id;
      if (isEdit) updateGoal(existing.id, patch);
      else gid = addGoal(patch);
      // Committing the monthly figure is a SEPARATE store write (allocations
      // live on the plan, not the goal) — but one Save, one action, from the
      // user's side; there's no plan to commit into until a salary exists.
      // This applies on EITHER duration now — a One-Time goal can be funded
      // monthly toward its target exactly like a Recurring one.
      if (planIsCurrent && gid) {
        updateGoalAllocation(gid, monthly ? parseAmount(monthly) : 0);
      }
      navigation.goBack();
      // Fired AFTER goBack, same as ReminderFormScreen: the toast renders from
      // the screen the user lands ON (GoalsScreen), not the one being popped —
      // firing it before the pop shows it for a single frame on a screen about
      // to disappear.
      toast.success(isEdit ? 'Goal updated' : 'Goal added', patch.name);
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.root} edges={['top']}>
        <PlainScreenHeader
          title={isEdit ? 'Edit Goal' : 'New Goal'}
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
        />

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── name ───────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>Name</Text>
          <TextInput
            value={name}
            onChangeText={(t) => { setName(sanitizeName(t)); setShowError(false); }}
            placeholder="Emergency Fund"
            placeholderTextColor={theme.textMuted}
            maxLength={INPUT_LIMITS.NAME_MAX}
            style={[
              styles.input,
              {
                color: theme.textPrimary,
                backgroundColor: theme.cardAlt,
                borderColor: showError && !nameOk ? theme.danger : theme.inputBorder,
              },
            ]}
          />
          {showError && !nameOk ? (
            <Text style={[styles.err, { color: theme.danger }]}>
              Give the goal a name of at least {INPUT_LIMITS.NAME_MIN} characters.
            </Text>
          ) : null}

          {/* ── kind ───────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>Type</Text>
          <View style={styles.kindRow}>
            {(Object.keys(GOAL_KIND_META) as GoalKind[]).map((k) => {
              const meta = GOAL_KIND_META[k];
              const on = kind === k;
              return (
                <TouchableOpacity
                  key={k}
                  onPress={() => { hapticLight(); setKind(k); }}
                  activeOpacity={0.8}
                  style={[
                    styles.kindChip,
                    {
                      borderColor: on ? theme.primary : theme.inputBorder,
                      backgroundColor: on ? theme.primary + '14' : 'transparent',
                    },
                  ]}
                >
                  <Ionicons name={meta.icon} size={15} color={on ? theme.primary : theme.textSecondary} />
                  <Text
                    style={[styles.kindTxt, { color: on ? theme.primary : theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: theme.textMuted }]}>{GOAL_KIND_META[kind].hint}</Text>

          {/* ── duration ───────────────────────────────────────────────── */}
          {/* Chosen FIRST because it decides which single field shows next —
              a target for a one-time goal, a monthly figure for a recurring
              one, never both. Reordering this after either field would mean
              showing one, then yanking it away the moment duration is picked. */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>Duration</Text>
          <View style={styles.kindRow}>
            {(Object.keys(GOAL_DURATION_META) as GoalDuration[]).map((d) => {
              const meta = GOAL_DURATION_META[d];
              const on = duration === d;
              return (
                <TouchableOpacity
                  key={d}
                  onPress={() => chooseDuration(d)}
                  activeOpacity={0.8}
                  style={[
                    styles.kindChip,
                    {
                      borderColor: on ? theme.primary : theme.inputBorder,
                      backgroundColor: on ? theme.primary + '14' : 'transparent',
                    },
                  ]}
                >
                  <Ionicons name={meta.icon} size={15} color={on ? theme.primary : theme.textSecondary} />
                  <Text
                    style={[styles.kindTxt, { color: on ? theme.primary : theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {meta.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: theme.textMuted }]}>{GOAL_DURATION_META[duration].hint}</Text>

          {/* ── target: One-Time only ───────────────────────────────────── */}
          {isOneTime ? (
            <>
              <Text style={[styles.label, { color: theme.textSecondary }]}>
                Overall target <Text style={{ color: theme.textMuted }}>· optional</Text>
              </Text>
              <TextInput
                value={target}
                onChangeText={(t) => setTarget(sanitizeAmount(t))}
                placeholder="e.g. 300000"
                placeholderTextColor={theme.textMuted}
                keyboardType="decimal-pad"
                maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
                style={[
                  styles.input,
                  { color: theme.textPrimary, backgroundColor: theme.cardAlt, borderColor: theme.inputBorder },
                ]}
              />
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {monthly
                  ? "We'll tell you the month you'll finish at this pace — and celebrate when you get there."
                  : 'Set one, and optionally a monthly amount below to track your pace toward it.'}
              </Text>
            </>
          ) : null}

          {/* ── monthly contribution: BOTH durations (Sep-12-26) ───────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            Monthly Contribution <Text style={{ color: theme.textMuted }}>· optional</Text>
          </Text>
          {planIsCurrent ? (
            <>
              <TextInput
                value={monthly}
                onChangeText={(t) => setMonthly(sanitizeAmount(t))}
                placeholder="e.g. 5000"
                placeholderTextColor={theme.textMuted}
                keyboardType="decimal-pad"
                maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
                style={[
                  styles.input,
                  { color: theme.textPrimary, backgroundColor: theme.cardAlt, borderColor: theme.inputBorder },
                ]}
              />
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {freeRoom > 0
                  ? `${formatCurrency(freeRoom)} unallocated this month. Reapplies automatically every month after.`
                  : "This month is fully allocated — raising this takes room from what's already set."}
              </Text>
            </>
          ) : (
            <Text style={[styles.hint, { color: theme.textMuted, marginTop: 0 }]}>
              Set this month's salary on the Goals screen to commit an amount here.
            </Text>
          )}

          {/* ── glyph ──────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>Icon</Text>
          <View style={styles.wrap}>
            {/* Type any emoji — the DEVICE keyboard is the picker, so there is no
                emoji-picker dependency (same approach as CreateGroupModal and
                CategoriesScreen). Highlighted whenever the goal's glyph isn't
                one of the presets, which is the only signal that the field is
                what's currently in use. */}
            <TextInput
              value={EMOJI_CHOICES.includes(emoji) ? '' : emoji}
              // Take the LAST glyph typed so a new emoji REPLACES the current
              // one — taking the first kept the old one and the field looked
              // unclearable.
              onChangeText={(t) => {
                const chars = Array.from(t.trim());
                const e = chars[chars.length - 1];
                if (e) { hapticLight(); setEmoji(e); }
              }}
              placeholder="⌨️"
              placeholderTextColor={theme.textMuted}
              maxLength={8}
              style={[
                styles.emojiBtn,
                styles.emojiOwn,
                {
                  color: theme.textPrimary,
                  borderColor: EMOJI_CHOICES.includes(emoji) ? theme.inputBorder : theme.primary,
                  backgroundColor: EMOJI_CHOICES.includes(emoji) ? theme.cardAlt : theme.primary + '14',
                },
              ]}
              accessibilityLabel="Use your own emoji"
            />
            {EMOJI_CHOICES.map((e) => (
              <TouchableOpacity
                key={e}
                onPress={() => { hapticLight(); setEmoji(e); }}
                activeOpacity={0.75}
                style={[
                  styles.emojiBtn,
                  {
                    borderColor: emoji === e ? theme.primary : 'transparent',
                    backgroundColor: emoji === e ? theme.primary + '10' : theme.cardAlt,
                  },
                ]}
                accessibilityLabel={`Icon ${e}`}
              >
                <Text style={styles.emojiTxt} allowFontScaling={false}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            Tap ⌨️ to use any emoji from your keyboard.
          </Text>

          {/* ── colour ─────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>Colour</Text>
          {/* Wider gap than the emoji row: a selected swatch scales to 1.18, and
              at the 8pt gap the neighbours it grew into looked crowded. */}
          <View style={[styles.wrap, styles.colorWrap]}>
            {GOAL_COLORS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => { hapticLight(); setColor(c); }}
                activeOpacity={0.75}
                style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]}
                accessibilityLabel={`Colour ${c}`}
                accessibilityState={{ selected: color === c }}
              >
                {color === c ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
              </TouchableOpacity>
            ))}
          </View>

          {/* ── auto-funding rule ──────────────────────────────────────── */}
          {/* The one place the goal namespace READS the spend tree. A goal
              names categories; it never becomes one. */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            Fund it automatically <Text style={{ color: theme.textMuted }}>· optional</Text>
          </Text>
          <Text style={[styles.hint, { color: theme.textMuted, marginTop: 0, marginBottom: spacing.sm }]}>
            Pick the categories or merchants this goal is made of. You can still add money by hand.
          </Text>

          <FormSelectRow
            leading={<Ionicons name="pricetag-outline" size={16} color={theme.textSecondary} />}
            value={categorySummary || 'Choose categories'}
            isPlaceholder={!categorySummary}
            onPress={() => { hapticLight(); setCategoryPickerOpen(true); }}
          />

          <Text style={[styles.label, { color: theme.textSecondary }]}>Merchants</Text>
          <View style={styles.merchantRow}>
            <TextInput
              value={merchantText}
              onChangeText={(t) => setMerchantText(sanitizeName(t, INPUT_LIMITS.MERCHANT_MAX))}
              onSubmitEditing={addMerchant}
              returnKeyType="done"
              placeholder="Zerodha, Groww, LIC…"
              placeholderTextColor={theme.textMuted}
              maxLength={INPUT_LIMITS.MERCHANT_MAX}
              style={[
                styles.input,
                styles.flex1,
                { color: theme.textPrimary, backgroundColor: theme.cardAlt, borderColor: theme.inputBorder },
              ]}
              accessibilityLabel="Merchant keyword"
            />
            <TouchableOpacity
              onPress={addMerchant}
              disabled={!merchantText.trim() || merchants.length >= GOAL_MERCHANT_LIMIT}
              activeOpacity={0.8}
              style={[
                styles.merchantAdd,
                {
                  borderColor: theme.primary,
                  opacity: !merchantText.trim() || merchants.length >= GOAL_MERCHANT_LIMIT ? 0.4 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add merchant"
            >
              <Ionicons name="add" size={18} color={theme.primary} />
            </TouchableOpacity>
          </View>
          {merchants.length > 0 ? (
            <View style={[styles.wrap, { marginTop: spacing.sm }]}>
              {merchants.map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => { hapticLight(); setMerchants(merchants.filter((x) => x !== m)); }}
                  activeOpacity={0.75}
                  style={[styles.mChip, { borderColor: theme.inputBorder, backgroundColor: theme.cardAlt }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${m}`}
                >
                  <Text style={[styles.mChipTxt, { color: theme.textPrimary }]} numberOfLines={1}>{m}</Text>
                  <Ionicons name="close" size={12} color={theme.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            {merchants.length >= GOAL_MERCHANT_LIMIT
              ? `That's the limit of ${GOAL_MERCHANT_LIMIT} merchants.`
              : 'Part of a name is enough — "epurse" matches "UPI-EPURSE BROKING".'}
          </Text>
        </ScrollView>

        {/* Pinned below the scroll view, per the footer-CTA rule — a Save that
            scrolls away is a Save you have to hunt for. */}
        <View
          style={[
            styles.footer,
            { borderTopColor: theme.divider, paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
        >
          {/* Delete rides in the footer beside Save rather than at the end of
              the scroll: the two are this screen's only verbs, and one of them
              being reachable only after scrolling past the whole auto-funding
              list made it feel missing. Icon-only and outlined — the same
              height as its neighbour, a fraction of the width — so the
              destructive action can never be mistaken for the primary one. */}
          <View style={styles.footerRow}>
            {isEdit ? (
              <TouchableOpacity
                style={[styles.deleteBtn, { borderColor: theme.danger + '55' }]}
                onPress={() => { hapticLight(); setConfirmDelete(true); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Delete goal"
              >
                <Ionicons name="trash-outline" size={19} color={theme.danger} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: nameOk ? theme.primary : theme.divider }]}
              onPress={handleSave}
              disabled={submitting}
              activeOpacity={0.85}
            >
              <Text style={[styles.saveTxt, { color: nameOk ? '#fff' : theme.textMuted }]}>
                {isEdit ? 'Save' : 'Add Goal'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Never both visible at once — nothing on this screen opens one while
          the other is already open, so the stacked-modal bug (§8b) that made
          this a pushed screen in the first place doesn't apply between them. */}
      <CenterModal
        visible={confirmDelete}
        title="Delete this goal?"
        message="Its allocation and logged contributions go with it. Money already spent or saved isn't affected."
        primaryText="Delete"
        secondaryText="Keep it"
        destructive
        onPrimary={() => {
          setConfirmDelete(false);
          const removedName = existing?.name;
          if (existing) deleteGoal(existing.id);
          navigation.goBack();
          if (removedName) toast.success('Goal deleted', removedName);
        }}
        onSecondary={() => setConfirmDelete(false)}
        onClose={() => setConfirmDelete(false)}
      />

      <GoalCategoryPickerModal
        visible={categoryPickerOpen}
        onClose={() => setCategoryPickerOpen(false)}
        parentIds={parentIds}
        setParentIds={setParentIds}
        categoryIds={categoryIds}
        setCategoryIds={setCategoryIds}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  flex1: { flex: 1 },

  label: {
    ...typography.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    ...typography.body,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 2,
  },
  err: { ...typography.tiny, marginTop: spacing.xs },
  hint: { ...typography.tiny, marginTop: spacing.xs, lineHeight: 16 },

  kindRow: { flexDirection: 'row', gap: spacing.sm },
  kindChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  kindTxt: { ...typography.tiny, fontWeight: '700', flexShrink: 1 },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  colorWrap: { gap: spacing.md, paddingVertical: spacing.xs },
  emojiBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  emojiTxt: { fontSize: 20 },
  // Dashed edge marks the "own emoji" tile as an input, not one more preset —
  // the same cue CategoriesScreen uses.
  emojiOwn: { fontSize: 20, textAlign: 'center', padding: 0, borderStyle: 'dashed' },

  swatch: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  // The app's selected-swatch treatment (CreateGroupModal): scale up, a WHITE
  // inner ring, and a dark drop so the ring stays visible on a pale colour.
  // A theme-coloured border was invisible on half the palette.
  swatchSelected: {
    borderWidth: 2,
    borderColor: '#fff',
    transform: [{ scale: 1.18 }],
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },

  // `stretch`, so the button is exactly as tall as the field beside it. It was
  // a hardcoded 46 against an input whose height comes from its font, padding
  // and border — about 43 — and the 3pt difference read as a misaligned
  // control. A number copied from a neighbour drifts the moment the neighbour
  // changes; taking the height FROM it cannot.
  merchantRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  merchantAdd: {
    width: 46, borderRadius: radius.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  mChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2, paddingVertical: 5,
  },
  mChipTxt: { ...typography.tiny, fontWeight: '700', maxWidth: 140 },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // BUTTON_H tall like its neighbour — matching PADDING is not matching height
  // — but only as wide as its glyph needs.
  deleteBtn: {
    width: BUTTON_H,
    minHeight: BUTTON_H,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    flex: 1,
    minHeight: BUTTON_H,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  saveTxt: { ...typography.bodyBold, fontWeight: '700', fontSize: 16 },
});

export default GoalFormScreen;
