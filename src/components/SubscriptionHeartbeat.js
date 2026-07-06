// =============================================================================
// SubscriptionHeartbeat — horizontal scrollable EKG timeline
// Built with a ScrollView containing an SVG path.
// Hike detection triggers animated pulse rings. Haptic feedback on scroll.
// =============================================================================

import React, { useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  Vibration,
} from 'react-native';
import Svg, { Path, Circle as SvgCircle } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing, radius, typography } from '../constants/theme';
import { formatCurrency, formatCompact } from '../utils/format';

const SCREEN_W = Dimensions.get('window').width;
const DAY_W = 26;
const CONTAINER_H = 90;
const BASELINE = 68;
const MAX_SPIKE_H = 52;
const MIN_SPIKE_H = 14;
const LEAD = 12;

// ---------------------------------------------------------------------------
// HikePulse — animated ring around price-hike spike tops
// ---------------------------------------------------------------------------
const HikePulse = ({ x, y }) => {
  const scale = useSharedValue(0.8);
  const opacity = useSharedValue(0.9);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 700 }),
        withTiming(0.8, { duration: 700 })
      ),
      -1
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 700 }),
        withTiming(0.8, { duration: 700 })
      ),
      -1
    );
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.hikePulse,
        {
          left: x - 7,
          top: y - 7,
        },
        animStyle,
      ]}
      pointerEvents="none"
    />
  );
};

// ---------------------------------------------------------------------------
// SubscriptionHeartbeat
// ---------------------------------------------------------------------------
const SubscriptionHeartbeat = ({ subscriptions, date }) => {
  const scrollRef = useRef(null);
  const lastHapticDay = useRef(null);

  // NOTE: no early return here — the hooks below (useMemo/useEffect) must run on
  // every render, so `subscriptions` toggling empty↔non-empty can't change the
  // hook count. The empty-state return lives AFTER all hooks.
  const subs = subscriptions || [];
  const targetDate = date || new Date();
  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const now = new Date();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  const currentDay = isCurrentMonth ? now.getDate() : daysInMonth;

  // Build a map of day → charges
  const dayCharges = useMemo(() => {
    const map = new Map();
    subs.forEach((sub) => {
      const day = Math.max(1, Math.min(daysInMonth, sub.dayOfMonth));
      if (!map.has(day)) map.set(day, []);
      map.get(day).push(sub);
    });
    return map;
  }, [subs, daysInMonth]);

  const maxAmount = useMemo(() => {
    let max = 0;
    dayCharges.forEach((charges) => {
      const total = charges.reduce((s, c) => s + c.amount, 0);
      if (total > max) max = total;
    });
    return max || 1;
  }, [dayCharges]);

  // Build EKG path.
  // We emit TWO things so the forecast part of the chart can recede:
  //   • solidPath  — the continuous baseline + every spike that has ALREADY happened.
  //   • dimSpikePaths — one standalone path per UPCOMING spike (a not-yet-charged day
  //     this month = a repeat of last month's recurring charge). These render at a low
  //     stroke opacity so this month's actual spikes read as the real signal. A single
  //     SVG <Path> can't vary opacity per segment, hence the split. Under a dimmed
  //     spike the solid path just runs flat along the baseline, so the two connect.
  const { solidPath, dimSpikePaths, spikePositions } = useMemo(() => {
    const toX = (d) => LEAD + (d - 0.5) * DAY_W;
    const totalWidth = LEAD + daysInMonth * DAY_W + 12;
    let solid = `M 0 ${BASELINE}`;
    const dimPaths = [];
    const spikes = [];
    // Where the solid (already-happened) line ends — extended as we add past days.
    let solidEndX = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const cx = toX(d);
      // In the current month, a day after today hasn't happened yet — forecast only.
      const upcoming = isCurrentMonth && d > currentDay;

      if (upcoming) {
        // Future day: DON'T extend the solid dark line. If a charge recurs on this
        // day, draw it as a dimmed forecast spike (it sits on the faded baseline).
        if (dayCharges.has(d)) {
          const charges = dayCharges.get(d);
          const totalDayAmt = charges.reduce((s, c) => s + c.amount, 0);
          const spikeH = MIN_SPIKE_H + (totalDayAmt / maxAmount) * (MAX_SPIKE_H - MIN_SPIKE_H);
          const peakY = BASELINE - spikeH;
          dimPaths.push(
            `M ${cx - 6} ${BASELINE}` +
              ` L ${cx - 3} ${BASELINE + 5}` +
              ` L ${cx} ${peakY}` +
              ` L ${cx + 4} ${BASELINE + 8}` +
              ` L ${cx + 8} ${BASELINE}`
          );
          spikes.push({ day: d, cx, peakY, charges, hasHike: charges.some((c) => c.priceHike), upcoming: true });
        }
        continue;
      }

      // Past / today (or any day of a non-current month) → full-strength solid.
      if (!dayCharges.has(d)) {
        solid += ` L ${cx} ${BASELINE}`;
        solidEndX = cx;
        continue;
      }

      const charges = dayCharges.get(d);
      const totalDayAmt = charges.reduce((s, c) => s + c.amount, 0);
      const spikeH = MIN_SPIKE_H + (totalDayAmt / maxAmount) * (MAX_SPIKE_H - MIN_SPIKE_H);
      const peakY = BASELINE - spikeH;
      solid += ` L ${cx - 6} ${BASELINE}`;
      solid += ` L ${cx - 3} ${BASELINE + 5}`;
      solid += ` L ${cx} ${peakY}`;
      solid += ` L ${cx + 4} ${BASELINE + 8}`;
      solid += ` L ${cx + 8} ${BASELINE}`;
      solidEndX = cx + 8;
      spikes.push({ day: d, cx, peakY, charges, hasHike: charges.some((c) => c.priceHike), upcoming: false });
    }

    // Current month: the solid line simply STOPS at today — no future line at all
    // (the dimmed upcoming spikes convey the forecast). Past months run full width.
    if (isCurrentMonth) {
      const todayX = toX(currentDay);
      if (solidEndX < todayX) { solid += ` L ${todayX} ${BASELINE}`; }
    } else {
      solid += ` L ${totalWidth} ${BASELINE}`;
    }

    return { solidPath: solid, dimSpikePaths: dimPaths, spikePositions: spikes };
  }, [dayCharges, daysInMonth, maxAmount, isCurrentMonth, currentDay]);

  const totalWidth = LEAD + daysInMonth * DAY_W + 12;

  const dayLabelDays = useMemo(() => {
    const raw = [1, 5, 10, 15, 20, 25, daysInMonth];
    return [...new Set(raw)].filter((d) => d <= daysInMonth);
  }, [daysInMonth]);

  const handleScroll = useCallback(
    (e) => {
      const offset = e.nativeEvent.contentOffset.x;
      const centerX = offset + SCREEN_W / 2;
      const dayAtCenter = Math.round((centerX - LEAD) / DAY_W + 0.5);
      if (
        dayAtCenter !== lastHapticDay.current &&
        dayCharges.has(dayAtCenter)
      ) {
        lastHapticDay.current = dayAtCenter;
        Vibration.vibrate(8);
      }
    },
    [dayCharges]
  );

  useEffect(() => {
    if (isCurrentMonth && scrollRef.current) {
      const timer = setTimeout(() => {
        const targetOffset = Math.max(0, LEAD + (currentDay - 1) * DAY_W - SCREEN_W / 2);
        scrollRef.current.scrollTo({ x: targetOffset, animated: true });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isCurrentMonth, currentDay]);

  const hikingSubscriptions = subs.filter((s) => s.priceHike);

  // Empty state — AFTER all hooks so the hook count is render-stable.
  if (subs.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {'No recurring subscriptions detected yet.\nThey appear after 2+ months of the same charge.'}
        </Text>
      </View>
    );
  }

  return (
    <View>
      {/* Subscription chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContainer}
        style={styles.chipsScroll}
      >
        {subs.map((sub) => (
          <View key={sub.merchantKey} style={styles.chip}>
            <Text style={styles.chipName} numberOfLines={1}>
              {sub.merchant}
            </Text>
            <Text style={styles.chipAmount}>{formatCompact(sub.amount)}</Text>
            {sub.priceHike && <Text style={styles.hikeArrow}>↑</Text>}
          </View>
        ))}
      </ScrollView>

      {/* EKG timeline */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.timelineScroll}
      >
        <View style={{ width: totalWidth, height: CONTAINER_H, position: 'relative' }}>
          <Svg width={totalWidth} height={CONTAINER_H}>
            {/* Today marker */}
            {isCurrentMonth && (
              <SvgCircle
                cx={LEAD + (currentDay - 0.5) * DAY_W}
                cy={BASELINE}
                r={3}
                fill={colors.primary}
              />
            )}

            {/* EKG path — baseline + already-happened spikes at full strength (up to today) */}
            <Path
              d={solidPath}
              stroke="#3B82F6"
              strokeWidth={2}
              strokeLinecap="round"
              fill="none"
            />

            {/* Upcoming (forecast) spike lines — dimmed so this month's actuals stand out.
                Thin strokes need a lower opacity than the dots to read as "expected". */}
            {dimSpikePaths.map((d, i) => (
              <Path
                key={`dim-${i}`}
                d={d}
                stroke="#3B82F6"
                strokeWidth={2}
                strokeLinecap="round"
                strokeOpacity={0.3}
                fill="none"
              />
            ))}

            {/* Spike top dots — upcoming (not-yet-charged this month) are dimmed */}
            {spikePositions.map((sp) => (
              <SvgCircle
                key={sp.day}
                cx={sp.cx}
                cy={sp.peakY}
                r={sp.hasHike ? 4.5 : 4}
                fill={sp.hasHike ? '#EF4444' : '#3B82F6'}
                // Upcoming (not-yet-charged this month) dots are dimmed, but only
                // lightly — enough to read as "expected" without looking ghosted.
                fillOpacity={sp.upcoming ? 0.6 : 1}
              />
            ))}
          </Svg>

          {/* Hike pulse rings — only for charges that have ALREADY happened */}
          {spikePositions
            .filter((sp) => sp.hasHike && !sp.upcoming)
            .map((sp) => (
              <HikePulse key={`hike-${sp.day}`} x={sp.cx} y={sp.peakY} />
            ))}

          {/* Day labels */}
          {dayLabelDays.map((d) => (
            <Text
              key={d}
              style={[
                styles.dayLabel,
                {
                  left: LEAD + (d - 0.5) * DAY_W - 8,
                  top: BASELINE + 8,
                },
              ]}
            >
              {d}
            </Text>
          ))}
        </View>
      </ScrollView>

      {/* Price hike notice bar */}
      {hikingSubscriptions.length > 0 && (
        <View style={styles.hikeBar}>
          <Text style={styles.hikeBarText}>
            {'Price hike detected: '}
            {hikingSubscriptions.map((s) => s.merchant).join(', ')}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  emptyContainer: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  chipsScroll: {
    marginBottom: spacing.sm,
  },
  chipsContainer: {
    gap: spacing.sm,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipName: {
    ...typography.tiny,
    color: colors.textPrimary,
    fontWeight: '600',
    maxWidth: 80,
  },
  chipAmount: {
    ...typography.tiny,
    color: colors.textSecondary,
  },
  hikeArrow: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '700',
  },
  timelineScroll: {
    marginHorizontal: -spacing.lg,
  },
  dayLabel: {
    position: 'absolute',
    ...typography.tiny,
    color: colors.textMuted,
    fontSize: 9,
  },
  hikeBar: {
    marginTop: spacing.sm,
    backgroundColor: '#FEE2E2',
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: '#EF4444',
  },
  hikeBarText: {
    ...typography.small,
    color: '#991B1B',
    lineHeight: 18,
  },
  hikePulse: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#EF4444',
  },
});

export default SubscriptionHeartbeat;
