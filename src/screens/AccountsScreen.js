// =============================================================================
// AccountsScreen — dedicated Accounts tab.
//
// Layout:
//   • Gradient header with total balance + eye toggle + add button
//   • CRED-style horizontal card scroll (same cards as before)
//   • Plain account list below for quick balance scanning
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState, View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Keyboard, Modal, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useEPurseStore,
  selectEPurseNetWorth,
  selectShouldShowAnchorNudge,
  selectAccountLinkSuggestions,
} from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows, pinnedHeaderChrome, withAlpha } from '../constants/theme';
import { useTheme, useGradient } from '../hooks/useTheme';
import { formatCurrency, formatCompact } from '../utils/format';
import { ACCOUNT_TYPES } from '../constants/categories';
import { tabBarClearance } from '../context/TabBarVisibilityContext';

import AccountCard    from '../components/AccountCard';
import SheetCloseButton from '../components/SheetCloseButton';
import EmptyState     from '../components/EmptyState';
import InfoIcon       from '../components/InfoIcon';
import AddAccountModal from '../components/AddAccountModal';
import CenterModal    from '../components/CenterModal';
import InfoSheet      from '../components/InfoSheet';
import CollapsingHeaderScreen from '../components/CollapsingHeaderScreen';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import { useHeaderStatusBar } from '../hooks/useHeaderStatusBar';

const TYPE_ORDER = {
  [ACCOUNT_TYPES.CASH]:        0,
  [ACCOUNT_TYPES.WALLET]:      1,
  [ACCOUNT_TYPES.DEBIT_CARD]:  2,
  [ACCOUNT_TYPES.CREDIT_CARD]: 3,
  [ACCOUNT_TYPES.BANK]:        4,
};

const TYPE_EMOJI = {
  [ACCOUNT_TYPES.BANK]:        '🏦',
  [ACCOUNT_TYPES.CREDIT_CARD]: '💳',
  [ACCOUNT_TYPES.DEBIT_CARD]:  '🏧',
  [ACCOUNT_TYPES.WALLET]:      '👛',
  [ACCOUNT_TYPES.CASH]:        '💵',
};
const TYPE_LABEL = {
  [ACCOUNT_TYPES.BANK]:        'Bank',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'Credit Card',
  [ACCOUNT_TYPES.DEBIT_CARD]:  'Debit Card',
  [ACCOUNT_TYPES.WALLET]:      'Wallet',
  [ACCOUNT_TYPES.CASH]:        'Cash',
};

// Balances reflecting real bank money are gated behind biometric reveal.
const BALANCE_SENSITIVE = new Set([ACCOUNT_TYPES.BANK, ACCOUNT_TYPES.DEBIT_CARD]);

// ── Centered card carousel geometry ──────────────────────────────────────────
// The active card sits CENTERED; its neighbours peek on both sides and stay put
// (no drift to the left edge as you swipe). Math:
//   • CARD_W caps at 300 but shrinks on narrow phones so a peek is always visible.
//   • SIDE = (screen − card) / 2  → padding that centers the first & last cards.
//   • snap interval = CARD_W + CARD_GAP, snapped from the start edge, so each card
//     lands centered. Neighbour peek = SIDE − CARD_GAP.
const SCREEN_W  = Dimensions.get('window').width;
const CARD_GAP  = 14;

/** The bar's on-gradient weights, as alphas so the light-bar variants derive from
 *  the same numbers. Were `#FFFFFF22` / `#FFFFFF26` inline. */
const ICON_BTN_ALPHA = 0x22 / 255;
const BAL_CHIP_ALPHA = 0x26 / 255;
const CARD_W    = Math.min(300, SCREEN_W - 88);
const CARD_SIDE = (SCREEN_W - CARD_W) / 2;
const CARD_ITV  = CARD_W + CARD_GAP; // snap interval / one "page"

// Collapsing-header geometry: the pinned title bar (taller so the collapsed header
// keeps comfortable padding below the heading), and the "Net Worth" hero that
// fades/collapses on scroll (both exclude the top safe-area inset).
const HEADER_BAR_H  = 68;
const HEADER_HERO_H = 84;

export default function AccountsScreen({ navigation }) {
  const theme        = useTheme();
  const insets       = useSafeAreaInsets();
  const gradient = useGradient();
  const tabBarScroll = useTabBarScroll();
  const isFocused    = useIsFocused();
  const accounts     = useEPurseStore((s) => s.accounts);
  const userName     = useEPurseStore((s) => s.userName);
  const addAccount   = useEPurseStore((s) => s.addAccount);
  const deleteAccount = useEPurseStore((s) => s.deleteAccount);

  // Debit-card↔bank unification: auto-detected merge suggestions + the actions.
  const linkSuggestions          = useEPurseStore(selectAccountLinkSuggestions);
  const linkDebitCardToBank      = useEPurseStore((s) => s.linkDebitCardToBank);
  const dismissAccountLinkSuggestion = useEPurseStore((s) => s.dismissAccountLinkSuggestion);
  // Manual link: the Debit Card the user chose to fold into a bank (opens picker).
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkInfoVisible, setLinkInfoVisible] = useState(false);

  const userPhones     = useEPurseStore((s) => s.userPhones);
  const addUserPhone   = useEPurseStore((s) => s.addUserPhone);
  const removeUserPhone = useEPurseStore((s) => s.removeUserPhone);

  const [balancesVisible,    setBalancesVisible]    = useState(false);
  const [addAccountVisible,  setAddAccountVisible]  = useState(false);
  const [confirm,            setConfirm]            = useState(null);
  const [phoneInput,         setPhoneInput]         = useState('');

  // StatusBar: light glyphs over the gradient header, dark once the LIGHT bar has
  // pinned over it (it covers the status-bar inset). The imperative, focus-gated
  // handling this screen pioneered now lives in the shared hook — a declarative
  // <StatusBar> stays mounted in the tab navigator and leaks its style onto the
  // next tab. Dashboard goes through the same one.
  const [headerPinned, setHeaderPinned] = useState(false);
  useHeaderStatusBar(headerPinned);

  const handleAddPhone = () => {
    const digits = phoneInput.replace(/\D/g, '');
    if (digits.length < 4) return;
    addUserPhone(digits);
    setPhoneInput('');
    Keyboard.dismiss();
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setBalancesVisible(false);
    });
    return () => sub.remove();
  }, []);

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)),
    [accounts],
  );

  // Bank accounts a Debit Card can be merged into (manual link picker).
  const bankAccounts = useMemo(
    () => accounts.filter((a) => a.type === ACCOUNT_TYPES.BANK),
    [accounts],
  );

  // ── Looping card carousel ──────────────────────────────────────────────────
  // With 2+ cards we clone the last card before the first and the first after the
  // last, then start scrolled onto the first REAL card. That way the previous card
  // always peeks on the left (no empty gap on card 1) and it wraps seamlessly. On
  // momentum end, if we've landed on a clone we jump (no animation) to its twin.
  const carouselRef = useRef(null);
  const loopEnabled = sortedAccounts.length >= 2;
  const carouselData = useMemo(() => {
    const real = sortedAccounts.map((a) => ({ a, key: a.id }));
    if (!loopEnabled) return real;
    const first = sortedAccounts[0];
    const last  = sortedAccounts[sortedAccounts.length - 1];
    return [
      { a: last,  key: `clone-left-${last.id}` },
      ...real,
      { a: first, key: `clone-right-${first.id}` },
    ];
  }, [sortedAccounts, loopEnabled]);

  // Start on the first real card (index 1) so the last card peeks on its left.
  useEffect(() => {
    if (!loopEnabled) return;
    const id = setTimeout(() => carouselRef.current?.scrollTo({ x: CARD_ITV, animated: false }), 0);
    return () => clearTimeout(id);
  }, [loopEnabled, sortedAccounts.length]);

  const handleCarouselMomentum = useCallback((e) => {
    if (!loopEnabled) return;
    const n = sortedAccounts.length;
    const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_ITV);
    if (idx === 0)         carouselRef.current?.scrollTo({ x: CARD_ITV * n, animated: false });      // clone-of-last → real last
    else if (idx === n + 1) carouselRef.current?.scrollTo({ x: CARD_ITV, animated: false });          // clone-of-first → real first
  }, [loopEnabled, sortedAccounts.length]);

  // Net Worth — your real money across all accounts. Includes private
  // transactions (they reflect actual money movement). See selectEPurseNetWorth
  // in the store for the exclusion rules.
  const totalBalance = useEPurseStore(selectEPurseNetWorth);

  const showAnchorNudge   = useEPurseStore(selectShouldShowAnchorNudge);
  const dismissAnchorNudge = useEPurseStore((s) => s.dismissAnchorNudge);

  const handleToggleBalances = async () => {
    if (balancesVisible) { setBalancesVisible(false); return; }
    try {
      const secLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // Skip auth only if the device has absolutely no security set up.
      // SecurityLevel.NONE (0) = no PIN, no biometrics — safe to allow through.
      // SECRET (1) = PIN/pattern only → prompts device lock.
      // BIOMETRIC_WEAK/STRONG (2/3) → prompts biometrics with PIN fallback.
      if (secLevel > LocalAuthentication.SecurityLevel.NONE) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Verify to reveal balances',
          cancelLabel:   'Cancel',
          fallbackLabel: 'Use Passcode',
          disableDeviceFallback: false,
        });
        if (!result.success) return;
      }
    } catch (_) {}
    setBalancesVisible(true);
  };

  /**
   * The Accounts bar, rendered on the gradient AND on the light bar that pins to
   * the top. `onLight` is the only axis.
   *
   * The BALANCE CHIP belongs to the pinned bar only, and that is what replaced a
   * fiddle worth remembering. The two bars used to be one, so the chip had to
   * fade in on `progress` from an absolutely-positioned slot: in flow it reserved
   * its width while still invisible (a dead gap beside the title when expanded)
   * and it could not animate its own width away, because `width` is not a
   * native-animatable prop. With a second bar it is simply in flow here and
   * absent there — no float, no interpolation.
   *
   * The eye stays in BOTH (Aug-26): the chip and the toggle used to cross-fade in
   * one slot, so the way to unmask disappeared at exactly the moment the masked
   * `••••` was on screen. While the pinned bar is up the gradient bar behind it
   * is inert, so every affordance has to be here too.
   */
  const pinned = useMemo(() => pinnedHeaderChrome(theme.card, theme), [theme]);

  const accountsBar = (onLight) => {
    const ink = onLight ? pinned.ink : '#fff';
    const fill = (alpha) => (onLight ? pinned.fill(alpha) : withAlpha('#FFFFFF', alpha));
    return (
      <View style={styles.barRow}>
        <Text style={[styles.headerTitle, { color: ink }]} numberOfLines={1}>Accounts</Text>
        <View style={styles.headerActions}>
          {onLight ? (
            <TouchableOpacity
              style={[styles.balChip, { backgroundColor: fill(BAL_CHIP_ALPHA) }]}
              onPress={handleToggleBalances}
              activeOpacity={0.8}
            >
              <Text style={[styles.balChipText, { color: ink }]} numberOfLines={1}>
                {balancesVisible ? formatCompact(totalBalance) : '\u2022\u2022\u2022\u2022'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: fill(ICON_BTN_ALPHA) }]}
            onPress={handleToggleBalances}
            activeOpacity={0.7}
          >
            <Ionicons name={balancesVisible ? 'eye-off-outline' : 'eye-outline'} size={20} color={ink} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: fill(ICON_BTN_ALPHA) }]}
            onPress={() => setAddAccountVisible(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={22} color={ink} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* StatusBar is driven imperatively via useHeaderStatusBar (above) so it
          doesn't leak its style onto other tabs. */}

      {/* ── Collapsing themed header + scrollable body ──
          The gradient header (with curve) slides up on scroll; the big "Net Worth"
          hero fades out while a compact balance chip slides into the pinned bar. */}
      <CollapsingHeaderScreen
        // Hide-on-scroll for the tab bar, same as every other tab (Aug-26).
        // CollapsingHeaderScreen chains this into its own Animated.event listener.
        onScroll={tabBarScroll.onScroll}
        gradientColors={gradient}
        barHeight={HEADER_BAR_H}
        heroHeight={HEADER_HERO_H}
        curveRadius={radius.xl}
        contentContainerStyle={styles.bodyContent}
        onCollapseChange={setHeaderPinned}
        renderCollapsedBar={() => accountsBar(true)}
        renderBar={() => accountsBar(false)}
        renderHero={() => (
          <View>
            <Text style={styles.headerLabel}>Net Worth</Text>
            <Text style={styles.headerBalance}>
              {balancesVisible ? formatCurrency(totalBalance) : '₹ ••••••'}
            </Text>
          </View>
        )}
      >
        {/* First-time anchor nudge — auto-hides once any account is anchored
            or once the user dismisses it. */}
        {showAnchorNudge ? (
          <View style={[styles.nudgeCard, { backgroundColor: theme.card, borderColor: theme.primary + '33' }]}>
            <View style={[styles.nudgeIcon, { backgroundColor: theme.primary + '1A' }]}>
              <Ionicons name="wallet-outline" size={20} color={theme.primary} />
            </View>
            <View style={styles.nudgeBody}>
              <Text style={[styles.nudgeTitle, { color: colors.textPrimary }]}>
                Set your real balances
              </Text>
              <Text style={[styles.nudgeBody2, { color: colors.textSecondary }]}>
                Tap any card below, flip it, and enter the actual balance from your
                bank. Net Worth becomes accurate from that moment on.
              </Text>
            </View>
            <TouchableOpacity
              onPress={dismissAnchorNudge}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Merge suggestions — "this card & this bank look like the same money" */}
        {linkSuggestions.map((sug) => (
          <View key={`${sug.cardMask}:${sug.bankMask}`} style={styles.linkSuggest}>
            <View style={styles.linkSuggestIcon}>
              <Ionicons name="git-merge-outline" size={20} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkSuggestTitle} numberOfLines={2}>
                Same account?
              </Text>
              <Text style={styles.linkSuggestBody}>
                Your debit card ··{sug.cardMask} and {sug.bankName} ··{sug.bankMask} look like the
                same account. Link them so the balance and net worth aren't counted twice.
              </Text>
              <View style={styles.linkSuggestActions}>
                <TouchableOpacity
                  style={[styles.linkBtn, { backgroundColor: theme.primary }]}
                  onPress={() =>
                    setConfirm({
                      title: 'Link card to bank?',
                      message: `We'll treat debit card ··${sug.cardMask} as part of ${sug.bankName} ··${sug.bankMask} — one balance, counted once. This can't be auto-undone.`,
                      primaryText: 'Link them',
                      destructive: false,
                      secondaryText: 'Cancel',
                      onSecondary: () => setConfirm(null),
                      onConfirm: () => { linkDebitCardToBank(sug.cardId, sug.bankId); setConfirm(null); },
                    })
                  }
                  activeOpacity={0.85}
                >
                  <Text style={styles.linkBtnText}>Link them</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.linkBtnGhost}
                  onPress={() => dismissAccountLinkSuggestion(sug.cardMask, sug.bankMask)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.linkBtnGhostText}>Not the same</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        {/* CRED-style cards — centered, looping peek carousel (hidden when none) */}
        {sortedAccounts.length > 0 ? (
          <ScrollView
            ref={carouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.cardsScroll}
            contentContainerStyle={styles.cardsRow}
            snapToInterval={CARD_ITV}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            onMomentumScrollEnd={handleCarouselMomentum}
            {...(loopEnabled ? { contentOffset: { x: CARD_ITV, y: 0 } } : {})}
          >
            {carouselData.map(({ a, key }) => (
              <View key={key} style={styles.cardSlot}>
                <AccountCard
                  account={a}
                  width={CARD_W}
                  active={isFocused}
                  showBalance={!BALANCE_SENSITIVE.has(a.type) || balancesVisible}
                  holderName={userName}
                  onDelete={() =>
                    setConfirm({
                      title: 'Remove account?',
                      message: `Remove "${a.name}"?\n\nTransactions will be kept but unlinked.`,
                      primaryText: 'Remove',
                      destructive: true,
                      secondaryText: 'Cancel',
                      onSecondary: () => setConfirm(null),
                      onConfirm: () => { deleteAccount(a.id); setConfirm(null); },
                    })
                  }
                />
              </View>
            ))}
          </ScrollView>
        ) : null}

        {/* Anchor-adjustment hint — plain text, no pill */}
        {sortedAccounts.length > 0 ? (
          <Text style={styles.flipHintText}>
            Tap the chip or balance on any card to adjust its balance.
          </Text>
        ) : null}

        {/* Flat account list */}
        <View style={styles.listHeaderRow}>
          <Text style={styles.listTitle}>All accounts</Text>
          <TouchableOpacity
            onPress={() => setLinkInfoVisible(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="About linking cards and banks"
          >
            <InfoIcon size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {sortedAccounts.length === 0 ? (
          <EmptyState
            compact
            icon="card-outline"
            title="No accounts yet"
            subtitle="Tap + above to add your first account."
            style={styles.accountsEmpty}
          />
        ) : (
          sortedAccounts.map((a) => (
            <TouchableOpacity
              key={a.id}
              style={styles.listRow}
              onPress={() => navigation.navigate('AccountDetails', { accountId: a.id })}
              activeOpacity={0.7}
            >
              <View style={styles.listIcon}>
                <Text style={{ fontSize: 20 }}>{TYPE_EMOJI[a.type] ?? '💳'}</Text>
              </View>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.listName} numberOfLines={1} ellipsizeMode="tail">{a.name}</Text>
                <Text style={styles.listType} numberOfLines={1}>
                  {TYPE_LABEL[a.type] ?? a.type}
                  {(a.aliasMasks?.length ?? 0) > 0 ? ` · card ··${a.aliasMasks[0]}` : ''}
                </Text>
              </View>
              {/* Debit cards can be folded into a bank (same money) */}
              {a.type === ACCOUNT_TYPES.DEBIT_CARD && bankAccounts.length > 0 ? (
                <TouchableOpacity
                  style={styles.rowLinkBtn}
                  onPress={() => setLinkTarget(a)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Link to a bank account"
                >
                  <Ionicons name="git-merge-outline" size={16} color={theme.primary} />
                  <Text style={[styles.rowLinkTxt, { color: theme.primary }]}>Link</Text>
                </TouchableOpacity>
              ) : null}
              <Text
                style={[styles.listBalance, { color: (a.balance ?? 0) < 0 ? colors.danger : colors.textPrimary }]}
                numberOfLines={1}
              >
                {(!BALANCE_SENSITIVE.has(a.type) || balancesVisible)
                  ? formatCurrency(Math.abs(a.balance ?? 0))
                  : '••••'}
              </Text>
            </TouchableOpacity>
          ))
        )}

        {/* Linked mobile numbers — powers self-transfer detection */}
        <Text style={[styles.listTitle, styles.listTitleStandalone]}>Your mobile numbers</Text>
        <View style={styles.phoneCard}>
          <Text style={styles.phoneHelp}>
            Add the mobile number(s) linked to your bank accounts. When money moves
            to your own account or number, we'll tag it as a self transfer and keep
            it out of your spending and income totals.
          </Text>

          {userPhones?.length > 0 ? (
            <View style={styles.phoneChips}>
              {userPhones.map((p) => (
                <View key={p} style={styles.phoneChip}>
                  <Text style={styles.phoneChipText}>{p}</Text>
                  <TouchableOpacity
                    onPress={() => removeUserPhone(p)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${p}`}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.phoneInputRow}>
            <TextInput
              style={styles.phoneInput}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="e.g. 9876543210"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
              returnKeyType="done"
              onSubmitEditing={handleAddPhone}
              maxLength={15}
            />
            <TouchableOpacity
              style={[styles.phoneAddBtn, phoneInput.replace(/\D/g, '').length < 4 && styles.phoneAddBtnDisabled]}
              onPress={handleAddPhone}
              disabled={phoneInput.replace(/\D/g, '').length < 4}
              activeOpacity={0.8}
            >
              <Text style={styles.phoneAddText}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: tabBarClearance(insets.bottom) }} />
      </CollapsingHeaderScreen>

      <AddAccountModal
        visible={addAccountVisible}
        onClose={() => setAddAccountVisible(false)}
        onAdd={(acct) => addAccount(acct)}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />

      {/* What "linking" a card to a bank means */}
      <InfoSheet
        visible={linkInfoVisible}
        onClose={() => setLinkInfoVisible(false)}
        icon={<Ionicons name="git-merge-outline" size={28} color={theme.primary} />}
        title="Linking cards & banks"
        body="A debit card spends from a bank account — it's the same money. Link them so your balance and net worth aren't counted twice. Tap “Link” on a debit card to merge it into its bank."
      />

      {/* Manual link: pick which bank a debit card draws from → merge into it */}
      <Modal
        visible={!!linkTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setLinkTarget(null)}
      >
        <View style={styles.pickBackdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setLinkTarget(null)} />
          <View style={styles.pickSheet}>
            <SheetCloseButton onPress={() => setLinkTarget(null)} variant="absolute" />
            <View style={styles.pickHandle} />
            <Text style={styles.pickTitle}>Link {linkTarget?.name} to…</Text>
            <Text style={styles.pickHelp}>
              Pick the bank account this debit card draws from. They'll share one balance and
              be counted once in net worth.
            </Text>
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {bankAccounts.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.pickRow}
                  activeOpacity={0.75}
                  onPress={() => {
                    const dc = linkTarget;
                    setLinkTarget(null);
                    setConfirm({
                      title: 'Link card to bank?',
                      message: `We'll treat "${dc.name}" as part of "${b.name}" — one balance, counted once. This can't be auto-undone.`,
                      primaryText: 'Link them',
                      secondaryText: 'Cancel',
                      onSecondary: () => setConfirm(null),
                      onConfirm: () => { linkDebitCardToBank(dc.id, b.id); setConfirm(null); },
                    });
                  }}
                >
                  <Text style={{ fontSize: 20, marginRight: spacing.sm }}>{TYPE_EMOJI[b.type]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickRowName} numberOfLines={1}>{b.name}</Text>
                    {b.mask ? <Text style={styles.pickRowSub}>··{b.mask}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pickCancel} onPress={() => setLinkTarget(null)}>
              <Text style={styles.pickCancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Pinned bar: "Accounts" title (flex) + right-side actions (chip / eye / add).
  barRow:         { flexDirection: 'row', alignItems: 'center' },
  // Ink is applied at the call site: this row renders on the gradient AND on
  // the light pinned bar (`accountsBar`).
  headerTitle:    { flex: 1, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  headerLabel:   { color: '#FFFFFFCC', ...typography.small },
  headerBalance: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  // Compact balance chip — same 40px height as the icon buttons. It is in FLOW:
  // it only exists on the pinned bar, so there is no invisible state to reserve
  // width for. (It used to float and fade in on scroll — see `accountsBar`.)
  balChip: {
    height:            40,
    minWidth:          64,
    maxWidth:          140,
    paddingHorizontal: 14,
    borderRadius:      20,
    alignItems:        'center',
    justifyContent:    'center',
  },
  balChipText: { fontWeight: '800', fontSize: 15, letterSpacing: -0.2 },

  // paddingTop is managed by CollapsingHeaderScreen (= expanded header height).
  bodyContent: { paddingHorizontal: spacing.lg },

  // Full-width breakout so the carousel can center cards against the SCREEN edges
  // (CARD_SIDE is computed from screen width), not the padded body.
  cardsScroll: { marginHorizontal: -spacing.lg },
  cardsRow:    {
    paddingTop: 14,
    paddingBottom: spacing.md,
    paddingHorizontal: CARD_SIDE, // centers the first & last card
    columnGap: CARD_GAP,          // peek gap; pairs with snapToInterval
  },
  cardSlot:    { width: CARD_W },
  addCardPlaceholder: {
    width: 280, height: 170,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    marginRight: spacing.md,
    gap: spacing.xs,
  },
  addCardPlus:  { fontSize: 32, color: colors.textSecondary, fontWeight: '300', lineHeight: 36 },
  addCardLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },

  nudgeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    ...shadows.card,
  },
  nudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeBody: { flex: 1 },
  nudgeTitle: {
    ...typography.bodyBold,
    fontWeight: '700',
    marginBottom: 2,
  },
  nudgeBody2: {
    ...typography.small,
    lineHeight: 18,
  },

  flipHintText: {
    ...typography.tiny,
    color: colors.textSecondary,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },

  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  listTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  // Standalone section titles (not inside listHeaderRow) keep their own spacing.
  listTitleStandalone: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
    ...shadows.card,
  },
  listIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  listName:    { ...typography.bodyBold, color: colors.textPrimary },
  listType:    { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  listBalance: { ...typography.bodyBold, color: colors.textPrimary },

  phoneCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  phoneHelp: {
    ...typography.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  phoneChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  phoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  phoneChipText: { ...typography.small, color: colors.textPrimary, fontWeight: '600' },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: colors.textPrimary,
  },
  phoneAddBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneAddBtnDisabled: { opacity: 0.4 },
  phoneAddText: { color: colors.card, ...typography.bodyBold, fontWeight: '700' },


  // Debit-card↔bank merge suggestion card
  linkSuggest: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadows.card,
  },
  linkSuggestIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  linkSuggestTitle: { ...typography.bodyBold, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  linkSuggestBody:  { ...typography.small, color: colors.textSecondary, lineHeight: 18 },
  linkSuggestActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  linkBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },
  linkBtnText: { color: '#fff', ...typography.small, fontWeight: '700' },
  linkBtnGhost: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  linkBtnGhostText: { color: colors.textSecondary, ...typography.small, fontWeight: '700' },

  // Per-row "Link" affordance on debit-card rows
  rowLinkBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 4 },
  rowLinkTxt: { ...typography.tiny, fontWeight: '700' },

  // Bank-picker bottom sheet (manual link)
  pickBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  pickSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl,
  },
  pickHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center', marginBottom: spacing.md },
  pickTitle:  { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  pickHelp:   { ...typography.small, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.sm },
  pickRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  pickRowName: { ...typography.bodyBold, color: colors.textPrimary },
  pickRowSub:  { ...typography.tiny, color: colors.textSecondary, marginTop: 1 },
  pickCancel:  { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  pickCancelTxt: { ...typography.body, color: colors.textSecondary },
  // Same fix as DashboardScreen's `recentEmpty`: `compact` EmptyState is short
  // by design, so with no accounts the whole page barely clears the header.
  // Reserve the space a populated account list would occupy and centre inside it.
  accountsEmpty: { minHeight: 300, justifyContent: 'center' },
});
