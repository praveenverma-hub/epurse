// =============================================================================
// useGoalAchievement — claim and show the "goal reached" congratulation.
// -----------------------------------------------------------------------------
// Lives in a hook because TWO screens need it (ui-consistency §0): GoalsScreen
// lists the goals, but the "Add money" FAB that usually tips one over its target
// is on GoalDetailScreen, so a congratulation that only existed on the list was
// never seen by the person who had just earned it.
//
// FOCUS-GATED, and that is the whole point rather than a refinement. Claiming is
// DESTRUCTIVE: `markGoalAchieved` stamps `achievedAt`, which is exactly what
// `getNewlyAchievedGoals` filters on, so a goal can only ever be celebrated once.
// The original effect on GoalsScreen had no gate, so funding a goal from
// GoalDetail ran it on the list screen sitting UNDERNEATH — the bonus was
// awarded and the goal marked, against a screen nobody was looking at, and the
// congratulation was silently spent. Gating on focus means only the screen the
// user is actually on can claim it, which also stops the two screens racing.
//
// Ordered so a crash can only ever UNDER-award: credit the bonus, then mark the
// goal. Marking first would swallow the reward.
//
// It also waits for any OTHER modal on the screen to be gone (`blocked`), which
// is the second reason a congratulation went missing. The money almost always
// arrives through `GoalFundModal`, and that is itself a native <Modal>: closing
// it and presenting this one in the same commit is exactly the stack §8b calls
// unreliable, and the arriving modal is the one that silently loses. `blocked`
// holds the CLAIM too, not just the render — claiming while it cannot be shown
// is how the celebration got spent invisibly in the first place.
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';

import { useEPurseStore } from '../store/ePurseStore';
import { useRewardStore } from '../store/useRewardStore';
import type { GoalAchievement } from '../components/GoalAchievedModal';

export interface GoalReward {
  rpAwarded: number;
  epcAwarded: number;
  multiplier: number;
}

/**
 * @param blocked another modal on this screen is open or still animating away —
 *                hold the congratulation (and the claim) until it is gone.
 */
export const useGoalAchievement = ({ blocked = false }: { blocked?: boolean } = {}) => {
  const isFocused = useIsFocused();

  // A dismissing <Modal> is still on screen for the length of its fade, so
  // "blocked just went false" is not the same as "the way is clear". CenterModal
  // fades at RN's default ~300ms; the margin is for the frame the unmount lands on.
  const [settled, setSettled] = useState(!blocked);
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
    if (blocked) { setSettled(false); return undefined; }
    const t = setTimeout(() => { if (!blockedRef.current) setSettled(true); }, 400);
    return () => clearTimeout(t);
  }, [blocked]);

  const goals = useEPurseStore((s: any) => s.goals);
  const transactions = useEPurseStore((s: any) => s.transactions);
  const goalContributions = useEPurseStore((s: any) => s.goalContributions);
  const getNewlyAchievedGoals = useEPurseStore((s: any) => s.getNewlyAchievedGoals);
  const markGoalAchieved = useEPurseStore((s: any) => s.markGoalAchieved);
  const markGoalMonthlyBonusAwarded = useEPurseStore((s: any) => s.markGoalMonthlyBonusAwarded);
  const markGoalCelebrated = useEPurseStore((s: any) => s.markGoalCelebrated);
  const awardGoalBonus = useRewardStore((s: any) => s.awardGoalBonus);

  const [achievement, setAchievement] = useState<GoalAchievement | null>(null);
  const [reward, setReward] = useState<GoalReward | null>(null);

  useEffect(() => {
    if (!isFocused) return;                  // never claim off-screen
    if (blocked || !settled) return;         // never claim behind another modal
    if (achievement) return;                 // one at a time
    const list = getNewlyAchievedGoals();
    if (list.length === 0) return;
    const next = list[0];
    // Both durations pay now (Sep-14-26): a lifetime target once ever, a
    // monthly commitment once per calendar month (`bonusAlreadyAwarded` is
    // per-goal-per-month for `monthly`, per-goal-forever for `lifetime` — see
    // `getNewlyAchievedGoals`). On a RE-show — already paid, only never SEEN —
    // nothing is attempted again, so `reward` stays null and the modal shows
    // no reward line rather than paying twice.
    //
    // `computeGoalReward`'s amount band reads `next.target`, which is already
    // the right figure for either kind (the lifetime target, or this month's
    // planned amount — see `getNewlyAchievedGoals`'s own mapping).
    const attemptingPay = !next.bonusAlreadyAwarded;
    const paid = attemptingPay
      ? awardGoalBonus(next.goalId, next.name, next.kind === 'lifetime' ? 'oneTime' : 'recurring', next.target)
      : null;
    // `achievedAt` means "crossed its LIFETIME target, ever" — stamping it for
    // a monthly completion too would leave a recurring goal's ribbon reading
    // GOAL COMPLETE forever after its first good month, since nothing ever
    // clears it. Only a `lifetime` completion marks the goal; a `monthly`
    // one stamps `bonusAwardedMonth` instead (the PAID twin of `celebratedMonth`,
    // the SEEN one) — both only when a payment was actually attempted this
    // pass, so a re-show never re-attempts and never double-deducts from the
    // monthly reward ceiling.
    if (next.kind === 'lifetime') markGoalAchieved(next.goalId, { bonusAwarded: true });
    else if (attemptingPay) markGoalMonthlyBonusAwarded(next.goalId, next.monthKey);
    setReward(paid);
    setAchievement(next);
  }, [
    isFocused, blocked, settled, goals, transactions, goalContributions,
    achievement, getNewlyAchievedGoals, awardGoalBonus, markGoalAchieved, markGoalMonthlyBonusAwarded,
  ]);

  // THE claim, and it happens on DISMISS — not on render. Anything that stops
  // the modal reaching the user (an unfocused screen, another modal animating
  // over it) therefore costs them nothing: `celebratedAt` stays unset and the
  // congratulation comes back. This is what makes the whole thing self-healing
  // rather than one-shot.
  const clear = useCallback(() => {
    // Recurring goals carry the month they were celebrated FOR, so next month's
    // is a fresh one; a one-time goal stamps `celebratedAt` and is done.
    if (achievement) markGoalCelebrated(achievement.goalId, { monthKey: achievement.monthKey });
    setAchievement(null);
    setReward(null);
  }, [achievement, markGoalCelebrated]);

  return { achievement, reward, clear };
};

export default useGoalAchievement;
