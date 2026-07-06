// =============================================================================
// RewardShop.tsx — Unified Profile + Widget Customization Hub (dark premium)
//
// Region A: top bar (back + "Profile & Perks")
// Region B: profile block (avatar + name + level), animated XP bar, coin balance
// Region C: 3 widget cards with locked / purchasable / owned-toggle states
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  FadeInUp,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useEPurseStore } from '../store/ePurseStore';
import {
  useRewardStore,
  selectTotalRP,
  selectEpcBalance,
  selectLevel,
  levelTitle,
  type InventoryItem,
} from '../store/useRewardStore';
import {
  rpForNextLevel,
  levelProgressPct,
  REWARD_COPY,
} from '../config/rewardConfig';
import { hapticLight, hapticSuccess, hapticError } from '../utils/haptics';
import { useToast } from '../components/Toast';
import InfoSheet from '../components/InfoSheet';
import InfoIcon from '../components/InfoIcon';

// ─── Dark-mode palette (screen-scoped) ───────────────────────────────────────

const D = {
  bg:           '#0A0E1A',
  card:         '#161B2E',
  cardElevated: '#1F2640',
  border:       '#283047',
  borderActive: '#FF5A1F',
  white:        '#F5F7FA',
  textSec:      '#A5ACBE',
  textMuted:    '#6B7388',
  gold:         '#F59E0B',
  goldGlow:     '#FCD34D',
  primary:      '#FF5A1F',
  success:      '#10B981',
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface NavigationProp {
  goBack: () => void;
}

interface Props {
  navigation: NavigationProp;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

const RewardShop: React.FC<Props> = ({ navigation }) => {
  const userName  = useEPurseStore((s: any) => s.userName ?? '');
  const totalRP   = useRewardStore(selectTotalRP);
  const coins     = useRewardStore(selectEpcBalance);
  const level     = useRewardStore(selectLevel);
  const inventory = useRewardStore((s) => s.inventory);

  const title         = useMemo(() => levelTitle(level),         [level]);
  const nextThreshold = useMemo(() => rpForNextLevel(totalRP),    [totalRP]);
  const pct           = useMemo(() => levelProgressPct(totalRP),  [totalRP]);

  // Which definition sheet (if any) is currently open. Single state keeps
  // them mutually exclusive — tapping RP closes EPC and vice-versa.
  const [infoOpen, setInfoOpen] = useState<'rp' | 'epc' | null>(null);

  const initial = userName?.trim()?.charAt(0)?.toUpperCase() || '🙂';
  const display = userName?.trim() || 'Guest';

  const handleBack = () => {
    hapticLight();
    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={D.bg} />
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* ── Region A: Header ──────────────────────────────────────── */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={handleBack} hitSlop={10} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={24} color={D.white} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Profile & Perks</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {/* ── Region B: Profile + XP + Coins ──────────────────────── */}
          <Animated.View
            entering={FadeInUp.springify().damping(22).stiffness(160)}
            style={styles.heroCard}
          >
            <LinearGradient
              colors={['#1B2342', '#0F1428']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            {/* Profile row */}
            <View style={styles.profileRow}>
              <Animated.View
                entering={ZoomIn.springify().damping(18).stiffness(220)}
                style={styles.avatarWrap}
              >
                <LinearGradient
                  colors={[D.primary, '#FB923C']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarText}>{initial}</Text>
                </LinearGradient>
                <LevelChip level={level} />
              </Animated.View>

              <View style={styles.profileMeta}>
                <Text style={styles.profileGreet}>Hey,</Text>
                <Text style={styles.profileName} numberOfLines={1}>
                  {display}
                </Text>
                <Text style={styles.profileTitle}>{title}</Text>
              </View>
            </View>

            {/* RP block — next-level progress */}
            <View style={styles.xpBlock}>
              <View style={styles.xpRow}>
                <TouchableOpacity
                  style={styles.labelWithInfo}
                  onPress={() => {
                    hapticLight();
                    setInfoOpen('rp');
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="What are Reality Points"
                >
                  <Text style={styles.xpLabel}>NEXT LEVEL</Text>
                  <InfoIcon size={14} color={D.textMuted} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
                <Text style={styles.xpPoints}>
                  {totalRP.toLocaleString('en-IN')}
                  <Text style={styles.xpPointsMuted}>
                    {' '}/ {nextThreshold.toLocaleString('en-IN')} RP
                  </Text>
                </Text>
              </View>
              <XpBar progress={pct} />
            </View>

            {/* Coin balance */}
            <View style={styles.coinBlock}>
              <View style={styles.coinIconWrap}>
                <Text style={styles.coinIcon}>💰</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.coinAmount}>
                  {coins.toLocaleString('en-IN')}
                </Text>
                <TouchableOpacity
                  style={styles.labelWithInfo}
                  onPress={() => {
                    hapticLight();
                    setInfoOpen('epc');
                  }}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="What are ePurse Coins"
                >
                  <Text style={styles.coinLabel}>EPC Balance</Text>
                  <InfoIcon size={14} color={D.textMuted} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>

          {/* ── Region C: Widget shop ─────────────────────────────── */}
          <View style={styles.shopHeader}>
            <Text style={styles.shopEyebrow}>CUSTOM WIDGETS</Text>
            <Text style={styles.shopHeading}>Make the dashboard yours</Text>
            <Text style={styles.shopSubtitle}>
              Earn RP from reviewing transactions and keeping your Aware Run
              alive. Spend EPC to unlock premium hardware-accelerated widgets.
            </Text>
          </View>

          {inventory.map((item, i) => (
            <Animated.View
              key={item.id}
              entering={FadeInUp.delay(160 + i * 90)
                .springify()
                .damping(22)
                .stiffness(180)}
            >
              <ShopCard item={item} currentLevel={level} currentCoins={coins} />
            </Animated.View>
          ))}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>

      {/* RP / EPC definition sheets — one component, two configurations.    */}
      <InfoSheet
        visible={infoOpen === 'rp'}
        onClose={() => setInfoOpen(null)}
        title={REWARD_COPY.RP_TITLE}
        eyebrow={REWARD_COPY.RP_EYEBROW}
        body={REWARD_COPY.RP_BODY}
        bullets={[
          { label: REWARD_COPY.RP_BULLET_EARN_LABEL,  value: REWARD_COPY.RP_BULLET_EARN_VALUE  },
          { label: REWARD_COPY.RP_BULLET_LEVEL_LABEL, value: REWARD_COPY.RP_BULLET_LEVEL_VALUE },
        ]}
      />
      <InfoSheet
        visible={infoOpen === 'epc'}
        onClose={() => setInfoOpen(null)}
        title={REWARD_COPY.EPC_TITLE}
        eyebrow={REWARD_COPY.EPC_EYEBROW}
        body={REWARD_COPY.EPC_BODY}
        bullets={[
          { label: REWARD_COPY.EPC_BULLET_EARN_LABEL, value: REWARD_COPY.EPC_BULLET_EARN_VALUE },
          { label: REWARD_COPY.EPC_BULLET_SAVE_LABEL, value: REWARD_COPY.EPC_BULLET_SAVE_VALUE },
        ]}
      />
    </View>
  );
};

export default RewardShop;

// ─── LevelChip ───────────────────────────────────────────────────────────────

const LevelChip: React.FC<{ level: number }> = ({ level }) => (
  <View style={styles.levelChipWrap}>
    <LinearGradient
      colors={[D.goldGlow, D.gold]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.levelChip}
    >
      <Text style={styles.levelChipText}>{level}</Text>
    </LinearGradient>
  </View>
);

// ─── XpBar ───────────────────────────────────────────────────────────────────

const XpBar: React.FC<{ progress: number }> = ({ progress }) => {
  const w = useSharedValue(0);

  useEffect(() => {
    w.value = withTiming(Math.max(0, Math.min(1, progress)) * 100, {
      duration: 1000,
      easing:   Easing.out(Easing.cubic),
    });
  }, [progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${w.value}%` }));

  return (
    <View style={styles.xpBarTrack}>
      <Animated.View style={[styles.xpBarFill, fillStyle]}>
        <LinearGradient
          colors={[D.goldGlow, D.primary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
    </View>
  );
};

// ─── ShopCard ────────────────────────────────────────────────────────────────

interface ShopCardProps {
  item:         InventoryItem;
  currentLevel: number;
  currentCoins: number;
}

const ShopCard: React.FC<ShopCardProps> = ({ item, currentLevel, currentCoins }) => {
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
      toast.warning(
        'Cannot purchase',
        messages[result.reason ?? 'unknown_item'],
      );
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
        colors={['#1A2138', '#10162A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.cardContent}>
        <View style={styles.cardEmojiBox}>
          <Text style={styles.cardEmoji}>{item.emoji}</Text>
        </View>

        <View style={styles.cardMiddle}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.cardDesc} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.metaPill}>
              <Text style={styles.metaPillText}>LV {item.minLevelRequirement}+</Text>
            </View>
            {!item.isUnlocked ? (
              <View style={[styles.metaPill, styles.metaPillCost]}>
                <Text style={styles.metaPillCostText}>
                  💰 {item.cost.toLocaleString('en-IN')}
                </Text>
              </View>
            ) : (
              <View style={[styles.metaPill, styles.metaPillOwned]}>
                <Text style={styles.metaPillOwnedText}>✓ OWNED</Text>
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
            />
          ) : null}

          {item.isUnlocked ? (
            <OwnedToggle active={item.isActive} onToggle={handleToggle} />
          ) : null}
        </View>
      </View>

      {/* Frosted lock overlay — sits above the card content */}
      {isLocked ? (
        <View style={styles.lockOverlay} pointerEvents="none">
          <View style={styles.lockOverlayTint} />
          <View style={styles.lockBadge}>
            <Text style={styles.lockIcon}>🔒</Text>
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
}> = ({ cost, canAfford, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.buyBtn,
      !canAfford && styles.buyBtnDisabled,
      pressed && { opacity: 0.85 },
    ]}
  >
    <LinearGradient
      colors={canAfford ? [D.primary, '#E64A0F'] : ['#22293F', '#1A2034']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFillObject}
    />
    <Text style={[styles.buyBtnText, !canAfford && styles.buyBtnTextDisabled]}>
      Unlock
    </Text>
    <Text style={[styles.buyBtnPrice, !canAfford && styles.buyBtnTextDisabled]}>
      💰 {cost.toLocaleString('en-IN')}
    </Text>
  </Pressable>
);

// ─── OwnedToggle ─────────────────────────────────────────────────────────────

const OwnedToggle: React.FC<{ active: boolean; onToggle: () => void }> = ({
  active,
  onToggle,
}) => (
  <View style={styles.toggleWrap}>
    <Switch
      value={active}
      onValueChange={onToggle}
      trackColor={{ false: '#283047', true: D.primary + 'AA' }}
      thumbColor={active ? D.primary : '#4B5366'}
      ios_backgroundColor="#283047"
    />
    <Text
      style={[
        styles.toggleLabel,
        { color: active ? D.primary : D.textMuted },
      ]}
    >
      {active ? 'ACTIVE' : 'OFF'}
    </Text>
  </View>
);

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: D.bg },
  container: { flex: 1 },

  // ── Region A: top bar ──────────────────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: D.white,
    letterSpacing: -0.3,
  },

  scroll: { paddingHorizontal: 16, paddingBottom: 32 },

  // ── Region B: hero card ────────────────────────────────────────────────
  heroCard: {
    borderRadius: 24,
    padding: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: D.border,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    marginBottom: 24,
  },

  // Profile row
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 22,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    position: 'relative',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: D.primary,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  levelChipWrap: {
    position: 'absolute',
    bottom: -4,
    right: -4,
  },
  levelChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: D.bg,
  },
  levelChipText: {
    fontSize: 12,
    fontWeight: '900' as const,
    color: '#7C2D12',
  },

  profileMeta: { flex: 1 },
  profileGreet: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: D.textSec,
    letterSpacing: 0.4,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: D.white,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  profileTitle: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: D.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginTop: 4,
  },

  // XP block
  xpBlock: {
    marginBottom: 16,
  },
  xpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  xpLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: D.textSec,
    letterSpacing: 1.2,
  },
  /** Wraps a section label + the (i) glyph so they tap together. */
  labelWithInfo: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  /** The (i) circle next to RP / EPC labels — tap opens InfoSheet. */
  xpPoints: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: D.white,
  },
  xpPointsMuted: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: D.textMuted,
  },
  xpBarTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  xpBarFill: {
    height: '100%',
    borderRadius: 6,
    overflow: 'hidden',
  },

  // Coin block
  coinBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  coinIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coinIcon: { fontSize: 24 },
  coinAmount: {
    fontSize: 26,
    fontWeight: '900' as const,
    color: D.white,
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  coinLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: D.gold,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginTop: 2,
  },

  // ── Region C: shop header ──────────────────────────────────────────────
  shopHeader: { marginBottom: 14, paddingHorizontal: 2 },
  shopEyebrow: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: D.gold,
    letterSpacing: 1.4,
  },
  shopHeading: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: D.white,
    letterSpacing: -0.4,
    marginTop: 4,
  },
  shopSubtitle: {
    fontSize: 13,
    color: D.textSec,
    fontWeight: '500' as const,
    marginTop: 4,
    lineHeight: 18,
  },

  // ── Shop card ──────────────────────────────────────────────────────────
  card: {
    borderRadius: 18,
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
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
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
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaPill: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  metaPillText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: D.textSec,
    letterSpacing: 0.6,
  },
  metaPillCost: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.32)',
  },
  metaPillCostText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: D.goldGlow,
    letterSpacing: 0.4,
  },
  metaPillOwned: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.32)',
  },
  metaPillOwnedText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: D.success,
    letterSpacing: 0.4,
  },

  cardRight: {
    minWidth: 92,
    alignItems: 'flex-end',
  },

  // ── Buy button ──────────────────────────────────────────────────────────
  buyBtn: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    minWidth: 92,
    overflow: 'hidden',
  },
  buyBtnDisabled: {},
  buyBtnText: {
    fontSize: 12,
    fontWeight: '900' as const,
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  buyBtnPrice: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    marginTop: 2,
  },
  buyBtnTextDisabled: { color: D.textMuted },

  // ── Owned toggle ────────────────────────────────────────────────────────
  toggleWrap: { alignItems: 'center', gap: 2 },
  toggleLabel: {
    fontSize: 9,
    fontWeight: '900' as const,
    letterSpacing: 1.0,
    marginTop: 2,
  },

  // ── Locked overlay (frosted-glass fallback) ─────────────────────────────
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockOverlayTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 14, 26, 0.78)',
  },
  lockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  lockIcon: { fontSize: 14 },
  lockText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: D.white,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
