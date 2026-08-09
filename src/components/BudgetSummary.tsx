import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import InfoSheet from './InfoSheet';
import SheetCloseButton from './SheetCloseButton';
import InfoIcon from './InfoIcon';
import ProgressBar from './ProgressBar';
import { progressTrack } from '../constants/theme';

// Essential (survival) categories — keyed by the first-level BUDGET parent ids
// the plan actually uses (groceries rolls into food, utilities→bills,
// transport→travel). Keep in sync with BudgetScreen's BUDGETABLE_IDS.
const ESSENTIAL_CATEGORIES = new Set(['food', 'bills', 'travel', 'health']);

// ── Status computation (from BudgetScreen) ───────────────────────────────────
const computeStatus = (pct: number, daysElapsedPct: number, hasCap: boolean, theme: any) => {
  if (!hasCap) return { key: 'neutral', label: 'No total cap', color: theme.textMuted, emoji: '·' };
  if (pct >= 100) return { key: 'over', label: 'Over budget', color: theme.danger, emoji: '🚨' };
  if (pct > daysElapsedPct + 10) return { key: 'slow', label: 'Over pace', color: theme.danger, emoji: '⚠' };
  if (pct > daysElapsedPct + 5) return { key: 'slow', label: 'Slow down', color: theme.warning, emoji: '⚠' };
  return { key: 'on', label: 'On track', color: theme.success, emoji: '✅' };
};

const ringColor = (pct: number, daysElapsedPct: number, theme: any) => {
  if (pct >= 100) return theme.danger;
  if (pct > daysElapsedPct + 10) return theme.danger;
  if (pct > daysElapsedPct + 5) return theme.warning;
  return theme.success;
};

// ============================================================================
// ANIMATED SVG CIRCLE
// ============================================================================

interface ProgressRingProps {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
}

// Built to match the app's OTHER three rings (ClassicProgressRing, AnalyticsScreen's
// ProgressRing, MiniRing): a static dashoffset with the rotation applied to the Circle
// itself. It previously drove `strokeDashoffset` through `useAnimatedProps` inside a
// `<G rotation>` wrapper — the only ring built that way, and the only one that rendered
// EMPTY on device while the "%" label beside it read the correct number. Reanimated
// props on an SVG child nested in a transformed <G> don't reliably reach the native
// view (the same class of problem GaugeProgress documents for <Mask>), so the arc
// stayed at its initial 0.
//
// This trades the 800ms fill animation for actually showing the value. The animated
// ring that IS reliable is GaugeProgress — its per-segment-opacity technique exists
// precisely because the straightforward approaches don't survive contact with the
// device. Use that if this ever needs to animate again; don't reintroduce <G> + animatedProps.
const ProgressRing: React.FC<ProgressRingProps> = ({ progress, size, strokeWidth, color }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Guard non-finite input: a NaN dashoffset blanks the arc entirely rather than
  // degrading to "empty" (the same guard ClassicProgressRing carries).
  const safe = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const dashOffset = circumference * (1 - safe);

  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={progressTrack(color)}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface BudgetSummaryProps {
  onPress?: () => void;
}

export const BudgetSummary: React.FC<BudgetSummaryProps> = ({ onPress }) => {
  const budget = useEPurseStore((s) => s.budget);
  const getBudgetUsage = useEPurseStore((s) => s.getBudgetUsage);
  const updateBudgetCategory = useEPurseStore((s) => s.updateBudgetCategory);
  const allCategories = useEPurseStore((s) => s.categories);
  const theme = useTheme();
  
  const [showInfo, setShowInfo] = useState(false);
  const [showRebalance, setShowRebalance] = useState(false);
  const [essentialMode, setEssentialMode] = useState(false);

  const usage = useMemo(() => getBudgetUsage(), [budget, getBudgetUsage]);

  // Empty state - no budget set
  if (!budget || !usage) {
    return (
      <TouchableOpacity style={[styles.emptyCard, { backgroundColor: theme.card, borderColor: theme.primary + '44' }]} onPress={onPress} activeOpacity={0.85}>
        <View style={[styles.emptyLeft, { backgroundColor: theme.background }]}>
          <Text style={styles.emptyEmoji}>📋</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>Plan your budget</Text>
          <Text style={[styles.emptySub, { color: theme.textSecondary }]}>
            Set caps for categories you care about. Track spend in real time.
          </Text>
        </View>
        <Text style={[styles.emptyArrow, { color: theme.primary }]}>›</Text>
      </TouchableOpacity>
    );
  }

  // STATE MACHINE CALCULATIONS
  const { totalSpent, isBudgetExhausted, overageAmount, daysRemaining, displayCategories } = useMemo(() => {
    const totalActual = usage.total.actual;
    const totalCap = usage.total.cap || 0;
    const exhausted = totalCap > 0 && totalActual >= totalCap;
    const overage = totalActual - totalCap;

    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const days = Math.ceil((lastDay.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    // Build category list from budget plan
    const cats = Object.entries(usage.perCategory).map(([catId, data]) => {
      const meta = allCategories.find((c) => c.id === catId);
      return {
        id: catId,
        name: meta?.name || catId,
        emoji: meta?.emoji || '📌',
        allocated: data.cap,
        spent: data.actual,
        color: meta?.color || '#6B7280',
        isEssential: ESSENTIAL_CATEGORIES.has(catId),
      };
    });

    const filtered = essentialMode ? cats.filter((c) => c.isEssential) : cats;

    // Sort by spending descending; pick top 3 as default
    const sorted = [...filtered].sort((a, b) => b.spent - a.spent);
    const top3 = sorted.slice(0, 3);

    // If a category outside the top 3 has hit its full budget (spent >= allocated),
    // replace the third slot (lowest spender) with the most-exhausted one so the
    // user always sees a "maxed out" category in the summary card.
    if (top3.length === 3) {
      const alertCat = sorted
        .slice(3)
        .filter((c) => c.allocated > 0 && c.spent >= c.allocated)
        .sort((a, b) => (b.spent / b.allocated) - (a.spent / a.allocated))[0];
      if (alertCat) top3[2] = alertCat;
    }

    const limited = top3;

    return {
      totalSpent: totalActual,
      isBudgetExhausted: exhausted,
      overageAmount: overage,
      daysRemaining: days,
      displayCategories: limited,
    };
  }, [usage, allCategories, essentialMode]);

  // Mirror BudgetScreen's hero-card logic exactly so the two cards can never
  // disagree: same cap guard, same pct, same days-elapsed basis — all taken
  // straight from the shared getBudgetUsage() selector.
  const hasCap = usage.total.cap != null && usage.total.cap > 0;
  const pctVal = hasCap ? usage.total.pct : 0;
  const progressRatio = Math.min(pctVal / 100, 1.0);
  const daysElapsedPct = usage.daysElapsedPct;
  const status = useMemo(() => computeStatus(pctVal, daysElapsedPct, hasCap, theme), [pctVal, daysElapsedPct, hasCap, theme]);
  const ringColorValue = useMemo(() => ringColor(pctVal, daysElapsedPct, theme), [pctVal, daysElapsedPct, theme]);

  const formatCurrency = (val: number) => `₹${(val / 1000).toFixed(1)}k`;

  const freezeLabel = daysRemaining <= 10 ? `⚡ Start ${daysRemaining}-Day Freeze` : '⚡ 5-Day Cooldown';

  // REBALANCE LOGIC
  const overBudgetCats = displayCategories.filter((c) => c.spent > c.allocated);
  const underBudgetCats = displayCategories.filter((c) => c.spent < c.allocated);

  const handleRebalance = (fromId: string, toId: string, amount: number) => {
    const fromCat = displayCategories.find((c) => c.id === fromId);
    const toCat = displayCategories.find((c) => c.id === toId);
    if (!fromCat || !toCat) return;
    
    updateBudgetCategory(fromId, fromCat.allocated - amount);
    updateBudgetCategory(toId, toCat.allocated + amount);
  };

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: theme.card }]}
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
    >
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Budget Summary</Text>
        {isBudgetExhausted && (
          <TouchableOpacity onPress={() => setShowInfo(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <InfoIcon size={18} color={theme.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* MAIN LAYOUT */}
      <View style={styles.mainRow}>
        {/* LEFT: MACRO RING */}
        <View style={styles.leftColumn}>
          <View style={styles.ringContainer}>
            <ProgressRing progress={progressRatio} size={60} strokeWidth={6} color={ringColorValue} />
            <View style={styles.ringCenter}>
              <Text style={[styles.percentText, { color: theme.textPrimary }]}>{Math.round(progressRatio * 100)}%</Text>
            </View>
          </View>
          <View style={[styles.statusPill, { backgroundColor: status.color + '18' }]}>
            <Text style={styles.statusEmoji}>{status.emoji}</Text>
            <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>

        {/* RIGHT: CATEGORY TRACKS */}
        <View style={styles.rightColumn}>
          {displayCategories.map((cat) => {
            const ratio = Math.min(cat.spent / cat.allocated, 1.0);
            const isOver = cat.spent > cat.allocated;
            const barColor = isOver ? '#334155' : cat.color;
            const overageVal = cat.spent - cat.allocated;

            return (
              <View key={cat.id} style={styles.trackRow}>
                <Text style={styles.trackEmoji}>{cat.emoji}</Text>
                <View style={styles.trackMiddle}>
                  <Text style={[styles.trackLabel, { color: theme.textPrimary }]}>{cat.name}</Text>
                  <ProgressBar progress={ratio} color={barColor} height={5} style={styles.trackBarContainer} />
                </View>
                {isOver ? (
                  <Text style={[styles.overageValue, { color: theme.danger }]}>+{formatCurrency(overageVal)}</Text>
                ) : (
                  <Text style={[styles.percentValue, { color: theme.textSecondary }]}>{Math.round(ratio * 100)}%</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* FOOTER BUTTONS - Only show when budget is exhausted.
          Total is non-editable (sum of category caps), so there's no "Top Up"
          of the total — the user raises a category cap in Edit Plan instead. */}
      {isBudgetExhausted && (
        <View style={[styles.footer, { marginTop: 12 }]}>
          <TouchableOpacity
            style={[styles.essentialBtn, { backgroundColor: essentialMode ? theme.textPrimary : theme.background }]}
            onPress={() => setEssentialMode(!essentialMode)}
          >
            <Ionicons name="lock-closed-outline" size={14} color={essentialMode ? '#ffffff' : theme.textPrimary} style={{ marginRight: 4 }} />
            <Text style={[styles.essentialText, { color: essentialMode ? '#ffffff' : theme.textPrimary }]}>
              Essential Mode
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* WARNING STRIP */}
      {isBudgetExhausted && (
        <View style={[styles.warningStrip, { backgroundColor: theme.danger + '15', borderLeftColor: theme.danger }]}>
          <Text style={[styles.warningText, { color: theme.danger }]}>⚠️ Budget exhausted — {daysRemaining} days remaining</Text>
        </View>
      )}

      {/* INFO SHEET — unified explainer (bottom sheet; switchable to center via variant) */}
      <InfoSheet
        visible={showInfo}
        onClose={() => setShowInfo(false)}
        title="Budget Features"
        body="Smart tools that help you stay within budget:"
        bullets={[
          { emoji: '⚖️', label: 'Smart Rebalancing', value: 'Move funds from under-budget categories to cover overages without increasing total spend.' },
          { emoji: '⚡', label: 'Cooldown Freezes',  value: 'Lock spending for remaining days to preserve budget. Ideal for month-end discipline.' },
          { emoji: '🔒', label: 'Essential Mode',    value: 'Filters view to survival categories only (Groceries, Utilities, Transport). Hides discretionary spend.' },
        ]}
      />

      {/* REBALANCE MODAL */}
      <Modal visible={showRebalance} transparent animationType="slide" onRequestClose={() => setShowRebalance(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRebalance(false)}>
          <View style={[styles.bottomSheet, { backgroundColor: theme.card }]}>
            <SheetCloseButton onPress={() => setShowRebalance(false)} variant="absolute" />
            <View style={[styles.sheetHandle, { backgroundColor: theme.divider }]} />
            <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>Rebalance Budget</Text>
            <ScrollView style={styles.sheetScroll}>
              {overBudgetCats.length === 0 ? (
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>All categories are within budget ✅</Text>
              ) : (
                overBudgetCats.map((cat) => (
                  <View key={cat.id} style={[styles.rebalanceItem, { backgroundColor: theme.background }]}>
                    <Text style={[styles.rebalanceCat, { color: theme.textPrimary }]}>
                      {cat.emoji} {cat.name}
                    </Text>
                    <Text style={[styles.rebalanceOver, { color: theme.danger }]}>Over by {formatCurrency(cat.spent - cat.allocated)}</Text>
                    {underBudgetCats.length > 0 && (
                      <TouchableOpacity
                        style={[styles.rebalanceButton, { backgroundColor: theme.success }]}
                        onPress={() => {
                          handleRebalance(underBudgetCats[0].id, cat.id, 500);
                        }}
                      >
                        <Text style={styles.rebalanceButtonText}>
                          Move ₹500 from {underBudgetCats[0].emoji} {underBudgetCats[0].name}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={[styles.closeButton, { backgroundColor: theme.textPrimary }]} onPress={() => setShowRebalance(false)}>
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </TouchableOpacity>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  emptyLeft: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyEmoji: { fontSize: 22 },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 15,
  },
  emptyArrow: {
    fontSize: 28,
    fontWeight: '300',
  },
  card: {
    borderRadius: 16,
    padding: 16,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    // Matches typography.h3 (the app-wide section heading) — colour applied inline.
    fontSize: 17,
    fontWeight: '600',
  },

  mainRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  leftColumn: {
    alignItems: 'center',
    marginRight: 16,
  },
  ringContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  percentText: {
    fontSize: 14,
    fontWeight: '800',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'center',
  },
  statusEmoji: {
    fontSize: 10,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  rightColumn: {
    flex: 1,
    justifyContent: 'space-around',
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  trackEmoji: {
    fontSize: 14,
  },
  trackMiddle: {
    flex: 1,
  },
  trackLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 3,
  },
  // Layout only — height/radius/track colour now come from ProgressBar.
  trackBarContainer: { marginBottom: 3 },
  percentValue: {
    fontSize: 10,
    minWidth: 32,
    textAlign: 'right',
  },
  overageValue: {
    fontSize: 10,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'right',
  },
  footer: {
    flexDirection: 'row',
    gap: 6,
  },
  // Full-width (sole child of the footer), so NOT a pill: at ~33px tall any radius
  // over ~16 renders as a stadium, which looks wrong stretched edge-to-edge. 12 =
  // `radius.md`, the small-control tier. (Can't import the token here — this file
  // already binds `radius` locally for the progress ring.)
  essentialBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  essentialText: {
    fontSize: 12,
    fontWeight: '600',
  },

  warningStrip: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
  },
  warningText: {
    fontSize: 12,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: '70%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  sheetScroll: {
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  featureBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  featureBadgeText: {
    fontSize: 20,
  },
  featureContent: {
    flex: 1,
  },
  featureName: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  rebalanceItem: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  rebalanceCat: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  rebalanceOver: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  rebalanceButton: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,   // radius.md (token shadowed locally, see essentialBtn)
    alignItems: 'center',
  },
  rebalanceButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
});
