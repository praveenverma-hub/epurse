// =============================================================================
// GroupInsightCarousel — a compact, paged group selector that lives at the TOP
// of the "Spend by group" card on the Month-End Stats screen (Insights →
// Analytics). Swiping snaps to a group and lifts `focusedGroupId` to the parent,
// which re-draws the category chart in the SAME card for that group only.
//
// • One slim card per group + a leading "All spending" card. Fully theme-aware:
//   the centred card animates to `theme.card` with a `theme.primary` border while
//   neighbours sit on `theme.background` and peek — so it reads as a selector on
//   whatever surface hosts it, in light or dark mode.
// • Self-measuring: it sizes its cards from its own laid-out width (via onLayout)
//   so it fits inside the host card's padding — no screen-width hacks.
// • Owed / Owe uses the LB-derived per-group net (positive = you're owed →
//   theme.success; negative = you owe → muted). Personal groups show their
//   tracker spend. "View Details" is handled by the parent card, not here.
//
// Stats are month-scoped by `date`; balances are cumulative (match the Groups tab).
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore, selectTransactions } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { spacing, radius, typography as typographyBase } from '../constants/theme';
import { formatCurrency, isSameMonth } from '../utils/format';
import { countsForSpend, spendContribution } from '../utils/split';

// The JS theme widens fontWeight to `string`; re-type for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;

const GUTTER = spacing.sm;                    // gap between cards (8)
const CARD_H = 108;
const FALLBACK_W = Dimensions.get('window').width - spacing.lg * 4; // pre-measure estimate

// Colours the animated worklet needs (theme-derived; passed into GroupCard).
interface CardColors {
  bgInactive: string;
  bgActive: string;
  borderInactive: string;
  borderActive: string;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CarouselTxn {
  id: string;
  amount: number;
  type?: string;
  categoryId?: string;
  groupId?: string;
  createdAt: string | number;
  isIgnored?: boolean;
}

interface GroupStat {
  id: string;
  name: string;
  emoji: string;
  color: string;
  shared: boolean;
  memberCount: number;
  personalShare: number; // your share this month
  groupTotal: number;    // full group spend this month
  net: number;           // owed(+) / owe(-), cumulative — shared groups only
  txnCount: number;
}

type CardItem =
  | { kind: 'all'; id: '__all__'; total: number }
  | ({ kind: 'group' } & GroupStat);

interface GroupInsightCarouselProps {
  date: Date;
  focusedGroupId: string | null;
  onFocusChange: (id: string | null) => void;
  /** Defaults to the store's transactions. */
  transactions?: CarouselTxn[];
  /** "All spending" figure — pass the month total so it matches the unfocused chart. */
  allSpendTotal?: number;
}

// ─── Per-group cumulative net (owed +, owe −), from the LB ledger ──────────────
function netByGroup(
  personBalances: Array<{ entries?: Array<{ kind: string; amount: number; groupId?: string }> }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of personBalances) {
    for (const e of p.entries || []) {
      if (!e.groupId) continue;
      const sign =
        e.kind === 'lent' || e.kind === 'borrow_repaid' ? 1 :
        e.kind === 'borrowed' || e.kind === 'lent_settled' ? -1 : 0;
      if (sign) out[e.groupId] = (out[e.groupId] || 0) + sign * e.amount;
    }
  }
  return out;
}

// ─── One compact, theme-aware card ────────────────────────────────────────────
const GroupCard: React.FC<{
  item: CardItem;
  index: number;
  scrollX: SharedValue<number>;
  cardW: number;
  snap: number;
  theme: any;
  styles: ReturnType<typeof makeStyles>;
  cardColors: CardColors;
}> = React.memo(({ item, index, scrollX, cardW, snap, theme, styles, cardColors }) => {
  const animStyle = useAnimatedStyle(() => {
    const input = [(index - 1) * snap, index * snap, (index + 1) * snap];
    return {
      transform: [{ scale: interpolate(scrollX.value, input, [0.94, 1, 0.94], Extrapolation.CLAMP) }],
      opacity: interpolate(scrollX.value, input, [0.82, 1, 0.82], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(scrollX.value, input,
        [cardColors.bgInactive, cardColors.bgActive, cardColors.bgInactive]),
      borderColor: interpolateColor(scrollX.value, input,
        [cardColors.borderInactive, cardColors.borderActive, cardColors.borderInactive]),
    };
  });

  // "All spending" overview card.
  if (item.kind === 'all') {
    return (
      <Animated.View style={[styles.card, { width: cardW }, animStyle]}>
        <View style={styles.rowTop}>
          <View style={[styles.emojiChip, { backgroundColor: theme.primary + '18' }]}>
            <Ionicons name="albums-outline" size={18} color={theme.primary} />
          </View>
          <View style={styles.identityCol}>
            <Text style={styles.groupName} numberOfLines={1}>All spending</Text>
            <Text style={styles.subtle} numberOfLines={1}>Swipe to a group →</Text>
          </View>
        </View>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>This month</Text>
          <Text style={[styles.metricValue, { color: theme.primary }]} numberOfLines={1}>
            {formatCurrency(item.total)}
          </Text>
        </View>
      </Animated.View>
    );
  }

  const owed = item.net > 0.005;
  const owe  = item.net < -0.005;
  const netColor = owed ? theme.success : owe ? theme.textSecondary : theme.textMuted;

  return (
    <Animated.View style={[styles.card, { width: cardW }, animStyle]}>
      <View style={styles.rowTop}>
        <View style={[styles.emojiChip, { backgroundColor: (item.color || theme.primary) + '22' }]}>
          <Text style={styles.emoji}>{item.emoji || (item.shared ? '👥' : '📁')}</Text>
        </View>
        <View style={styles.identityCol}>
          <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.subtle} numberOfLines={1}>
            {item.shared ? `${item.memberCount || 0} member${item.memberCount === 1 ? '' : 's'}` : 'Personal tracker'}
            {item.txnCount > 0 ? `  ·  ${item.txnCount} txn${item.txnCount === 1 ? '' : 's'}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.metricRow}>
        <View style={styles.metricLeft}>
          <Text style={styles.metricLabel} numberOfLines={1}>
            {item.shared ? (owe ? 'You owe' : 'Owed to you') : 'Your spend'}
          </Text>
          <Text style={[styles.metricValue, { color: item.shared ? netColor : theme.primary }]} numberOfLines={1}>
            {item.shared
              ? (item.net === 0 ? 'Settled' : formatCurrency(Math.abs(item.net)))
              : formatCurrency(item.personalShare)}
          </Text>
        </View>
        <View style={styles.metricRight}>
          <Text style={styles.shareLabel} numberOfLines={1}>your share</Text>
          <Text style={styles.shareValue} numberOfLines={1}>
            {formatCurrency(item.personalShare)}
            <Text style={styles.shareOf}>{`  of ${formatCurrency(item.groupTotal)}`}</Text>
          </Text>
        </View>
      </View>
    </Animated.View>
  );
});

// ─── Carousel ─────────────────────────────────────────────────────────────────
const GroupInsightCarousel: React.FC<GroupInsightCarouselProps> = ({
  date,
  focusedGroupId,
  onFocusChange,
  transactions,
  allSpendTotal,
}) => {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const cardColors = useMemo<CardColors>(() => ({
    bgInactive: theme.background,
    bgActive: theme.card,
    borderInactive: theme.divider,
    borderActive: theme.primary,
  }), [theme]);

  const groups       = useEPurseStore((s: any) => s.groups) as any[];
  const storeTxns    = useEPurseStore(selectTransactions) as CarouselTxn[];
  const getBalances  = useEPurseStore((s: any) => s.getPersonBalances) as () => any[];
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed); // recompute trigger

  const txns = transactions ?? storeTxns;

  // Measured width → card sizing (fits whatever card/padding hosts it).
  const [boxW, setBoxW] = useState(FALLBACK_W);
  const cardW   = Math.min(300, Math.max(180, boxW - GUTTER * 5)); // leave neighbour peek
  const snap    = cardW + GUTTER;
  const sidePad = Math.max(0, (boxW - cardW) / 2 - GUTTER / 2);    // centres the snapped card
  const onBoxLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - boxW) > 1) setBoxW(w);
  }, [boxW]);

  // Per-group month stats + cumulative owed/owe.
  const stats: GroupStat[] = useMemo(() => {
    const nets = netByGroup(getBalances());
    const acc: Record<string, GroupStat> = {};
    for (const g of groups) {
      acc[g.id] = {
        id: g.id, name: g.name, emoji: g.emoji, color: g.color,
        shared: g.type === 'shared',
        memberCount: Array.isArray(g.members) ? g.members.length : 0,
        personalShare: 0, groupTotal: 0, net: nets[g.id] || 0, txnCount: 0,
      };
    }
    for (const t of txns) {
      if (!t.groupId || t.isIgnored) continue;
      const s = acc[t.groupId];
      if (!s || !isSameMonth(t.createdAt as any, date)) continue;
      if (countsForSpend(t as any)) {
        // Expense adds, refund credit nets both your share and the group total down.
        s.personalShare += spendContribution(t as any);
        s.groupTotal += (t.type === 'debit' ? (Number(t.amount) || 0) : -(Number(t.amount) || 0));
        s.txnCount += 1;
      }
    }
    return Object.values(acc).sort(
      (a, b) => (b.groupTotal - a.groupTotal) || (Math.abs(b.net) - Math.abs(a.net)),
    );
  }, [groups, txns, date, getBalances, lentBorrowed]);

  const allTotal = allSpendTotal != null ? allSpendTotal : stats.reduce((s, g) => s + g.personalShare, 0);

  const items: CardItem[] = useMemo(
    () => [{ kind: 'all', id: '__all__', total: allTotal }, ...stats.map((s) => ({ kind: 'group' as const, ...s }))],
    [stats, allTotal],
  );

  // ── Scroll + focus wiring ──
  const scrollX = useSharedValue(0);
  const listRef = useRef<any>(null);
  const currentIndex = useRef(0);

  const scrollHandler = useAnimatedScrollHandler((e) => { scrollX.value = e.contentOffset.x; });

  const indexForFocus = useCallback(
    (id: string | null) => (id ? Math.max(0, items.findIndex((it) => it.id === id)) : 0),
    [items],
  );

  // External focus change (parent "Clear"/deleted group) → snap the carousel to it.
  useEffect(() => {
    const target = indexForFocus(focusedGroupId);
    if (target !== currentIndex.current) {
      currentIndex.current = target;
      listRef.current?.scrollToOffset({ offset: target * snap, animated: true });
    }
  }, [focusedGroupId, indexForFocus, snap]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const idx = Math.round(e.nativeEvent.contentOffset.x / snap);
      currentIndex.current = idx;
      const it = items[idx];
      onFocusChange(!it || it.kind === 'all' ? null : it.id);
    },
    [items, onFocusChange, snap],
  );

  if (stats.length === 0) return null;

  return (
    <View onLayout={onBoxLayout}>
      <Animated.FlatList
        ref={listRef}
        data={items}
        keyExtractor={(it) => it.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: sidePad, paddingVertical: spacing.xs }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item, index }) => (
          <GroupCard
            item={item}
            index={index}
            scrollX={scrollX}
            cardW={cardW}
            snap={snap}
            theme={theme}
            styles={styles}
            cardColors={cardColors}
          />
        )}
      />
    </View>
  );
};

export default GroupInsightCarousel;

// Theme-aware styles (colours resolved from the active palette).
const makeStyles = (t: any) =>
  StyleSheet.create({
    card: {
      marginHorizontal: GUTTER / 2,
      height: CARD_H,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.md,
      justifyContent: 'space-between',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.darkMode ? 0.3 : 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center' },
    emojiChip: {
      width: 34, height: 34, borderRadius: 10,
      alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
    },
    emoji: { fontSize: 18 },
    identityCol: { flex: 1 },
    groupName: { color: t.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
    subtle: { color: t.textMuted, ...typography.tiny, marginTop: 1 },

    metricRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    metricLeft: { flexShrink: 1 },
    metricRight: { alignItems: 'flex-end', flexShrink: 1, marginLeft: spacing.sm },
    metricLabel: { color: t.textMuted, ...typography.tiny, textTransform: 'uppercase', letterSpacing: 0.4 },
    metricValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, marginTop: 1 },
    shareLabel: { color: t.textMuted, ...typography.tiny },
    shareValue: { color: t.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 1 },
    shareOf: { color: t.textMuted, fontWeight: '500' },
  });
