import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEPurseStore } from '../store/ePurseStore';

// Essential categories that should show in survival mode
const ESSENTIAL_CATEGORIES = new Set(['food', 'groceries', 'utilities', 'transport', 'health', 'rent']);

// ============================================================================
// ANIMATED SVG CIRCLE
// ============================================================================

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ProgressRingProps {
  progress: number;
  size: number;
  strokeWidth: number;
  color: string;
}

const ProgressRing: React.FC<ProgressRingProps> = ({ progress, size, strokeWidth, color }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressValue = useSharedValue(0);

  React.useEffect(() => {
    progressValue.value = withTiming(progress, { duration: 800 });
  }, [progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progressValue.value),
  }));

  return (
    <Svg width={size} height={size}>
      <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          strokeLinecap="round"
        />
      </G>
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
  const setBudgetTotalCap = useEPurseStore((s) => s.setBudgetTotalCap);
  const updateBudgetCategory = useEPurseStore((s) => s.updateBudgetCategory);
  const allCategories = useEPurseStore((s) => s.categories);
  
  const [showInfo, setShowInfo] = useState(false);
  const [showRebalance, setShowRebalance] = useState(false);
  const [essentialMode, setEssentialMode] = useState(false);

  const usage = useMemo(() => getBudgetUsage(), [budget, getBudgetUsage]);

  // Empty state - no budget set
  if (!budget || !usage) {
    return (
      <TouchableOpacity style={styles.emptyCard} onPress={onPress} activeOpacity={0.85}>
        <View style={styles.emptyLeft}>
          <Text style={styles.emptyEmoji}>📋</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.emptyTitle}>Plan your budget</Text>
          <Text style={styles.emptySub}>
            Set caps for categories you care about. Track spend in real time.
          </Text>
        </View>
        <Text style={styles.emptyArrow}>›</Text>
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

    return {
      totalSpent: totalActual,
      isBudgetExhausted: exhausted,
      overageAmount: overage,
      daysRemaining: days,
      displayCategories: filtered,
    };
  }, [usage, allCategories, essentialMode]);

  const totalCap = usage.total.cap || 1;
  const progressRatio = Math.min(totalSpent / totalCap, 1.0);
  const ringColor = isBudgetExhausted ? '#dc2626' : '#10b981';

  const formatCurrency = (val: number) => `₹${(val / 1000).toFixed(1)}k`;

  const freezeLabel = daysRemaining <= 10 ? `⚡ Start ${daysRemaining}-Day Freeze` : '⚡ 5-Day Cooldown';

  // REBALANCE LOGIC
  const overBudgetCats = displayCategories.filter((c) => c.spent > c.allocated);
  const underBudgetCats = displayCategories.filter((c) => c.spent < c.allocated);

  const handleTopUp = () => {
    const newCap = totalCap + 5000;
    setBudgetTotalCap(newCap);
  };

  const handleRebalance = (fromId: string, toId: string, amount: number) => {
    const fromCat = displayCategories.find((c) => c.id === fromId);
    const toCat = displayCategories.find((c) => c.id === toId);
    if (!fromCat || !toCat) return;
    
    updateBudgetCategory(fromId, fromCat.allocated - amount);
    updateBudgetCategory(toId, toCat.allocated + amount);
  };

  return (
    <View style={styles.card}>
      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>Budget Summary</Text>
        <TouchableOpacity onPress={() => setShowInfo(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.infoIcon}>ℹ️</Text>
        </TouchableOpacity>
      </View>

      {/* MAIN LAYOUT */}
      <View style={styles.mainRow}>
        {/* LEFT: MACRO RING */}
        <View style={styles.leftColumn}>
          <View style={styles.ringContainer}>
            <ProgressRing progress={progressRatio} size={120} strokeWidth={12} color={ringColor} />
            <View style={styles.ringCenter}>
              <Text style={styles.percentText}>{Math.round(progressRatio * 100)}%</Text>
            </View>
          </View>
          <Text style={styles.spentText}>{formatCurrency(totalSpent)} spent</Text>
          {isBudgetExhausted ? (
            <Text style={styles.overageText}>Overage: -{formatCurrency(overageAmount)}</Text>
          ) : (
            <Text style={styles.limitText}>of {formatCurrency(totalCap)}</Text>
          )}
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
                <Text style={styles.trackLabel}>
                  {cat.emoji} {cat.name}
                </Text>
                <View style={styles.trackBarContainer}>
                  <View style={[styles.trackBar, { width: `${ratio * 100}%`, backgroundColor: barColor }]} />
                </View>
                {isOver ? (
                  <Text style={styles.overageValue}>+{formatCurrency(overageVal)}</Text>
                ) : (
                  <Text style={styles.percentValue}>{Math.round(ratio * 100)}%</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* FOOTER BUTTONS */}
      <View style={styles.footer}>
        {!isBudgetExhausted ? (
          <>
            <TouchableOpacity style={styles.pillButton} onPress={() => setShowRebalance(true)}>
              <Text style={styles.pillText}>⚖️ Rebalance Tracks</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillButton}>
              <Text style={styles.pillText}>{freezeLabel}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={[styles.pillButton, styles.topUpButton]} onPress={handleTopUp}>
              <Text style={[styles.pillText, styles.topUpText]}>➕ Top Up</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pillButton, essentialMode && styles.essentialActive]}
              onPress={() => setEssentialMode(!essentialMode)}
            >
              <Text style={[styles.pillText, essentialMode && styles.essentialActiveText]}>
                🔒 Essential Mode
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* WARNING STRIP */}
      {isBudgetExhausted && (
        <View style={styles.warningStrip}>
          <Text style={styles.warningText}>⚠️ Budget exhausted — {daysRemaining} days remaining</Text>
        </View>
      )}

      {/* INFO MODAL */}
      <Modal visible={showInfo} transparent animationType="slide" onRequestClose={() => setShowInfo(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowInfo(false)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Budget Features</Text>
            <ScrollView style={styles.sheetScroll}>
              <View style={styles.featureItem}>
                <View style={styles.featureBadge}>
                  <Text style={styles.featureBadgeText}>⚖️</Text>
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureName}>Smart Rebalancing</Text>
                  <Text style={styles.featureDesc}>
                    Move funds from under-budget categories to cover overages without increasing total spend.
                  </Text>
                </View>
              </View>
              <View style={styles.featureItem}>
                <View style={styles.featureBadge}>
                  <Text style={styles.featureBadgeText}>⚡</Text>
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureName}>Cooldown Freezes</Text>
                  <Text style={styles.featureDesc}>
                    Lock spending for remaining days to preserve budget. Ideal for month-end discipline.
                  </Text>
                </View>
              </View>
              <View style={styles.featureItem}>
                <View style={styles.featureBadge}>
                  <Text style={styles.featureBadgeText}>🔒</Text>
                </View>
                <View style={styles.featureContent}>
                  <Text style={styles.featureName}>Essential Mode</Text>
                  <Text style={styles.featureDesc}>
                    Filters view to survival categories only (Groceries, Utilities, Transport). Hides discretionary spend.
                  </Text>
                </View>
              </View>
            </ScrollView>
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowInfo(false)}>
              <Text style={styles.closeButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* REBALANCE MODAL */}
      <Modal visible={showRebalance} transparent animationType="slide" onRequestClose={() => setShowRebalance(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowRebalance(false)}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Rebalance Budget</Text>
            <ScrollView style={styles.sheetScroll}>
              {overBudgetCats.length === 0 ? (
                <Text style={styles.emptyText}>All categories are within budget ✅</Text>
              ) : (
                overBudgetCats.map((cat) => (
                  <View key={cat.id} style={styles.rebalanceItem}>
                    <Text style={styles.rebalanceCat}>
                      {cat.emoji} {cat.name}
                    </Text>
                    <Text style={styles.rebalanceOver}>Over by {formatCurrency(cat.spent - cat.allocated)}</Text>
                    {underBudgetCats.length > 0 && (
                      <TouchableOpacity
                        style={styles.rebalanceButton}
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
            <TouchableOpacity style={styles.closeButton} onPress={() => setShowRebalance(false)}>
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginTop: 24,
    gap: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#FF6B3544',
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
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyEmoji: { fontSize: 22 },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  emptySub: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 15,
  },
  emptyArrow: {
    fontSize: 28,
    fontWeight: '300',
    color: '#FF6B35',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginTop: 24,
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
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  infoIcon: {
    fontSize: 18,
  },
  mainRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  leftColumn: {
    alignItems: 'center',
    marginRight: 24,
  },
  ringContainer: {
    position: 'relative',
    marginBottom: 12,
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
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  spentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  limitText: {
    fontSize: 12,
    color: '#6b7280',
  },
  overageText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '600',
  },
  rightColumn: {
    flex: 1,
    justifyContent: 'space-around',
  },
  trackRow: {
    marginBottom: 12,
  },
  trackLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  trackBarContainer: {
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  trackBar: {
    height: '100%',
    borderRadius: 3,
  },
  percentValue: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'right',
  },
  overageValue: {
    fontSize: 11,
    color: '#dc2626',
    fontWeight: '600',
    textAlign: 'right',
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
  },
  pillButton: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  topUpButton: {
    backgroundColor: '#10b981',
  },
  topUpText: {
    color: '#ffffff',
  },
  essentialActive: {
    backgroundColor: '#1f2937',
  },
  essentialActiveText: {
    color: '#ffffff',
  },
  warningStrip: {
    marginTop: 12,
    backgroundColor: '#fef2f2',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#dc2626',
  },
  warningText: {
    fontSize: 12,
    color: '#991b1b',
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#ffffff',
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
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
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
    backgroundColor: '#f3f4f6',
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
    color: '#111827',
    marginBottom: 4,
  },
  featureDesc: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  closeButton: {
    backgroundColor: '#111827',
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
    color: '#6b7280',
    textAlign: 'center',
    paddingVertical: 20,
  },
  rebalanceItem: {
    backgroundColor: '#f9fafb',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  rebalanceCat: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  rebalanceOver: {
    fontSize: 13,
    color: '#dc2626',
    fontWeight: '600',
    marginBottom: 12,
  },
  rebalanceButton: {
    backgroundColor: '#10b981',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  rebalanceButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
});
