// =============================================================================
// AccountCard — CRED-style realistic credit-card view used in the dashboard.
// -----------------------------------------------------------------------------
// • Picks one of N gradient palettes deterministically from account.id so
//   each card stays the same colour across renders but different cards differ.
// • Renders a subtle SVG glow + chip + contactless-wave decoration so it feels
//   like a real card and not just a coloured rectangle.
// • Brand row maps account.type → label (BANK / CREDIT / WALLET / CASH).
// =============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect, Defs, RadialGradient, Stop } from 'react-native-svg';

import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';
import { ACCOUNT_TYPES } from '../constants/categories';

// ---- Gradient palettes (account-specific, NOT app-theme) -------------------
// We rotate through these so each account gets a visually distinct card.
const CARD_PALETTES = [
  { start: '#1F1147', end: '#5B247A',  glow: '#9D4EDD' },  // deep violet (default)
  { start: '#0F2027', end: '#2C5364',  glow: '#56CCF2' },  // teal slate
  { start: '#11998E', end: '#38EF7D',  glow: '#A8FF78' },  // emerald
  { start: '#373B44', end: '#4286F4',  glow: '#5FA8FF' },  // graphite blue
  { start: '#7B2FF7', end: '#F107A3',  glow: '#FF7BD0' },  // magenta
  { start: '#8E2DE2', end: '#4A00E0',  glow: '#7C3AED' },  // royal
  { start: '#FF512F', end: '#DD2476',  glow: '#FF8FA3' },  // sunset rose
  { start: '#283048', end: '#859398',  glow: '#A0AEC0' },  // platinum
];

const TYPE_LABEL = {
  [ACCOUNT_TYPES.BANK]:        'BANK',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'CREDIT',
  [ACCOUNT_TYPES.WALLET]:      'WALLET',
  [ACCOUNT_TYPES.CASH]:        'CASH',
};

const TYPE_EMOJI = {
  [ACCOUNT_TYPES.BANK]:        '🏦',
  [ACCOUNT_TYPES.CREDIT_CARD]: '💳',
  [ACCOUNT_TYPES.WALLET]:      '👛',
  [ACCOUNT_TYPES.CASH]:        '💵',
};

// ---- Hash helper to pick a stable palette per account ---------------------
const paletteFor = (account) => {
  const str = String(account?.id || account?.mask || account?.name || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return CARD_PALETTES[h % CARD_PALETTES.length];
};

// ---- Mask helper -----------------------------------------------------------
const maskedNumber = (account) => {
  const m = (account?.mask || '').replace(/\D/g, '');
  if (!m) return '•••• •••• •••• ••••';
  const last4 = m.slice(-4).padStart(4, '•');
  return `•••• •••• •••• ${last4}`;
};

// ---- Component -------------------------------------------------------------
const AccountCard = ({ account, onPress, width = 280, height = 170 }) => {
  const palette = useMemo(() => paletteFor(account), [account?.id]);
  const Wrapper = onPress ? TouchableOpacity : View;
  const label   = TYPE_LABEL[account.type] || 'CARD';
  const emoji   = TYPE_EMOJI[account.type] || '💳';

  return (
    <Wrapper
      style={[styles.shadow, { width, height, marginRight: spacing.md }]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <LinearGradient
        colors={[palette.start, palette.end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, { width, height }]}
      >
        {/* SVG decorative layer: subtle glow + contactless wave */}
        <Svg
          width={width}
          height={height}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient id="glow" cx="80%" cy="20%" r="70%">
              <Stop offset="0%"  stopColor={palette.glow} stopOpacity="0.55" />
              <Stop offset="60%" stopColor={palette.glow} stopOpacity="0.15" />
              <Stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={height} fill="url(#glow)" />

          {/* Decorative arc — bottom-right corner curve */}
          <Path
            d={`M ${width - 80} ${height} Q ${width} ${height - 40}, ${width} ${height - 90}`}
            stroke="#FFFFFF22"
            strokeWidth="1.5"
            fill="none"
          />
          <Path
            d={`M ${width - 40} ${height} Q ${width} ${height - 20}, ${width} ${height - 60}`}
            stroke="#FFFFFF14"
            strokeWidth="1"
            fill="none"
          />
        </Svg>

        {/* ── Top row: brand label + emoji ── */}
        <View style={styles.topRow}>
          <Text style={styles.brand}>{label}</Text>
          <Text style={styles.brandEmoji}>{emoji}</Text>
        </View>

        {/* ── EMV chip ── */}
        <View style={styles.chip}>
          <Svg width={32} height={24} viewBox="0 0 32 24">
            <Rect x="0" y="0" width="32" height="24" rx="4" ry="4" fill="#E8C766" />
            <Rect x="0" y="0" width="32" height="24" rx="4" ry="4" fill="#D4B14A" opacity="0.4" />
            {/* Chip grid lines */}
            <Path d="M0 6 L32 6" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M0 12 L32 12" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M0 18 L32 18" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M10 0 L10 24" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M22 0 L22 24" stroke="#B58E2F" strokeWidth="0.8" />
          </Svg>
          <View style={styles.contactless}>
            <Svg width={18} height={18} viewBox="0 0 18 18">
              <Path d="M 4 6 Q 7 9, 4 12" stroke="#FFFFFFAA" strokeWidth="1.4" fill="none" />
              <Path d="M 7 4 Q 12 9, 7 14" stroke="#FFFFFF88" strokeWidth="1.4" fill="none" />
              <Path d="M 10 2 Q 17 9, 10 16" stroke="#FFFFFF66" strokeWidth="1.4" fill="none" />
            </Svg>
          </View>
        </View>

        {/* ── Masked number ── */}
        <Text style={styles.number}>{maskedNumber(account)}</Text>

        {/* ── Bottom row: name + balance ── */}
        <View style={styles.bottomRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>HOLDER</Text>
            <Text style={styles.name} numberOfLines={1}>{account.name}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.label}>BALANCE</Text>
            <Text style={styles.balance}>{formatCompact(account.balance)}</Text>
          </View>
        </View>
      </LinearGradient>
    </Wrapper>
  );
};

// ---- Styles ----------------------------------------------------------------
const styles = StyleSheet.create({
  shadow: { borderRadius: radius.lg, ...shadows.elevated },
  card: {
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    color: '#FFFFFFE6',
    ...typography.tiny,
    fontWeight: '800',
    letterSpacing: 2,
  },
  brandEmoji: { fontSize: 18 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: -spacing.xs,
  },
  contactless: { marginLeft: spacing.xs },

  number: {
    color: '#FFFFFFEE',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 2.5,
  },

  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  label: {
    color: '#FFFFFF88',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  name: {
    color: '#fff',
    ...typography.bodyBold,
    fontWeight: '700',
    marginTop: 2,
  },
  balance: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
});

export default AccountCard;
