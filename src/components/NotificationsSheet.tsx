// =============================================================================
// NotificationsSheet.tsx — bottom-sheet activity feed surfaced by the BellIcon.
// • Layout comes from `analytics/bellFeed` (Money Due → Today/Yesterday/
//   Earlier → one pinned Rewards row).
// • Tap a row → mark read + open what it's about. Long-press → dismiss it.
// • "Mark all read" is visible only when unread count > 0.
// =============================================================================

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './AppText';
import Modal from "./AppModal";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import {
  useNotificationStore,
  selectNotificationEntries,
  type NotificationKind,
} from '../store/useNotificationStore';
import { useEPurseStore } from '../store/ePurseStore';
import { useRewardStore } from '../store/useRewardStore';
import { levelFromRP, multiplierForStreak } from '../config/rewardConfig';
import { buildBellFeed, type DueRow, type FeedRow } from '../analytics/bellFeed';
import { timeAgo } from '../utils/format';
import { DIVIDER_W } from '../constants/theme';
import SheetCloseButton from './SheetCloseButton';
import { openStoreListing } from './UpdateRequiredGate';
import type { AutoModalId } from '../constants/autoModals';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface NotificationsSheetProps {
  visible: boolean;
  onClose: () => void;
  onOpenPending?: (modal: AutoModalId) => void;
  /** Same contract as HomeCarousel's `onNavigate` (route + params). */
  onNavigate?: (route: string, params?: Record<string, unknown>) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCREEN_H    = Dimensions.get('window').height;
const SHEET_MAX_H = SCREEN_H * 0.78;
const STATUS_BAR_H = StatusBar.currentHeight ?? 44;
const ENTER_MS = 320;
const EXIT_MS  = 240;

const PENDING_TARGET: Partial<Record<NotificationKind, AutoModalId>> = {
  monthly_recap: 'monthlyRecap',
  weekly_recap:  'weeklyRecap',
};

const ROUTE_FOR: Partial<Record<FeedRow['kind'], (r: FeedRow) => [string, Record<string, unknown>?]>> = {
  budget_breach:     () => ['Insights', { defaultTab: 'budget' }],
  midmonth_check_in: () => ['Insights', { defaultTab: 'budget' }],
  subscription_hike: () => ['Insights'],
  goal_achieved:     () => ['Goals'],
  cc_cycle_heads_up: (r) => ['AccountDetails', { accountId: r.entry?.meta?.accountId }],
  cc_bill_paid:      (r) => ['AccountDetails', { accountId: r.accountId }],
};

const PAID_ICON: keyof typeof Ionicons.glyphMap = 'checkmark-circle-outline';
const PAID_TINT   = '#10B981';
const URGENT_INK  = '#DC2626';
const REWARD_ICON: keyof typeof Ionicons.glyphMap = 'sparkles-outline';
const REWARD_TINT = '#06B6D4';

const KIND_ICON: Record<NotificationKind, keyof typeof Ionicons.glyphMap> = {
  cc_due:                'card-outline',
  cc_payment_review:     'card-outline',
  cc_cycle_heads_up:     'calendar-outline',
  subscription_hike:     'trending-up-outline',
  budget_breach:         'pie-chart-outline',
  midmonth_check_in:     'speedometer-outline',
  monthly_recap:         'bar-chart-outline',
  weekly_recap:          'calendar-outline',
  aware_savings_ready:   'gift-outline',
  aware_check_in:        'sparkles-outline',
  aware_streak_reset:    'refresh-circle-outline',
  aware_savings_claimed: 'gift-outline',
  goal_achieved:         'flag-outline',
  level_up:              'trophy-outline',
  app_update:            'arrow-up-circle-outline',
};

// Fallback for a kind with no entry (e.g. one persisted by a newer build).
const FALLBACK_ICON: keyof typeof Ionicons.glyphMap = 'notifications-outline';
const FALLBACK_TINT = '#6B7280';

const KIND_TINT: Record<NotificationKind, string> = {
  cc_due:                '#F59E0B',
  cc_payment_review:     '#7C3AED',
  cc_cycle_heads_up:     '#F59E0B',
  subscription_hike:     '#EF4444',
  budget_breach:         '#EF4444',
  midmonth_check_in:     '#2563EB',
  monthly_recap:         '#FF5A1F',
  weekly_recap:          '#2563EB',
  aware_savings_ready:   '#10B981',
  aware_check_in:        '#06B6D4',
  aware_streak_reset:    '#9CA3AF',
  aware_savings_claimed: '#10B981',
  goal_achieved:         '#14B8A6',
  level_up:              '#7C3AED',
  app_update:            '#2563EB',
};

// ─── Component ──────────────────────────────────────────────────────────────

const NotificationsSheet: React.FC<NotificationsSheetProps> = ({
  visible,
  onClose,
  onOpenPending,
  onNavigate,
}) => {
  const entries     = useNotificationStore(selectNotificationEntries);
  const markRead    = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss     = useNotificationStore((s) => s.dismiss);
  const openMonthlyRecap = useEPurseStore((s) => s.openMonthlyRecap);
  const ccBills     = useEPurseStore((s) => s.ccBills);
  const accounts    = useEPurseStore((s) => s.accounts);
  const streak      = useRewardStore((s) => s.awareStreak);
  const totalRP     = useRewardStore((s) => s.totalRP);
  const pendingBonus = useRewardStore((s) => s.pendingSavingsReward);

  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(-SHEET_MAX_H);
  const afterCloseRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (visible) {
      StatusBar.setBarStyle('dark-content', true);
      opacity.value   = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
      translate.value = withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
    } else {
      StatusBar.setBarStyle('light-content', true);
      opacity.value   = withTiming(0, { duration: EXIT_MS });
      translate.value = withTiming(-SHEET_MAX_H, {
        duration: EXIT_MS,
        easing:   Easing.in(Easing.cubic),
      });
    }
    return () => {
      cancelAnimation(opacity);
      cancelAnimation(translate);
    };
  }, [visible, opacity, translate]);

  const finishDismiss = (): void => {
    onClose();
    const afterClose = afterCloseRef.current;
    afterCloseRef.current = null;
    afterClose?.();
  };

  const handleDismiss = (afterClose?: () => void): void => {
    afterCloseRef.current = afterClose ?? null;
    opacity.value = withTiming(0, { duration: EXIT_MS });
    translate.value = withTiming(
      -SHEET_MAX_H,
      { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishDismiss)();
      },
    );
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: translate.value }] }));

  const unreadCount = useMemo(
    () => entries.reduce((n, e) => (e.isRead ? n : n + 1), 0),
    [entries],
  );

  // Rebuilt on open so "Today" and "due in N days" are measured from now.
  const feed = useMemo(
    () => buildBellFeed({ entries, ccBills, accounts, nowMs: Date.now() }),
    [entries, ccBills, accounts, visible],
  );

  const go = (route: string, params?: Record<string, unknown>): void =>
    handleDismiss(() => onNavigate?.(route, params));

  const openDue = (row: DueRow): void => {
    if (row.entryId) markRead(row.entryId);
    if (row.type === 'review') {
      handleDismiss(() => onOpenPending?.('ccPayment'));
      return;
    }
    go('Accounts', { cardLast4: row.cardLast4 ?? null });
  };

  const openRow = (row: FeedRow): void => {
    const entry = row.entry;
    if (entry) markRead(entry.id);
    const pendingTarget = entry ? PENDING_TARGET[entry.kind] : undefined;
    if (entry && pendingTarget) {
      const monthKey = entry.kind === 'monthly_recap'
        ? (entry.meta?.monthKey as string | undefined)
        : undefined;
      handleDismiss(() => {
        if (monthKey) openMonthlyRecap(monthKey);
        onOpenPending?.(pendingTarget);
      });
      return;
    }
    // app_update is the SOFT nudge — tapping it is the whole point of showing
    // it, so it goes straight to the store listing. The sheet stays open: the
    // tap left the app, it didn't navigate anywhere inside it.
    if (row.kind === 'app_update') { openStoreListing(); return; }
    const target = ROUTE_FOR[row.kind]?.(row);
    if (target) go(...target);
  };

  const unreadRewards = feed.rewards.filter((e) => !e.isRead);
  const showRewards = streak > 0 || !!pendingBonus || feed.rewards.length > 0;
  const openRewards = (): void => {
    unreadRewards.forEach((e) => markRead(e.id));
    if (pendingBonus) handleDismiss(() => onOpenPending?.('epcClaim'));
    else go('Profile');
  };

  const isEmpty = feed.due.length === 0 && feed.days.length === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => handleDismiss()}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => handleDismiss()} />

        <Animated.View style={[styles.sheet, sheetStyle]}>
          <SheetCloseButton onPress={() => handleDismiss()} variant="absolute" />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Notifications</Text>
            {unreadCount > 0 && (
              <Pressable
                onPress={markAllRead}
                accessibilityRole="button"
                accessibilityLabel="Mark all as read"
              >
                <Text style={styles.markAllText}>Mark all read</Text>
              </Pressable>
            )}
          </View>

          {isEmpty ? (
            <EmptyState />
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {feed.due.length > 0 && (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Money Due</Text>
                  {feed.due.map((row) => (
                    <NotificationRow
                      key={row.id}
                      icon={KIND_ICON[row.type === 'bill' ? 'cc_due' : 'cc_payment_review']}
                      tint={KIND_TINT[row.type === 'bill' ? 'cc_due' : 'cc_payment_review']}
                      title={row.title}
                      body={row.body}
                      bodyInk={row.urgent ? URGENT_INK : undefined}
                      trailing={row.trailing}
                      isRead={row.isRead}
                      onPress={() => openDue(row)}
                    />
                  ))}
                </View>
              )}
              {feed.days.map((day) => (
                <View key={day.label} style={styles.group}>
                  <Text style={styles.groupLabel}>{day.label}</Text>
                  {day.rows.map((row) => (
                    <NotificationRow
                      key={row.id}
                      icon={row.kind === 'cc_bill_paid' ? PAID_ICON : KIND_ICON[row.kind] ?? FALLBACK_ICON}
                      tint={row.kind === 'cc_bill_paid' ? PAID_TINT : KIND_TINT[row.kind] ?? FALLBACK_TINT}
                      title={row.title}
                      body={row.body}
                      trailing={row.trailing}
                      time={timeAgo(row.at)}
                      isRead={row.isRead}
                      onPress={() => openRow(row)}
                      onLongPress={row.entry ? () => dismiss(row.entry!.id) : undefined}
                    />
                  ))}
                </View>
              ))}
            </ScrollView>
          )}

          {showRewards && (
            <View style={styles.rewardsBar}>
              <NotificationRow
                icon={REWARD_ICON}
                tint={REWARD_TINT}
                title="Rewards"
                body={
                  pendingBonus ? `Zero-spend bonus ready, +${pendingBonus.rpAmount} RP`
                  : unreadRewards[0]?.title
                  ?? `Day ${streak} Aware Run · ${multiplierForStreak(streak)}×`
                }
                trailing={`Level ${levelFromRP(totalRP)}`}
                isRead={!pendingBonus && unreadRewards.length === 0}
                onPress={openRewards}
                chevron
              />
            </View>
          )}

          {/* Pull-down indicator */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

// ─── Empty state ────────────────────────────────────────────────────────────

const EmptyState: React.FC = () => (
  <View style={styles.empty}>
    <View style={styles.emptyIconWrap}>
      <Ionicons name="notifications-off-outline" size={28} color="#9CA3AF" />
    </View>
    <Text style={styles.emptyTitle}>You're all caught up</Text>
    <Text style={styles.emptyBody}>
      Bills due, spending alerts and reports show up here.
    </Text>
  </View>
);

// ─── Row ────────────────────────────────────────────────────────────────────

interface RowProps {
  icon:         keyof typeof Ionicons.glyphMap;
  tint:         string;
  title:        string;
  body:         string;
  bodyInk?:     string;
  trailing?:    string | null;
  time?:        string;
  isRead:       boolean;
  chevron?:     boolean;
  onPress:      () => void;
  onLongPress?: () => void;
}

const NotificationRow: React.FC<RowProps> = ({
  icon, tint, title, body, bodyInk, trailing, time, isRead, chevron, onPress, onLongPress,
}) => (
  <Pressable
    onPress={onPress}
    onLongPress={onLongPress}
    delayLongPress={350}
    style={({ pressed }) => [
      styles.row,
      isRead && styles.rowRead,
      pressed && styles.rowPressed,
    ]}
  >
    <View style={[styles.rowIconWrap, { backgroundColor: `${tint}1A`, borderColor: `${tint}33` }]}>
      <Ionicons name={icon} size={18} color={tint} />
    </View>
    <View style={styles.rowBody}>
      <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
      <Text style={[styles.rowText, bodyInk ? { color: bodyInk, fontWeight: '600' } : null]} numberOfLines={2}>
        {body}
      </Text>
    </View>
    {(!!trailing || !!time) && (
      <View style={styles.rowRight}>
        {!!trailing && <Text style={styles.rowAmount} numberOfLines={1}>{trailing}</Text>}
        {!!time && <Text style={styles.rowTime}>{time}</Text>}
      </View>
    )}
    {!isRead && <View style={[styles.unreadDot, { backgroundColor: tint }]} />}
    {chevron && <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />}
  </Pressable>
);

export default NotificationsSheet;

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: 'rgba(5, 8, 16, 0.65)',
    justifyContent:  'flex-start',
  },
  sheet: {
    backgroundColor:         '#FFFFFF',
    paddingHorizontal:       20,
    paddingTop:              STATUS_BAR_H + 12,
    paddingBottom:           8,
    borderBottomLeftRadius:  28,
    borderBottomRightRadius: 28,
    maxHeight:               SHEET_MAX_H,
  },
  handleRow: {
    alignItems:    'center',
    paddingTop:    10,
    paddingBottom: 10,
  },
  handle: {
    width:           38,
    height:          4,
    borderRadius:    2,
    backgroundColor: '#E5E7EB',
  },
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   12,
  },
  title: {
    color:         '#1C1C1E',
    fontSize:      18,
    fontWeight:    '800',
    letterSpacing: -0.3,
  },
  markAllText: {
    color:      '#0EA5E9',
    fontSize:   13,
    fontWeight: '700',
  },
  list:        { maxHeight: SCREEN_H * 0.54 },
  listContent: { paddingBottom: 8, gap: 16 },
  group:       { gap: 8 },
  groupLabel: {
    color:      '#6B7280',
    fontSize:   13,
    fontWeight: '700',
  },
  rewardsBar: {
    borderTopWidth: DIVIDER_W,
    borderTopColor: '#E5E7EB',
    paddingTop:     10,
    marginTop:      4,
  },

  // Row
  row: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: '#F9FAFB',
    borderRadius:    14,
    paddingHorizontal: 12,
    paddingVertical:   10,
    gap: 12,
  },
  rowRead:    { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3F4F6' },
  rowPressed: { opacity: 0.7 },
  rowIconWrap: {
    width:           34,
    height:          34,
    borderRadius:    17,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     1,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowRight: { alignItems: 'flex-end', maxWidth: '45%', gap: 2 },
  rowAmount: {
    color:      '#111827',
    fontSize:   13,
    fontWeight: '700',
  },
  rowTitle: {
    color:      '#111827',
    fontSize:   14,
    fontWeight: '700',
  },
  rowTime: {
    color:      '#9CA3AF',
    fontSize:   11,
    fontWeight: '600',
  },
  rowText: {
    color:      '#4B5563',
    fontSize:   12.5,
    lineHeight: 17,
    marginTop:  2,
  },
  unreadDot: {
    width:        8,
    height:       8,
    borderRadius: 4,
  },

  // Empty state
  empty: {
    alignItems:        'center',
    justifyContent:    'center',
    paddingVertical:   42,
    paddingHorizontal: 24,
  },
  emptyIconWrap: {
    width:           52,
    height:          52,
    borderRadius:    26,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: '#F3F4F6',
    marginBottom:    12,
  },
  emptyTitle: {
    color:      '#111827',
    fontSize:   15,
    fontWeight: '800',
  },
  emptyBody: {
    color:      '#6B7280',
    fontSize:   13,
    lineHeight: 18,
    marginTop:  4,
    textAlign:  'center',
  },
});
