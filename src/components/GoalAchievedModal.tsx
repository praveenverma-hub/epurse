// =============================================================================
// GoalAchievedModal — a goal's lifetime target has been reached.
//
// This is the only unprompted celebration in Goals, and it stays that way on
// purpose: a target is a line the USER drew, so crossing it is the one moment
// the app is certain means something. Open-ended goals never fire it — there is
// no finish line to cross — and neither does a monthly allocation being met,
// which happens every month and would turn the modal into noise.
//
// It carries a real reward — RP + EPC, scaled internally by the Aware Run
// streak multiplier (see `awardGoalBonus`) but never shown as its OWN line
// here (Sep-14-26: "that's not we are awarding, it's a counting value for the
// user's daily review basis"). The multiplier moves the RP/EPC numbers this
// modal DOES show; it just isn't a distinct thing being handed out for the
// goal, so it doesn't get its own cell. The once-per-goal guard is
// `bonusAwardedAt` on the goal itself, written by the caller AFTER the bonus
// is credited — so a crash between the two costs the user nothing and
// re-shows the modal.
// =============================================================================

import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import type { TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import {
  radius, spacing, typography as typographyBase, shadows, withAlpha, readableOn,
} from '../constants/theme';
import { formatCurrency } from '../utils/format';
import Confetti from './Confetti';
import GradientButtonBase from './GradientButton';

const typography = typographyBase as unknown as Record<string, TextStyle>;

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

export interface GoalAchievement {
  goalId: string;
  name: string;
  emoji: string;
  color: string;
  target: number;
  saved: number;
  /** 'lifetime' = the target is done for good. 'monthly' = this month's commitment is met. */
  kind?: 'lifetime' | 'monthly';
  /** The month a recurring goal was celebrated FOR; null for a one-time goal. */
  monthKey?: string | null;
}

interface Props {
  visible: boolean;
  achievement: GoalAchievement | null;
  /** What the bonus actually paid. Null while it's being credited. */
  reward: { rpAwarded: number; epcAwarded: number; multiplier: number } | null;
  onClose: () => void;
}

const GoalAchievedModal: React.FC<Props> = ({ visible, achievement, reward, onClose }) => {
  const theme = useTheme();
  if (!visible || !achievement) return null;

  const accent = achievement.color || theme.primary;
  // A recurring goal has no finish line — it met THIS MONTH's commitment, and
  // says so, because "GOAL COMPLETE" on something that restarts in three weeks
  // reads as wrong the moment the user looks at the goal again.
  const monthly = achievement.kind === 'monthly';
  // The medallion is a solid fill of the goal's colour, so its ink is measured
  // on that colour and not on the card behind it.
  const medallionInk = readableOn(accent, '#FFFFFF', 3);

  // `reward` is now THREE states, not two (Sep-14-26 reward rework):
  //   • a real amount        — paid this time, show the numbers.
  //   • present but all-zero — a payment was ATTEMPTED but the monthly reward
  //     ceiling had nothing left (`useRewardStore.awardGoalBonus` clamps to
  //     zero rather than refusing outright, so this can legitimately happen
  //     when several goals complete in the same busy month) — never render
  //     "+0 RP", say so instead.
  //   • null                 — nothing was attempted THIS time because it was
  //     already paid earlier (a re-show of an unseen congratulation) — still
  //     true to say "credited", just not just now.
  const rewardIsZero  = !!reward && reward.rpAwarded === 0 && reward.epcAwarded === 0;
  const showRewardRow = !!reward && !rewardIsZero;
  const noteText = monthly
    ? (rewardIsZero
        ? "This month's goal-reward budget is already spent — nothing paid this time, but it starts fresh again next month."
        : reward
          ? 'It starts again next month — anything more you put in this month still counts.'
          : 'Already credited for this month — it starts fresh again next month.')
    : (rewardIsZero
        ? "This month's goal-reward budget was already spent by the time this one landed — nothing paid this time. The goal stays on your list."
        : reward
          ? 'Credited to your balance. The goal stays on your list — keep it, retarget it, or remove it whenever you like.'
          : 'Already credited to your balance earlier. The goal stays on your list — keep it, retarget it, or remove it whenever you like.');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Confetti active />

        <View style={styles.sheet}>
        <View style={[styles.sheetInner, { backgroundColor: theme.card }]}>
          <LinearGradient
            colors={[withAlpha(accent, theme.darkMode ? 0.28 : 0.18), withAlpha(accent, 0.02)]}
            style={styles.wash}
            pointerEvents="none"
          />

          <View style={[styles.medallion, { backgroundColor: accent }]}>
            <Text style={styles.medallionGlyph} allowFontScaling={false}>{achievement.emoji}</Text>
            <View style={[styles.tick, { backgroundColor: theme.success, borderColor: theme.card }]}>
              <Ionicons name="checkmark" size={13} color={readableOn(theme.success, '#FFFFFF', 3)} />
            </View>
          </View>

          <Text style={[styles.eyebrow, { color: theme.textMuted }]}>
            {monthly ? 'THIS MONTH DONE' : 'GOAL COMPLETE'}
          </Text>
          <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
            {achievement.name}
          </Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]}>
            {monthly
              ? `You set aside ${formatCurrency(achievement.saved)} — this month's ${formatCurrency(achievement.target)} is covered.`
              : `You set aside ${formatCurrency(achievement.saved)} — your ${formatCurrency(achievement.target)} target is done.`}
          </Text>

          {showRewardRow ? (
            <View style={[styles.rewardRow, { borderColor: theme.divider, backgroundColor: theme.cardAlt }]}>
              <View style={styles.rewardCell}>
                <Text style={[styles.rewardV, { color: theme.primary }]}>+{reward!.rpAwarded}</Text>
                <Text style={[styles.rewardK, { color: theme.textMuted }]}>RP</Text>
              </View>
              <View style={[styles.rewardCell, { borderLeftColor: theme.divider, borderLeftWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[styles.rewardV, { color: theme.success }]}>+{reward!.epcAwarded}</Text>
                <Text style={[styles.rewardK, { color: theme.textMuted }]}>EPC</Text>
              </View>
            </View>
          ) : null}

          <Text style={[styles.note, { color: theme.textMuted }]}>
            {noteText}
          </Text>

          <GradientButton title="Yay!" onPress={onClose} style={styles.cta} />
        </View>
        </View>

        <Pressable
          style={styles.dismiss}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000CC', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  dismiss: { ...StyleSheet.absoluteFillObject, zIndex: -1 },
  // Shadow + sizing live here; `overflow: 'hidden'` (needed to clip `wash`'s
  // gradient to the rounded corner) moved to `sheetInner` — on the SAME view
  // it clipped this shadow to nothing (iOS) / a hard box (Android elevation).
  sheet: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.xl,
    ...shadows.elevated,
  },
  sheetInner: {
    padding: spacing.xl,
    alignItems: 'center',
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  wash: { ...StyleSheet.absoluteFillObject, height: 190 },

  medallion: {
    width: 78, height: 78, borderRadius: 39,
    alignItems: 'center', justifyContent: 'center',
  },
  medallionGlyph: { fontSize: 36 },
  tick: {
    position: 'absolute', right: -2, bottom: -2,
    width: 26, height: 26, borderRadius: 13, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
  },

  eyebrow: { ...typography.tiny, fontWeight: '800', letterSpacing: 1.1, marginTop: spacing.lg },
  title: { ...typography.h1, textAlign: 'center', marginTop: 4 },
  sub: { ...typography.small, textAlign: 'center', marginTop: spacing.sm, lineHeight: 19 },

  rewardRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  rewardCell: { flex: 1, alignItems: 'center', paddingVertical: spacing.md - 2 },
  rewardV: { ...typography.h3, fontWeight: '800' },
  rewardK: { ...typography.tiny, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },

  note: { ...typography.tiny, textAlign: 'center', marginTop: spacing.md, lineHeight: 16 },
  cta: { marginTop: spacing.lg, alignSelf: 'stretch' },
});

export default GoalAchievedModal;
