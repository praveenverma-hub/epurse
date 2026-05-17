// =============================================================================
// GhostLineChart — SVG dual-line chart with Reanimated v3 + GestureHandler v2
// Current month (hero line) vs previous month (ghost dashed line).
// Pan scrub coexists with parent ScrollView via activeOffsetX / failOffsetY.
// =============================================================================

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, {
  Path,
  Line,
  Circle,
  Text as SvgText,
  Defs,
  LinearGradient as SvgGrad,
  Stop,
} from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, spacing, typography } from '../constants/theme';
import { formatCurrency, formatCompact } from '../utils/format';

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - spacing.lg * 4;
const CHART_H = 168;
const Y_AXIS_W = 42;
const X_AXIS_H = 20;
const PLOT_W = CHART_W - Y_AXIS_W;
const PLOT_H = CHART_H - X_AXIS_H;
const TOP_PAD = 10;
const TOOLTIP_W = 148;

function getHotness(current, ghost, maxDay, daysInPrevMonth) {
  const curVal = current[maxDay] || 0;
  const ghostIdx = Math.min(maxDay, daysInPrevMonth);
  const ghostVal = ghost[ghostIdx] || 0;
  const ratio = ghostVal > 0 ? curVal / ghostVal : 1;
  if (ratio > 1.2) return { mode: 'hot', heroStart: '#FF6B35', heroEnd: '#F59E0B' };
  if (ratio < 0.82) return { mode: 'cool', heroStart: '#10B981', heroEnd: '#059669' };
  return { mode: 'on_track', heroStart: '#3B82F6', heroEnd: '#6D28D9' };
}

function buildLinePath(arr, maxDay, maxDays, maxValue, toX, toY) {
  let d = '';
  for (let i = 1; i <= maxDay; i++) {
    const x = toX(i);
    const y = toY(arr[i] || 0);
    d += i === 1 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

function buildAreaPath(arr, maxDay, maxDays, maxValue, toX, toY) {
  if (maxDay < 1) return '';
  let d = `M ${toX(1)} ${PLOT_H}`;
  for (let i = 1; i <= maxDay; i++) {
    const x = toX(i);
    const y = toY(arr[i] || 0);
    d += ` L ${x} ${y}`;
  }
  d += ` L ${toX(maxDay)} ${PLOT_H} Z`;
  return d;
}

function buildGhostPath(ghost, daysInPrevMonth, toX, toY) {
  let d = '';
  for (let i = 1; i <= daysInPrevMonth; i++) {
    const x = toX(i);
    const y = toY(ghost[i] || 0);
    d += i === 1 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  return d;
}

const GhostLineChart = ({ data }) => {
  const { current, ghost, daysInMonth, daysInPrevMonth, maxDay, isCurrentMonth } = data || {};

  const scrubXSV = useSharedValue(Y_AXIS_W);
  const scrubOpacity = useSharedValue(0);
  const [scrubInfo, setScrubInfo] = useState(null);

  const maxDays = Math.max(daysInMonth || 28, daysInPrevMonth || 28, 28);

  const maxValue = useMemo(() => {
    if (!current || !ghost) return 100;
    const curMax = current.slice(0, (maxDay || 0) + 1);
    const ghostMax = ghost.slice(0, (daysInPrevMonth || 0) + 1);
    return Math.max(...curMax, ...ghostMax, 100);
  }, [current, ghost, maxDay, daysInPrevMonth]);

  const toX = useCallback(
    (day) => Y_AXIS_W + (day / maxDays) * PLOT_W,
    [maxDays]
  );

  const toY = useCallback(
    (val) => TOP_PAD + (PLOT_H - TOP_PAD) * (1 - Math.min(1, val / maxValue)),
    [maxValue]
  );

  const { heroStart, heroEnd, mode } = useMemo(
    () => getHotness(current || [0], ghost || [0], maxDay || 0, daysInPrevMonth || 0),
    [current, ghost, maxDay, daysInPrevMonth]
  );

  const heroPaths = useMemo(() => {
    if (!current || !ghost || maxDay === 0) return { line: '', area: '', ghostLine: '' };
    return {
      line: buildLinePath(current, maxDay, maxDays, maxValue, toX, toY),
      area: buildAreaPath(current, maxDay, maxDays, maxValue, toX, toY),
      ghostLine: buildGhostPath(ghost, daysInPrevMonth, toX, toY),
    };
  }, [current, ghost, maxDay, maxDays, daysInPrevMonth, maxValue, toX, toY]);

  const gridVals = [
    maxValue * 0.25,
    maxValue * 0.5,
    maxValue * 0.75,
    maxValue,
  ];

  const updateScrub = useCallback(
    (xPos) => {
      if (!current) return;
      const rawDay = Math.round(((xPos - Y_AXIS_W) / PLOT_W) * maxDays);
      const day = Math.max(1, Math.min(maxDay || 1, rawDay));
      const curVal = current[day] || 0;
      const ghostIdx = Math.min(day, daysInPrevMonth || 0);
      const ghostVal = ghost ? ghost[ghostIdx] || 0 : 0;
      const diff = curVal - ghostVal;
      const diffPct = ghostVal > 0 ? (diff / ghostVal) * 100 : 0;
      setScrubInfo({ day, curVal, ghostVal, diff, diffPct });
    },
    [current, ghost, maxDay, maxDays, daysInPrevMonth]
  );

  const panGesture = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-8, 8])
    .onBegin((e) => {
      const cx = Math.max(Y_AXIS_W, Math.min(Y_AXIS_W + PLOT_W, e.x));
      scrubXSV.value = cx;
      scrubOpacity.value = withTiming(1, { duration: 120 });
      runOnJS(updateScrub)(cx);
    })
    .onUpdate((e) => {
      const cx = Math.max(Y_AXIS_W, Math.min(Y_AXIS_W + PLOT_W, e.x));
      scrubXSV.value = cx;
      runOnJS(updateScrub)(cx);
    })
    .onEnd(() => {
      scrubOpacity.value = withTiming(0, { duration: 200 });
      runOnJS(setScrubInfo)(null);
    });

  const scrubLineStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: scrubXSV.value - 0.5,
    top: 0,
    width: 1,
    height: PLOT_H,
    backgroundColor: colors.textSecondary,
    opacity: scrubOpacity.value,
  }));

  const tooltipLeft = useAnimatedStyle(() => {
    const left = Math.max(0, Math.min(CHART_W - TOOLTIP_W, scrubXSV.value - TOOLTIP_W / 2));
    return {
      position: 'absolute',
      top: 8,
      left,
      opacity: scrubOpacity.value,
    };
  });

  const endDotX = maxDay > 0 ? toX(maxDay) : 0;
  const endDotY = maxDay > 0 ? toY((current || [])[maxDay] || 0) : 0;

  const xAxisTicks = useMemo(() => {
    return [
      1,
      Math.round(maxDays * 0.25),
      Math.round(maxDays * 0.5),
      Math.round(maxDays * 0.75),
      maxDays,
    ];
  }, [maxDays]);

  const hotnessBadge = mode === 'hot'
    ? { label: 'Spending faster', bg: '#FEE2E2', text: '#DC2626' }
    : mode === 'cool'
    ? { label: 'On a streak', bg: '#D1FAE5', text: '#065F46' }
    : { label: 'On track', bg: '#DBEAFE', text: '#1E40AF' };

  if (!data || maxDay === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No spend data yet this month.</Text>
      </View>
    );
  }

  return (
    <View>
      {/* Legend row */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendRect, { backgroundColor: heroStart }]} />
          <Text style={styles.legendLabel}>This month</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendRectDashed} />
          <Text style={styles.legendLabel}>Last month</Text>
        </View>
        <View style={[styles.hotnessBadge, { backgroundColor: hotnessBadge.bg }]}>
          <Text style={[styles.hotnessBadgeText, { color: hotnessBadge.text }]}>
            {hotnessBadge.label}
          </Text>
        </View>
      </View>

      {/* Chart area */}
      <GestureDetector gesture={panGesture}>
        <View style={styles.chartContainer}>
          <Svg width={CHART_W} height={CHART_H}>
            <Defs>
              <SvgGrad id="heroLine" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={heroStart} stopOpacity="1" />
                <Stop offset="1" stopColor={heroEnd} stopOpacity="1" />
              </SvgGrad>
              <SvgGrad id="heroArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={heroStart} stopOpacity="0.18" />
                <Stop offset="1" stopColor={heroStart} stopOpacity="0" />
              </SvgGrad>
            </Defs>

            {/* Grid lines */}
            {gridVals.map((val, i) => {
              const gy = toY(val);
              return (
                <React.Fragment key={i}>
                  <Line
                    x1={Y_AXIS_W}
                    y1={gy}
                    x2={CHART_W}
                    y2={gy}
                    stroke={colors.divider}
                    strokeWidth={1}
                  />
                  <SvgText
                    x={Y_AXIS_W - 4}
                    y={gy + 4}
                    textAnchor="end"
                    fontSize={9}
                    fill={colors.textMuted}
                  >
                    {formatCompact(val)}
                  </SvgText>
                </React.Fragment>
              );
            })}

            {/* Area fill */}
            {heroPaths.area ? (
              <Path d={heroPaths.area} fill="url(#heroArea)" />
            ) : null}

            {/* Ghost line */}
            {heroPaths.ghostLine ? (
              <Path
                d={heroPaths.ghostLine}
                stroke="#C4C9D4"
                strokeWidth={1.5}
                strokeDasharray="5,4"
                fill="none"
                opacity={0.75}
              />
            ) : null}

            {/* Hero line */}
            {heroPaths.line ? (
              <Path
                d={heroPaths.line}
                stroke="url(#heroLine)"
                strokeWidth={3}
                strokeLinecap="round"
                fill="none"
              />
            ) : null}

            {/* Endpoint dot */}
            {maxDay > 0 && (
              <Circle cx={endDotX} cy={endDotY} r={4.5} fill={heroStart} />
            )}
          </Svg>

          {/* Scrub line overlay */}
          <Animated.View style={scrubLineStyle} pointerEvents="none" />

          {/* Tooltip overlay */}
          <Animated.View style={tooltipLeft} pointerEvents="none">
            <View style={styles.tooltip}>
              {scrubInfo ? (
                <>
                  <Text style={styles.tooltipDay}>Day {scrubInfo.day}</Text>
                  <Text style={styles.tooltipCur}>{formatCompact(scrubInfo.curVal)}</Text>
                  {scrubInfo.ghostVal > 0 && (
                    <Text style={[
                      styles.tooltipDiff,
                      { color: scrubInfo.diff > 0 ? '#EF4444' : '#10B981' },
                    ]}>
                      {scrubInfo.diff > 0 ? '+' : ''}
                      {scrubInfo.diffPct.toFixed(0)}% vs last mo
                    </Text>
                  )}
                </>
              ) : null}
            </View>
          </Animated.View>
        </View>
      </GestureDetector>

      {/* X-axis ticks */}
      <View style={[styles.xAxis, { paddingLeft: Y_AXIS_W }]}>
        {xAxisTicks.map((d) => (
          <Text key={d} style={styles.xTick}>
            {d}
          </Text>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  emptyContainer: {
    height: CHART_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.small,
    color: colors.textMuted,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendRect: {
    width: 14,
    height: 4,
    borderRadius: 2,
  },
  legendRectDashed: {
    width: 14,
    height: 0,
    borderWidth: 1.5,
    borderColor: '#C4C9D4',
    borderStyle: 'dashed',
  },
  legendLabel: {
    ...typography.tiny,
    color: colors.textSecondary,
  },
  hotnessBadge: {
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  hotnessBadgeText: {
    ...typography.tiny,
    fontWeight: '600',
  },
  chartContainer: {
    width: CHART_W,
    height: CHART_H,
  },
  tooltip: {
    width: TOOLTIP_W,
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  tooltipDay: {
    ...typography.tiny,
    color: colors.textMuted,
  },
  tooltipCur: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  tooltipDiff: {
    ...typography.tiny,
    fontWeight: '600',
  },
  xAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  xTick: {
    ...typography.tiny,
    color: colors.textMuted,
  },
});

export default GhostLineChart;
