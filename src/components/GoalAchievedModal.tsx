// =============================================================================
// GoalAchievedModal — a goal's lifetime target has been reached.
//
// This is the only unprompted celebration in Goals, and it stays that way on
// purpose: a target is a line the USER drew, so crossing it is the one moment
// the app is certain means something. Open-ended goals never fire it — there is
// no finish line to cross — and neither does a monthly allocation being met,
// which happens every month and would turn the modal into noise.
//
// It carries a real reward (RP + EPC on the Aware Run multiplier, see
// `awardGoalBonus`). The once-per-goal guard is `bonusAwardedAt` on the goal
// itself, written by the caller AFTER the bonus is credited — so a crash
// between the two costs the user nothing and re-shows the modal.
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
  // The medallion is a solid fill of the goal's colour, so its ink is measured
  // on that colour and not on the card behind it.
  const medallionInk = readableOn(accent, '#FFFFFF', 3);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Confetti active />

        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
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

          <Text style={[styles.eyebrow, { color: theme.textMuted }]}>GOAL COMPLETE</Text>
          <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
            {achievement.name}
          </Text>
          <Text style={[styles.sub, { color: theme.textSecondary }]}>
            You set aside {formatCurrency(achievement.saved)} — your {formatCurrency(achievement.target)}{' '}
            target is done.
          </Text>

          {reward ? (
            <View style={[styles.rewardRow, { borderColor: theme.divider, backgroundColor: theme.cardAlt }]}>
              <View style={styles.rewardCell}>
                <Text style={[styles.rewardV, { color: theme.primary }]}>+{reward.rpAwarded}</Text>
                <Text style={[styles.rewardK, { color: theme.textMuted }]}>RP</Text>
              </View>
              <View style={[styles.rewardCell, { borderLeftColor: theme.divider, borderLeftWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[styles.rewardV, { color: theme.success }]}>+{reward.epcAwarded}</Text>
                <Text style={[styles.rewardK, { color: theme.textMuted }]}>EPC</Text>
              </View>
              {reward.multiplier > 1 ? (
                <View style={[styles.rewardCell, { borderLeftColor: theme.divider, borderLeftWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[styles.rewardV, { color: theme.textPrimary }]}>×{reward.multiplier}</Text>
                  <Text style={[styles.rewardK, { color: theme.textMuted }]}>Aware Run</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={[styles.note, { color: theme.textMuted }]}>
            Credited to your balance. The goal stays on your list — keep it, retarget it, or
            remove it whenever you like.
          </Text>

          <GradientButton title="Nice" onPress={onClose} style={styles.cta} />
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
  sheet: {
    width: '100%',
    maxWidth: 380,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    overflow: 'hidden',
    ...shadows.elevated,
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
