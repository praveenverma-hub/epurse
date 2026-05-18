// =============================================================================
// DailyQueueStack — swipeable SMS transaction review queue
// -----------------------------------------------------------------------------
// Right swipe  → approve  → +10 XP float animation
// Left swipe   → category picker → mark reviewed after selection
// Empty queue  → InboxZero celebration card
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  runOnJS,
  interpolate,
  Extrapolate,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore, selectUnreviewedQueue } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDateTime } from '../utils/format';
import { canSplitTransaction } from '../utils/split';
import CategoryPickerModal from './CategoryPickerModal';
import LinkContactModal from './LinkContactModal';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_H         = 152;
const BACK_PEEK      = 20; // px of back cards visible below the top card
const SWIPE_THRESHOLD = SCREEN_W * 0.28;
const SWIPE_VELOCITY  = 600; // velocity shortcut — flick to dismiss even before threshold

// Visual offsets for up to 3 stacked cards (index 0 = top)
const STACK_SCALE  = [1,    0.96,  0.92];
const STACK_OFFSET = [0,    10,    20];   // translateY downward from top
const STACK_ALPHA  = [1,    0.82,  0.60];

// =============================================================================
// InboxZero — shown briefly after the last card is cleared
// =============================================================================
const InboxZero = () => {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withSpring(1.06, { damping: 6, stiffness: 120 }),
        withSpring(1.00, { damping: 6, stiffness: 120 }),
      ),
      -1,
      false,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.inboxZero}>
      <Animated.View style={[styles.inboxZeroRing, pulseStyle]}>
        <Text style={styles.inboxZeroCheck}>✓</Text>
      </Animated.View>
      <Text style={styles.inboxZeroTitle}>All caught up!</Text>
      <Text style={styles.inboxZeroSub}>New transactions will appear here for review.</Text>
    </View>
  );
};

// =============================================================================
// SwipeableCard — a single review card (top card is gesture-interactive)
// =============================================================================
const SwipeableCard = ({ txn, index, categories, onApprove, onPickCategory }) => {
  const isTop = index === 0;

  // Gesture shared values (only used by the top card)
  const translateX = useSharedValue(0);
  const rotate     = useSharedValue(0);

  // +10 XP float
  const xpOpacity = useSharedValue(0);
  const xpY       = useSharedValue(0);

  const fireXPAnimation = useCallback(() => {
    xpOpacity.value = withSequence(
      withTiming(1,   { duration: 120 }),
      withTiming(0,   { duration: 500 }),
    );
    xpY.value = withTiming(-56, { duration: 620 });
  }, []);

  const resetXP = useCallback(() => {
    xpOpacity.value = 0;
    xpY.value       = 0;
  }, []);

  const handleApprove = useCallback(() => {
    onApprove(txn.id);
  }, [txn.id, onApprove]);

  const handlePickCategory = useCallback(() => {
    onPickCategory(txn);
  }, [txn, onPickCategory]);

  const gesture = Gesture.Pan()
    .enabled(isTop)
    .onUpdate((e) => {
      translateX.value = e.translationX;
      rotate.value = interpolate(
        e.translationX,
        [-SCREEN_W, SCREEN_W],
        [-18, 18],
        Extrapolate.CLAMP,
      );
    })
    .onEnd((e) => {
      const dx = e.translationX;
      const vx = e.velocityX;
      const shouldApprove = dx > SWIPE_THRESHOLD || vx > SWIPE_VELOCITY;
      const shouldReject  = dx < -SWIPE_THRESHOLD || vx < -SWIPE_VELOCITY;

      if (shouldApprove) {
        runOnJS(fireXPAnimation)();
        translateX.value = withTiming(SCREEN_W * 1.6, { duration: 230 }, (done) => {
          if (done) runOnJS(handleApprove)();
        });
      } else if (shouldReject) {
        translateX.value = withSpring(0, { damping: 16 });
        rotate.value     = withSpring(0, { damping: 16 });
        runOnJS(handlePickCategory)();
      } else {
        translateX.value = withSpring(0, { damping: 16 });
        rotate.value     = withSpring(0, { damping: 16 });
      }
    });

  const cardAnimatedStyle = useAnimatedStyle(() => {
    if (!isTop) return {};
    return {
      transform: [
        { translateX: translateX.value },
        { rotate: `${rotate.value}deg` },
      ],
    };
  });

  // Green approve overlay (visible while swiping right)
  const approveOverlayStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [0, SWIPE_THRESHOLD], [0, 1], Extrapolate.CLAMP)
      : 0,
  }));

  // Amber reject overlay (visible while swiping left)
  const rejectOverlayStyle = useAnimatedStyle(() => ({
    opacity: isTop
      ? interpolate(translateX.value, [-SWIPE_THRESHOLD, 0], [1, 0], Extrapolate.CLAMP)
      : 0,
  }));

  const xpStyle = useAnimatedStyle(() => ({
    opacity:   xpOpacity.value,
    transform: [{ translateY: xpY.value }],
  }));

  const cat = categories.find((c) => c.id === txn.categoryId);
  const isDebit = txn.type === 'debit';
  const amountColor = isDebit ? colors.danger : colors.success;

  return (
    <View
      style={[
        styles.cardSlot,
        {
          zIndex:  10 - index,
          top:     STACK_OFFSET[index] ?? (index * 10),
          opacity: STACK_ALPHA[index]  ?? 0.5,
        },
      ]}
      pointerEvents={isTop ? 'auto' : 'none'}
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.card,
            { transform: [{ scale: STACK_SCALE[index] ?? 0.88 }] },
            cardAnimatedStyle,
          ]}
        >
          {/* ── Approve overlay ── */}
          <Animated.View style={[styles.overlay, styles.overlayApprove, approveOverlayStyle]}>
            <Text style={styles.overlayLabel}>✓  Looks good</Text>
          </Animated.View>

          {/* ── Reject overlay ── */}
          <Animated.View style={[styles.overlay, styles.overlayReject, rejectOverlayStyle]}>
            <Text style={styles.overlayLabel}>✎  Edit category</Text>
          </Animated.View>

          {/* ── Card content ── */}
          <View style={styles.cardTop}>
            <View style={styles.cardCatBadge}>
              <Text style={styles.cardEmoji}>{cat?.emoji ?? '📌'}</Text>
            </View>
            <View style={styles.cardMeta}>
              <Text style={styles.cardMerchant} numberOfLines={1}>{txn.merchant || 'Unknown'}</Text>
              <Text style={styles.cardCatName} numberOfLines={1}>{cat?.name ?? 'Uncategorised'}</Text>
            </View>
            <Text style={[styles.cardAmount, { color: amountColor }]}>
              {isDebit ? '−' : '+'}{formatCurrency(txn.amount)}
            </Text>
          </View>

          <View style={styles.cardDivider} />

          <View style={styles.cardBottom}>
            <Text style={styles.cardDate}>{formatDateTime(txn.createdAt)}</Text>
            <View style={styles.swipeHints}>
              <Text style={styles.hintLeft}>← edit</Text>
              <Text style={styles.hintRight}>approve →</Text>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>

      {/* +10 XP float — only on top card */}
      {isTop && (
        <Animated.View style={[styles.xpBadge, xpStyle]} pointerEvents="none">
          <Text style={styles.xpText}>+10 XP</Text>
        </Animated.View>
      )}
    </View>
  );
};

// =============================================================================
// DailyQueueStack — container
// =============================================================================
const DailyQueueStack = () => {
  const theme      = useTheme();
  const navigation = useNavigation();
  const queue    = useEPurseStore(selectUnreviewedQueue);
  const xp       = useEPurseStore((s) => s.xp || 0);
  const streak   = useEPurseStore((s) => s.reviewStreak || { current: 0, best: 0 });
  const categories               = useEPurseStore((s) => s.categories);
  const markReviewed             = useEPurseStore((s) => s.markReviewed);
  const updateTransactionCategory = useEPurseStore((s) => s.updateTransactionCategory);
  const updateTransactionCategoryWithContact = useEPurseStore((s) => s.updateTransactionCategoryWithContact);

  // Category picker state
  const [pickerTxn,  setPickerTxn]  = useState(null);
  const [lbLinkData, setLbLinkData] = useState(null); // { txn, categoryId }

  // InboxZero: show celebration when user clears the last card this session
  const prevLenRef = useRef(queue.length);
  const [showZero, setShowZero] = useState(false);

  useEffect(() => {
    if (prevLenRef.current > 0 && queue.length === 0) {
      setShowZero(true);
      const t = setTimeout(() => setShowZero(false), 4000);
      return () => clearTimeout(t);
    }
    prevLenRef.current = queue.length;
  }, [queue.length]);

  const handleApprove = useCallback((id) => {
    markReviewed(id);
  }, [markReviewed]);

  const handlePickCategory = useCallback((txn) => {
    setPickerTxn(txn);
  }, []);

  const handleSelectCategory = useCallback((categoryId) => {
    if (!pickerTxn) return;
    updateTransactionCategory(pickerTxn.id, categoryId);
    markReviewed(pickerTxn.id);
    setPickerTxn(null);
  }, [pickerTxn, updateTransactionCategory, markReviewed]);

  const handleSelectLentBorrow = useCallback((categoryId) => {
    if (!pickerTxn) return;
    const txn = pickerTxn;
    setPickerTxn(null);
    setLbLinkData({ txn, categoryId });
  }, [pickerTxn]);

  const handleLinkContact = useCallback((contactInfo) => {
    if (!lbLinkData) return;
    updateTransactionCategoryWithContact(lbLinkData.txn.id, lbLinkData.categoryId, contactInfo);
    markReviewed(lbLinkData.txn.id);
    setLbLinkData(null);
  }, [lbLinkData, updateTransactionCategoryWithContact, markReviewed]);

  const handlePickerClose = useCallback(() => {
    setPickerTxn(null);
  }, []);

  const handleLbClose = useCallback(() => {
    setLbLinkData(null);
  }, []);

  // Nothing to show — section is hidden
  if (queue.length === 0 && !showZero) return null;

  const visible = queue.slice(0, 3); // show at most 3 stacked cards

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>REVIEW QUEUE</Text>
        <View style={styles.headerRow}>
          {queue.length > 0 ? (
            <Text style={styles.headerSub}>
              {queue.length} transaction{queue.length !== 1 ? 's' : ''} to review
            </Text>
          ) : <View />}
          <TouchableOpacity
            style={styles.xpPill}
            onPress={() => navigation.navigate('RewardShop')}
            activeOpacity={0.75}
          >
            <Text style={styles.xpPillText}>⚡ {xp} XP</Text>
            {streak.current > 0 && (
              <Text style={styles.streakText}> · 🔥 {streak.current}d</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Stack or InboxZero ── */}
      {queue.length === 0 ? (
        <InboxZero />
      ) : (
        <View style={[styles.stackContainer, { height: CARD_H + BACK_PEEK }]}>
          {[...visible].reverse().map((txn, revIdx) => {
            const idx = visible.length - 1 - revIdx;
            return (
              <SwipeableCard
                key={txn.id}
                txn={txn}
                index={idx}
                categories={categories}
                onApprove={handleApprove}
                onPickCategory={handlePickCategory}
              />
            );
          })}
        </View>
      )}

      {/* ── Swipe hint footer ── */}
      {queue.length > 0 && (
        <Text style={styles.footerHint}>
          Swipe right to approve · left to re-categorise
        </Text>
      )}

      {/* ── Category picker ── */}
      <CategoryPickerModal
        visible={!!pickerTxn}
        categories={categories}
        selectedCategoryId={pickerTxn?.categoryId}
        isHidden={false}
        isIgnored={false}
        canSplit={!!pickerTxn && canSplitTransaction(pickerTxn)}
        isSplitTxn={!!pickerTxn?.isSplit}
        onSelectCategory={handleSelectCategory}
        onSelectLentBorrow={handleSelectLentBorrow}
        onClose={handlePickerClose}
      />

      {/* ── Link contact (for lent/borrow re-categorisation) ── */}
      <LinkContactModal
        visible={!!lbLinkData}
        categoryId={lbLinkData?.categoryId}
        onConfirm={handleLinkContact}
        onClose={handleLbClose}
      />
    </View>
  );
};

// =============================================================================
// Styles
// =============================================================================
const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
    marginTop: spacing.xl,

  },

  // ── Header ──
  header: {
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  headerTitle: {
    ...typography.tiny,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  headerSub: {
    ...typography.small,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  xpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E8',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  xpPillText: {
    ...typography.tiny,
    color: colors.primary,
    fontWeight: '700',
  },
  streakText: {
    ...typography.tiny,
    color: colors.warning,
    fontWeight: '700',
  },

  // ── Stack ──
  stackContainer: {
    position: 'relative',
  },
  cardSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
  },

  // ── Card ──
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    height: CARD_H,
    justifyContent: 'space-between',
    overflow: 'hidden',
    ...shadows.elevated,
  },

  // Overlay (approve / reject)
  overlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  overlayApprove: {
    backgroundColor: '#10B98126',
    borderWidth: 2,
    borderColor: colors.success,
  },
  overlayReject: {
    backgroundColor: '#F59E0B26',
    borderWidth: 2,
    borderColor: colors.warning,
  },
  overlayLabel: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },

  // Card content
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  cardCatBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji:    { fontSize: 22 },
  cardMeta:     { flex: 1 },
  cardMerchant: { ...typography.bodyBold, color: colors.textPrimary },
  cardCatName:  { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  cardAmount:   { ...typography.h3, fontWeight: '700' },

  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },

  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardDate: { ...typography.tiny, color: colors.textMuted },
  swipeHints: { flexDirection: 'row', gap: spacing.sm },
  hintLeft:  { ...typography.tiny, color: colors.warning, fontWeight: '600' },
  hintRight: { ...typography.tiny, color: colors.success, fontWeight: '600' },

  // +10 XP badge
  xpBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: CARD_H / 2 - 24,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    zIndex: 99,
  },
  xpText: {
    ...typography.bodyBold,
    color: '#fff',
    fontWeight: '800',
  },

  // ── Footer hint ──
  footerHint: {
    ...typography.tiny,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm + BACK_PEEK,
  },

  // ── InboxZero ──
  inboxZero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  inboxZeroRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ECFDF5',
    borderWidth: 2,
    borderColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  inboxZeroCheck: { fontSize: 28, color: colors.success },
  inboxZeroTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  inboxZeroSub: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});

export default DailyQueueStack;
