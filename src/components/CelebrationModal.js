// =============================================================================
// CelebrationModal — full-screen wrap-up after a budget month ends.
//
// Two tones:
//   • Under-budget → confetti, savings amount, streak count, top wins
//   • Over-budget  → soft "April done · ₹X over budget. Let's plan May."
// Triggered by `pendingCelebration` state on the store; dismissed via the
// `clearPendingCelebration` action.
// =============================================================================

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  Animated, Easing, Dimensions,
} from 'react-native';

import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useEPurseStore } from '../store/ePurseStore';
import { formatCompact } from '../utils/format';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Bright pastel palette for confetti pieces
const CONFETTI_COLORS = [
  '#FF5A1F', '#FBBF24', '#10B981', '#3B82F6',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F59E0B',
];

// ── A single confetti piece — falls from above with a slight drift ─────────
const ConfettiPiece = ({ delay, color, startX, size, drift }) => {
  const fall = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(fall, {
        toValue: 1,
        duration: 2400 + Math.random() * 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, fall]);

  const translateY = fall.interpolate({
    inputRange: [0, 1],
    outputRange: [-40, SCREEN_H + 40],
  });
  const translateX = fall.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, drift, drift * 1.5],
  });
  const rotate = fall.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${720 + Math.random() * 360}deg`],
  });
  const opacity = fall.interpolate({
    inputRange: [0, 0.05, 0.85, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: startX,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate }],
      }}
    />
  );
};

const Confetti = ({ active, count = 36 }) => {
  // Generated once — random seeds stay stable for the modal's lifetime
  const pieces = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      key: i,
      delay: Math.random() * 800,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      startX: Math.random() * SCREEN_W,
      size: 5 + Math.random() * 5,
      drift: (Math.random() - 0.5) * 80,
    }));
  }, [count]);

  if (!active) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map(({ key, ...p }) => <ConfettiPiece key={key} {...p} />)}
    </View>
  );
};

// ── Modal ─────────────────────────────────────────────────────────────────
const CelebrationModal = ({ visible, onClose, onPlanNext }) => {
  const theme = useTheme();
  const pending      = useEPurseStore((s) => s.pendingCelebration);
  const budgetStreak = useEPurseStore((s) => s.budgetStreak);

  if (!visible || !pending) return null;

  const isUnder = pending.status === 'under';
  const isOver  = pending.status === 'over';
  const monthName = (() => {
    if (!pending.monthKey) return '';
    const [y, m] = pending.monthKey.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long' });
  })();

  // Top 3 category "wins" — categories that were budgeted and stayed under cap
  // (sorted by absolute amount saved). Only computed for the under-budget case.
  const wins = useMemo(() => {
    if (!isUnder) return [];
    return Object.entries(pending.perCategory || {})
      .map(([catId, v]) => ({ catId, saved: Math.max(0, v.cap - v.actual), ...v }))
      .filter((r) => r.cap > 0 && r.saved > 0)
      .sort((a, b) => b.saved - a.saved)
      .slice(0, 3);
  }, [pending, isUnder]);

  const categories = useEPurseStore((s) => s.categories);
  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Confetti only on wins */}
        <Confetti active={isUnder} />

        <View style={styles.sheet}>
          {/* Hero emoji */}
          <Text style={styles.heroEmoji}>{isUnder ? '🎉' : '🌱'}</Text>

          {/* Headline */}
          <Text style={styles.headline}>
            {isUnder
              ? `${monthName} complete!`
              : isOver
              ? `${monthName} done`
              : `${monthName} wrapped`}
          </Text>

          {/* Tagline */}
          {isUnder && pending.savedAmount > 0 ? (
            <>
              <Text style={styles.subText}>You stayed under budget by</Text>
              <Text style={[styles.savedAmount, { color: theme.primary }]}>
                {formatCompact(pending.savedAmount)}
              </Text>
            </>
          ) : isOver ? (
            <>
              <Text style={styles.subText}>You went over by</Text>
              <Text style={[styles.savedAmount, { color: colors.danger }]}>
                {formatCompact(pending.overshoot || 0)}
              </Text>
              <Text style={styles.softLine}>That's okay. Fresh start ahead.</Text>
            </>
          ) : (
            <Text style={styles.softLine}>
              Spent {formatCompact(pending.totalActual || 0)} last month
            </Text>
          )}

          {/* Streak badge — only meaningful if streak > 0 */}
          {isUnder && budgetStreak?.current >= 1 ? (
            <View style={styles.streakRow}>
              <Text style={styles.streakEmoji}>🏆</Text>
              <Text style={styles.streakText}>
                {budgetStreak.current}-month streak
                {budgetStreak.best > budgetStreak.current ? ` · best ${budgetStreak.best}` : ''}
              </Text>
            </View>
          ) : null}

          {/* Win highlights */}
          {wins.length > 0 ? (
            <View style={styles.winsList}>
              <Text style={styles.winsLabel}>Top wins</Text>
              {wins.map((w) => {
                const cat = categoryById.get(w.catId);
                if (!cat) return null;
                return (
                  <View key={w.catId} style={styles.winRow}>
                    <Text style={styles.winEmoji}>{cat.emoji}</Text>
                    <Text style={styles.winName}>{cat.name}</Text>
                    <Text style={[styles.winSaved, { color: colors.success }]}>
                      ₹{Math.round(w.saved).toLocaleString('en-IN')} under
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* CTAs */}
          <View style={styles.ctas}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
              onPress={onPlanNext}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Plan this month</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default CelebrationModal;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000B0',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    ...shadows.elevated,
  },

  heroEmoji: { fontSize: 56, marginBottom: spacing.md },
  headline: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  savedAmount: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginVertical: spacing.sm,
  },
  softLine: {
    ...typography.small,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  streakEmoji: { fontSize: 14 },
  streakText: { ...typography.small, color: '#92400E', fontWeight: '700' },

  winsList: {
    width: '100%',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  winsLabel: {
    ...typography.small,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  winRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  winEmoji: { fontSize: 16 },
  winName:  { flex: 1, ...typography.bodyBold, color: colors.textPrimary },
  winSaved: { ...typography.small, fontWeight: '700' },

  ctas: {
    width: '100%',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  primaryBtn: {
    paddingVertical: spacing.md + 2,
    borderRadius: radius.lg,
    alignItems: 'center',
  },
  primaryBtnText: { ...typography.bodyBold, color: '#fff', fontWeight: '800', fontSize: 16 },
  secondaryBtn: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  secondaryBtnText: { ...typography.small, color: colors.textSecondary, fontWeight: '700' },
});
