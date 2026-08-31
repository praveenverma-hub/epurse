// =============================================================================
// ShopScreen — the widget catalogue, on its own screen.
//
// Split out of RewardShop.tsx (now ProfileScreen). This is the part of the
// profile that GROWS: every new customisable widget adds a card here, and while
// it shared a scroll with the profile block it pushed identity and navigation
// off the first screenful. On its own it can grow to any length.
//
// One card per REWARD_CONFIG.SHOP_ITEMS entry (via the reward store's inventory,
// which merges new catalogue items on rehydrate), each in a
// locked / purchasable / owned-toggle state. The list is not fixed-length.
//
// The EPC balance rides in a pinned strip under the header rather than being
// left behind on the profile: "can I afford this" is the question every card on
// this screen asks, and scrolling away from the answer is what made the old
// single-screen version awkward.
// =============================================================================

import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import {
  useRewardStore,
  selectEpcBalance,
  selectLevel,
  type InventoryItem,
} from '../store/useRewardStore';
import { hapticLight, hapticSuccess, hapticError } from '../utils/haptics';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { useRewardPalette, type RewardPalette } from '../hooks/useRewardPalette';
import { radius, spacing } from '../constants/theme';

// ─── Props ───────────────────────────────────────────────────────────────────

interface NavigationProp {
  goBack: () => void;
}

interface Props {
  navigation: NavigationProp;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

const ShopScreen: React.FC<Props> = ({ navigation }) => {
  const D = useRewardPalette();
  const styles = useMemo(() => makeStyles(D), [D]);

  const coins     = useRewardStore(selectEpcBalance);
  const level     = useRewardStore(selectLevel);
  const inventory = useRewardStore((s) => s.inventory);

  // Ordered by unlock level so the list reads as a ladder: what's reachable now
  // sits at the top and the aspirational items trail off below. Catalogue order
  // is just the order items were added, which puts a LV3 widget under a LV6 one.
  // Sorted on a copy — `inventory` is store state. Cost breaks ties; id keeps it
  // stable after that.
  const shopItems = useMemo(
    () =>
      [...inventory].sort(
        (a, b) =>
          a.minLevelRequirement - b.minLevelRequirement ||
          a.cost - b.cost ||
          a.id.localeCompare(b.id),
      ),
    [inventory],
  );

  return (
    <View style={styles.root}>
      <StatusBar barStyle={D.dark ? 'light-content' : 'dark-content'} backgroundColor={D.bg} />
      <SafeAreaView style={styles.container} edges={['top']}>
        <PlainScreenHeader
          title="Shop"
          onBack={() => {
            hapticLight();
            navigation.goBack();
          }}
          tint={D.white}
          titleColor={D.white}
        />

        {/* Balance strip — the answer to "can I afford this", kept on screen. */}
        <View style={styles.balanceStrip}>
          <View style={styles.balanceIcon}>
            <Ionicons name="cash-outline" size={18} color={D.goldInk} />
          </View>
          <Text style={styles.balanceAmount} numberOfLines={1}>
            {coins.toLocaleString('en-IN')}
            <Text style={styles.balanceUnit}> EPC</Text>
          </Text>
          <View style={styles.levelPill}>
            <Text style={styles.levelPillText}>LV {level}</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* ONE line, not a masthead. This was an ALL-CAPS eyebrow + a 20pt
              heading + a two-sentence paragraph, stacked under a screen title
              that already said "Shop" — four tiers of text saying the same
              thing before the first card. (The eyebrow also broke
              ui-consistency §1, which bans ALL-CAPS eyebrows as headings.)
              Where EPC comes from is explained by the EPC info sheet on the
              profile, so it doesn't need re-stating here. */}
          <Text style={styles.intro}>
            Spend EPC to unlock widgets for your dashboard.
          </Text>

          {shopItems.length === 0 ? (
            <EmptyState
              compact
              icon="bag-handle-outline"
              title="Nothing in stock yet"
              subtitle="New widgets land here as the app grows. Keep earning EPC in the meantime."
            />
          ) : (
            shopItems.map((item, i) => (
              <Animated.View
                key={item.id}
                entering={FadeInUp.delay(80 + i * 90)
                  .springify()
                  .damping(22)
                  .stiffness(180)}
              >
                <ShopCard
                  item={item}
                  currentLevel={level}
                  currentCoins={coins}
                  D={D}
                  styles={styles}
                />
              </Animated.View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

export default ShopScreen;

// ─── ShopCard ────────────────────────────────────────────────────────────────

interface ShopCardProps {
  item:         InventoryItem;
  currentLevel: number;
  currentCoins: number;
  D:            RewardPalette;
  styles:       any;
}

const ShopCard: React.FC<ShopCardProps> = ({ item, currentLevel, currentCoins, D, styles }) => {
  const purchaseItem     = useRewardStore((s) => s.purchaseItem);
  const toggleItemActive = useRewardStore((s) => s.toggleItemActive);
  const toast            = useToast();

  const isLocked = currentLevel < item.minLevelRequirement;

  const scale = useSharedValue(1);
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const bounce = () => {
    scale.value = withSequence(
      withSpring(1.06, { damping: 7,  stiffness: 220 }),
      withSpring(1.00, { damping: 12, stiffness: 220 }),
    );
  };

  const handleBuy = () => {
    const result = purchaseItem(item.id);
    if (!result.ok) {
      hapticError();
      const messages: Record<string, string> = {
        insufficient_funds: `You need ${item.cost - currentCoins} more EPC.`,
        level_locked:       `Reach Level ${item.minLevelRequirement} to unlock.`,
        already_owned:      'Already in your inventory.',
        unknown_item:       'Unknown item.',
      };
      toast.warning('Cannot purchase', messages[result.reason ?? 'unknown_item']);
      return;
    }
    hapticSuccess();
    bounce();
  };

  const handleToggle = () => {
    hapticLight();
    toggleItemActive(item.id);
  };

  return (
    <Animated.View
      style={[
        styles.card,
        scaleStyle,
        item.isUnlocked && item.isActive && styles.cardActive,
      ]}
    >
      <LinearGradient
        colors={D.cardGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.cardContent}>
        {/* The widget's OWN emoji — that's data (its identity in the catalogue),
            not chrome, so it stays an emoji while every other glyph here is an
            Ionicon. */}
        <View style={styles.cardEmojiBox}>
          <Text style={styles.cardEmoji}>{item.emoji}</Text>
        </View>

        <View style={styles.cardMiddle}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>LV {item.minLevelRequirement}+</Text>
            </View>
            {!item.isUnlocked ? (
              <View style={[styles.metaPill, styles.metaPillCost]}>
                <Ionicons name="cash-outline" size={11} color={D.goldInk} />
                <Text style={styles.metaPillCostText}>
                  {item.cost.toLocaleString('en-IN')}
                </Text>
              </View>
            ) : (
              <View style={[styles.metaPill, styles.metaPillOwned]}>
                <Ionicons name="checkmark-circle" size={11} color={D.successInk} />
                <Text style={styles.metaPillOwnedText}>OWNED</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.cardRight}>
          {!isLocked && !item.isUnlocked ? (
            <BuyButton
              cost={item.cost}
              canAfford={currentCoins >= item.cost}
              onPress={handleBuy}
              D={D}
              styles={styles}
            />
          ) : null}

          {item.isUnlocked ? (
            <OwnedToggle active={item.isActive} onToggle={handleToggle} D={D} styles={styles} />
          ) : null}
        </View>
      </View>

      {/* Frosted lock overlay — sits above the card content */}
      {isLocked ? (
        <View style={styles.lockOverlay} pointerEvents="none">
          <View style={styles.lockOverlayTint} />
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={13} color={D.white} />
            <Text style={styles.lockText}>
              Unlocks at Level {item.minLevelRequirement}
            </Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
};

// ─── BuyButton ───────────────────────────────────────────────────────────────

const BuyButton: React.FC<{
  cost: number;
  canAfford: boolean;
  onPress: () => void;
  D: RewardPalette;
  styles: any;
}> = ({ cost, canAfford, onPress, D, styles }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.buyBtn, pressed && { opacity: 0.85 }]}
    accessibilityRole="button"
    accessibilityLabel={`Unlock for ${cost} EPC`}
  >
    <LinearGradient
      colors={canAfford ? [D.primary, '#E64A0F'] : [D.cardElevated, D.card]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFillObject}
    />
    <Text style={[styles.buyBtnText, !canAfford && styles.buyBtnTextDisabled]}>Unlock</Text>
    <View style={styles.buyBtnPriceRow}>
      <Ionicons
        name="cash-outline"
        size={11}
        color={canAfford ? '#FFFFFF' : D.textMuted}
      />
      <Text style={[styles.buyBtnPrice, !canAfford && styles.buyBtnTextDisabled]}>
        {cost.toLocaleString('en-IN')}
      </Text>
    </View>
  </Pressable>
);

// ─── OwnedToggle ─────────────────────────────────────────────────────────────

const OwnedToggle: React.FC<{
  active: boolean;
  onToggle: () => void;
  D: RewardPalette;
  styles: any;
}> = ({ active, onToggle, D, styles }) => (
  <View style={styles.toggleWrap}>
    <Switch
      value={active}
      onValueChange={onToggle}
      trackColor={{ false: D.switchTrackOff, true: D.primary + 'AA' }}
      thumbColor={active ? D.primary : '#4B5366'}
      ios_backgroundColor={D.switchTrackOff}
    />
    <Text style={[styles.toggleLabel, { color: active ? D.primary : D.textMuted }]}>
      {active ? 'ACTIVE' : 'OFF'}
    </Text>
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

function makeStyles(D: RewardPalette) {
  return StyleSheet.create({
    root:      { flex: 1, backgroundColor: D.bg },
    container: { flex: 1 },

    // ── Balance strip ──────────────────────────────────────────────────────
    balanceStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.lg,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: D.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: D.border,
    },
    balanceIcon: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      backgroundColor: D.goldTint,
      borderWidth: 1,
      borderColor: D.goldBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // flex:1 so a large balance truncates instead of pushing the level pill off.
    balanceAmount: {
      flex: 1,
      fontSize: 17,
      fontWeight: '900' as const,
      color: D.white,
      letterSpacing: -0.3,
    },
    balanceUnit: { fontSize: 11, fontWeight: '800' as const, color: D.goldInk },
    levelPill: {
      backgroundColor: D.overlayTint,
      borderWidth: 1,
      borderColor: D.overlayBorder,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    levelPillText: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.textSec,
      letterSpacing: 0.6,
    },

    scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

    // ── Intro line ─────────────────────────────────────────────────────────
    intro: {
      fontSize: 13,
      color: D.textSec,
      fontWeight: '500' as const,
      lineHeight: 18,
      marginBottom: 14,
      paddingHorizontal: 2,
    },

    // ── Shop card ──────────────────────────────────────────────────────────
    card: {
      borderRadius: radius.lg,
      overflow: 'hidden',
      borderWidth: 1.5,
      borderColor: D.border,
      marginBottom: 12,
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    cardActive: {
      borderColor: D.borderActive,
      shadowColor: D.primary,
      shadowOpacity: 0.35,
      shadowRadius: 14,
    },
    cardContent: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      gap: 12,
    },
    cardEmojiBox: {
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: D.overlayTint,
      borderWidth: 1,
      borderColor: D.overlayBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardEmoji: { fontSize: 28 },
    cardMiddle: { flex: 1 },
    cardName: {
      fontSize: 15,
      fontWeight: '800' as const,
      color: D.white,
      letterSpacing: -0.2,
    },
    cardDesc: {
      fontSize: 12,
      color: D.textSec,
      marginTop: 3,
      marginBottom: 8,
      lineHeight: 16,
    },
    metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
    metaPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: D.overlayTint,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: D.overlayBorder,
    },
    metaPillText: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.textSec,
      letterSpacing: 0.6,
    },
    metaPillCost: { backgroundColor: D.goldTint, borderColor: D.goldBorder },
    metaPillCostText: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.goldInk,
      letterSpacing: 0.4,
    },
    metaPillOwned: { backgroundColor: D.successTint, borderColor: D.successBorder },
    metaPillOwnedText: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.successInk,
      letterSpacing: 0.4,
    },

    cardRight: { minWidth: 92, alignItems: 'flex-end' },

    // ── Buy button ─────────────────────────────────────────────────────────
    buyBtn: {
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: 'center',
      minWidth: 92,
      overflow: 'hidden',
    },
    buyBtnText: {
      fontSize: 12,
      fontWeight: '900' as const,
      color: '#FFFFFF',
      letterSpacing: 0.4,
    },
    buyBtnPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
    buyBtnPrice: { fontSize: 11, fontWeight: '800' as const, color: '#FFFFFF' },
    buyBtnTextDisabled: { color: D.textMuted },

    // ── Owned toggle ───────────────────────────────────────────────────────
    toggleWrap: { alignItems: 'center', gap: 2 },
    toggleLabel: {
      fontSize: 9,
      fontWeight: '900' as const,
      letterSpacing: 1.0,
      marginTop: 2,
    },

    // ── Locked overlay ─────────────────────────────────────────────────────
    lockOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lockOverlayTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: D.lockTint,
    },
    lockBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: D.lockBadgeBg,
      borderWidth: 1,
      borderColor: D.lockBadgeBorder,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
    },
    lockText: {
      fontSize: 11,
      fontWeight: '800' as const,
      color: D.white,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
  });
}
