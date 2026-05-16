// =============================================================================
// BudgetWidget — dashboard surface for the monthly budget plan.
//
// Two states:
//   • Empty  → CTA card inviting the user to create a plan
//   • Active → mini progress ring + 1-2 breach categories + tap-to-open
// Tap anywhere → navigate to BudgetScreen.
// =============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCompact } from '../utils/format';

const MiniRing = ({ pct, color, size = 56, strokeWidth = 6 }) => {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const dashOffset = c - (Math.min(pct, 100) / 100) * c;
  return (
    <Svg width={size} height={size}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.divider} strokeWidth={strokeWidth} />
      <Circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${c} ${c}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
};

const ringColorFor = (pct, daysElapsedPct) => {
  if (pct >= 100) return colors.danger;
  if (pct > daysElapsedPct + 10) return colors.danger;
  if (pct > daysElapsedPct + 5)  return colors.warning;
  return colors.success;
};

const statusLabelFor = (pct, daysElapsedPct, hasCap) => {
  if (!hasCap)                   return { label: 'No total cap',  emoji: '·',  color: colors.textMuted };
  if (pct >= 100)                return { label: 'Over budget',   emoji: '🚨', color: colors.danger };
  if (pct > daysElapsedPct + 10) return { label: 'Over pace',     emoji: '⚠',  color: colors.danger };
  if (pct > daysElapsedPct + 5)  return { label: 'Slow down',     emoji: '⚠',  color: colors.warning };
  return { label: 'On track', emoji: '✅', color: colors.success };
};

const BudgetWidget = ({ onPress }) => {
  const theme         = useTheme();
  const budget        = useEPurseStore((s) => s.budget);
  const transactions  = useEPurseStore((s) => s.transactions);
  const categories    = useEPurseStore((s) => s.categories);
  const budgetStreak  = useEPurseStore((s) => s.budgetStreak);
  const getBudgetUsage = useEPurseStore((s) => s.getBudgetUsage);

  // Recomputes whenever budget OR transactions change
  const usage = useMemo(() => getBudgetUsage(), [budget, transactions, getBudgetUsage]);

  const categoryById = useMemo(() => {
    const map = new Map();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!budget) {
    return (
      <TouchableOpacity
        style={[styles.emptyCard, { borderColor: theme.primary + '44' }]}
        onPress={onPress}
        activeOpacity={0.85}
      >
        <View style={styles.emptyLeft}>
          <Text style={styles.emptyEmoji}>📋</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.emptyTitle}>Plan your {monthName}</Text>
          <Text style={styles.emptySub}>
            Set rough caps for the categories you care about. Track spend in real time.
          </Text>
        </View>
        <Text style={[styles.emptyArrow, { color: theme.primary }]}>›</Text>
      </TouchableOpacity>
    );
  }

  // ── Active state ─────────────────────────────────────────────────────────
  const { total, perCategory, daysElapsedPct, daysLeftInMonth } = usage;
  const hasCap = total.cap != null && total.cap > 0;
  const pctVal = hasCap ? total.pct : 0;
  const rColor = hasCap ? ringColorFor(pctVal, daysElapsedPct) : colors.divider;
  const status = statusLabelFor(pctVal, daysElapsedPct, hasCap);

  // Top 2 breach categories
  const breaches = Object.entries(perCategory)
    .map(([catId, v]) => ({ catId, ...v }))
    .filter((r) => r.pct >= 90)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 2);

  // If no total cap is set, fall back to summing budgeted category actuals so
  // the user still sees something meaningful in the headline.
  const headlineActual = hasCap ? total.actual : Object.values(perCategory).reduce((s, r) => s + r.actual, 0);
  const headlineCap    = hasCap ? total.cap    : Object.values(perCategory).reduce((s, r) => s + r.cap, 0);

  // Top 3 categories by pct for the right column
  const topCatRows = Object.entries(perCategory)
    .map(([catId, v]) => ({ catId, ...v }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>🎯 {monthName} Budget</Text>
        <Text style={styles.headerSub}>
          {daysLeftInMonth === 0 ? 'Last day' : `${daysLeftInMonth}d left`}
        </Text>
      </View>

      {/* Body — ring | numbers | category column */}
      <View style={styles.bodyRow}>
        {/* Ring */}
        <View style={styles.ringWrap}>
          <MiniRing pct={pctVal} color={rColor} />
          <View style={styles.ringCenter}>
            <Text style={[styles.ringPct, { color: rColor }]}>
              {hasCap ? `${Math.round(pctVal)}%` : '—'}
            </Text>
          </View>
        </View>

        {/* Amounts + status */}
        <View style={styles.numbersWrap}>
          <Text style={styles.amountActual}>{formatCompact(headlineActual)}</Text>
          <Text style={styles.amountCap}>
            {headlineCap > 0 ? `of ${formatCompact(headlineCap)}` : 'spent'}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: status.color + '15' }]}>
            <Text style={styles.statusEmoji}>{status.emoji}</Text>
            <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        {/* Category % column */}
        {topCatRows.length > 0 && (
          <View style={styles.catColumn}>
            {topCatRows.map((b) => {
              const cat = categoryById.get(b.catId);
              if (!cat) return null;
              const pctColor = b.pct >= 100 ? colors.danger : b.pct >= 85 ? colors.warning : colors.success;
              return (
                <View key={b.catId} style={styles.catRow}>
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <View style={styles.catBarTrack}>
                    <View style={[styles.catBarFill, { width: `${Math.min(100, b.pct)}%`, backgroundColor: pctColor }]} />
                  </View>
                  <Text style={[styles.catPct, { color: pctColor }]}>{Math.round(b.pct)}%</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Streak badge */}
      {budgetStreak?.current >= 1 && breaches.length === 0 ? (
        <View style={styles.streakRow}>
          <Text style={styles.streakEmoji}>🏆</Text>
          <Text style={styles.streakText}>{budgetStreak.current}-month streak under budget</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // ── Empty / CTA state ──
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    marginTop: spacing.md,
    ...shadows.card,
  },
  emptyLeft: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyEmoji: { fontSize: 22 },
  emptyTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  emptySub:   { ...typography.tiny, color: colors.textSecondary, marginTop: 2, lineHeight: 15 },
  emptyArrow: { fontSize: 28, fontWeight: '300' },

  // ── Active state ──
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginTop: spacing.md,
    ...shadows.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  headerSub:   { ...typography.tiny, color: colors.textSecondary },

  bodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ringWrap: { position: 'relative', width: 56, height: 56 },
  ringCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPct: { fontSize: 12, fontWeight: '800' },

  numbersWrap: { flex: 1, gap: 2 },
  amountActual: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.3 },
  amountCap: { ...typography.tiny, color: colors.textSecondary },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  statusEmoji: { fontSize: 10 },
  statusLabel: { ...typography.tiny, fontWeight: '700' },

  // ── Category % right column ──
  catColumn: {
    gap: 6,
    minWidth: 96,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  catEmoji:    { fontSize: 11 },
  catBarTrack: {
    flex: 1,
    height: 4,
    backgroundColor: colors.divider,
    borderRadius: 2,
    overflow: 'hidden',
  },
  catBarFill: { height: '100%', borderRadius: 2 },
  catPct:     { fontSize: 10, fontWeight: '700', minWidth: 28, textAlign: 'right' },

  // ── Streak row ──
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignSelf: 'flex-start',
  },
  streakEmoji: { fontSize: 12 },
  streakText:  { ...typography.tiny, color: '#92400E', fontWeight: '700' },
});

export default BudgetWidget;
