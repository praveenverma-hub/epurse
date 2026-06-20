// =============================================================================
// DailyQueueStack — swipeable SMS transaction review queue
// -----------------------------------------------------------------------------
// Right swipe  → approve  → recordReview() → +RP / +EPC drift animation
// Left swipe   → category picker → mark reviewed after selection
// Empty queue  → InboxZero celebration card
// ⓘ icon       → opens QueueCapInfoSheet explaining the 20/day earning cap
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
import {
  useRewardStore,
  selectTotalRP,
  selectAwareStreak,
} from '../store/useRewardStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDateTime } from '../utils/format';
import { canSplitTransaction } from '../utils/split';
import CategoryPickerModal from './CategoryPickerModal';
import LinkContactModal from './LinkContactModal';
import SplitConfigModal from './SplitConfigModal';
import GroupPickerSheet from './GroupPickerSheet';
import GroupExpenseSheet from './GroupExpenseSheet';
import CenterModal from './CenterModal';
import QueueCapInfoSheet from './QueueCapInfoSheet';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_H         = 152;
const BACK_PEEK      = 20; // px of back cards visible below the top card
const SWIPE_THRESHOLD = SCREEN_W * 0.28;
const SWIPE_VELOCITY  = 600; // velocity shortcut — flick to dismiss even before threshold

// Visual offsets for up to 3 stacked cards (index 0 = top)
const STACK_SCALE  = [1,    0.96,  0.92];
const STACK_OFFSET = [0,    10,    20];   // translateY downward from top
const STACK_ALPHA  = [1,    0.82,  0.60];

// Synthetic first-run tutorial card (NOT a real transaction). Teaches the
// swipe-to-approve mechanic; dismissing it flips welcomeReviewSeen in the store.
const WELCOME_CARD = { id: '__welcome__', __welcome: true };

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
const SwipeableCard = ({ txn, index, categories, groupName, onApprove, onPickCategory }) => {
  const isTop = index === 0;

  // Gesture shared values (only used by the top card)
  const translateX = useSharedValue(0);
  const rotate     = useSharedValue(0);

  // Reward drift badge (+RP / +EPC). Label is set just-in-time from the
  // recordReview() return payload so capped reviews can show the cap hint
  // instead of fake award numbers.
  const driftOpacity = useSharedValue(0);
  const driftY       = useSharedValue(0);
  const [driftLabel, setDriftLabel] = useState('');

  const fireDriftAnimation = useCallback((label) => {
    setDriftLabel(label);
    driftOpacity.value = withSequence(
      withTiming(1, { duration: 120 }),
      withTiming(0, { duration: 500 }),
    );
    driftY.value = withTiming(-56, { duration: 620 });
  }, []);

  const handleApprove = useCallback(() => {
    onApprove(txn.id, fireDriftAnimation);
  }, [txn.id, onApprove, fireDriftAnimation]);

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

  const driftStyle = useAnimatedStyle(() => ({
    opacity:   driftOpacity.value,
    transform: [{ translateY: driftY.value }],
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
          {txn.__welcome ? (
            <View style={styles.welcomeInner}>
              <Text style={styles.welcomeEmoji}>👋</Text>
              <Text style={styles.welcomeTitle}>Welcome to ePurse</Text>
              <Text style={styles.welcomeBody} numberOfLines={2}>
                New transactions land here to review. Swipe right to approve, left to fix the category.
              </Text>
              <View style={styles.swipeHints}>
                <Text style={styles.hintLeft}>← edit</Text>
                <Text style={styles.hintRight}>got it →</Text>
              </View>
            </View>
          ) : (
            <>
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
                <View style={styles.cardBottomLeft}>
                  <Text style={styles.cardDate}>{formatDateTime(txn.createdAt)}</Text>
                  {groupName ? (
                    <View style={styles.groupChip}>
                      <Text style={styles.groupChipTxt} numberOfLines={1}>🗂 {groupName}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.swipeHints}>
                  <Text style={styles.hintLeft}>← edit</Text>
                  <Text style={styles.hintRight}>approve →</Text>
                </View>
              </View>
            </>
          )}
        </Animated.View>
      </GestureDetector>

      {/* RP / EPC drift — only on the top card. Label is set just-in-time
          based on the recordReview() return payload (cap-respecting). */}
      {isTop && !!driftLabel && (
        <Animated.View style={[styles.driftBadge, driftStyle]} pointerEvents="none">
          <Text style={styles.driftText}>{driftLabel}</Text>
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
  const groups   = useEPurseStore((s) => s.groups);
  const welcomeReviewSeen   = useEPurseStore((s) => s.welcomeReviewSeen);
  const setWelcomeReviewSeen = useEPurseStore((s) => s.setWelcomeReviewSeen);
  const totalRP    = useRewardStore(selectTotalRP);
  const awareStreak = useRewardStore(selectAwareStreak);
  const recordReview = useRewardStore((s) => s.recordReview);
  const categories               = useEPurseStore((s) => s.categories);
  const markReviewed             = useEPurseStore((s) => s.markReviewed);
  const updateTransactionCategory = useEPurseStore((s) => s.updateTransactionCategory);
  const updateTwoTierCategory    = useEPurseStore((s) => s.updateTwoTierCategory);
  const updateTransactionCategoryWithContact = useEPurseStore((s) => s.updateTransactionCategoryWithContact);
  // Full manage-panel actions (parity with Dashboard/Activity, available in the queue).
  const setTransactionSplit       = useEPurseStore((s) => s.setTransactionSplit);
  const setTransactionHidden      = useEPurseStore((s) => s.setTransactionHidden);
  const ignoreTransaction         = useEPurseStore((s) => s.ignoreTransaction);
  const deleteTransaction         = useEPurseStore((s) => s.deleteTransaction);
  const tagTransactionToGroup     = useEPurseStore((s) => s.tagTransactionToGroup);
  const untagTransactionFromGroup = useEPurseStore((s) => s.untagTransactionFromGroup);
  const updateGroupExpense        = useEPurseStore((s) => s.updateGroupExpense);

  // Category picker state
  const [pickerTxn,  setPickerTxn]  = useState(null);
  const [lbLinkData, setLbLinkData] = useState(null); // { txn, categoryId }
  const [splitTxn,   setSplitTxn]   = useState(null);
  const [groupPickerTxn,  setGroupPickerTxn]  = useState(null);
  const [groupExpenseTxn, setGroupExpenseTxn] = useState(null); // { txn, group } — tag NEW into group
  const [editGroupTxn,    setEditGroupTxn]    = useState(null); // { txn, group } — set/edit split on a grouped txn
  const [confirm,    setConfirm]    = useState(null);
  const [showCapInfo, setShowCapInfo] = useState(false);

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

  /**
   * Compose the queue-clear with the economy hit. `markReviewed` always
   * fires so the card leaves the layout; `recordReview` decides whether to
   * award RP/EPC (within daily cap) or show the cap hint. `fireDrift` is
   * the SwipeableCard's per-card animation entry point — we hand it the
   * pre-formatted label.
   */
  const handleApprove = useCallback((id, fireDrift) => {
    // The welcome tutorial card isn't a real txn — swiping it just dismisses the
    // one-time coach mark (no review reward, no markReviewed lookup).
    if (id === WELCOME_CARD.id) {
      setWelcomeReviewSeen(true);
      return;
    }
    const result = recordReview();
    markReviewed(id);
    if (fireDrift) {
      if (result.counted) {
        fireDrift(`+${result.rpAwarded} RP  ·  +${result.epcAwarded} EPC`);
      } else if (result.message) {
        fireDrift(result.message);
      }
    }
  }, [markReviewed, recordReview, setWelcomeReviewSeen]);

  const handlePickCategory = useCallback((txn) => {
    // The welcome card has no category to edit — left-swipe is a no-op.
    if (txn?.__welcome) return;
    setPickerTxn(txn);
  }, []);

  const handleSelectCategory = useCallback((categoryId) => {
    if (!pickerTxn) return;
    updateTransactionCategory(pickerTxn.id, categoryId);
    recordReview();
    markReviewed(pickerTxn.id);
    setPickerTxn(null);
  }, [pickerTxn, updateTransactionCategory, markReviewed, recordReview]);

  const handleSelectTwoTier = useCallback((parentCategory, childCategory) => {
    if (!pickerTxn) return;
    updateTwoTierCategory(pickerTxn.id, parentCategory, childCategory);
    recordReview();
    markReviewed(pickerTxn.id);
    setPickerTxn(null);
  }, [pickerTxn, updateTwoTierCategory, markReviewed, recordReview]);

  const handleSelectLentBorrow = useCallback((categoryId) => {
    if (!pickerTxn) return;
    const txn = pickerTxn;
    setPickerTxn(null);
    setLbLinkData({ txn, categoryId });
  }, [pickerTxn]);

  const handleLinkContact = useCallback((contactInfo) => {
    if (!lbLinkData) return;
    updateTransactionCategoryWithContact(lbLinkData.txn.id, lbLinkData.categoryId, contactInfo);
    recordReview();
    markReviewed(lbLinkData.txn.id);
    setLbLinkData(null);
  }, [lbLinkData, updateTransactionCategoryWithContact, markReviewed, recordReview]);

  const handlePickerClose = useCallback(() => {
    setPickerTxn(null);
  }, []);

  const handleLbClose = useCallback(() => {
    setLbLinkData(null);
  }, []);

  // Acting on a queued txn (group/split/hide) counts as reviewing it: award the
  // capped review reward and clear it from the queue — same as categorising.
  const clearAsReviewed = useCallback((id) => {
    recordReview();
    markReviewed(id);
  }, [recordReview, markReviewed]);

  // ── Manage actions (parity with the full panel) ──
  const handleAddToGroup = useCallback(() => {
    const t = pickerTxn;
    setPickerTxn(null);
    setGroupPickerTxn(t);
  }, [pickerTxn]);

  const handleRemoveFromGroup = useCallback(() => {
    if (!pickerTxn) return;
    untagTransactionFromGroup(pickerTxn.id);
    clearAsReviewed(pickerTxn.id);
    setPickerTxn(null);
  }, [pickerTxn, untagTransactionFromGroup, clearAsReviewed]);

  // Set / edit "who owes" on a shared-group-tagged txn (e.g. one auto-tagged by a
  // Group Zone). Opens the group-expense editor — paid by me + equal split by default,
  // category shown — and persists via updateGroupExpense (keeps account/total/LB in sync).
  const handleEditGroup = useCallback(() => {
    if (!pickerTxn) return;
    const group = groups.find((g) => g.id === pickerTxn.groupId);
    if (!group || group.type !== 'shared') return;
    // Read the freshest txn from the store (category may have just changed in the modal).
    const fresh = useEPurseStore.getState().transactions.find((t) => t.id === pickerTxn.id) || pickerTxn;
    setPickerTxn(null);
    setEditGroupTxn({ txn: fresh, group });
  }, [pickerTxn, groups]);

  const handleOpenSplit = useCallback(() => {
    const t = pickerTxn;
    setPickerTxn(null);
    setSplitTxn(t);
  }, [pickerTxn]);

  const handleToggleHidden = useCallback((hidden) => {
    if (!pickerTxn) return;
    const t = pickerTxn;
    setPickerTxn(null);
    setConfirm({
      title: hidden ? 'Mark as Private?' : 'Make Public?',
      message: hidden
        ? 'This transaction will be private — hidden from default views but still counted in totals.'
        : 'This transaction will be visible again in all default views.',
      primaryText: hidden ? 'Mark Private' : 'Make Public',
      destructive: hidden,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => { setTransactionHidden(t.id, hidden); clearAsReviewed(t.id); setConfirm(null); },
    });
  }, [pickerTxn, setTransactionHidden, clearAsReviewed]);

  const handleIgnore = useCallback(() => {
    if (!pickerTxn) return;
    const t = pickerTxn;
    setPickerTxn(null);
    setConfirm({
      title: 'Ignore transaction?',
      message: 'This removes it from your balances and every total and chart. It will be treated as if it never happened.',
      primaryText: 'Ignore',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => { ignoreTransaction(t.id); setConfirm(null); }, // ignored ⇒ leaves the queue
    });
  }, [pickerTxn, ignoreTransaction]);

  const handleDelete = useCallback(() => {
    if (!pickerTxn) return;
    const t = pickerTxn;
    setPickerTxn(null);
    setConfirm({
      title: 'Delete transaction?',
      message: 'This action cannot be undone.',
      primaryText: 'Delete',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm: () => { deleteTransaction(t.id); setConfirm(null); },
    });
  }, [pickerTxn, deleteTransaction]);

  // Brand-new users see a one-time welcome card atop the queue that teaches the
  // swipe mechanic. It lives only in the rendered list (not the store ledger).
  const showWelcome = !welcomeReviewSeen;
  const displayQueue = showWelcome ? [WELCOME_CARD, ...queue] : queue;

  // Nothing to show — section is hidden (unless the welcome card is pending).
  if (displayQueue.length === 0 && !showZero) return null;

  const visible = displayQueue.slice(0, 3); // show at most 3 stacked cards

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>REVIEW QUEUE</Text>
          <TouchableOpacity
            style={styles.infoDot}
            onPress={() => setShowCapInfo(true)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel="Daily earning cap info"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.infoDotText}>ⓘ</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerRow}>
          {showWelcome ? (
            <Text style={styles.headerSub}>Getting started</Text>
          ) : queue.length > 0 ? (
            <Text style={styles.headerSub}>
              {queue.length} transaction{queue.length !== 1 ? 's' : ''} to review
            </Text>
          ) : <View />}
          <TouchableOpacity
            style={styles.xpPill}
            onPress={() => navigation.navigate('RewardShop')}
            activeOpacity={0.75}
          >
            <Text style={styles.xpPillText}>⚡ {totalRP.toLocaleString('en-IN')} RP</Text>
            {awareStreak > 0 && (
              <Text style={styles.streakText}> · 🔥 {awareStreak}d</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Stack or InboxZero ── */}
      {displayQueue.length === 0 ? (
        <InboxZero />
      ) : (
        <View style={[styles.stackContainer, { height: CARD_H + BACK_PEEK }]}>
          {[...visible].reverse().map((txn, revIdx) => {
            const idx = visible.length - 1 - revIdx;
            // If a Group Zone is on (or this txn was tagged), surface the group
            // name on the card so the user can confirm/override it in the queue.
            const groupName = txn.groupId
              ? (groups.find((g) => g.id === txn.groupId)?.name || null)
              : null;
            return (
              <SwipeableCard
                key={txn.id}
                txn={txn}
                index={idx}
                categories={categories}
                groupName={groupName}
                onApprove={handleApprove}
                onPickCategory={handlePickCategory}
              />
            );
          })}
        </View>
      )}

      {/* ── Swipe hint footer ── */}
      {displayQueue.length > 0 && (
        <Text style={styles.footerHint}>
          Swipe right to approve · left to re-categorise
        </Text>
      )}

      {/* ── Category picker ── */}
      <CategoryPickerModal
        visible={!!pickerTxn}
        categories={categories}
        selectedCategoryId={pickerTxn?.categoryId}
        selectedParent={pickerTxn?.parentCategory}
        selectedChild={pickerTxn?.childCategory}
        isHidden={!!pickerTxn?.isHidden}
        isIgnored={!!pickerTxn?.isIgnored}
        canSplit={!!pickerTxn && canSplitTransaction(pickerTxn)}
        isSplitTxn={!!pickerTxn?.isSplit}
        categoryLocked={!!pickerTxn?.lbLocked}
        currentGroupId={pickerTxn?.groupId || null}
        onSelectCategory={handleSelectCategory}
        onSelectTwoTier={handleSelectTwoTier}
        onSelectLentBorrow={handleSelectLentBorrow}
        onPressAddToGroup={handleAddToGroup}
        onPressRemoveFromGroup={handleRemoveFromGroup}
        onPressEditGroup={
          pickerTxn?.groupId && groups.find((g) => g.id === pickerTxn.groupId)?.type === 'shared'
            ? handleEditGroup
            : undefined
        }
        groupHasSplit={!!pickerTxn?.groupSplit}
        onPressSplit={handleOpenSplit}
        onToggleHidden={handleToggleHidden}
        onIgnore={handleIgnore}
        onDelete={handleDelete}
        onClose={handlePickerClose}
      />

      {/* ── Link contact (for lent/borrow re-categorisation) ── */}
      <LinkContactModal
        visible={!!lbLinkData}
        categoryId={lbLinkData?.categoryId}
        onConfirm={handleLinkContact}
        onClose={handleLbClose}
      />

      {/* ── Split ── */}
      <SplitConfigModal
        visible={!!splitTxn}
        transaction={splitTxn}
        onClose={() => setSplitTxn(null)}
        onApply={(others, meta) => {
          if (splitTxn) {
            setTransactionSplit(splitTxn.id, others, meta);
            clearAsReviewed(splitTxn.id);
          }
          setSplitTxn(null);
        }}
      />

      {/* ── Add to group ── */}
      <GroupPickerSheet
        visible={!!groupPickerTxn}
        txn={groupPickerTxn}
        onClose={() => setGroupPickerTxn(null)}
        onCreateNew={() => { setGroupPickerTxn(null); navigation.navigate('Groups'); }}
        onPick={(groupId, group) => {
          const txn = groupPickerTxn;
          setGroupPickerTxn(null);
          if (group?.type === 'shared') {
            setGroupExpenseTxn({ txn, group });
          } else {
            tagTransactionToGroup(txn.id, groupId);
            clearAsReviewed(txn.id);
          }
        }}
      />

      {groupExpenseTxn && (
        <GroupExpenseSheet
          visible={!!groupExpenseTxn}
          group={groupExpenseTxn.group}
          presetAmount={groupExpenseTxn.txn?.amount}
          onClose={() => setGroupExpenseTxn(null)}
          onAdd={(expenseData) => {
            tagTransactionToGroup(groupExpenseTxn.txn.id, groupExpenseTxn.group.id, expenseData.shares?.length ? {
              paidByMemberId: expenseData.paidByMemberId,
              paidByName: expenseData.paidByName,
              shares: expenseData.shares,
            } : null);
            clearAsReviewed(groupExpenseTxn.txn.id);
            setGroupExpenseTxn(null);
          }}
        />
      )}

      {/* ── Set / edit who-owes on an already-grouped txn (e.g. Group-Zone-tagged) ── */}
      {editGroupTxn && (
        <GroupExpenseSheet
          visible={!!editGroupTxn}
          group={editGroupTxn.group}
          editTxn={editGroupTxn.txn}
          presetAmount={editGroupTxn.txn?.amount}
          showCategory
          lockPayerToMe={!editGroupTxn.txn?.isGroupMemo && !!editGroupTxn.txn?.accountId}
          onClose={() => setEditGroupTxn(null)}
          onAdd={(expenseData) => {
            updateGroupExpense(editGroupTxn.txn.id, expenseData);
            clearAsReviewed(editGroupTxn.txn.id);
            setEditGroupTxn(null);
          }}
        />
      )}

      {/* ── Confirm (hide / ignore / delete) ── */}
      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />

      {/* ── Daily cap explainer ── */}
      <QueueCapInfoSheet
        visible={showCapInfo}
        onClose={() => setShowCapInfo(false)}
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
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
  infoDot: {
    width: 18, height: 18,
    alignItems: 'center', justifyContent: 'center',
  },
  infoDotText: {
    fontSize: 13,
    color:    colors.textMuted,
    fontWeight: '700',
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
  cardBottomLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  groupChip: {
    backgroundColor: colors.primary + '14',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 130,
  },
  groupChipTxt: { ...typography.tiny, color: colors.primary, fontWeight: '700' },
  swipeHints: { flexDirection: 'row', gap: spacing.sm },
  hintLeft:  { ...typography.tiny, color: colors.warning, fontWeight: '600' },
  hintRight: { ...typography.tiny, color: colors.success, fontWeight: '600' },

  // ── Welcome tutorial card ──
  welcomeInner: { flex: 1, justifyContent: 'center', gap: 4 },
  welcomeEmoji: { fontSize: 26 },
  welcomeTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  welcomeBody:  { ...typography.small, color: colors.textSecondary, lineHeight: 18 },

  // RP / EPC drift badge (was xpBadge)
  driftBadge: {
    position: 'absolute',
    alignSelf: 'center',
    top: CARD_H / 2 - 24,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    zIndex: 99,
  },
  driftText: {
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
