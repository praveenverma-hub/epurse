// =============================================================================
// AccountCard — CRED-style realistic credit-card view used in the dashboard.
// =============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect, Defs, RadialGradient, Stop } from 'react-native-svg';

import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';
import { ACCOUNT_TYPES } from '../constants/categories';

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

const BALANCE_SENSITIVE_TYPES = new Set([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.CREDIT_CARD]);

const paletteFor = (account) => {
  const str = String(account?.id || account?.mask || account?.name || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return CARD_PALETTES[h % CARD_PALETTES.length];
};

const maskedNumber = (account) => {
  const m = (account?.mask || '').replace(/\D/g, '');
  if (!m) return '•••• •••• •••• ••••';
  const last4 = m.slice(-4).padStart(4, '•');
  return `•••• •••• •••• ${last4}`;
};

const AccountCard = ({ account, onPress, showBalance = true, width = 280, height = 170 }) => {
  const palette = useMemo(() => paletteFor(account), [account?.id]);
  const Wrapper = onPress ? TouchableOpacity : View;
  const label   = TYPE_LABEL[account.type] || 'CARD';
  const emoji   = TYPE_EMOJI[account.type] || '💳';
  const isSensitive = BALANCE_SENSITIVE_TYPES.has(account.type);
  const balanceHidden = isSensitive && !showBalance;

  // Bank name: prefer account.bankName, fall back to account.name without the mask suffix
  const bankName = account.bankName || null;

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
          <Path
            d={`M ${width - 80} ${height} Q ${width} ${height - 40}, ${width} ${height - 90}`}
            stroke="#FFFFFF22" strokeWidth="1.5" fill="none"
          />
          <Path
            d={`M ${width - 40} ${height} Q ${width} ${height - 20}, ${width} ${height - 60}`}
            stroke="#FFFFFF14" strokeWidth="1" fill="none"
          />
        </Svg>

        {/* ── Top row: brand label + bank name + emoji ── */}
        <View style={styles.topRow}>
          <View>
            <Text style={styles.brand}>{label}</Text>
            {bankName ? (
              <Text style={styles.bankName}>{bankName}</Text>
            ) : null}
          </View>
          <Text style={styles.brandEmoji}>{emoji}</Text>
        </View>

        {/* ── EMV chip ── */}
        <View style={styles.chip}>
          <Svg width={32} height={24} viewBox="0 0 32 24">
            <Rect x="0" y="0" width="32" height="24" rx="4" ry="4" fill="#E8C766" />
            <Rect x="0" y="0" width="32" height="24" rx="4" ry="4" fill="#D4B14A" opacity="0.4" />
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
            {balanceHidden ? (
              <Text style={styles.balanceMasked}>••••••</Text>
            ) : (
              <Text style={styles.balance}>{formatCompact(account.balance)}</Text>
            )}
          </View>
        </View>
      </LinearGradient>
    </Wrapper>
  );
};

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
    alignItems: 'flex-start',
  },
  brand: {
    color: '#FFFFFFE6',
    ...typography.tiny,
    fontWeight: '800',
    letterSpacing: 2,
  },
  bankName: {
    color: '#FFFFFFCC',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
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
  balanceMasked: {
    color: '#FFFFFF99',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 4,
  },
});

export default AccountCard;
