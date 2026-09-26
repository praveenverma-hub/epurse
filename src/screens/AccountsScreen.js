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
  AppState, View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useEPurseStore,
  selectEPurseNetWorth,
  selectAssetsAndLiabilities,
  selectAccountLinkSuggestions,
} from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows, pinnedHeaderChrome, withAlpha } from '../constants/theme';
import { useTheme, useGradient } from '../hooks/useTheme';
import { formatCurrency, formatCompact, timeAgo } from '../utils/format';
import { netWorthTrend } from '../utils/accountFlow';
import { resolveAccountGradient } from '../utils/accountGradient';
import { resolveTxnAccount } from '../utils/accountMatch';
import { ccPaymentStatus, PAYMENT_STATUS_LABEL, dueRelativeText, ccStatusColor } from '../utils/ccStatement';
import { currentPaymentWindow } from '../utils/dueDate';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_EMOJI, ACCOUNT_TYPE_LABEL } from '../constants/categories';
import { tabBarClearance } from '../context/TabBarVisibilityContext';

import AccountCard    from '../components/AccountCard';
import StatSplitRow   from '../components/StatSplitRow';
import EmptyState     from '../components/EmptyState';
import InfoIcon       from '../components/InfoIcon';
import CenterModal    from '../components/CenterModal';
import InfoSheet      from '../components/InfoSheet';
import LinkCardToBankSheet from '../components/LinkCardToBankSheet';
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

// ── Collapsing-header geometry (excluding the top safe-area inset) ───────────
//
// Both numbers here were wrong in the same way: they were HEIGHTS carrying space
// that belonged to something else, and the space was then paid a second time.
//
// `HEADER_BAR_H` was 68 "so the collapsed header keeps comfortable padding below
// the heading" — hand-rolled padding from before `CollapsingHeaderScreen` supplied
// any. Its bar content is 40, so 28 of that was slack; once the component padded
// BOTH modes with `HEADER_PAD_B` (Aug-30) the collapsed bar sat 28pt deeper than
// Home's. `barHeight` is the bar's CONTENT — nothing else.
//
// `HEADER_HERO_H` was a pinned 84 around ~54pt of TEXT, so the component centred
// the hero in its box and left 15pt above it. Added to the 28 above, the gap from
// the title row to "Net Worth" measured **43pt** where Home's is 16. Pinning a
// height around text is what the component's own docs warn against: it varies with
// the font and the OS font-scale setting, so no constant is right on every device.
//
// So the hero MEASURES itself and the gap is stated once, as the same
// `spacing.lg` Home uses. No box slack, and the gap is exactly `heroBlock`'s
// padding. Derived in `headerLayout.test.mjs`.
const HEADER_BAR_H = 40;   // the row's own content: two 40pt icon buttons

/**
 * First frame only — the real height is measured. Roughly the gap (16) + the 13pt
 * label's line box (~18) + the 30pt figure's (~36). Being a few points out is
 * invisible because the measurement corrects it on the next frame; do NOT promote
 * this to `heroHeight`.
 */
const HEADER_HERO_EST = 70;

export default function AccountsScreen({ navigation }) {
  const theme        = useTheme();
  const insets       = useSafeAreaInsets();
  const gradient = useGradient();
  const tabBarScroll = useTabBarScroll();
  const isFocused    = useIsFocused();
  const accounts     = useEPurseStore((s) => s.accounts);
  const userName     = useEPurseStore((s) => s.userName);
  const deleteAccount = useEPurseStore((s) => s.deleteAccount);

  // Debit-card↔bank unification: auto-detected merge suggestions + the actions.
  // useMemo, not a selector: it builds a fresh array of fresh objects, which
  // zustand v5 can never compare equal — as a selector this re-renders forever.
  const accountsForLinks         = useEPurseStore((s) => s.accounts);
  const txnsForLinks             = useEPurseStore((s) => s.transactions);
  const archivedForLinks         = useEPurseStore((s) => s.archivedTransactions);
  const declinedForLinks         = useEPurseStore((s) => s.declinedAccountLinks);
  const linkSuggestions          = useMemo(
    () => selectAccountLinkSuggestions({
      accounts: accountsForLinks,
      transactions: txnsForLinks,
      archivedTransactions: archivedForLinks,
      declinedAccountLinks: declinedForLinks,
    }),
    [accountsForLinks, txnsForLinks, archivedForLinks, declinedForLinks]
  );
  const linkDebitCardToBank      = useEPurseStore((s) => s.linkDebitCardToBank);
  const dismissAccountLinkSuggestion = useEPurseStore((s) => s.dismissAccountLinkSuggestion);
  // Manual link: the Debit Card the user chose to fold into a bank (opens picker).
  const [linkTarget, setLinkTarget] = useState(null);
  const [linkInfoVisible, setLinkInfoVisible] = useState(false);

  const [balancesVisible,    setBalancesVisible]    = useState(false);
  const [confirm,            setConfirm]            = useState(null);

  // StatusBar: light glyphs over the gradient header, dark once the LIGHT bar has
  // pinned over it (it covers the status-bar inset). The imperative, focus-gated
  // handling this screen pioneered now lives in the shared hook — a declarative
  // <StatusBar> stays mounted in the tab navigator and leaks its style onto the
  // next tab. Dashboard goes through the same one.
  const [headerPinned, setHeaderPinned] = useState(false);
  useHeaderStatusBar(headerPinned);

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

  // Most recent activity per account, for the plain list's "Last activity"
  // line — ONE pass over every transaction via `resolveTxnAccount` (the
  // store's own matcher, see utils/accountMatch), not a per-row re-scan.
  const lastActivityByAccount = useMemo(() => {
    const map = {};
    for (const t of txnsForLinks) {
      if (t.isIgnored) continue;
      const acc = resolveTxnAccount(t, accounts);
      if (!acc) continue;
      const at = new Date(t.createdAt).getTime();
      if (!map[acc.id] || at > map[acc.id]) map[acc.id] = at;
    }
    return map;
  }, [txnsForLinks, accounts]);

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
  // Same accounts, split into what you own vs what you owe — always sums back
  // to totalBalance above (see selectAssetsAndLiabilities's own doc comment).
  // Computed in a useMemo, NOT called as a store selector directly — it
  // returns a fresh object every call, and zustand v5 compares selector
  // results by reference (see the project's own "no zustand selector
  // allocates" lint / project_zustand_v5_selector_loop_sep2026 memory).
  const { assets, liabilities } = useMemo(
    () => selectAssetsAndLiabilities({ accounts }),
    [accounts],
  );
  // "vs last month" — reconstructed from each account's own ledger, not stored
  // history (there isn't any). `accounts`/`txnsForLinks` are already subscribed
  // above for the link-suggestion memo; reused here rather than a second
  // subscription to the same state.
  const netWorthCompare = useMemo(
    () => netWorthTrend(accounts, txnsForLinks),
    [accounts, txnsForLinks],
  );
  // A tiny epsilon keeps float noise (fractions of a rupee) from flickering
  // between up/down — real "no change" reads as flat, not ±0.01%.
  const nwTrend = Math.abs(netWorthCompare.deltaPct) < 0.05 ? 'flat'
    : netWorthCompare.deltaPct > 0 ? 'up' : 'down';
  const nwTrendColor = nwTrend === 'up' ? theme.success : nwTrend === 'down' ? theme.danger : '#FFFFFFB3';
  const nwTrendIcon = nwTrend === 'up' ? 'trending-up' : nwTrend === 'down' ? 'trending-down' : 'remove';

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
            onPress={() => navigation.navigate('AccountForm')}
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
        estimatedHeroHeight={HEADER_HERO_EST}
        curveRadius={radius.xl}
        contentContainerStyle={styles.bodyContent}
        onCollapseChange={setHeaderPinned}
        renderCollapsedBar={() => accountsBar(true)}
        renderBar={() => accountsBar(false)}
        renderHero={() => (
          <View style={styles.heroBlock}>
            <Text style={styles.headerLabel}>NET WORTH</Text>
            <View style={styles.heroAmountRow}>
              <Text style={styles.headerBalance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {balancesVisible ? formatCurrency(totalBalance) : '₹ ••••••'}
              </Text>
              {/* Masked with the balance — a ratio still leaks how much things
                  moved, so it's gated the same as the figure it's about. */}
              {balancesVisible && netWorthCompare.hasComparison ? (
                <View style={styles.nwTrendWrap}>
                  {/* Only the icon+percentage gets the chip background — "vs
                      last month" renders plain, same treatment as the
                      "Net Worth" label itself, not as part of the chip. The
                      trend colour now lives in the chip's OWN tinted
                      background; the icon/value stay plain white on it. */}
                  <View style={[styles.nwTrendChip, { backgroundColor: withAlpha(nwTrendColor, 0.3) }]}>
                    <Ionicons name={nwTrendIcon} size={12} color="#fff" />
                    <Text style={styles.nwTrendPct} numberOfLines={1}>
                      {Math.round(Math.abs(netWorthCompare.deltaPct))}%
                    </Text>
                  </View>
                  <Text style={[styles.headerLabel, styles.nwTrendSub]} numberOfLines={1}>vs last month</Text>
                </View>
              ) : null}
            </View>
            <StatSplitRow
              style={styles.assetsRow}
              cells={[
                { label: 'BALANCE',     value: balancesVisible ? formatCurrency(assets) : '••••' },
                { label: 'OUTSTANDING', value: balancesVisible ? formatCurrency(liabilities) : '••••' },
              ]}
            />
          </View>
        )}
      >
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
                      title: 'Delete account?',
                      message: `Delete "${a.name}"?\n\nTransactions will be kept but unlinked.`,
                      primaryText: 'Delete',
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
          <Text style={styles.listTitle}>All Accounts</Text>
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
          sortedAccounts.map((a) => {
            // Row subtitle — a Credit Card gets its payment status (the same
            // status/wording the detail screen's own Payment Details card
            // uses), everything else gets when it last moved. Only ONE shows
            // per row: a CC has no plain "last activity" line of its own here,
            // status already implies recency and the row has no space for both.
            const isCC = a.type === ACCOUNT_TYPES.CREDIT_CARD;
            let rowSubtitle = null;
            let rowSubtitleColor = null;
            if (isCC) {
              const status = ccPaymentStatus(a);
              if (status !== 'no_statement') {
                rowSubtitle = (status === 'upcoming' || status === 'due_soon' || status === 'due_today')
                  ? `Due ${dueRelativeText(currentPaymentWindow(a))}`
                  : PAYMENT_STATUS_LABEL[status];
                rowSubtitleColor = ccStatusColor(status, theme);
              }
            } else if (lastActivityByAccount[a.id]) {
              rowSubtitle = `Last activity ${timeAgo(lastActivityByAccount[a.id])}`;
            }

            return (
            <TouchableOpacity
              key={a.id}
              style={styles.listRow}
              onPress={() => navigation.navigate('AccountDetails', { accountId: a.id })}
              activeOpacity={0.7}
            >
              <TouchableOpacity
                style={styles.listIconWrap}
                onPress={() => navigation.navigate('AccountForm', { accountId: a.id })}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Manage ${a.name}`}
              >
                {/* Same gradient the account's own detail-screen hero card
                    resolves to (bank-name match / manual Card Color pick /
                    hash fallback) — one shared source, not a flat neutral
                    circle unrelated to what the card itself looks like. */}
                <LinearGradient
                  colors={resolveAccountGradient(a, theme)}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.listIcon}
                >
                  <Text style={{ fontSize: 20 }}>{ACCOUNT_TYPE_EMOJI[a.type] ?? '💳'}</Text>
                </LinearGradient>
                {a.primary ? (
                  <View style={[styles.listPrimeBadge, { backgroundColor: theme.card }]}>
                    <Ionicons name="star" size={10} color="#F2A93B" />
                  </View>
                ) : null}
              </TouchableOpacity>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.listName} numberOfLines={1} ellipsizeMode="tail">{a.name}</Text>
                <Text style={styles.listType} numberOfLines={1}>
                  {ACCOUNT_TYPE_LABEL[a.type] ?? a.type}
                  {(a.aliasMasks?.length ?? 0) > 0 ? ` · card ··${a.aliasMasks[0]}` : ''}
                </Text>
                {rowSubtitle ? (
                  <Text
                    style={[styles.listSubtitle, rowSubtitleColor ? { color: rowSubtitleColor } : null]}
                    numberOfLines={1}
                  >
                    {rowSubtitle}
                  </Text>
                ) : null}
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
            );
          })
        )}

        <View style={{ height: tabBarClearance(insets.bottom) }} />
      </CollapsingHeaderScreen>

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

      {/* What "linking" a card to a bank means — the one thing on this screen
          a user might not already understand on sight (unlike "last activity"
          or a plain-English payment-status label, which need no explaining). */}
      <InfoSheet
        visible={linkInfoVisible}
        onClose={() => setLinkInfoVisible(false)}
        icon={<Ionicons name="git-merge-outline" size={28} color={theme.primary} />}
        title="Linking cards & banks"
        body="A debit card spends from a bank account — it's the same money. Link them so your balance and net worth aren't counted twice. Tap “Link” on a debit card to merge it into its bank."
      />

      {/* Manual link: pick which bank a debit card draws from → merge into it */}
      <LinkCardToBankSheet
        visible={!!linkTarget}
        card={linkTarget}
        bankAccounts={bankAccounts}
        onClose={() => setLinkTarget(null)}
        onLink={(bankId) => {
          const dc = linkTarget;
          const b = bankAccounts.find((acc) => acc.id === bankId);
          setLinkTarget(null);
          setConfirm({
            title: 'Link card to bank?',
            message: `We'll treat "${dc.name}" as part of "${b.name}" — one balance, counted once. This can't be auto-undone.`,
            primaryText: 'Link them',
            secondaryText: 'Cancel',
            onSecondary: () => setConfirm(null),
            onConfirm: () => { linkDebitCardToBank(dc.id, bankId); setConfirm(null); },
          });
        }}
      />

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
  /** The ONLY thing between the title row and "Net Worth" — matching Home's own
   *  `balanceBlock` gap. With a self-measuring hero there is no box slack to add
   *  to it, so this number is the gap. */
  heroBlock:     { paddingTop: spacing.lg },
  // Same row as the balance figure, chip on the right — flex-end so the
  // (two-line, shorter) chip sits at the BOTTOM of the row, level with where
  // the big amount text ends, rather than centered across its full height.
  heroAmountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.sm },
  // Matches Dashboard's own eyebrow-label + hero-figure treatment
  // (`balanceLabel`/`balanceValue`) — same tiny-bold-tracked eyebrow above a
  // large, tight-tracked figure, so the two hero screens read as one family.
  headerLabel:   { color: '#FFFFFFCC', ...typography.tiny, fontWeight: '800', letterSpacing: 0.9 },
  headerBalance: { color: '#fff', fontSize: 38, fontWeight: '800', letterSpacing: -0.8 },
  // Column: the chip (icon+%, its own background) on top, plain caption below.
  nwTrendWrap: { alignItems: 'center' },
  nwTrendChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: spacing.sm, paddingVertical: 4,
    borderRadius: radius.pill,
  },
  nwTrendPct: { color: '#fff', ...typography.tiny, fontWeight: '800' },
  // Same treatment as the "Net Worth" label (styles.headerLabel) — plain
  // context text, not part of the coloured chip above it.
  nwTrendSub: { marginTop: 3, fontSize: 10 },
  assetsRow: { marginTop: spacing.md },
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
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card,
    marginRight: spacing.md,
    gap: spacing.xs,
  },
  addCardPlus:  { fontSize: 32, color: colors.textSecondary, fontWeight: '300', lineHeight: 36 },
  addCardLabel: { ...typography.small, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },

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
  listIconWrap: { width: 40, height: 40 },
  listIcon: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  // Corner badge for a primary account — same idiom as AccountDetailsScreen's
  // own "PRIME" mark, sized down to sit on this 40px icon.
  listPrimeBadge: {
    position: 'absolute', top: -3, right: -3,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.pop,
  },
  listName:    { ...typography.bodyBold, color: colors.textPrimary },
  listType:    { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  // A Credit Card's payment status (tinted per status, see the row's own
  // colour switch) or, for every other type, "Last activity …" in the same
  // muted tone as listType.
  listSubtitle: { ...typography.tiny, color: colors.textSecondary, marginTop: 2, fontWeight: '600' },
  listBalance: { ...typography.bodyBold, color: colors.textPrimary },

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

  // Same fix as DashboardScreen's `recentEmpty`: `compact` EmptyState is short
  // by design, so with no accounts the whole page barely clears the header.
  // Reserve the space a populated account list would occupy and centre inside it.
  accountsEmpty: { minHeight: 300, justifyContent: 'center' },
});
