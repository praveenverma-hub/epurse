import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useCategoryMaps } from '../hooks/useCategoryTree';
import { parentCatIdForTxn } from '../constants/twoTierCategories';
import { colors, radius, readableOn, spacing, typography, shadows } from '../constants/theme';
import { formatCurrency, formatDateTime } from '../utils/format';
import { buildTxnCard, CARD_CONTEXT } from '../utils/txnCardModel';
import CategoryIcon from './CategoryIcon';

/**
 * The ONE transaction card for every list. WHAT it says (meta line, amount tone,
 * chips, "of ₹X") is decided by `buildTxnCard` (utils/txnCardModel.ts, tested);
 * this file only lays it out.
 *
 * `context` drops what the host screen already says: 'account' (Account Details)
 * omits the account, 'group' (Group Detail) omits the ribbon and names the payer.
 */
const TransactionItem = ({ txn, onPress, onLongPress, onPressCategory, onPressSplitChip, context = CARD_CONTEXT.DEFAULT, muted = false }) => {
  const categories = useEPurseStore((s) => s.categories);
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const category = useMemo(
    () => categories.find((c) => c.id === txn.categoryId) || categories[categories.length - 1],
    [categories, txn.categoryId]
  );

  // "Counts as expense" rule (SpendRulesScreen). The card must SAY so: an exclusion that
  // only shows up as a smaller Spent figure is undiscoverable. Debits only.
  const excludedExpenseParents = useEPurseStore((s) => s.excludedExpenseParents);
  const catMaps = useCategoryMaps();
  const isExcluded = useMemo(() => {
    if (!excludedExpenseParents?.length || txn.type !== 'debit') return false;
    return excludedExpenseParents.includes(parentCatIdForTxn(txn, catMaps));
  }, [excludedExpenseParents, catMaps, txn.type, txn.parentCategory, txn.categoryId]);

  const group = useMemo(() => (txn.groupId ? groups.find((g) => g.id === txn.groupId) : null), [groups, txn.groupId]);
  const account = useMemo(() => (txn.accountId ? accounts.find((a) => a.id === txn.accountId) : null), [accounts, txn.accountId]);

  const card = useMemo(
    () => buildTxnCard(txn, { group, account, categoryName: category?.name, isExcluded, context }),
    [txn, group, account, category?.name, isExcluded, context]
  );
  const cardPressable = typeof onPress === 'function';
  const amountColor = AMOUNT_INK[card.amount.tone];

  return (
    <TouchableOpacity
      activeOpacity={cardPressable ? 0.8 : 1}
      onPress={cardPressable ? onPress : undefined}
      disabled={!cardPressable}
      style={[styles.card, muted && styles.cardMuted]}
    >
      {/* Group watermark — the group's own emoji (data), oversized and faint, bleeding
          off the right edge behind the amount, so the card reads as "in this group". */}
      {card.showGroupRibbon && group.emoji ? (
        <View style={styles.groupWatermarkClip} pointerEvents="none">
          <Text style={styles.groupWatermark} allowFontScaling={false}>{group.emoji}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        activeOpacity={onPressCategory ? 0.75 : 1}
        onPress={onPressCategory}
        disabled={!onPressCategory}
        style={styles.categoryTap}
      >
        <CategoryIcon category={category} />
      </TouchableOpacity>

      {/* tier 1 merchant · tier 2 what + whose money · tier 3 when + status */}
      <View style={styles.middle}>
        <Text style={styles.title} numberOfLines={1}>{card.title}</Text>
        {card.meta ? <Text style={styles.meta} numberOfLines={1}>{card.meta}</Text> : null}
        <View style={styles.footerRow}>
          <Text style={styles.time} numberOfLines={1}>{formatDateTime(txn.createdAt)}</Text>
          {card.hasNote ? (
            <Ionicons name="document-text-outline" size={12} color={colors.textMuted} style={styles.noteMark}
              accessibilityLabel="Has a note" />
          ) : null}
          {card.chips.map((c) => (
            <View key={c.kind} style={[styles.chip, { backgroundColor: CHIP_TONE[c.tone].bg }]}>
              <Text style={[styles.chipText, { color: CHIP_TONE[c.tone].ink }]}>{c.amount ? `${c.label} ${formatCurrency(c.amount)}` : c.label}</Text>
            </View>
          ))}
          {card.overflow > 0 ? (
            <View style={[styles.chip, { backgroundColor: CHIP_TONE.neutral.bg }]}>
              <Text style={[styles.chipText, { color: CHIP_TONE.neutral.ink }]}>+{card.overflow}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.right, card.showGroupRibbon && styles.rightBelowRibbon]}>
        <TouchableOpacity onLongPress={onLongPress} activeOpacity={onLongPress ? 0.6 : 1} disabled={!onLongPress}>
          {card.amount.notInvolved ? (
            <Text style={styles.notInvolved}>Not involved</Text>
          ) : (
            <Text style={[styles.amount, { color: amountColor }]}>
              {card.amount.sign} {formatCurrency(card.amount.value)}
            </Text>
          )}
        </TouchableOpacity>
        {card.totalHint ? <Text style={styles.totalHint}>of {formatCurrency(card.totalHint)}</Text> : null}
        {card.splitCount ? (
          <TouchableOpacity
            style={styles.splitPill}
            activeOpacity={onPressSplitChip ? 0.8 : 1}
            onPress={onPressSplitChip ? () => onPressSplitChip(txn) : undefined}
            disabled={!onPressSplitChip}
            accessibilityLabel={`Split ${card.splitCount} ways`}
          >
            <Ionicons name="pie-chart-outline" size={12} color={SPLIT_INK} />
            <Text style={[styles.splitText, { color: SPLIT_INK }]}>Split · {card.splitCount}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Group ribbon — hangs from the card's top-right edge: group colour folding
          behind at the top, fading into the card where the name sits. */}
      {card.showGroupRibbon ? (
        <LinearGradient
          colors={[group.color || colors.info, '#FFFFFF00', '#FFFFFF00', '#FFFFFF00']}
          locations={[0, 0.3, 0.85, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.groupBanner}
          pointerEvents="none"
        >
          <View style={styles.groupBannerRow}>
            {/* Name sits on the faded (≈ card) end — measure it, raw amber/cyan are ~2:1 there. */}
            <Text style={[styles.groupBannerText, { color: readableOn(colors.card, group.color || colors.info) }]} numberOfLines={1}>
              {truncateGroupName(group.name)}
            </Text>
          </View>
        </LinearGradient>
      ) : null}
    </TouchableOpacity>
  );
};

// Amount ink by meaning. Muted = no money of mine moved (memo) or ignored.
const AMOUNT_INK = { income: colors.income, expense: colors.textPrimary, muted: colors.textMuted };

// One tinted-fill chip style; the ink is MEASURED against the card so amber/green stay
// legible (raw warning amber is ~2:1 on white).
const tone = (hue, bg) => ({ bg: bg || hue + '1F', ink: readableOn(colors.card, hue) });
const CHIP_TONE = {
  warning:  tone(colors.warning),
  income:   tone(colors.income),
  lent:     tone(colors.lent, colors.lentSoft),
  borrowed: tone(colors.borrowed, colors.borrowedSoft),
  neutral:  { bg: colors.textMuted + '1F', ink: colors.textSecondary },
};
const SPLIT_INK = readableOn(colors.card, colors.info);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    // 12px between normal rows.
    marginBottom: spacing.md,
    // Let the floating group badge poke above the top edge (don't clip it on Android).
    overflow: 'visible',
    ...shadows.card,
  },
  // Archived / pre-onboarding rows: flat, recessed card. NO elevation — dimming an
  // elevation-shadow card via a container `opacity` makes Android draw a hard grey
  // shadow box (the "distorted" look). A flat bordered card de-emphasises cleanly.
  cardMuted: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  categoryTap: { borderRadius: radius.md },
  middle: { flex: 1, marginLeft: spacing.md, marginRight: spacing.sm },
  // Merchant leads but doesn't out-shout the amount beside it.
  title: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  meta: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: spacing.xs },
  time: { ...typography.tiny, color: colors.textMuted, flexShrink: 1 },
  noteMark: { marginLeft: -2 },
  chip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, flexShrink: 0 },
  chipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  right: { alignItems: 'flex-end', maxWidth: '42%' },
  // The ribbon hangs 26px from the top-right edge; a centred amount ran into it.
  // Drop the column to the bottom instead, so the amount lines up with the date line.
  rightBelowRibbon: { alignSelf: 'stretch', justifyContent: 'flex-end', paddingTop: 18 },
  amount: { fontSize: 15, fontWeight: '700' },
  totalHint: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  notInvolved: { ...typography.small, color: colors.textMuted, fontStyle: 'italic', fontWeight: '600' },
  splitPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.sm,
    backgroundColor: colors.info + '1A',
  },
  splitText: { fontSize: 10, fontWeight: '700' },
  // Group watermark — clip layer fills the card and matches its rounded shape so the
  // oversized emoji is cut cleanly at the card's edges (only ~60% shows).
  groupWatermarkClip: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  // The emoji itself: near card-height, faint, and shifted right so ~40% bleeds off
  // the edge. `top` starts it ~10px above the (vertically-centred) amount.
  groupWatermark: {
    position: 'absolute',
    right: -24,
    top: 24,
    fontSize: 62,
    opacity: 0.12,
  },
  // Gradient ribbon tag — dark group colour at top fading to white, hangs from card edge.
  groupBanner: {
    position: 'absolute',
    top: 0,
    right: 14,
    width: 65,
    height: 26,
    justifyContent: 'flex-end',
    paddingHorizontal: 7,
    paddingBottom: 4,
    borderBottomLeftRadius: radius.sm,
    borderBottomRightRadius: radius.sm,
    zIndex: 3,
    elevation: 1,
    overflow: 'hidden',
    alignItems:"center"
  },
  groupBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  groupBannerText: {
    ...typography.tiny,
    fontWeight: '800',
    textAlign: 'left',
    includeFontPadding: false,
    flexShrink: 1,
  },
});

// Cap the floating group badge to ~10 chars so a long group name can't widen the
// corner pill (icon + name). Longer names get an ellipsis.
function truncateGroupName(name) {
  const s = (name || '').trim();
  return s.length > 10 ? `${s.slice(0, 9).trimEnd()}…` : s;
}

export default TransactionItem;
