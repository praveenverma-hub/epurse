// =============================================================================
// MonthlyLineChart — SVG line + gradient-fill chart for a single month-wise
// series (grid, area fill, endpoint dot, axis labels). Same visual language as
// `GhostLineChart` (the "Spending Pace" insight's chart) — gradient area under
// the line, faint grid with compact value labels, a highlighted endpoint —
// minus that chart's day-of-month ghost/scrub mechanics, which don't apply to
// a plain trailing series like a Balance Trend.
// =============================================================================
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, {
  Path, Line, Circle, Text as SvgText, Defs, LinearGradient as SvgGrad, Stop,
} from 'react-native-svg';
import { typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';

const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

const CHART_H = 140;
const Y_AXIS_W = 40;
const X_AXIS_H = 18;
const PLOT_H = CHART_H - X_AXIS_H;
const TOP_PAD = 14;

export interface MonthlyLineDatum { key: string; label: string; total: number }

export default function MonthlyLineChart({
  data, color, allowNegative = false,
}: {
  data: MonthlyLineDatum[];
  color: string;
  /** A negative value dips below a drawn zero-line and its endpoint dot (if
   *  it's the latest point) renders in `theme.danger` — an overdrawn balance
   *  reads as a warning rather than a normal point on the line. */
  allowNegative?: boolean;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const plotW = Math.max(1, width - Y_AXIS_W);

  const { minV, maxV } = useMemo(() => {
    const vals = data.map((d) => d.total);
    const rawMax = Math.max(...vals, 0);
    const rawMin = allowNegative ? Math.min(...vals, 0) : 0;
    const headroom = Math.max(1, (rawMax - rawMin) * 0.15) || Math.max(1, Math.abs(rawMax) * 0.15) || 1;
    return { minV: rawMin === 0 ? 0 : rawMin - headroom, maxV: rawMax + headroom };
  }, [data, allowNegative]);

  const span = Math.max(1, maxV - minV);
  const toX = useCallback((i: number) => (data.length <= 1 ? Y_AXIS_W : Y_AXIS_W + (i / (data.length - 1)) * plotW), [data.length, plotW]);
  const toY = useCallback((v: number) => TOP_PAD + (PLOT_H - TOP_PAD) * (1 - (v - minV) / span), [minV, span]);

  const { linePath, areaPath } = useMemo(() => {
    if (data.length === 0) return { linePath: '', areaPath: '' };
    let line = '';
    data.forEach((d, i) => {
      const x = toX(i);
      const y = toY(d.total);
      line += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    const baseY = toY(minV);
    let area = `M ${toX(0)} ${baseY}`;
    data.forEach((d, i) => { area += ` L ${toX(i)} ${toY(d.total)}`; });
    area += ` L ${toX(data.length - 1)} ${baseY} Z`;
    return { linePath: line, areaPath: area };
  }, [data, toX, toY, minV]);

  const gridVals = [maxV, minV + span * 0.5, minV];
  const hasZeroLine = allowNegative && minV < 0 && maxV > 0;
  const last = data[data.length - 1];
  const lastX = data.length ? toX(data.length - 1) : 0;
  const lastY = data.length ? toY(last.total) : 0;
  const lastColor = allowNegative && last && last.total < 0 ? theme.danger : color;

  if (data.length === 0) return null;

  return (
    <View>
      <View onLayout={onLayout} style={styles.chartBox}>
        {width > 0 ? (
          <Svg width={width} height={CHART_H}>
            <Defs>
              <SvgGrad id="lineArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity="0.2" />
                <Stop offset="1" stopColor={color} stopOpacity="0" />
              </SvgGrad>
            </Defs>

            {gridVals.map((val, i) => {
              const gy = toY(val);
              return (
                <React.Fragment key={i}>
                  <Line x1={Y_AXIS_W} y1={gy} x2={width} y2={gy} stroke={theme.divider} strokeWidth={1} />
                  <SvgText x={Y_AXIS_W - 6} y={gy + 3} textAnchor="end" fontSize={9} fill={theme.textMuted}>
                    {formatCompact(val)}
                  </SvgText>
                </React.Fragment>
              );
            })}
            {hasZeroLine ? (
              <Line x1={Y_AXIS_W} y1={toY(0)} x2={width} y2={toY(0)} stroke={theme.textMuted} strokeWidth={1} strokeDasharray="3,3" />
            ) : null}

            {areaPath ? <Path d={areaPath} fill="url(#lineArea)" /> : null}
            {linePath ? <Path d={linePath} stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
            {data.map((d, i) => (
              <Circle
                key={d.key}
                cx={toX(i)}
                cy={toY(d.total)}
                r={i === data.length - 1 ? 4.5 : 3}
                fill={i === data.length - 1 ? lastColor : color}
                opacity={i === data.length - 1 ? 1 : 0.6}
              />
            ))}
            {/* Endpoint value callout — the one figure worth reading directly off the chart. */}
            <SvgText
              x={Math.min(width - 4, Math.max(Y_AXIS_W + 24, lastX))}
              y={Math.max(TOP_PAD - 2, lastY - 10)}
              textAnchor="end"
              fontSize={11}
              fontWeight="700"
              fill={lastColor}
            >
              {formatCompact(last.total)}
            </SvgText>
          </Svg>
        ) : null}
      </View>
      <View style={[styles.xAxis, { paddingLeft: Y_AXIS_W }]}>
        {data.map((d) => (
          <Text key={d.key} style={[styles.xTick, { color: theme.textMuted }]}>{d.label}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chartBox: { width: '100%', height: CHART_H },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  xTick: { ...typography.tiny },
});
