// =============================================================================
// AccountCard — CRED-style realistic card with 3D "Balance Adjustment" flip.
//
// Tapping the EMV chip or the BALANCE field on a Savings-Bank card flips the
// card 180° around the Y-axis to reveal the adjustment matrix on the back —
// a numeric input plus two pill actions (Update Anchor / Keep Current).
// Sensitive balances are also force-hidden whenever the app moves to the
// background, so the app-switcher snapshot never leaks the figure.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  AppState,
  Keyboard,
} from 'react-native';
import type { AppStateStatus } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

import { radius, spacing, typography, shadows } from '../constants/theme';
import { formatCompact } from '../utils/format';
import { INPUT_LIMITS, sanitizeAmount } from '../utils/validation';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_EMOJI } from '../constants/categories';
import { useEPurseStore } from '../store/ePurseStore';

// ── Types ────────────────────────────────────────────────────────────────────

type Account = {
  id: string;
  type: string;
  name?: string;
  mask?: string;
  bankName?: string;
  balance: number;
  ccPaymentsTracked?: boolean;
};

type Palette = { start: string; end: string; glow: string };

type Props = {
  account: Account;
  onPress?: () => void;
  onDelete?: () => void;
  showBalance?: boolean;
  active?: boolean;
  holderName?: string;
  width?: number;
  height?: number;
};

// ── Visual constants ─────────────────────────────────────────────────────────

const CARD_PALETTES: Palette[] = [
  { start: '#1F1147', end: '#5B247A', glow: '#9D4EDD' }, // midnight violet
  { start: '#0F2027', end: '#2C5364', glow: '#56CCF2' }, // deep teal
  { start: '#061236', end: '#0D2E6E', glow: '#3B82F6' }, // sapphire navy
  { start: '#0A1F11', end: '#153A28', glow: '#10B981' }, // midnight forest
  { start: '#1C0A12', end: '#55163A', glow: '#F472B6' }, // dark cherry
  { start: '#0E1020', end: '#1A2040', glow: '#94A3B8' }, // onyx steel
  { start: '#130F08', end: '#2D2010', glow: '#C9A84C' }, // midnight gold
  { start: '#18080A', end: '#4A1015', glow: '#F87171' }, // deep ruby
];

const TYPE_SUBTITLE: Record<string, string> = {
  [ACCOUNT_TYPES.BANK]: 'SAVINGS BANK',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'CREDIT CARD',
  [ACCOUNT_TYPES.DEBIT_CARD]: 'DEBIT CARD',
  [ACCOUNT_TYPES.WALLET]: 'DIGITAL WALLET',
  [ACCOUNT_TYPES.CASH]: 'CASH',
};

// Debit-card balance reflects real bank money, so hide it when backgrounded too.
const BALANCE_SENSITIVE_TYPES = new Set<string>([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.DEBIT_CARD]);
const TYPE_LABEL_SET = new Set<string>(Object.values(TYPE_SUBTITLE));

// Heavy, physical spring — feels like a real card flipping.
const FLIP_SPRING = { damping: 15, stiffness: 90, mass: 1 } as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

const paletteFor = (account: Account): Palette => {
  const str = String(account?.id || account?.mask || account?.name || '');
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return CARD_PALETTES[h % CARD_PALETTES.length];
};

const maskedNumber = (account: Account): string => {
  const m = (account?.mask || '').replace(/\D/g, '');
  if (!m) return '•••• •••• •••• ••••';
  const last4 = m.slice(-4).padStart(4, '•');
  return `•••• •••• •••• ${last4}`;
};

const deriveBankName = (account: Account): string | null => {
  if (account.bankName) return account.bankName.toUpperCase();
  if (!account.name) return null;
  if (account.name.includes('··')) {
    const derived = account.name.split('··')[0].trim().toUpperCase() || null;
    if (!derived || TYPE_LABEL_SET.has(derived)) return null;
    return derived;
  }
  if (account.type === ACCOUNT_TYPES.CASH || account.type === ACCOUNT_TYPES.WALLET) {
    return account.name.toUpperCase();
  }
  return null;
};

// ── Component ────────────────────────────────────────────────────────────────

const AccountCard: React.FC<Props> = ({
  account,
  onPress,
  onDelete,
  showBalance = true,
  active = true,
  holderName,
  width = 280,
  height = 170,
}) => {
  const palette = useMemo(() => paletteFor(account), [account?.id]);
  const subtitle = TYPE_SUBTITLE[account.type] || 'CARD';
  const emoji = ACCOUNT_TYPE_EMOJI[account.type] || '💳';
  const isSensitive = BALANCE_SENSITIVE_TYPES.has(account.type);
  const isBank = account.type === ACCOUNT_TYPES.BANK;
  const bankDisplay = deriveBankName(account);
  const displayHolder = holderName || account.name || 'Card Holder';
  const isCreditCard = account.type === ACCOUNT_TYPES.CREDIT_CARD;
  const ccTrackingActive = isCreditCard && !!account.ccPaymentsTracked;
  const isFullyPaid = ccTrackingActive && account.balance >= 0;
  const outstanding = isCreditCard ? Math.abs(account.balance) : null;

  // ── App-state — force-hide sensitive balances when backgrounded ───────────
  const [appActive, setAppActive] = useState<boolean>(
    AppState.currentState === 'active',
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      setAppActive(state === 'active');
    });
    return () => sub.remove();
  }, []);
  const balanceHidden = isSensitive && (!showBalance || !appActive);

  // ── Flip state & animation ────────────────────────────────────────────────
  const setAccountAnchor = useEPurseStore(
    (s: any) => s.setAccountAnchor,
  ) as (id: string, newBalance: number) => void;

  // Every card type supports the anchor flip. Bank/Wallet/Cash: set the actual
  // positive balance. Credit-Card: set actual outstanding (0 = fully paid).
  const canFlip = true;

  const flip = useSharedValue(0); // 0 = front, 180 = back
  const [flipped, setFlipped] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Flip back when the parent screen loses focus (user navigates away).
  useEffect(() => {
    if (!active && flipped) {
      Keyboard.dismiss();
      setDraft('');
      setFlipped(false);
      flip.value = withSpring(0, FLIP_SPRING);
    }
  }, [active, flipped, flip]);

  const flipToBack = async () => {
    if (!canFlip) return;
    try {
      const secLevel = await LocalAuthentication.getEnrolledLevelAsync();
      if (secLevel > LocalAuthentication.SecurityLevel.NONE) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify to adjust balance',
          cancelLabel:   'Cancel',
          fallbackLabel: 'Use Passcode',
          disableDeviceFallback: false,
        });
        if (!result.success) return;
      }
    } catch (_) {}
    setDraft('');
    setFlipped(true);
    flip.value = withSpring(180, FLIP_SPRING);
  };

  const flipToFront = () => {
    Keyboard.dismiss();
    flip.value = withSpring(0, FLIP_SPRING, (finished) => {
      if (finished) runOnJS(setFlipped)(false);
    });
  };

  // Auto-focus once the back face is visibly facing the camera.
  useEffect(() => {
    if (!flipped) return;
    const t = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, [flipped]);

  // Backgrounded mid-edit → snap shut so the input doesn't leak.
  useEffect(() => {
    if (!appActive && flipped) {
      Keyboard.dismiss();
      setDraft('');
      setFlipped(false);
      flip.value = withSpring(0, FLIP_SPRING);
    }
  }, [appActive, flipped, flip]);

  const handleUpdateAnchor = () => {
    const parsed = parseFloat(draft.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0) {
      // Credit cards store outstanding as a negative balance. User types the
      // positive outstanding amount; we negate it for the underlying store.
      const target = isCreditCard ? -Math.abs(parsed) : parsed;
      if (target !== (account.balance ?? 0)) {
        setAccountAnchor(account.id, target);
      }
    }
    flipToFront();
  };

  // Two faces are absolutely stacked. Each carries its own animated rotation:
  //   • Front: 0° → 180°    (visible while < 90°, hidden after via backfaceVisibility)
  //   • Back : 180° → 360°  (the +180° offset means the back's content lands at
  //                          world-0° when the flip completes, so it reads correctly
  //                          to the user without any extra child-level inversion)
  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${flip.value}deg` },
    ],
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1200 },
      { rotateY: `${flip.value + 180}deg` },
    ],
  }));

  return (
    <View style={{ position: 'relative' }}>
      <View style={[styles.flipContainer, { width, height }]}>
        {/* ── Front face ── */}
        <Animated.View
          style={[styles.face, { width, height }, frontStyle]}
          pointerEvents={flipped ? 'none' : 'auto'}
        >
          <FrontFace
            account={account}
            palette={palette}
            subtitle={subtitle}
            emoji={emoji}
            bankDisplay={bankDisplay}
            displayHolder={displayHolder}
            balanceHidden={balanceHidden}
            isCreditCard={isCreditCard}
            ccTrackingActive={ccTrackingActive}
            isFullyPaid={isFullyPaid}
            outstanding={outstanding}
            width={width}
            height={height}
            onPress={onPress}
            onFlipPress={canFlip ? flipToBack : undefined}
          />
        </Animated.View>

        {/* ── Back face ── */}
        <Animated.View
          style={[styles.face, { width, height }, backStyle]}
          pointerEvents={flipped ? 'auto' : 'none'}
        >
          <BackFace
            palette={palette}
            currentBalance={account.balance ?? 0}
            isCreditCard={isCreditCard}
            draft={draft}
            setDraft={setDraft}
            inputRef={inputRef}
            onConfirm={handleUpdateAnchor}
            onCancel={flipToFront}
            width={width}
            height={height}
          />
        </Animated.View>
      </View>

      {/* ── Delete pill (top-right) ── */}
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

export default AccountCard;

// ─── Front face ──────────────────────────────────────────────────────────────

type FrontFaceProps = {
  account: Account;
  palette: Palette;
  subtitle: string;
  emoji: string;
  bankDisplay: string | null;
  displayHolder: string;
  balanceHidden: boolean;
  isCreditCard: boolean;
  ccTrackingActive: boolean;
  isFullyPaid: boolean;
  outstanding: number | null;
  width: number;
  height: number;
  onPress?: () => void;
  onFlipPress?: () => void;
};

const FrontFace: React.FC<FrontFaceProps> = ({
  account,
  palette,
  subtitle,
  emoji,
  bankDisplay,
  displayHolder,
  balanceHidden,
  isCreditCard,
  ccTrackingActive,
  isFullyPaid,
  outstanding,
  width,
  height,
  onPress,
  onFlipPress,
}) => {
  const Outer: any = onPress ? TouchableOpacity : View;
  const ChipWrap: any = onFlipPress ? TouchableOpacity : View;
  const BalanceWrap: any = onFlipPress ? TouchableOpacity : View;

  return (
    <Outer
      style={[styles.shadow, { width, height }]}
      activeOpacity={onPress ? 0.85 : undefined}
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
              <Stop offset="0%" stopColor={palette.glow} stopOpacity="0.55" />
              <Stop offset="60%" stopColor={palette.glow} stopOpacity="0.15" />
              <Stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width={width} height={height} fill="url(#glow)" />
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

        {/* ── Top row: bank name + emoji ── */}
        <View style={styles.topRow}>
          <View style={{ flex: 1 }}>
            {bankDisplay ? (
              <Text style={styles.bankName} numberOfLines={1}>
                {bankDisplay}
              </Text>
            ) : null}
            <Text style={styles.typeSubtitle}>{subtitle}</Text>
          </View>
          <Text style={styles.brandEmoji}>{emoji}</Text>
        </View>

        {/* ── EMV chip — tap-to-flip trigger #1 ── */}
        <ChipWrap
          style={styles.chip}
          activeOpacity={onFlipPress ? 0.7 : undefined}
          onPress={onFlipPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Svg width={32} height={24} viewBox="0 0 32 24">
            <Rect x="0" y="0" width="32" height="24" rx="4" ry="4" fill="#E8C766" />
            <Rect
              x="0" y="0" width="32" height="24" rx="4" ry="4"
              fill="#D4B14A" opacity="0.4"
            />
            <Path d="M0 6 L32 6"  stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M0 12 L32 12" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M0 18 L32 18" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M10 0 L10 24" stroke="#B58E2F" strokeWidth="0.8" />
            <Path d="M22 0 L22 24" stroke="#B58E2F" strokeWidth="0.8" />
          </Svg>
          <View style={styles.contactless}>
            <Svg width={18} height={18} viewBox="0 0 18 18">
              <Path d="M 4 6 Q 7 9, 4 12"   stroke="#FFFFFFAA" strokeWidth="1.4" fill="none" />
              <Path d="M 7 4 Q 12 9, 7 14"  stroke="#FFFFFF88" strokeWidth="1.4" fill="none" />
              <Path d="M 10 2 Q 17 9, 10 16" stroke="#FFFFFF66" strokeWidth="1.4" fill="none" />
            </Svg>
          </View>
        </ChipWrap>

        <Text style={styles.number}>{maskedNumber(account)}</Text>

        {/* ── Bottom row: holder + balance (tap-to-flip trigger #2) ── */}
        <View style={styles.bottomRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>HOLDER</Text>
            <Text style={styles.name} numberOfLines={1}>
              {displayHolder}
            </Text>
          </View>

          <BalanceWrap
            style={{ alignItems: 'flex-end' }}
            activeOpacity={onFlipPress ? 0.7 : undefined}
            onPress={onFlipPress}
            hitSlop={{ top: 8, bottom: 8, left: 8 }}
          >
            <Text style={styles.label}>
              {ccTrackingActive ? 'OUTSTANDING' : 'BALANCE'}
            </Text>
            {balanceHidden ? (
              <Text style={styles.balanceMasked}>••••••</Text>
            ) : isFullyPaid ? (
              <View style={styles.fullyPaidBadge}>
                <Text style={styles.fullyPaidText}>FULLY PAID</Text>
              </View>
            ) : (
              <Text style={styles.balance}>
                {isCreditCard
                  ? formatCompact(outstanding ?? 0)
                  : formatCompact(account.balance)}
              </Text>
            )}
          </BalanceWrap>
        </View>
      </LinearGradient>
    </Outer>
  );
};

// ─── Back face ───────────────────────────────────────────────────────────────

type BackFaceProps = {
  palette: Palette;
  currentBalance: number;
  isCreditCard: boolean;
  draft: string;
  setDraft: (v: string) => void;
  inputRef: React.RefObject<TextInput>;
  onConfirm: () => void;
  onCancel: () => void;
  width: number;
  height: number;
};

const BackFace: React.FC<BackFaceProps> = ({
  palette,
  currentBalance,
  isCreditCard,
  draft,
  setDraft,
  inputRef,
  onConfirm,
  onCancel,
  width,
  height,
}) => {
  // CC: user thinks in positive outstanding ("I owe ₹1500"); store keeps it
  // negative (balance = -1500). Hint with the absolute figure.
  const placeholderValue = isCreditCard
    ? Math.abs(currentBalance).toFixed(2)
    : Number(currentBalance).toFixed(2);
  const titleText    = isCreditCard ? 'OUTSTANDING ANCHOR'  : 'BALANCE ANCHOR';
  const subtitleText = isCreditCard
    ? 'Set actual outstanding in ₹ (0 if fully paid)'
    : 'Set the actual balance on this account';

  return (
  <View style={[styles.shadow, { width, height }]}>
    <LinearGradient
      colors={[palette.start, palette.end]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.card, styles.backCard, { width, height }]}
    >
      {/* Magnetic stripe — anchors the "back of card" visual language */}
      <View style={styles.magStripe} />

      <View>
        <Text style={styles.backTitle}>{titleText}</Text>
        <Text style={styles.backSubtitle}>{subtitleText}</Text>
      </View>

      <View style={styles.inputWrap}>
        <Text style={styles.currencySymbol}>₹</Text>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={(t) => setDraft(sanitizeAmount(t))}
          placeholder={placeholderValue}
          placeholderTextColor="#FFFFFF44"
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={onConfirm}
          style={styles.input}
          maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
          selectionColor="#FFFFFF"
          underlineColorAndroid="transparent"
        />
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={onCancel}
          activeOpacity={0.82}
        >
          <Text style={styles.actionTextSecondary}>Keep Current</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnPrimary]}
          onPress={onConfirm}
          activeOpacity={0.82}
        >
          <Text style={styles.actionTextPrimary}>Update Anchor</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  </View>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flipContainer: {
    // Just a sized box that the two absolute faces stack inside.
  },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    backfaceVisibility: 'hidden',
  },

  shadow: { borderRadius: radius.lg, ...shadows.elevated },
  card: {
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },

  // ── Front-face styles ──
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
    alignSelf: 'flex-start',
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
    // formatCompact output is always short (≤ ~"₹99.99Cr"), so we deliberately DON'T
    // set numberOfLines={1}/adjustsFontSizeToFit here: that combo is the Android bug
    // that clips the trailing glyph (the "k"/"L"/"Cr" unit) of single-line bold text.
    // Left unconstrained it measures & renders in full. paddingRight is belt-and-braces.
    paddingRight: 3,
    includeFontPadding: false,
  },
  balanceMasked: {
    color: '#FFFFFF99',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 4,
  },
  fullyPaidBadge: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#10B98133',
    borderWidth: 1,
    borderColor: '#10B98166',
  },
  fullyPaidText: {
    color: '#6EE7B7',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },

  // ── Back-face styles ──
  backCard: {
    paddingTop: 50, // clear the magnetic stripe
    paddingBottom: spacing.sm + 2,
    justifyContent: 'space-between',
  },
  magStripe: {
    position: 'absolute',
    top: 16,
    left: 0,
    right: 0,
    height: 26,
    backgroundColor: '#00000099',
  },
  backTitle: {
    color: '#FFFFFFE6',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2.4,
  },
  backSubtitle: {
    color: '#FFFFFF77',
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.4,
    marginTop: 2,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#FFFFFF33',
    paddingBottom: 2,
  },
  currencySymbol: {
    color: '#FFFFFFCC',
    fontSize: 18,
    fontWeight: '800',
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.5,
    padding: 0,
    paddingVertical: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: '#FFFFFF',
  },
  actionTextPrimary: {
    color: '#0B0B0F',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionBtnSecondary: {
    backgroundColor: '#FFFFFF14',
    borderWidth: 1,
    borderColor: '#FFFFFF33',
  },
  actionTextSecondary: {
    color: '#FFFFFFD0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  // ── Delete pill ──
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
