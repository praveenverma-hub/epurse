// =============================================================================
// CustomWidgetContainer.tsx — premium / fallback widget switcher
//
// Reads the reward store's inventory and conditionally renders the premium
// Skia widget when that widget is unlocked AND active, otherwise renders a
// clean, dependency-free fallback. Each entry point takes the same data
// props the premium widget needs — the consumer doesn't care which renders.
// =============================================================================

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useRewardStore, selectWidgetActive } from '../store/useRewardStore';
import DailyBudgetLiquidWave from './DailyBudgetLiquidWave';
import ConcentricSpendingRings, { type RingData } from './ConcentricSpendingRings';
import StreakFlameEmitter from './StreakFlameEmitter';
import { formatCurrency } from '../utils/format';

// ─── Budget widget ───────────────────────────────────────────────────────────

interface BudgetWidgetProps {
  /** 0..100+ remaining budget (>100 = over-budget). */
  remainingPct: number;
  label?:       string;
  caption?:     string;
}

export const BudgetWidget: React.FC<BudgetWidgetProps> = ({
  remainingPct,
  label,
  caption,
}) => {
  const isActive = useRewardStore(selectWidgetActive('liquid_wave'));

  if (isActive) {
    return (
      <DailyBudgetLiquidWave
        remainingPct={remainingPct}
        label={label}
        caption={caption}
      />
    );
  }

  return <FlatBudgetBar pct={remainingPct} label={label} caption={caption} />;
};

const FlatBudgetBar: React.FC<{ pct: number; label?: string; caption?: string }> = ({
  pct,
  label,
  caption,
}) => {
  const clamped = Math.max(0, Math.min(100, pct));
  const over    = pct < 0;
  const w       = useSharedValue(0);

  useEffect(() => {
    w.value = withTiming(clamped, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [clamped]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${w.value}%` }));
  const tone      = over ? '#EF4444' : clamped < 30 ? '#F59E0B' : '#10B981';

  return (
    <View style={flatStyles.barWrap}>
      {label ? <Text style={flatStyles.label}>{label}</Text> : null}
      <View style={flatStyles.barTrack}>
        <Animated.View style={[flatStyles.barFill, fillStyle, { backgroundColor: tone }]} />
      </View>
      <View style={flatStyles.barRow}>
        <Text style={[flatStyles.pctText, { color: tone }]}>
          {over ? `${Math.round(-pct)}% over` : `${Math.round(clamped)}% left`}
        </Text>
        {caption ? <Text style={flatStyles.captionText}>{caption}</Text> : null}
      </View>
    </View>
  );
};

// ─── Rings widget ────────────────────────────────────────────────────────────

interface RingsWidgetProps {
  rings:        RingData[];
  centerLabel?: string;
}

export const RingsWidget: React.FC<RingsWidgetProps> = ({ rings, centerLabel }) => {
  const isActive = useRewardStore(selectWidgetActive('concentric_rings'));

  if (isActive) {
    return <ConcentricSpendingRings rings={rings} centerLabel={centerLabel} />;
  }

  return <FlatRingsList rings={rings} centerLabel={centerLabel} />;
};

const FlatRingsList: React.FC<{ rings: RingData[]; centerLabel?: string }> = ({
  rings,
  centerLabel,
}) => {
  const total = rings.reduce((acc, r) => acc + r.amount, 0);
  const max   = Math.max(1, ...rings.map((r) => r.amount));

  return (
    <View style={flatStyles.ringsWrap}>
      <View style={flatStyles.ringsHeader}>
        <Text style={flatStyles.ringsLabel}>{centerLabel ?? 'Spending breakdown'}</Text>
        <Text style={flatStyles.ringsTotal}>{formatCurrency(total)}</Text>
      </View>
      {rings.length === 0 ? (
        <Text style={flatStyles.ringsEmpty}>No spend recorded this month.</Text>
      ) : (
        rings.map((r) => {
          const w = (r.amount / max) * 100;
          return (
            <View key={r.parentCategory} style={flatStyles.ringRow}>
              <Text style={flatStyles.ringEmoji}>{r.emoji}</Text>
              <View style={{ flex: 1 }}>
                <View style={flatStyles.ringRowTop}>
                  <Text style={flatStyles.ringName}>{r.parentCategory}</Text>
                  <Text style={flatStyles.ringAmount}>{formatCurrency(r.amount)}</Text>
                </View>
                <View style={flatStyles.ringTrack}>
                  <View
                    style={[
                      flatStyles.ringFill,
                      { width: `${w}%`, backgroundColor: r.color },
                    ]}
                  />
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
};

// ─── Streak widget ───────────────────────────────────────────────────────────

interface StreakWidgetProps {
  streak: number;
  onTap?: () => void;
}

export const StreakWidget: React.FC<StreakWidgetProps> = ({ streak, onTap }) => {
  const isActive = useRewardStore(selectWidgetActive('particle_flame'));

  if (isActive) {
    return <StreakFlameEmitter streak={streak} onTap={onTap} />;
  }
  return <FlatStreakBadge streak={streak} />;
};

const FlatStreakBadge: React.FC<{ streak: number }> = ({ streak }) => {
  const tone = streak >= 14 ? '#22D3EE' : streak >= 4 ? '#A78BFA' : '#FB923C';
  return (
    <View style={[flatStyles.streakBadge, { borderColor: tone + '66' }]}>
      <Text style={flatStyles.streakIcon}>🔥</Text>
      <View>
        <Text style={[flatStyles.streakNumber, { color: tone }]}>{streak}</Text>
        <Text style={flatStyles.streakLabel}>day streak</Text>
      </View>
    </View>
  );
};

// ─── Fallback styles ─────────────────────────────────────────────────────────

const flatStyles = StyleSheet.create({
  // Budget
  barWrap: {
    width: '100%',
    paddingVertical: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginBottom: 8,
  },
  barTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 6,
  },
  barRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  pctText: {
    fontSize: 13,
    fontWeight: '800',
  },
  captionText: {
    fontSize: 12,
    color: '#6B7280',
  },

  // Rings (flat list)
  ringsWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  ringsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  ringsLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1.0,
  },
  ringsTotal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1C1C1E',
  },
  ringsEmpty: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 12,
  },
  ringRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  ringEmoji: { fontSize: 20 },
  ringRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  ringName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  ringAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  ringTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
  },
  ringFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Streak
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    alignSelf: 'flex-start',
  },
  streakIcon: { fontSize: 24 },
  streakNumber: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  streakLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: -2,
  },
});
