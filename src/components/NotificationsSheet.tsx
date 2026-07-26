// =============================================================================
// NotificationsSheet.tsx — bottom-sheet activity feed surfaced by the BellIcon.
// • Reads entries straight from useNotificationStore.
// • Empty state when no entries.
// • Tap a row → mark read. Long-press a row → dismiss it.
// • "Mark all read" footer chip is visible only when unread count > 0.
// =============================================================================

import React, { useEffect, useMemo } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  type NotificationEntry,
  type NotificationKind,
} from '../store/useNotificationStore';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface NotificationsSheetProps {
  visible: boolean;
  onClose: () => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SCREEN_H    = Dimensions.get('window').height;
const SHEET_MAX_H = SCREEN_H * 0.78;
const STATUS_BAR_H = StatusBar.currentHeight ?? 44;
const ENTER_MS = 320;
const EXIT_MS  = 240;

const KIND_ICON: Record<NotificationKind, keyof typeof Ionicons.glyphMap> = {
  cc_due:                'card-outline',
  subscription_hike:     'trending-up-outline',
  monthly_recap:         'bar-chart-outline',
  aware_check_in:        'sparkles-outline',
  aware_streak_reset:    'refresh-circle-outline',
  aware_savings_claimed: 'gift-outline',
  level_up:              'trophy-outline',
};

const KIND_TINT: Record<NotificationKind, string> = {
  cc_due:                '#F59E0B',
  subscription_hike:     '#EF4444',
  monthly_recap:         '#FF5A1F',
  aware_check_in:        '#06B6D4',
  aware_streak_reset:    '#9CA3AF',
  aware_savings_claimed: '#10B981',
  level_up:              '#7C3AED',
};

// ─── Time-ago helper ────────────────────────────────────────────────────────
// Under a day: relative ("just now" / "Xm ago" / "Xh ago"). A day or older: the
// actual date (e.g. "4 Jul", or "4 Jul 2025" across years) — clearer than "3d"/"2w".

const timeAgo = (ms: number): string => {
  const diff = Math.max(0, Date.now() - ms);
  const m = Math.floor(diff / 60_000);
  if (m < 1)    return 'just now';
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  // ≥ 1 day ago → show the date. Include the year only when it differs from now.
  const dt  = new Date(ms);
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    dt.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' };
  return dt.toLocaleDateString('en-IN', opts);
};

// ─── Component ──────────────────────────────────────────────────────────────

const NotificationsSheet: React.FC<NotificationsSheetProps> = ({
  visible,
  onClose,
}) => {
  const entries     = useNotificationStore(selectNotificationEntries);
  const markRead    = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss     = useNotificationStore((s) => s.dismiss);

  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(-SHEET_MAX_H);

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

  const handleDismiss = (): void => {
    opacity.value = withTiming(0, { duration: EXIT_MS });
    translate.value = withTiming(
      -SHEET_MAX_H,
      { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onClose)();
      },
    );
  };

  const backdropStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: translate.value }] }));

  const unreadCount = useMemo(
    () => entries.reduce((n, e) => (e.isRead ? n : n + 1), 0),
    [entries],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleDismiss} />

        <Animated.View style={[styles.sheet, sheetStyle]}>
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

          {entries.length === 0 ? (
            <EmptyState />
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            >
              {entries.map((entry) => (
                <NotificationRow
                  key={entry.id}
                  entry={entry}
                  onPress={() => markRead(entry.id)}
                  onLongPress={() => dismiss(entry.id)}
                />
              ))}
            </ScrollView>
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
      Bill reminders, Aware Run rewards, and level-ups will show up here.
    </Text>
  </View>
);

// ─── Row ────────────────────────────────────────────────────────────────────

interface RowProps {
  entry:       NotificationEntry;
  onPress:     () => void;
  onLongPress: () => void;
}

const NotificationRow: React.FC<RowProps> = ({ entry, onPress, onLongPress }) => {
  const tint     = KIND_TINT[entry.kind];
  const iconName = KIND_ICON[entry.kind];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        entry.isRead && styles.rowRead,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={[styles.rowIconWrap, { backgroundColor: `${tint}1A`, borderColor: `${tint}33` }]}>
        <Ionicons name={iconName} size={18} color={tint} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTopLine}>
          <Text style={styles.rowTitle} numberOfLines={1}>{entry.title}</Text>
          <Text style={styles.rowTime}>{timeAgo(entry.createdAt)}</Text>
        </View>
        <Text style={styles.rowText} numberOfLines={2}>{entry.body}</Text>
      </View>
      {!entry.isRead && <View style={[styles.unreadDot, { backgroundColor: tint }]} />}
    </Pressable>
  );
};

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
  list:        { maxHeight: SCREEN_H * 0.62 },
  listContent: { paddingBottom: 8, gap: 8 },

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
  rowTopLine: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  rowTitle: {
    flex:       1,
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
