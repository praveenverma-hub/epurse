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
import Svg, { Circle } from 'react-native-svg';
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
import GaugeProgress, { gaugeColorAt } from './GaugeProgress.native';
import { colors } from '../constants/theme';
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

// ─── Budget hero ring (Budget tab) ───────────────────────────────────────────
//
// Distinct from BudgetWidget above: this is the big ring in the Budget screen's
// hero card, not the Dashboard's daily capsule.

/** Default hero diameter. Was 140; reduced so the amounts beside it get more room. */
const HERO_RING_SIZE = 110;
/** Classic ring stroke as a fraction of its diameter — the original 12px on a 140 box. */
const CLASSIC_STROKE_RATIO = 12 / 140;

/**
 * True when the user owns AND has enabled the Gradient Budget Gauge.
 *
 * Exported because the hero's "%" label has to be tinted from whichever ring is
 * actually rendering — the two use different colour logic (see `budgetRingColor`)
 * and a mismatch is immediately visible. Call it at the top level of a screen,
 * never inside a conditional render helper.
 */
export const useGaugeWidgetActive = (): boolean =>
  useRewardStore(selectWidgetActive('gradient_gauge'));

/**
 * The colour for the number printed inside the hero ring.
 *
 * The two rings answer different questions, so they genuinely need different
 * colours — this isn't duplication that should be collapsed:
 *   • classic — a PACE verdict. Amber/red mean "ahead of where the month is",
 *     so it can be red at 60% spent on the 5th.
 *   • gauge   — the gradient's own colour at that value, so the label matches
 *     the shade the knob comes to rest in.
 */
export const budgetRingColor = (
  pct: number,
  daysElapsedPct: number,
  hasCap: boolean,
  isGauge: boolean,
): string => {
  if (!hasCap) return colors.divider;
  if (isGauge) return gaugeColorAt(pct);
  if (pct >= 100) return colors.danger;
  if (pct > daysElapsedPct + 10) return colors.danger;
  if (pct > daysElapsedPct + 5) return colors.warning;
  return colors.success;
};

interface BudgetRingWidgetProps {
  /** 0-100, percentage of the budget CONSUMED. */
  pct:             number;
  daysElapsedPct:  number;
  hasCap:          boolean;
  size?:           number;
  /** Centre fill for the gauge — match the card behind it. */
  discColor?:      string;
  /** Bump to replay the gauge's fill animation (see GaugeProgress). */
  replayKey?:      number | string;
  children?:       React.ReactNode;
}

export const BudgetRingWidget: React.FC<BudgetRingWidgetProps> = ({
  pct,
  daysElapsedPct,
  hasCap,
  size = HERO_RING_SIZE,
  discColor,
  replayKey,
  children,
}) => {
  const isGauge = useGaugeWidgetActive();
  const color   = budgetRingColor(pct, daysElapsedPct, hasCap, isGauge);

  if (isGauge) {
    return (
      <GaugeProgress
        value={hasCap ? pct : 0}
        size={size}
        showPointer={hasCap}
        discColor={discColor}
        replayKey={replayKey}
      >
        {children}
      </GaugeProgress>
    );
  }

  return (
    <ClassicProgressRing pct={pct} size={size} color={color}>
      {children}
    </ClassicProgressRing>
  );
};

/**
 * The stock Budget ring: a plain 360° track with a dash-revealed arc. This is the
 * DEFAULT — the gauge is a paid swap-in, so nobody loses their hero card by not
 * buying it. Kept dependency-light on purpose; it's what every user sees.
 */
const ClassicProgressRing: React.FC<{
  pct:       number;
  size:      number;
  color:     string;
  children?: React.ReactNode;
}> = ({ pct, size, color, children }) => {
  // Stroke scales with the ring instead of being a fixed 12. The original hardcoded it
  // against a 140 box; keeping that literal while shrinking the ring would have made it
  // proportionally chunkier, which is the opposite of the intent. 12/140 preserves the
  // weight the design had at its original size.
  const strokeWidth = size * CLASSIC_STROKE_RATIO;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  // Guard the same non-finite input GaugeProgress guards: a NaN dashoffset blanks
  // the arc entirely rather than degrading to "empty".
  const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const dashOffset = c - (safePct / 100) * c;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colors.divider}
          strokeWidth={strokeWidth}
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={flatStyles.ringCenter}>{children}</View>
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
  // Classic hero ring — absolute so the label centres over the SVG.
  ringCenter: { position: 'absolute', alignItems: 'center' },

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
