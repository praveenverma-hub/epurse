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
  { start: '#1F1147', end: '#5B247A', glow: '#9D4EDD' },  // midnight violet
  { start: '#0F2027', end: '#2C5364', glow: '#56CCF2' },  // deep teal
  { start: '#061236', end: '#0D2E6E', glow: '#3B82F6' },  // sapphire navy
  { start: '#0A1F11', end: '#153A28', glow: '#10B981' },  // midnight forest
  { start: '#1C0A12', end: '#55163A', glow: '#F472B6' },  // dark cherry
  { start: '#0E1020', end: '#1A2040', glow: '#94A3B8' },  // onyx steel
  { start: '#130F08', end: '#2D2010', glow: '#C9A84C' },  // midnight gold
  { start: '#18080A', end: '#4A1015', glow: '#F87171' },  // deep ruby
];

// Full-length label shown as subtitle under the bank name
const TYPE_SUBTITLE = {
  [ACCOUNT_TYPES.BANK]:        'SAVINGS BANK',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'CREDIT CARD',
  [ACCOUNT_TYPES.WALLET]:      'DIGITAL WALLET',
  [ACCOUNT_TYPES.CASH]:        'CASH',
};

const TYPE_EMOJI = {
  [ACCOUNT_TYPES.BANK]:        '🏦',
  [ACCOUNT_TYPES.CREDIT_CARD]: '💳',
  [ACCOUNT_TYPES.WALLET]:      '👛',
  [ACCOUNT_TYPES.CASH]:        '💵',
};

const BALANCE_SENSITIVE_TYPES = new Set([ACCOUNT_TYPES.BANK]);

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

const TYPE_LABEL_SET = new Set(Object.values(TYPE_SUBTITLE));

// Derives a display bank name from bankName field or account name
const deriveBankName = (account) => {
  if (account.bankName) return account.bankName.toUpperCase();
  if (!account.name) return null;
  // "HDFC ··4567" → "HDFC", "Cash" → null, "UPI Wallet" → "UPI"
  if (account.name.includes('··')) {
    const derived = account.name.split('··')[0].trim().toUpperCase() || null;
    if (!derived || TYPE_LABEL_SET.has(derived)) return null;
    return derived;
  }
  // For CASH / WALLET with a plain name, show the name as the "bank"
  if (account.type === ACCOUNT_TYPES.CASH || account.type === ACCOUNT_TYPES.WALLET) {
    return account.name.toUpperCase();
  }
  return null;
};

const AccountCard = ({
  account,
  onPress,
  onDelete,
  showBalance = true,
  holderName,
  width = 280,
  height = 170,
}) => {
  const palette = useMemo(() => paletteFor(account), [account?.id]);
  const Wrapper    = onPress ? TouchableOpacity : View;
  const subtitle   = TYPE_SUBTITLE[account.type] || 'CARD';
  const emoji      = TYPE_EMOJI[account.type] || '💳';
  const isSensitive    = BALANCE_SENSITIVE_TYPES.has(account.type);
  const balanceHidden  = isSensitive && !showBalance;
  const bankDisplay    = deriveBankName(account);
  const displayHolder  = holderName || account.name || 'Card Holder';

  return (
    <View style={{ position: 'relative', marginRight: spacing.md }}>
      <Wrapper
        style={[styles.shadow, { width, height }]}
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

          {/* ── Top row: bank name + emoji ── */}
          <View style={styles.topRow}>
            <View style={{ flex: 1 }}>
              {bankDisplay ? (
                <Text style={styles.bankName} numberOfLines={1}>{bankDisplay}</Text>
              ) : null}
              <Text style={styles.typeSubtitle}>{subtitle}</Text>
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

          {/* ── Bottom row: holder + balance ── */}
          <View style={styles.bottomRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>HOLDER</Text>
              <Text style={styles.name} numberOfLines={1}>{displayHolder}</Text>
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

      {/* ── Delete button (overlaid top-right corner) ── */}
      {onDelete ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={onDelete}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          activeOpacity={0.75}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
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
  bankName: {
    color: '#FFFFFFE6',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  typeSubtitle: {
    color: '#FFFFFFBB',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 2,
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

  deleteBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FF3B30EE',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 4,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 12,
  },
});

export default AccountCard;
