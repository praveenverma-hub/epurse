// =============================================================================
// OnboardingExperience.tsx
// -----------------------------------------------------------------------------
// A single, self-contained module that finalizes the frictionless entry flow:
//
//   1. OnboardingDeck          — 4-page slide deck (3 info slides + registration)
//   2. AccountFilterScreen     — "Is this yours?" pre-home account gate
//   3. TopVendorFixCard +      — Myntra-style inline feed widget with a strict
//      buildFeedWithWidgets()    24-hour-from-onboarding injection window
//   4. AnchorBalanceToast +    — first-visit "anchor your live balance" toast
//      BalanceAnchorModal +      with an inline balance-anchoring modal
//      useAnchorToast()
//
// Design system: colours come from the live `useTheme()` palette (flat keys:
// primary / background / card / divider / textPrimary / textSecondary / success
// / danger …). Spacing & radius come from constants/theme. Icons are inline
// react-native-svg (no icon dependency). Everything is theme-aware and responsive.
//
// ── STORE WIRING ─────────────────────────────────────────────────────────────
// Uses EXISTING store actions: setUserName, setUserPhones, setHasOnboarded,
// setSmsPermissionGranted, setAccountAnchor, deleteAccount.
//
// Add these TWO members to ePurseStore.js so the 24-hour widget rule works
// (every call here is optional-chained, so the file is safe before you wire it):
//
//     // state:
//     userOnboardedAt: null,
//     // action:
//     setUserOnboardedAt: (ts) => set({ userOnboardedAt: ts ?? Date.now() }),
//     // persist: add `userOnboardedAt: state.userOnboardedAt` to partialize().
//
// `isAnchored` is derived from the existing `anchoredAt` timestamp (an account
// is anchored once setAccountAnchor() has run); an explicit `account.isAnchored`
// boolean is honoured if you later add one.
//
// Navigation: register `AccountFilter` as a stack screen. Route names used here
// (`AccountFilter`, `Main`) are overridable via props.
// =============================================================================

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '../hooks/useTheme';
import { spacing, radius } from '../constants/theme';
import { useEPurseStore, selectAccountLinkSuggestions } from '../store/ePurseStore';
import { ACCOUNT_TYPES } from '../constants/categories';
import { requestSmsPermission, smsSupported } from '../services/smsService';
import { requestLocationPermission } from '../services/locationService';
import { requestContactsPermission } from '../services/contactsService';
import { requestNotificationPermissions } from '../utils/notifications';
import { runInitialInboxSweep } from '../utils/inboxSweep';
import { INPUT_LIMITS, sanitizeName, isValidName, sanitizePhone, isValidPhone, sanitizeAmount } from '../utils/validation';

// =============================================================================
// Types
// =============================================================================
interface Theme {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  gradientStart: string;
  gradientEnd: string;
  background: string;
  card: string;
  cardAlt: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  shadow: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  darkMode?: boolean;
}

export interface Account {
  id: string;
  type: string;
  name?: string;
  bankName?: string | null;
  mask?: string | null;
  balance?: number;
  color?: string;
  anchoredAt?: number | null;
  isAnchored?: boolean;
}

export interface VendorFix {
  id: string;
  vendor: string;
  amount: number;
  count: number;
  suggestedCategory?: string;
}

type Nav = {
  replace?: (route: string, params?: object) => void;
  navigate?: (route: string, params?: object) => void;
} | undefined;

// =============================================================================
// Constants
// =============================================================================
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_W = Dimensions.get('window').width;

type IconKind = 'smartphone' | 'folder' | 'trophy';

interface Slide {
  key: string;
  icon: IconKind;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    key: 'tracking',
    icon: 'smartphone',
    title: 'The truth of your wallet, automated.',
    body: 'Securely tracking your credit cards and bank balances in real-time through intelligent device logs.',
  },
  {
    key: 'strategy',
    icon: 'folder',
    title: 'Strategy over chaos.',
    body: 'Enforce custom budget limits and group related expenses into cross-cutting project folders like trips or renovations.',
  },
  {
    key: 'gamified',
    icon: 'trophy',
    title: 'Every step counts. Literally.',
    body: 'Build lasting wealth habits with Aware Run and earn Reality Points for staying on budget. Accumulate ePurse Coins to unlock custom themes.',
  },
];

// =============================================================================
// Inline SVG icons (theme-tinted, no icon dependency)
// =============================================================================
const SmartphoneIcon = ({ color, size = 40 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={6} y={2} width={12} height={20} rx={3} stroke={color} strokeWidth={1.6} />
    <Line x1={10} y1={18.5} x2={14} y2={18.5} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Rect x={9} y={6} width={6} height={1.6} rx={0.8} fill={color} />
  </Svg>
);

const FolderGridIcon = ({ color, size = 40 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
      stroke={color}
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
    <Rect x={7} y={11} width={3.2} height={3.2} rx={0.8} fill={color} opacity={0.85} />
    <Rect x={13} y={11} width={3.2} height={3.2} rx={0.8} fill={color} opacity={0.5} />
  </Svg>
);

const TrophyIcon = ({ color, size = 40 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    <Path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Line x1={12} y1={13} x2={12} y2={17} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Path d="M8.5 20h7M9.5 20l.5-3h4l.5 3" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
  </Svg>
);

const ShieldCheckIcon = ({ color, size = 40 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    <Path d="M9 12l2 2 4-4" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

const CardChipIcon = ({ color, size = 22 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x={3} y={6} width={18} height={12} rx={2.5} stroke={color} strokeWidth={1.5} />
    <Line x1={3} y1={10} x2={21} y2={10} stroke={color} strokeWidth={1.5} />
  </Svg>
);

const renderSlideIcon = (kind: IconKind, color: string) => {
  if (kind === 'smartphone') return <SmartphoneIcon color={color} size={48} />;
  if (kind === 'folder') return <FolderGridIcon color={color} size={48} />;
  return <TrophyIcon color={color} size={48} />;
};

// =============================================================================
// 3. Inline feed injection helpers (pure, testable)
// =============================================================================
export type FeedRow<T> =
  | { kind: 'txn'; key: string; item: T }
  | { kind: 'vendorFix'; key: string };

/**
 * THE 24-HOUR EXPIRATION FILTER. True only while the user is within their first
 * day since onboarding completed. Outside the window (or if unknown), false —
 * the widget injector is skipped entirely to keep the ledger clean.
 */
export const shouldShowVendorFix = (
  userOnboardedAt?: number | null,
  now: number = Date.now(),
): boolean => {
  if (!userOnboardedAt) return false;
  const elapsed = now - userOnboardedAt;
  return elapsed >= 0 && elapsed < ONE_DAY_MS;
};

/**
 * Build a FlatList data array of transaction rows with the "Top 30-Day Vendor
 * Fix" widget injected once, after `afterIndex`, ONLY when inside the 24-hour
 * window. Pure function — drive your FlatList from its output.
 */
export function buildFeedWithWidgets<T extends { id?: string }>(
  items: T[],
  opts: {
    userOnboardedAt?: number | null;
    now?: number;
    afterIndex?: number;
    keyOf?: (item: T, index: number) => string;
  },
): FeedRow<T>[] {
  const { userOnboardedAt, now = Date.now(), afterIndex = 3, keyOf } = opts;
  const rows: FeedRow<T>[] = items.map((item, i) => ({
    kind: 'txn',
    key: keyOf ? keyOf(item, i) : item.id ?? `txn-${i}`,
    item,
  }));
  if (items.length > 0 && shouldShowVendorFix(userOnboardedAt, now)) {
    const at = Math.min(Math.max(afterIndex, 0), rows.length);
    rows.splice(at, 0, { kind: 'vendorFix', key: 'widget-vendor-fix' });
  }
  return rows;
}

// =============================================================================
// 1. OnboardingDeck — 4-page deck (3 info slides + registration handshake)
// =============================================================================
export default function OnboardingDeck({
  navigation,
  accountFilterRoute = 'AccountFilter',
}: {
  navigation?: Nav;
  accountFilterRoute?: string;
}) {
  const theme = useTheme() as Theme;
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => deckStyles(theme), [theme]);

  const setUserName = useEPurseStore((s: any) => s.setUserName);
  const setUserPhones = useEPurseStore((s: any) => s.setUserPhones);
  const setHasOnboarded = useEPurseStore((s: any) => s.setHasOnboarded);
  const setUserOnboardedAt = useEPurseStore((s: any) => s.setUserOnboardedAt);
  const setSmsPermissionGranted = useEPurseStore((s: any) => s.setSmsPermissionGranted);
  // Inbox-sweep dependencies (one-time onboarding back-fill).
  const ingestMessage = useEPurseStore((s: any) => s.ingestMessage);
  const setLastSmsSync = useEPurseStore((s: any) => s.setLastSmsSync);
  const setLastSmsDate = useEPurseStore((s: any) => s.setLastSmsDate);
  const compactTransactions = useEPurseStore((s: any) => s.compactTransactions);
  const capOnboardingQueue = useEPurseStore((s: any) => s.capOnboardingQueue);

  const scrollRef = useRef<ScrollView>(null);
  const [width, setWidth] = useState(WINDOW_W);
  const [page, setPage] = useState(0);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sweepLabel, setSweepLabel] = useState<string | null>(null);

  const totalPages = SLIDES.length + 1; // info slides + registration
  const registrationIndex = SLIDES.length;

  const nameValid = isValidName(name);
  const phoneValid = isValidPhone(phone);
  const formValid = nameValid && phoneValid;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
  }, [width]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
      if (next !== page) setPage(next);
    },
    [page, width],
  );

  const goToPage = useCallback(
    (idx: number) => {
      scrollRef.current?.scrollTo({ x: idx * width, animated: true });
      setPage(idx);
    },
    [width],
  );

  const goNext = useCallback(() => {
    if (page < registrationIndex) goToPage(page + 1);
  }, [page, registrationIndex, goToPage]);

  const navAfter = useCallback(
    (route: string) => {
      if (navigation?.replace) navigation.replace(route);
      else navigation?.navigate?.(route);
    },
    [navigation],
  );

  const handleGetStarted = useCallback(async () => {
    if (!formValid || submitting) return;
    Keyboard.dismiss();
    setSubmitting(true);
    try {
      setUserName?.(name.trim());
      setUserPhones?.([phone]);
      // Capture the absolute onboarding timestamp — drives the 24h widget rule.
      setUserOnboardedAt?.(Date.now());

      // Trigger the native SMS permission sheet (Android). On other platforms
      // there's nothing to request, so we proceed straight through.
      if (smsSupported) {
        try {
          const res = await requestSmsPermission();
          if (res?.granted) {
            setSmsPermissionGranted?.(true);
            // Back-fill 3 months of accounts/transactions so the next screen
            // ("Is this yours?") has the discovered cards to confirm.
            await runInitialInboxSweep(
              { ingestMessage, setLastSmsDate, setLastSmsSync, compactTransactions, capOnboardingQueue },
              (p) => setSweepLabel(p.label),
            );
          }
        } catch {
          /* permission denied / dismissed — continue; user can grant later */
        }
      }

      // Ask for the remaining runtime permissions up-front while the user is in
      // the "grant access" mindset, so the app is fully wired on first launch:
      //   • Location — lets live incoming SMS stamp each transaction with where
      //     it happened (getLocationIfGranted, never prompts later).
      //   • Contacts — powers the split-with / Lent-Borrowed people picker.
      // Each is isolated so denying one never blocks the others, and a denial
      // is non-fatal — the matching feature simply stays dormant until granted.
      try { await requestLocationPermission(); } catch { /* optional */ }
      try { await requestContactsPermission(); } catch { /* optional */ }
      //   • Notifications — budget breaches, mid-month nudges, CC-bill-due and
      //     subscription-hike alerts all silently no-op without this grant, so we
      //     ask up-front rather than lazily on the first borrow reminder.
      try { await requestNotificationPermissions(); } catch { /* optional */ }

      setHasOnboarded?.(true);
      navAfter(accountFilterRoute);
    } finally {
      setSweepLabel(null);
      setSubmitting(false);
    }
  }, [
    formValid, submitting, name, phone, setUserName, setUserPhones,
    setUserOnboardedAt, setSmsPermissionGranted, setHasOnboarded,
    ingestMessage, setLastSmsDate, setLastSmsSync, compactTransactions,
    capOnboardingQueue, navAfter, accountFilterRoute,
  ]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      {/* Onboarding sits on a light background → dark status-bar glyphs. */}
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      {/* Skip — muted, top-right; accelerates to the registration page */}
      {page < registrationIndex && (
        <Pressable
          style={styles.skipBtn}
          hitSlop={12}
          onPress={() => goToPage(registrationIndex)}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}
          onLayout={onLayout}
          style={styles.flex}
        >
          {/* Info slides */}
          {SLIDES.map((slide) => (
            <View key={slide.key} style={[styles.page, { width }]}>
              <View style={styles.slideInner}>
                <View style={[styles.iconHalo, { backgroundColor: theme.primary + '14' }]}>
                  <View style={[styles.iconRing, { borderColor: theme.primary + '26' }]}>
                    {renderSlideIcon(slide.icon, theme.primary)}
                  </View>
                </View>
                <Text style={styles.slideTitle}>{slide.title}</Text>
                <Text style={styles.slideBody}>{slide.body}</Text>
              </View>
            </View>
          ))}

          {/* Registration / secure handshake */}
          <View style={[styles.page, { width }]}>
            <ScrollView
              contentContainerStyle={styles.regScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.iconHalo, styles.regIcon, { backgroundColor: theme.primary + '14' }]}>
                <ShieldCheckIcon color={theme.primary} size={44} />
              </View>
              <Text style={styles.regTitle}>Let&apos;s get you set up.</Text>
              <Text style={styles.regSub}>
                Two quick details and we&apos;ll securely connect your device logs.
              </Text>

              <Text style={styles.label}>Full name</Text>
              <TextInput
                style={[styles.input, name.length > 0 && !nameValid && styles.inputError]}
                placeholder="e.g. Praveen Verma"
                placeholderTextColor={theme.textSecondary}
                value={name}
                onChangeText={(t) => setName(sanitizeName(t))}
                autoCapitalize="words"
                returnKeyType="next"
                maxLength={INPUT_LIMITS.NAME_MAX}
              />

              <Text style={styles.label}>Mobile number</Text>
              <View style={[styles.phoneWrap, phone.length > 0 && !phoneValid && styles.inputError]}>
                <Text style={styles.phonePrefix}>+91</Text>
                <View style={styles.phoneDivider} />
                <TextInput
                  style={styles.phoneInput}
                  placeholder="10-digit number"
                  placeholderTextColor={theme.textSecondary}
                  value={phone}
                  onChangeText={(t) => setPhone(sanitizePhone(t))}
                  keyboardType="number-pad"
                  maxLength={INPUT_LIMITS.PHONE_LEN}
                  returnKeyType="done"
                />
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: formValid ? theme.primary : theme.divider },
                  pressed && formValid && styles.primaryBtnPressed,
                ]}
                disabled={!formValid || submitting}
                onPress={handleGetStarted}
                accessibilityRole="button"
                accessibilityLabel="Get started"
              >
                {submitting ? (
                  <View style={styles.btnLoadingRow}>
                    <ActivityIndicator color="#FFFFFF" />
                    {sweepLabel ? <Text style={styles.btnLoadingText}>{sweepLabel}</Text> : null}
                  </View>
                ) : (
                  <Text style={[styles.primaryBtnText, !formValid && { color: theme.textSecondary }]}>
                    Get Started
                  </Text>
                )}
              </Pressable>

              <Text style={styles.regFinePrint}>
                We&apos;ll request SMS access to read bank alerts on-device. Nothing leaves your phone.
              </Text>
            </ScrollView>
          </View>
        </ScrollView>

        {/* Bottom dot pagination + Next on info slides */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <View style={styles.dots}>
            {Array.from({ length: totalPages }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i === page
                    ? [styles.dotActive, { backgroundColor: theme.primary }]
                    : { backgroundColor: theme.divider },
                ]}
              />
            ))}
          </View>
          {page < registrationIndex ? (
            <Pressable style={styles.nextBtn} onPress={goNext} hitSlop={8}>
              <Text style={[styles.nextText, { color: theme.primary }]}>Next</Text>
            </Pressable>
          ) : (
            <View style={styles.nextBtnPlaceholder} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// =============================================================================
// 2. AccountFilterScreen — "Is this yours?" pre-home gate
// =============================================================================
export function AccountFilterScreen({
  navigation,
  homeRoute = 'Main',
}: {
  navigation?: Nav;
  homeRoute?: string;
}) {
  const theme = useTheme() as Theme;
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => filterStyles(theme), [theme]);

  const accounts: Account[] = useEPurseStore((s: any) => s.accounts) || [];
  const deleteAccount = useEPurseStore((s: any) => s.deleteAccount);
  const setAccountType = useEPurseStore((s: any) => s.setAccountType);

  // Debit-card↔bank merge suggestions surfaced from the just-completed sweep.
  const linkSuggestions = useEPurseStore(selectAccountLinkSuggestions) as Array<{
    cardId: string; cardMask: string; bankId: string; bankMask: string; bankName: string;
  }>;
  const linkDebitCardToBank = useEPurseStore((s: any) => s.linkDebitCardToBank);
  const dismissAccountLinkSuggestion = useEPurseStore((s: any) => s.dismissAccountLinkSuggestion);

  // Local enable map — default every discovered account ON.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const isOn = useCallback((id: string) => enabled[id] ?? true, [enabled]);
  const toggle = useCallback(
    (id: string) => setEnabled((prev) => ({ ...prev, [id]: !(prev[id] ?? true) })),
    [],
  );

  const navAfter = useCallback(
    (route: string) => {
      if (navigation?.replace) navigation.replace(route);
      else navigation?.navigate?.(route);
    },
    [navigation],
  );

  const finalize = useCallback(() => {
    // Drop any account the user toggled off — it isn't theirs.
    accounts.forEach((a) => {
      if (!isOn(a.id)) deleteAccount?.(a.id);
    });
    navAfter(homeRoute);
  }, [accounts, isOn, deleteAccount, navAfter, homeRoute]);

  const maskLabel = useCallback((a: Account) => {
    const head = a.bankName || a.name || a.type || 'Account';
    const tail = a.mask ? `•••• ${a.mask}` : '';
    return tail ? `${head}  ${tail}` : head;
  }, []);

  const empty = accounts.length === 0;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: theme.primary + '14' }]}>
          <CardChipIcon color={theme.primary} size={24} />
        </View>
        <Text style={styles.title}>Is this yours?</Text>
        <Text style={styles.subtitle}>
          We detected these cards on your device. Toggle off any that do not belong to you to
          finalize your workspace.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {empty ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={theme.primary} />
            <Text style={styles.emptyText}>
              Scanning your recent bank messages… accounts will appear here as we find them.
            </Text>
          </View>
        ) : (
          accounts.map((a) => {
            const on = isOn(a.id);
            const isCard =
              a.type === ACCOUNT_TYPES.DEBIT_CARD || a.type === ACCOUNT_TYPES.CREDIT_CARD;
            return (
              <View
                key={a.id}
                style={[styles.row, !on && styles.rowOff]}
              >
                <View style={styles.rowTop}>
                  <View
                    style={[
                      styles.rowDot,
                      { backgroundColor: on ? (a.color || theme.primary) : theme.divider },
                    ]}
                  />
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, !on && styles.rowTitleOff]} numberOfLines={1}>
                      {maskLabel(a)}
                    </Text>
                    <Text style={styles.rowType}>{a.type}</Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={() => toggle(a.id)}
                    trackColor={{ false: theme.divider, true: theme.primary }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor={theme.divider}
                  />
                </View>

                {/* Card type can be misread from the SMS (a credit card that omits the
                    word "credit" reads as a debit card). Let the user correct it here. */}
                {isCard && on ? (
                  <View style={styles.typeToggleRow}>
                    <Text style={styles.typeToggleLabel}>Card type</Text>
                    <View style={styles.segment}>
                      {[
                        { key: ACCOUNT_TYPES.DEBIT_CARD, label: 'Debit' },
                        { key: ACCOUNT_TYPES.CREDIT_CARD, label: 'Credit' },
                      ].map((opt) => {
                        const active = a.type === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            onPress={() => { if (!active) setAccountType?.(a.id, opt.key); }}
                            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                          >
                            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                              {opt.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        {/* Same-account merge suggestions — a debit card + the bank it draws from */}
        {linkSuggestions.length > 0 ? (
          <View style={styles.mergeBlock}>
            <Text style={styles.mergeHeading}>Looks like the same account</Text>
            {linkSuggestions.map((sug) => (
              <View key={`${sug.cardMask}:${sug.bankMask}`} style={styles.mergeCard}>
                <Text style={styles.mergeBody}>
                  Your debit card{' '}
                  <Text style={styles.mergeStrong}>••{sug.cardMask}</Text> and{' '}
                  <Text style={styles.mergeStrong}>{sug.bankName} ••{sug.bankMask}</Text> appear to be
                  the same account. Link them so the balance isn&apos;t counted twice?
                </Text>
                <View style={styles.mergeActions}>
                  <Pressable
                    style={({ pressed }) => [styles.mergeLink, { backgroundColor: theme.primary }, pressed && styles.primaryBtnPressed]}
                    onPress={() => linkDebitCardToBank(sug.cardId, sug.bankId)}
                  >
                    <Text style={styles.mergeLinkTxt}>Yes, link</Text>
                  </Pressable>
                  <Pressable
                    style={styles.mergeKeep}
                    onPress={() => dismissAccountLinkSuggestion(sug.cardMask, sug.bankMask)}
                  >
                    <Text style={styles.mergeKeepTxt}>Keep separate</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: theme.primary },
            pressed && styles.primaryBtnPressed,
          ]}
          onPress={finalize}
          accessibilityRole="button"
          accessibilityLabel="Finalize workspace"
        >
          <Text style={styles.primaryBtnText}>
            {empty ? 'Continue' : 'Finalize Workspace'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

// =============================================================================
// 3. TopVendorFixCard — Myntra-style inline feed widget
// =============================================================================
export function TopVendorFixCard({
  vendors,
  onFix,
  onDismiss,
}: {
  vendors: VendorFix[];
  onFix?: (vendor: VendorFix) => void;
  onDismiss?: () => void;
}) {
  const theme = useTheme() as Theme;
  const styles = useMemo(() => vendorStyles(theme), [theme]);

  if (!vendors || vendors.length === 0) return null;

  const money = (n: number) =>
    `₹${Math.round(n).toLocaleString('en-IN')}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.badge, { backgroundColor: theme.primary + '1A' }]}>
            <Text style={[styles.badgeText, { color: theme.primary }]}>NEW</Text>
          </View>
          <Text style={styles.heading}>Top 30-Day Vendor Fix</Text>
        </View>
        {onDismiss && (
          <Pressable hitSlop={10} onPress={onDismiss} accessibilityLabel="Dismiss vendor fix">
            <Text style={styles.dismiss}>✕</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.subheading}>
        Tap to categorize your most frequent merchants in one go.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {vendors.map((v) => (
          <View key={v.id} style={styles.chip}>
            <View style={[styles.chipAvatar, { backgroundColor: theme.primary + '14' }]}>
              <Text style={[styles.chipAvatarText, { color: theme.primary }]}>
                {v.vendor.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.chipVendor} numberOfLines={1}>{v.vendor}</Text>
            <Text style={styles.chipMeta}>
              {money(v.amount)} · {v.count}x
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.chipBtn,
                { backgroundColor: theme.primary },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => onFix?.(v)}
            >
              <Text style={styles.chipBtnText}>
                {v.suggestedCategory ? `→ ${v.suggestedCategory}` : 'Categorize'}
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * Example FlatList wiring that injects the vendor-fix widget per the 24h rule.
 * Drop-in for the Home feed; `renderTransaction` renders your existing row.
 */
export function InlineTransactionsFeed<T extends { id?: string }>({
  transactions,
  renderTransaction,
  vendors,
  userOnboardedAt,
  afterIndex = 3,
  onFixVendor,
  ListHeaderComponent,
  contentContainerStyle,
}: {
  transactions: T[];
  renderTransaction: (item: T, index: number) => React.ReactElement | null;
  vendors: VendorFix[];
  userOnboardedAt?: number | null;
  afterIndex?: number;
  onFixVendor?: (vendor: VendorFix) => void;
  ListHeaderComponent?: React.ComponentType | React.ReactElement | null;
  contentContainerStyle?: object;
}) {
  const [dismissed, setDismissed] = useState(false);

  const rows = useMemo(
    () =>
      buildFeedWithWidgets(transactions, { userOnboardedAt, afterIndex }).filter(
        (r) => !(dismissed && r.kind === 'vendorFix'),
      ),
    [transactions, userOnboardedAt, afterIndex, dismissed],
  );

  // Lightweight, dependency-free list (avoids importing FlatList generics noise).
  return (
    <ScrollView
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
    >
      {ListHeaderComponent
        ? React.isValidElement(ListHeaderComponent)
          ? ListHeaderComponent
          : React.createElement(ListHeaderComponent as React.ComponentType)
        : null}
      {rows.map((row, i) =>
        row.kind === 'vendorFix' ? (
          <TopVendorFixCard
            key={row.key}
            vendors={vendors}
            onFix={onFixVendor}
            onDismiss={() => setDismissed(true)}
          />
        ) : (
          <View key={row.key}>{renderTransaction(row.item, i)}</View>
        ),
      )}
    </ScrollView>
  );
}

// =============================================================================
// 4. Anchor-balance toast + modal + first-visit hook
// =============================================================================

/** An account is anchored once it has a live-balance anchor timestamp. */
export const isAccountAnchored = (account?: Account | null): boolean =>
  !!(account && (account.isAnchored || account.anchoredAt));

/**
 * First-visit anchoring controller for an account ledger screen.
 * Shows the toast while the account is unanchored; opens the modal; commits the
 * anchor via the real `setAccountAnchor` store action.
 */
export function useAnchorToast(account?: Account | null) {
  const setAccountAnchor = useEPurseStore((s: any) => s.setAccountAnchor);
  const [dismissed, setDismissed] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const anchored = isAccountAnchored(account);
  const showToast = !anchored && !dismissed;

  const openModal = useCallback(() => setModalVisible(true), []);
  const closeModal = useCallback(() => setModalVisible(false), []);
  const dismissToast = useCallback(() => setDismissed(true), []);

  const commitAnchor = useCallback(
    (amount: number) => {
      if (account?.id) setAccountAnchor?.(account.id, amount);
      setModalVisible(false);
      setDismissed(true);
    },
    [account, setAccountAnchor],
  );

  return { showToast, modalVisible, openModal, closeModal, dismissToast, commitAnchor };
}

export function AnchorBalanceToast({
  onPressAnchor,
  onDismiss,
  position = 'bottom',
}: {
  onPressAnchor: () => void;
  onDismiss?: () => void;
  position?: 'top' | 'bottom';
}) {
  const theme = useTheme() as Theme;
  const styles = useMemo(() => toastStyles(theme), [theme]);

  return (
    <View style={[styles.toast, position === 'top' ? styles.toastTop : styles.toastBottom]}>
      <Text style={styles.toastText}>
        💳 Tweak and anchor your official live balance to optimize active budget metrics.{' '}
        <Text style={styles.toastAction} onPress={onPressAnchor}>
          Anchor balance
        </Text>
      </Text>
      {onDismiss && (
        <Pressable hitSlop={10} onPress={onDismiss} accessibilityLabel="Dismiss">
          <Text style={styles.toastClose}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

export function BalanceAnchorModal({
  visible,
  accountLabel,
  initialValue,
  onCancel,
  onSave,
}: {
  visible: boolean;
  accountLabel?: string;
  initialValue?: number;
  onCancel: () => void;
  onSave: (amount: number) => void;
}) {
  const theme = useTheme() as Theme;
  const styles = useMemo(() => modalStyles(theme), [theme]);
  const [value, setValue] = useState(
    initialValue != null ? String(Math.round(initialValue)) : '',
  );

  const amount = parseFloat(value.replace(/,/g, ''));
  const valid = !Number.isNaN(amount) && amount >= 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.title}>Anchor live balance</Text>
          {!!accountLabel && <Text style={styles.label}>{accountLabel}</Text>}
          <Text style={styles.help}>
            Enter the balance shown in your bank app right now. We&apos;ll keep it in sync from here.
          </Text>

          <View style={styles.amountRow}>
            <Text style={styles.currency}>₹</Text>
            <TextInput
              style={styles.amountInput}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              value={value}
              onChangeText={(t) => setValue(sanitizeAmount(t))}
              keyboardType="decimal-pad"
              maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
              autoFocus
            />
          </View>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel}>
              <Text style={[styles.btnText, { color: theme.textSecondary }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: valid ? theme.primary : theme.divider }]}
              disabled={!valid}
              onPress={() => valid && onSave(amount)}
            >
              {/* Mute text when disabled — white on the light `divider` fill is
                  unreadable; textSecondary keeps the disabled state legible in
                  both light and dark themes. */}
              <Text style={[styles.btnText, { color: valid ? '#FFFFFF' : theme.textSecondary }]}>Anchor</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Convenience: mount this near the top/bottom of an account ledger screen. It
 * wires the toast + modal + store anchor in one drop-in component.
 *
 *   <AccountAnchorBanner account={account} position="bottom" />
 */
export function AccountAnchorBanner({
  account,
  position = 'bottom',
}: {
  account?: Account | null;
  position?: 'top' | 'bottom';
}) {
  const { showToast, modalVisible, openModal, closeModal, dismissToast, commitAnchor } =
    useAnchorToast(account);

  if (!showToast && !modalVisible) return null;

  const label = account
    ? `${account.bankName || account.name || account.type}${account.mask ? `  •••• ${account.mask}` : ''}`
    : undefined;

  return (
    <>
      {showToast && (
        <AnchorBalanceToast
          position={position}
          onPressAnchor={openModal}
          onDismiss={dismissToast}
        />
      )}
      <BalanceAnchorModal
        visible={modalVisible}
        accountLabel={label}
        initialValue={account?.balance}
        onCancel={closeModal}
        onSave={commitAnchor}
      />
    </>
  );
}

// =============================================================================
// Styles — theme-driven factories (all embedded, responsive)
// =============================================================================
const deckStyles = (t: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    screen: { flex: 1 },
    skipBtn: { position: 'absolute', top: spacing.md, right: spacing.xl, zIndex: 10, padding: spacing.sm },
    skipText: { fontSize: 14, fontWeight: '600', color: t.textSecondary },
    page: { flex: 1 },
    slideInner: {
      flex: 1,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconHalo: {
      width: 132,
      height: 132,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xxl,
    },
    iconRing: {
      width: 92,
      height: 92,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slideTitle: {
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.4,
      color: t.textPrimary,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    slideBody: {
      fontSize: 15,
      lineHeight: 22,
      color: t.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing.sm,
    },
    regScroll: { paddingHorizontal: 24, paddingTop: spacing.xxl, paddingBottom: spacing.xl, alignItems: 'stretch' },
    regIcon: { alignSelf: 'center', width: 96, height: 96, marginBottom: spacing.xl },
    regTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, color: t.textPrimary, textAlign: 'center' },
    regSub: { fontSize: 14, lineHeight: 20, color: t.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.xl },
    label: { fontSize: 13, fontWeight: '600', color: t.textSecondary, marginBottom: spacing.sm, marginTop: spacing.md },
    input: {
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: Platform.OS === 'ios' ? 14 : 10,
      fontSize: 16,
      color: t.textPrimary,
      backgroundColor: t.card,
    },
    inputError: { borderColor: t.danger },
    phoneWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      backgroundColor: t.card,
      paddingHorizontal: spacing.lg,
    },
    phonePrefix: { fontSize: 16, fontWeight: '600', color: t.textPrimary },
    phoneDivider: { width: 1, height: 22, backgroundColor: t.divider, marginHorizontal: spacing.md },
    phoneInput: { flex: 1, fontSize: 16, color: t.textPrimary, paddingVertical: Platform.OS === 'ios' ? 14 : 10 },
    primaryBtn: {
      borderRadius: radius.md,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xl,
      minHeight: 52,
    },
    primaryBtnPressed: { opacity: 0.9 },
    primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
    btnLoadingRow: { flexDirection: 'row', alignItems: 'center' },
    btnLoadingText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginLeft: spacing.md },
    regFinePrint: { fontSize: 12, lineHeight: 17, color: t.textSecondary, textAlign: 'center', marginTop: spacing.lg },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingTop: spacing.md,
    },
    dots: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 7, height: 7, borderRadius: radius.pill, marginRight: spacing.sm },
    dotActive: { width: 22 },
    nextBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    nextBtnPlaceholder: { width: 44, height: 20 },
    nextText: { fontSize: 16, fontWeight: '700' },
  });

const filterStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1 },
    header: { paddingHorizontal: 24, paddingTop: spacing.xl, paddingBottom: spacing.lg },
    headerIcon: {
      width: 48, height: 48, borderRadius: radius.md,
      alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
    },
    title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4, color: t.textPrimary },
    subtitle: { fontSize: 14, lineHeight: 21, color: t.textSecondary, marginTop: spacing.sm },
    listContent: { paddingHorizontal: 24, paddingBottom: spacing.xl },
    emptyState: { alignItems: 'center', paddingVertical: spacing.xxl * 2 },
    emptyText: { fontSize: 14, lineHeight: 20, color: t.textSecondary, textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg },
    row: {
      backgroundColor: t.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.divider,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    rowTop: { flexDirection: 'row', alignItems: 'center' },
    rowOff: { opacity: 0.55 },
    rowDot: { width: 10, height: 10, borderRadius: radius.pill, marginRight: spacing.md },
    rowText: { flex: 1, marginRight: spacing.md },
    rowTitle: { fontSize: 15, fontWeight: '600', color: t.textPrimary },
    rowTitleOff: { textDecorationLine: 'line-through' },
    rowType: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
    typeToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: t.divider,
    },
    typeToggleLabel: { fontSize: 13, color: t.textSecondary },
    segment: {
      flexDirection: 'row',
      backgroundColor: t.background,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: t.divider,
      padding: 2,
    },
    segmentBtn: {
      paddingVertical: 6,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
    },
    segmentBtnActive: { backgroundColor: t.primary },
    segmentText: { fontSize: 13, fontWeight: '600', color: t.textSecondary },
    segmentTextActive: { color: '#FFFFFF' },
    footer: { paddingHorizontal: 24, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: t.divider },
    primaryBtn: { borderRadius: radius.md, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 52 },
    primaryBtnPressed: { opacity: 0.9 },
    primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

    // Debit-card↔bank merge suggestions
    mergeBlock: { marginTop: spacing.lg },
    mergeHeading: { fontSize: 13, fontWeight: '700', color: t.textSecondary, marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
    mergeCard: {
      backgroundColor: t.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.divider,
      padding: spacing.md,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    mergeBody: { fontSize: 13, lineHeight: 19, color: t.textSecondary },
    mergeStrong: { color: t.textPrimary, fontWeight: '700' },
    mergeActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    mergeLink: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3, borderRadius: radius.pill },
    mergeLinkTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    mergeKeep: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 3, borderRadius: radius.pill, borderWidth: 1, borderColor: t.divider },
    mergeKeepTxt: { color: t.textSecondary, fontSize: 13, fontWeight: '700' },
  });

const vendorStyles = (t: Theme) =>
  StyleSheet.create({
    wrap: {
      backgroundColor: t.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.divider,
      paddingVertical: spacing.lg,
      marginVertical: spacing.sm,
      marginHorizontal: spacing.lg,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center' },
    badge: { borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, marginRight: spacing.sm },
    badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    heading: { fontSize: 16, fontWeight: '700', color: t.textPrimary },
    dismiss: { fontSize: 15, color: t.textSecondary, paddingHorizontal: spacing.xs },
    subheading: { fontSize: 13, color: t.textSecondary, paddingHorizontal: spacing.lg, marginTop: 2, marginBottom: spacing.md },
    scroller: { paddingHorizontal: spacing.lg, paddingRight: spacing.sm },
    chip: {
      width: 140,
      backgroundColor: t.cardAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.divider,
      padding: spacing.md,
      marginRight: spacing.md,
    },
    chipAvatar: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
    chipAvatarText: { fontSize: 16, fontWeight: '800' },
    chipVendor: { fontSize: 14, fontWeight: '700', color: t.textPrimary },
    chipMeta: { fontSize: 12, color: t.textSecondary, marginTop: 2, marginBottom: spacing.md },
    chipBtn: { borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
    chipBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  });

const toastStyles = (t: Theme) =>
  StyleSheet.create({
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.textPrimary,
      borderRadius: radius.md,
      marginHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
      elevation: 6,
    },
    toastTop: { marginTop: spacing.md },
    toastBottom: { marginBottom: spacing.md },
    toastText: { flex: 1, fontSize: 13, lineHeight: 19, color: t.background },
    // The toast pill is filled with `textPrimary` (inverted snackbar), so the
    // action link must contrast THAT. `background` is the pill's body-text colour
    // — guaranteed readable across all 4 accents and light/dark. Bold + underline
    // signals it's pressable without relying on an accent hue that may wash out
    // (e.g. the amber theme's pale primaryLight on a near-white dark-mode pill).
    toastAction: { fontWeight: '800', color: t.background, textDecorationLine: 'underline' },
    toastClose: { color: t.background, opacity: 0.7, fontSize: 14, marginLeft: spacing.md },
  });

const modalStyles = (t: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    sheet: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: t.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.2,
      shadowRadius: 24,
      elevation: 12,
    },
    title: { fontSize: 18, fontWeight: '800', color: t.textPrimary },
    label: { fontSize: 13, fontWeight: '600', color: t.textSecondary, marginTop: spacing.xs },
    help: { fontSize: 13, lineHeight: 19, color: t.textSecondary, marginTop: spacing.md },
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.divider,
      borderRadius: radius.md,
      backgroundColor: t.cardAlt,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.lg,
    },
    currency: { fontSize: 22, fontWeight: '700', color: t.textPrimary, marginRight: spacing.sm },
    amountInput: { flex: 1, fontSize: 22, fontWeight: '700', color: t.textPrimary, paddingVertical: spacing.md },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xl },
    btn: { borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, marginLeft: spacing.md, minWidth: 96, alignItems: 'center' },
    btnGhost: { backgroundColor: 'transparent' },
    btnText: { fontSize: 15, fontWeight: '700' },
  });
