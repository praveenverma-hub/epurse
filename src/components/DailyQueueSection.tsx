// =============================================================================
// DailyQueueSection.tsx — Swipeable daily transaction review queue
// Swipe right → approve (mark reviewed + XP float).
// Swipe left → springs back, opens TwoTierCategorySheet immediately.
// Smart rule suggestion fires after ≥2 identical categorisations per merchant.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  ZoomIn,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useEPurseStore, selectUnreviewedQueue } from '../store/ePurseStore';
import { TwoTierCategorySheet } from './TwoTierCategorySheet';
import { SmartRuleModal, SmartRuleState } from './SmartRuleModal';

const { width: SCREEN_W } = Dimensions.get('window');

const VISIBLE_CARDS = 3;
const SCALES = [1, 0.95, 0.9] as const;
const OFFSETS = [0, 10, 20] as const;
const CARD_H = 116;
const DECK_H = CARD_H + OFFSETS[VISIBLE_CARDS - 1]; // 136

// ─── Types ───────────────────────────────────────────────────────────────────

interface TransactionQueueItem {
  id: string;
  amount: number;
  timestamp: string;
  createdAt: string;
  cleanMerchant: string;
  rawMerchant: string;
  parentCategory?: string;
  childCategory?: string;
  categoryId?: string;
  isSubscription?: boolean;
  type?: string;
}

interface RuleEntry {
  parentCategory: string;
  childCategory: string;
  count: number;
}

// ─── XPFloat ─────────────────────────────────────────────────────────────────

interface XPFloatProps {
  floatKey: string;
  onDone: (key: string) => void;
}

const XPFloat: React.FC<XPFloatProps> = ({ floatKey, onDone }) => {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withTiming(-70, { duration: 900 });
    opacity.value = withTiming(0, { duration: 900 }, (finished) => {
      if (finished) runOnJS(onDone)(floatKey);
    });
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.xpFloat, style]} pointerEvents="none">
      <Text style={styles.xpFloatText}>+10 XP ⚡</Text>
    </Animated.View>
  );
};

// ─── InboxZeroView ───────────────────────────────────────────────────────────

interface InboxZeroViewProps {
  onCollapsed: () => void;
}

const InboxZeroView: React.FC<InboxZeroViewProps> = ({ onCollapsed }) => {
  const containerHeight = useSharedValue(DECK_H + 48);
  const containerOpacity = useSharedValue(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      containerHeight.value = withSpring(0, { damping: 20, stiffness: 200 });
      containerOpacity.value = withTiming(0, { duration: 300 }, (finished) => {
        if (finished) runOnJS(onCollapsed)();
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    height: containerHeight.value,
    opacity: containerOpacity.value,
    overflow: 'hidden' as const,
  }));

  return (
    <Animated.View style={containerStyle}>
      <Animated.View
        entering={ZoomIn.springify().damping(18).stiffness(240)}
        style={styles.inboxZeroInner}
      >
        <Text style={styles.inboxZeroCheck}>✓</Text>
        <Text style={styles.inboxZeroTitle}>All caught up!</Text>
        <Text style={styles.inboxZeroSub}>
          New SMS transactions appear here automatically.
        </Text>
      </Animated.View>
    </Animated.View>
  );
};

// ─── QueueCard ───────────────────────────────────────────────────────────────

interface QueueCardProps {
  txn: TransactionQueueItem;
  stackIndex: number;
  isTop: boolean;
  onApprove: (id: string) => void;
  onEdit: (txn: TransactionQueueItem) => void;
}

const QueueCard: React.FC<QueueCardProps> = ({
  txn,
  stackIndex,
  isTop,
  onApprove,
  onEdit,
}) => {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(OFFSETS[Math.min(stackIndex, 2)]);
  const scale = useSharedValue(SCALES[Math.min(stackIndex, 2)]);

  useEffect(() => {
    translateY.value = withSpring(OFFSETS[Math.min(stackIndex, 2)], {
      damping: 22,
      stiffness: 220,
    });
    scale.value = withSpring(SCALES[Math.min(stackIndex, 2)], {
      damping: 22,
      stiffness: 220,
    });
  }, [stackIndex]);

  const panGesture = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      const approveThreshold = e.translationX > 80 || e.velocityX > 700;
      const editThreshold = e.translationX < -50;

      if (approveThreshold) {
        translateX.value = withTiming(SCREEN_W * 1.5, { duration: 280 }, () => {
          runOnJS(onApprove)(txn.id);
        });
      } else if (editThreshold) {
        translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
        runOnJS(onEdit)(txn);
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 300 });
      }
    });

  const cardStyle = useAnimatedStyle(() => {
    const rotate = interpolate(
      translateX.value,
      [-SCREEN_W, 0, SCREEN_W],
      [-12, 0, 12],
      Extrapolation.CLAMP,
    );
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
        { rotate: `${rotate}deg` },
      ],
    };
  });

  const approveOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [0, 80], [0, 1], Extrapolation.CLAMP),
  }));

  const editOverlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-80, 0], [1, 0], Extrapolation.CLAMP),
  }));

  const isDebit = txn.type !== 'credit';
  const amountStr = `₹${Math.abs(txn.amount).toLocaleString('en-IN')}`;
  const dateStr = formatRelativeDate(txn.createdAt || txn.timestamp);
  const categoryLine = txn.parentCategory
    ? txn.childCategory
      ? `${txn.parentCategory} › ${txn.childCategory}`
      : txn.parentCategory
    : (txn.categoryId ?? 'Uncategorised');

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.card, cardStyle]}>
        {/* Approve tint */}
        <Animated.View
          style={[styles.overlayApprove, approveOverlayStyle]}
          pointerEvents="none"
        >
          <Text style={styles.overlayApproveText}>✓  Looks Good</Text>
        </Animated.View>

        {/* Edit tint */}
        <Animated.View
          style={[styles.overlayEdit, editOverlayStyle]}
          pointerEvents="none"
        >
          <Text style={styles.overlayEditText}>✎  Edit</Text>
        </Animated.View>

        {/* Content */}
        <View style={styles.cardRow}>
          <View
            style={[
              styles.merchantIcon,
              { backgroundColor: isDebit ? '#FFF0EB' : '#EDFDF5' },
            ]}
          >
            <Text
              style={[
                styles.merchantIconText,
                { color: isDebit ? '#FF5A1F' : '#059669' },
              ]}
            >
              {(txn.cleanMerchant || txn.rawMerchant || '?').charAt(0).toUpperCase()}
            </Text>
          </View>

          <View style={styles.cardMid}>
            <Text style={styles.merchantName} numberOfLines={1}>
              {txn.cleanMerchant || txn.rawMerchant || 'Unknown'}
            </Text>
            <Text style={styles.cardCategory} numberOfLines={1}>
              {categoryLine}
            </Text>
            {txn.isSubscription && (
              <View style={styles.subBadge}>
                <Text style={styles.subBadgeText}>Subscription</Text>
              </View>
            )}
          </View>

          <View style={styles.cardRight}>
            <Text
              style={[
                styles.amountText,
                { color: isDebit ? '#FF5A1F' : '#059669' },
              ]}
            >
              {isDebit ? '−' : '+'}{amountStr}
            </Text>
            <Text style={styles.dateText}>{dateStr}</Text>
          </View>
        </View>

        {isTop && (
          <View style={styles.swipeHint}>
            <Text style={styles.swipeHintLeft}>← Edit</Text>
            <Text style={styles.swipeHintRight}>Approve →</Text>
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameYear = now.getFullYear() === d.getFullYear();
  const sameMonth = sameYear && now.getMonth() === d.getMonth();
  const dayDiff = sameMonth ? now.getDate() - d.getDate() : -1;
  const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  if (sameMonth && dayDiff === 0) return `Today ${timeStr}`;
  if (sameMonth && dayDiff === 1) return `Yesterday ${timeStr}`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ─── DailyQueueSection ───────────────────────────────────────────────────────

export const DailyQueueSection: React.FC = () => {
  const storeQueue = useEPurseStore(selectUnreviewedQueue) as TransactionQueueItem[];
  const userCustomRules = useEPurseStore((s: any) => s.userCustomRules ?? {});
  const markReviewed = useEPurseStore((s: any) => s.markReviewed);
  const updateTwoTierCategory = useEPurseStore((s: any) => s.updateTwoTierCategory);
  const saveUserCustomRule = useEPurseStore((s: any) => s.saveUserCustomRule);

  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set());
  const [xpFloatKeys, setXpFloatKeys] = useState<string[]>([]);
  const [showInboxZero, setShowInboxZero] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);
  const [editingTxn, setEditingTxn] = useState<TransactionQueueItem | null>(null);
  const [smartRule, setSmartRule] = useState<SmartRuleState | null>(null);

  const hasHadItems = useRef(false);
  const ruleTracker = useRef<Map<string, RuleEntry>>(new Map());

  const visibleQueue = useMemo(
    () => storeQueue.filter((t) => !localDismissed.has(t.id)),
    [storeQueue, localDismissed],
  );

  useEffect(() => {
    if (visibleQueue.length > 0) {
      hasHadItems.current = true;
      setShowInboxZero(false);
    } else if (hasHadItems.current) {
      setShowInboxZero(true);
    }
  }, [visibleQueue.length]);

  const spawnXpFloat = useCallback((id: string) => {
    setXpFloatKeys((prev) => [...prev, `${id}-${Date.now()}`]);
  }, []);

  const handleApprove = useCallback(
    (id: string) => {
      setLocalDismissed((prev) => new Set(prev).add(id));
      markReviewed(id);
      spawnXpFloat(id);
    },
    [markReviewed, spawnXpFloat],
  );

  const handleEdit = useCallback((txn: TransactionQueueItem) => {
    setEditingTxn(txn);
    setSheetVisible(true);
  }, []);

  const handleSheetSave = useCallback(
    (parentCategory: string, childCategory: string) => {
      if (!editingTxn) return;
      const { id, rawMerchant, cleanMerchant } = editingTxn;

      updateTwoTierCategory(id, parentCategory, childCategory);
      markReviewed(id);
      setLocalDismissed((prev) => new Set(prev).add(id));
      spawnXpFloat(id);

      // Smart rule tracking — key is SCREAMING_SNAKE_CASE of raw merchant
      const rawKey = (rawMerchant || cleanMerchant || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '_');

      if (rawKey) {
        const existing = ruleTracker.current.get(rawKey);
        const sameCategory =
          existing?.parentCategory === parentCategory &&
          existing?.childCategory === childCategory;
        const newCount = sameCategory ? (existing!.count + 1) : 1;

        ruleTracker.current.set(rawKey, { parentCategory, childCategory, count: newCount });

        if (newCount >= 2 && !(rawKey in userCustomRules)) {
          setSmartRule({
            merchant: cleanMerchant || rawMerchant || rawKey,
            parentCategory,
            childCategory,
            rawMerchantKey: rawKey,
          });
        }
      }

      setSheetVisible(false);
      setEditingTxn(null);
    },
    [editingTxn, markReviewed, updateTwoTierCategory, userCustomRules, spawnXpFloat],
  );

  const handleSheetClose = useCallback(() => {
    setSheetVisible(false);
    setEditingTxn(null);
  }, []);

  const handleAutomate = useCallback(
    (rawMerchantKey: string, parentCategory: string, childCategory: string) => {
      saveUserCustomRule(rawMerchantKey, { parentCategory, childCategory });
      setSmartRule(null);
    },
    [saveUserCustomRule],
  );

  const removeXpFloat = useCallback((key: string) => {
    setXpFloatKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  if (visibleQueue.length === 0 && !showInboxZero) return null;

  const topFew = visibleQueue.slice(0, VISIBLE_CARDS);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Daily Queue</Text>
        {visibleQueue.length > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{visibleQueue.length}</Text>
          </View>
        )}
      </View>

      {showInboxZero ? (
        <InboxZeroView onCollapsed={() => setShowInboxZero(false)} />
      ) : (
        <View style={styles.deck}>
          {/* Render in reverse so top card (index 0) is drawn last = on top */}
          {[...topFew].reverse().map((txn, reverseIdx) => {
            const stackIndex = topFew.length - 1 - reverseIdx;
            return (
              <QueueCard
                key={txn.id}
                txn={txn}
                stackIndex={stackIndex}
                isTop={stackIndex === 0}
                onApprove={handleApprove}
                onEdit={handleEdit}
              />
            );
          })}

          {/* XP floats — pinned to top-right corner of deck */}
          <View style={styles.xpFloatAnchor} pointerEvents="none">
            {xpFloatKeys.map((key) => (
              <XPFloat key={key} floatKey={key} onDone={removeXpFloat} />
            ))}
          </View>
        </View>
      )}

      <TwoTierCategorySheet
        visible={sheetVisible}
        merchant={editingTxn?.cleanMerchant || editingTxn?.rawMerchant || ''}
        currentParent={editingTxn?.parentCategory}
        currentChild={editingTxn?.childCategory}
        onClose={handleSheetClose}
        onSave={handleSheetSave}
      />

      <SmartRuleModal
        rule={smartRule}
        onAutomate={handleAutomate}
        onDismiss={() => setSmartRule(null)}
      />
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  countBadge: {
    backgroundColor: '#FF5A1F',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ── Card deck ──────────────────────────────────────────────────────────────
  deck: {
    height: DECK_H,
    position: 'relative',
  },
  card: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CARD_H,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  merchantIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  merchantIconText: {
    fontSize: 18,
    fontWeight: '700',
  },
  cardMid: {
    flex: 1,
    gap: 3,
  },
  merchantName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  cardCategory: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  subBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EDE9FE',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  subBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6D28D9',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
  },

  // ── Swipe hint ─────────────────────────────────────────────────────────────
  swipeHint: {
    position: 'absolute',
    bottom: 8,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  swipeHintLeft: {
    fontSize: 10,
    color: '#D1D5DB',
    fontWeight: '600',
  },
  swipeHintRight: {
    fontSize: 10,
    color: '#D1D5DB',
    fontWeight: '600',
  },

  // ── Swipe overlays ─────────────────────────────────────────────────────────
  overlayApprove: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5, 150, 105, 0.12)',
    borderRadius: 16,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
  overlayApproveText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#059669',
  },
  overlayEdit: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 90, 31, 0.10)',
    borderRadius: 16,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 20,
  },
  overlayEditText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FF5A1F',
  },

  // ── XP float ───────────────────────────────────────────────────────────────
  xpFloatAnchor: {
    position: 'absolute',
    top: 0,
    right: 12,
  },
  xpFloat: {
    backgroundColor: '#FFF7ED',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: '#FDBA74',
  },
  xpFloatText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EA580C',
  },

  // ── Inbox zero ─────────────────────────────────────────────────────────────
  inboxZeroInner: {
    height: DECK_H + 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  inboxZeroCheck: {
    fontSize: 36,
    color: '#059669',
    fontWeight: '700',
  },
  inboxZeroTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  inboxZeroSub: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
