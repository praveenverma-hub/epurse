// =============================================================================
// ProfileScreen — the profile HUB.
//
// Was RewardShop.tsx, which stacked three unrelated jobs in one scroll: the
// profile block, the widget catalogue, and (until Aug-26) the settings sheet.
// The shop is the part that grows as the app grows, so it kept pushing the two
// things you actually came for — who you are, and where you go next — further
// off screen, and Settings hid behind a gear glyph in the corner.
//
// Now: hero card (identity + progress + balances) and then a LIST of
// destinations. Everything reachable from here is one visible, labelled row —
// Shop, Reminders, Backup, Settings — so nothing depends on spotting an icon.
//
// Region A: header      Region B: hero (avatar/level, RP bar, EPC + Aware Run)
// Region C: destination list
//
// Theme-adaptive via useRewardPalette(); shares that palette with ShopScreen.
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StatusBar,
  StyleSheet,
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
  withTiming,
} from 'react-native-reanimated';

import { useEPurseStore } from '../store/ePurseStore';
import {
  useRewardStore,
  selectTotalRP,
  selectEpcBalance,
  selectLevel,
  selectAwareStreak,
  levelTitle,
} from '../store/useRewardStore';
import {
  rpForNextLevel,
  levelProgressPct,
  REWARD_COPY,
} from '../config/rewardConfig';
import { hapticLight } from '../utils/haptics';
import InfoSheet from '../components/InfoSheet';
import InfoIcon from '../components/InfoIcon';
import NavListRow from '../components/NavListRow';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { useRewardPalette, type RewardPalette } from '../hooks/useRewardPalette';
import { radius, spacing } from '../constants/theme';

// ─── Props ───────────────────────────────────────────────────────────────────

interface NavigationProp {
  goBack: () => void;
  navigate: (route: string) => void;
}

interface Props {
  navigation: NavigationProp;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const D = useRewardPalette();
  const styles = useMemo(() => makeStyles(D), [D]);

  const userName  = useEPurseStore((s: any) => s.userName ?? '');
  const totalRP   = useRewardStore(selectTotalRP);
  const coins     = useRewardStore(selectEpcBalance);
  const level     = useRewardStore(selectLevel);
  const streak    = useRewardStore(selectAwareStreak);
  const inventory = useRewardStore((s) => s.inventory);

  const title         = useMemo(() => levelTitle(level),        [level]);
  const nextThreshold = useMemo(() => rpForNextLevel(totalRP),  [totalRP]);
  const pct           = useMemo(() => levelProgressPct(totalRP), [totalRP]);

  // The shop row says what's actually in there, so the user can tell whether
  // it's worth the tap without taking it.
  const owned = useMemo(() => inventory.filter((i) => i.isUnlocked).length, [inventory]);

  // Which definition sheet (if any) is open. One state keeps them mutually
  // exclusive — tapping RP closes EPC and vice-versa.
  const [infoOpen, setInfoOpen] = useState<'rp' | 'epc' | null>(null);

  const go = (route: string) => () => {
    hapticLight();
    navigation.navigate(route);
  };

  const initial = userName?.trim()?.charAt(0)?.toUpperCase() || '🙂';
  const display = userName?.trim() || 'Guest';

  return (
    <View style={styles.root}>
      <StatusBar barStyle={D.dark ? 'light-content' : 'dark-content'} backgroundColor={D.bg} />
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* ── Region A: Header ──────────────────────────────────────── */}
        <PlainScreenHeader
          title="Profile"
          onBack={() => {
            hapticLight();
            navigation.goBack();
          }}
          tint={D.white}
          titleColor={D.white}
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* ── Region B: identity + progress + balances ─────────────── */}
          <Animated.View
            entering={FadeInUp.springify().damping(22).stiffness(160)}
            style={styles.heroCard}
          >
            <LinearGradient
              colors={D.heroGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

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
                <LevelChip level={level} styles={styles} D={D} />
              </Animated.View>

              <View style={styles.profileMeta}>
                <Text style={styles.profileGreet}>Hey,</Text>
                <Text style={styles.profileName} numberOfLines={1}>{display}</Text>
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
              <XpBar progress={pct} D={D} styles={styles} />
            </View>

            {/* Two stats, one row. EPC alone left the streak — the thing the
                whole earning loop turns on — visible only as a Dashboard chip. */}
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <View style={[styles.statIconWrap, styles.statIconGold]}>
                  <Ionicons name="cash-outline" size={20} color={D.goldInk} />
                </View>
                <View style={styles.statText}>
                  <Text style={styles.statValue} numberOfLines={1}>
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
                    <Text style={styles.statLabel}>EPC</Text>
                    <InfoIcon size={13} color={D.textMuted} style={{ marginLeft: 3 }} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.stat}>
                <View style={[styles.statIconWrap, styles.statIconPrimary]}>
                  <Ionicons name="flame-outline" size={20} color={D.primary} />
                </View>
                <View style={styles.statText}>
                  <Text style={styles.statValue} numberOfLines={1}>
                    {streak}
                    <Text style={styles.statValueUnit}>d</Text>
                  </Text>
                  {/* ALWAYS "Aware Run" — never the tier label. `labelForStreak`
                      returns "Warming up" / "Steady" / "Veteran", which are names
                      for the MULTIPLIER, not for the streak. Showing one here
                      swapped the feature's name for a word that appears nowhere
                      else, so the same number was called two different things
                      depending on whether it was zero. The tier still shows where
                      it belongs — the Dashboard vault explainer, which spells out
                      "N-day Aware Run · Steady · ×1.2" in full. */}
                  <Text style={styles.statLabelPlain} numberOfLines={1}>
                    Aware Run
                  </Text>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* ── Region C: destinations ───────────────────────────────── */}
          {/* No group LABELS. Two cards separated by a gap already read as two
              groups, and "PERKS" / "APP" were ALL-CAPS eyebrows acting as section
              headings — the thing ui-consistency §1 bans, added by me in the same
              turn that wrote this screen. Four rows do not need a table of
              contents. */}
          <View style={styles.listCard}>
            <NavListRow
              variant="tile"
              icon="bag-handle-outline"
              label="Shop"
              hint={
                owned > 0
                  ? `${owned} of ${inventory.length} widgets unlocked`
                  : 'Spend EPC on dashboard widgets'
              }
              onPress={go('Shop')}
            />
            <NavListRow
              variant="tile"
              divided
              icon="alarm-outline"
              label="Reminders"
              hint="Bill dates and settle-up nudges"
              onPress={go('Reminders')}
            />
          </View>

          <View style={styles.listCard}>
            <NavListRow
              variant="tile"
              icon="cloud-outline"
              label="Backup & restore"
              hint="End-to-end encrypted · Google Drive"
              onPress={go('Backup')}
            />
            <NavListRow
              variant="tile"
              divided
              icon="settings-outline"
              label="Settings"
              hint="Appearance, recap, categories"
              onPress={go('Settings')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* RP / EPC definition sheets — one component, two configurations. */}
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

export default ProfileScreen;

// ─── LevelChip ───────────────────────────────────────────────────────────────

const LevelChip: React.FC<{ level: number; styles: any; D: RewardPalette }> = ({ level, styles, D }) => (
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

const XpBar: React.FC<{ progress: number; D: RewardPalette; styles: any }> = ({ progress, D, styles }) => {
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

// ─── Styles ──────────────────────────────────────────────────────────────────
// A function of the palette so colours stay reactive to theme changes —
// StyleSheet.create alone can't react to a hook.

function makeStyles(D: RewardPalette) {
  return StyleSheet.create({
    root:      { flex: 1, backgroundColor: D.bg },
    container: { flex: 1 },

    scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

    // ── Region B: hero card ────────────────────────────────────────────────
    heroCard: {
      borderRadius: radius.xl,
      padding: 20,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: D.border,
      shadowColor: '#000',
      shadowOpacity: 0.4,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
      marginBottom: spacing.xl,
    },

    profileRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      marginBottom: 22,
    },
    avatarWrap: { width: 64, height: 64, position: 'relative' },
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
    avatarText: { fontSize: 28, fontWeight: '800' as const, color: '#FFFFFF' },
    levelChipWrap: { position: 'absolute', bottom: -4, right: -4 },
    levelChip: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: D.bg,
    },
    levelChipText: { fontSize: 12, fontWeight: '900' as const, color: '#7C2D12' },

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
      color: D.goldInk,
      textTransform: 'uppercase',
      letterSpacing: 1.0,
      marginTop: 4,
    },

    // XP block
    xpBlock: { marginBottom: spacing.lg },
    xpRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: spacing.sm,
    },
    xpLabel: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.textSec,
      letterSpacing: 1.2,
    },
    /** Wraps a label + the (i) glyph so they tap together. */
    labelWithInfo: { flexDirection: 'row', alignItems: 'center' },
    xpPoints: { fontSize: 12, fontWeight: '700' as const, color: D.white },
    xpPointsMuted: { fontSize: 12, fontWeight: '500' as const, color: D.textMuted },
    xpBarTrack: {
      height: 12,
      borderRadius: 6,
      backgroundColor: D.overlayTint,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: D.overlayBorder,
    },
    xpBarFill: { height: '100%', borderRadius: 6, overflow: 'hidden' },

    // ── Stat row (EPC · Aware Run) ─────────────────────────────────────────
    statRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: D.hairline,
    },
    stat: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    // marginHorizontal, not a row gap: the divider must not touch either stat's
    // content, and `stat` is flex:1 so it would otherwise butt straight up to it.
    statDivider: {
      width: 1,
      alignSelf: 'stretch',
      marginHorizontal: spacing.md,
      backgroundColor: D.hairline,
    },
    statIconWrap: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statIconGold:    { backgroundColor: D.goldTint,   borderColor: D.goldBorder },
    statIconPrimary: { backgroundColor: D.overlayTint, borderColor: D.overlayBorder },
    // flex:1 so a 9-figure balance truncates instead of pushing the divider.
    statText: { flex: 1 },
    statValue: {
      fontSize: 22,
      fontWeight: '900' as const,
      color: D.white,
      letterSpacing: -0.5,
      lineHeight: 26,
    },
    statValueUnit: { fontSize: 14, fontWeight: '800' as const, color: D.textSec },
    statLabel: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.goldInk,
      textTransform: 'uppercase',
      letterSpacing: 1.0,
    },
    statLabelPlain: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: D.textSec,
      textTransform: 'uppercase',
      letterSpacing: 1.0,
    },

    // ── Region C: destination list ─────────────────────────────────────────
    listCard: {
      backgroundColor: D.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: D.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      marginBottom: spacing.xl,
    },
  });
}
