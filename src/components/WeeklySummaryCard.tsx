// =============================================================================
// WeeklySummaryCard — "This Week" spend summary on the Dashboard.
// -----------------------------------------------------------------------------
// Surfaced only when the user enables it in the Settings sheet
// (store flag `showWeeklySummary`). All weekly math comes from the single
// source `selectWeeklySummary` in the store — this component only renders.
//
// Anatomy:
//   • Header      — "This Week" + Mon→Sun date range, trend pill vs last week
//   • Amount      — total spent this week + daily-average subtitle
//   • Bar chart   — 7 columns (Mon→Sun); today emphasised, future days faint
//   • Footer      — top spending category + transaction count
// Tapping the card calls `onPress` (Dashboard routes it to weekly analytics).
// =============================================================================

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ePurseStore is still JS — selectWeeklySummary is untyped there, so we describe
// its shape locally (WeeklySummary) to keep this component fully typed.
import { useEPurseStore, selectWeeklySummary } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatCompact } from '../utils/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeekDay {
  label: string;
  amount: number;
  isToday: boolean;
  isFuture: boolean;
}

interface TopCategory {
  id: string;
  name: string;
  emoji: string;
  color: string;
  total: number;
}

interface WeeklySummary {
  total: number;
  prevTotal: number;
  deltaPct: number | null;
  dailyAvg: number;
  daysElapsed: number;
  txnCount: number;
  maxDay: number;
  perDay: WeekDay[];
  topCategory: TopCategory | null;
  weekStartMs: number;
  weekEndMs: number;
}

// The palette shape returned by useTheme() — only the keys this card reads.
interface Palette {
  card: string;
  primary: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  success: string;
  danger: string;
}

export interface WeeklySummaryCardProps {
  onPress?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_MS  = 24 * 60 * 60 * 1000;
const CHART_H = 84;   // px height of the tallest bar
const MIN_BAR = 5;    // floor so a tiny non-zero day is still visible

// Full weekday names (Mon→Sun) for the tapped-bar accessibility label.
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// "21–27 Jul" (same month) / "28 Jul – 3 Aug" (spans months).
const formatWeekRange = (startMs: number): string => {
  const s = new Date(startMs);
  const e = new Date(startMs + 6 * DAY_MS);
  const d = (dt: Date) => dt.getDate();
  const mon = (dt: Date) => dt.toLocaleDateString('en-IN', { month: 'short' });
  return s.getMonth() === e.getMonth()
    ? `${d(s)}–${d(e)} ${mon(e)}`
    : `${d(s)} ${mon(s)} – ${d(e)} ${mon(e)}`;
};

// ─── Component ────────────────────────────────────────────────────────────────

const WeeklySummaryCard: React.FC<WeeklySummaryCardProps> = ({ onPress }) => {
  const theme = useTheme() as Palette;
  const summary = useEPurseStore(selectWeeklySummary) as WeeklySummary;
  const {
    total, deltaPct, dailyAvg, txnCount, maxDay,
    perDay, topCategory, weekStartMs,
  } = summary;

  // Tapped bar (null → default to today). Reset when the week rolls over.
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  useEffect(() => { setSelectedIdx(null); }, [weekStartMs]);
  const todayIdx  = perDay.findIndex((d) => d.isToday);
  const activeIdx = selectedIdx ?? todayIdx;

  // Grow bars from the baseline whenever the week or its total changes.
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    grow.setValue(0);
    Animated.timing(grow, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating height
    }).start();
  }, [weekStartMs, total, grow]);

  const isEmpty = total <= 0;

  // Trend pill state — only meaningful when last week had spend.
  const up   = deltaPct != null && deltaPct > 0.5;
  const down = deltaPct != null && deltaPct < -0.5;
  const trendColor = down ? theme.success : up ? theme.danger : theme.textMuted;

  const styles = makeStyles(theme);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && onPress && styles.cardPressed]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`This week you spent ${formatCurrency(total)}`}
    >
      {/* ── Header ── */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.iconWrap}>
            <Ionicons name="calendar-outline" size={16} color={theme.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>This Week</Text>
            <Text style={styles.subtitle}>{formatWeekRange(weekStartMs)}</Text>
          </View>
        </View>

        {deltaPct != null && !isEmpty ? (
          <View style={[styles.trendPill, { backgroundColor: `${trendColor}1A` }]}>
            <Ionicons
              name={down ? 'arrow-down' : up ? 'arrow-up' : 'remove'}
              size={12}
              color={trendColor}
            />
            <Text style={[styles.trendText, { color: trendColor }]}>
              {Math.abs(Math.round(deltaPct))}%
            </Text>
          </View>
        ) : (
          onPress ? <Ionicons name="chevron-forward" size={18} color={theme.textMuted} /> : null
        )}
      </View>

      {/* ── Amount ── */}
      <View style={styles.amountBlock}>
        <Text style={styles.amount} numberOfLines={1}>{formatCurrency(total)}</Text>
        <Text style={styles.amountSub}>
          {isEmpty
            ? 'No spends yet — nice!'
            : `${formatCurrency(dailyAvg)}/day avg · vs last week`}
        </Text>
      </View>

      {/* ── 7-day bar chart — tap a column to reveal that day's amount ── */}
      <View style={styles.chartRow}>
        {perDay.map((d, i) => {
          const target = maxDay > 0 && d.amount > 0
            ? Math.max(MIN_BAR, (d.amount / maxDay) * CHART_H)
            : 0;
          const active = i === activeIdx;
          const barColor = active
            ? theme.primary
            : d.isFuture
              ? `${theme.textMuted}22`
              : `${theme.primary}40`;
          // Today stays identifiable (accent) even when another day is selected.
          const labelColor = active || d.isToday ? theme.primary : theme.textMuted;
          return (
            <Pressable
              key={i}
              style={styles.dayCol}
              onPress={() => setSelectedIdx(i)}
              hitSlop={{ top: 10, bottom: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`${DAY_FULL[i]}: ${formatCurrency(d.amount)}`}
            >
              <View style={styles.valueSlot}>
                {active && !isEmpty && (
                  <Text style={styles.valueLabel}>
                    {d.isFuture ? '—' : formatCompact(d.amount)}
                  </Text>
                )}
              </View>
              <View style={styles.track}>
                <Animated.View
                  style={[
                    styles.bar,
                    {
                      height: grow.interpolate({ inputRange: [0, 1], outputRange: [0, target] }),
                      backgroundColor: barColor,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.dayLabel,
                  { color: labelColor },
                  (active || d.isToday) && styles.dayLabelStrong,
                ]}
              >
                {d.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── Footer: top category + count ── */}
      {!isEmpty && (topCategory || txnCount > 0) && (
        <>
          <View style={styles.divider} />
          <View style={styles.footerRow}>
            {topCategory ? (
              <View style={styles.topCatWrap}>
                <View style={[styles.topCatDot, { backgroundColor: `${topCategory.color}22` }]}>
                  <Text style={styles.topCatEmoji}>{topCategory.emoji}</Text>
                </View>
                <Text style={styles.topCatText} numberOfLines={1}>
                  <Text style={styles.topCatLabel}>Top · </Text>
                  {topCategory.name}
                </Text>
                <Text style={styles.topCatAmt}>{formatCompact(topCategory.total)}</Text>
              </View>
            ) : <View style={{ flex: 1 }} />}
            <Text style={styles.countText}>
              {txnCount} {txnCount === 1 ? 'txn' : 'txns'}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
};

export default WeeklySummaryCard;

// ─── Styles (theme-aware) ─────────────────────────────────────────────────────

const makeStyles = (theme: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: `${theme.primary}1F`,
      ...shadows.card,
    },
    cardPressed: { opacity: 0.9 },

    // Header
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1, minWidth: 0 },
    iconWrap: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: `${theme.primary}18`,
    },
    headerText: { flex: 1, minWidth: 0 },
    title: { ...typography.h3, color: theme.textPrimary, fontWeight: '700' },
    subtitle: { ...typography.tiny, fontWeight: '500', color: theme.textMuted, marginTop: 1 },

    trendPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    trendText: { fontSize: 12, fontWeight: '800' },

    // Amount
    amountBlock: { marginTop: spacing.md },
    amount: { color: theme.textPrimary, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
    amountSub: { ...typography.small, fontWeight: '400', color: theme.textSecondary, marginTop: 2 },

    // Chart
    chartRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginTop: spacing.lg,
      gap: spacing.xs,
    },
    dayCol: { flex: 1, alignItems: 'center' },
    // Fixed-height slot above every bar keeps baselines aligned; only the
    // active column paints a label into it. Negative insets let a wide value
    // (e.g. ₹1.2K) center over a narrow column without truncating.
    valueSlot: { height: 15, alignSelf: 'stretch', position: 'relative' },
    valueLabel: {
      position: 'absolute',
      bottom: 0, left: -16, right: -16,
      textAlign: 'center',
      fontSize: 10.5,
      fontWeight: '800',
      color: theme.primary,
      letterSpacing: -0.2,
      fontVariant: ['tabular-nums'],
    },
    track: {
      width: 12,
      height: CHART_H,
      borderRadius: 6,
      backgroundColor: `${theme.textMuted}12`,
      justifyContent: 'flex-end',
      overflow: 'hidden',
    },
    bar: { width: '100%', borderRadius: 6 },
    dayLabel: { ...typography.tiny, fontWeight: '500', color: theme.textMuted, marginTop: 6 },
    dayLabelStrong: { fontWeight: '800' },

    // Footer
    divider: { height: 1, backgroundColor: theme.divider, marginTop: spacing.lg },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    topCatWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 },
    topCatDot: {
      width: 24, height: 24, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center',
    },
    topCatEmoji: { fontSize: 13 },
    topCatText: { ...typography.small, color: theme.textPrimary, fontWeight: '600', flexShrink: 1 },
    topCatLabel: { color: theme.textMuted, fontWeight: '600' },
    topCatAmt: { ...typography.small, color: theme.textSecondary, fontWeight: '700' },
    countText: { ...typography.tiny, color: theme.textMuted, fontWeight: '600', flexShrink: 0 },
  });
