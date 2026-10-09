// =============================================================================
// OnboardingExperience.tsx
// -----------------------------------------------------------------------------
// A single, self-contained module that finalizes the frictionless entry flow:
//
//   1. OnboardingDeck          — 4-page slide deck (3 info slides + registration)
//   2. AccountFilterScreen     — "Is this yours?" gate after SMS account discovery
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
// Uses EXISTING store actions: setUserName, setHasOnboarded,
// setSmsPermissionGranted, setAccountAnchor, deleteAccount.
//
// Also reads `isLoggedIn` (set via useGoogleSession/setGoogleAccount) — the
// registration page embeds a compact GoogleSignInPanel alongside the name
// field, and "Get Started" stays disabled until sign-in completes. The phone
// number is no longer collected here; it's added later from MyProfileScreen.
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  LayoutChangeEvent,
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
import KeyboardAvoidingView from '../components/AppKeyboardAvoidingView';
import Modal from "../components/AppModal";
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { useTheme } from '../hooks/useTheme';
import { spacing, radius, BUTTON_H } from '../constants/theme';
import { useEPurseStore, selectAccountLinkSuggestions } from '../store/ePurseStore';
import GoogleSignInPanel from '../components/GoogleSignInPanel';
import EPurseBrandLockup, { EPurseInlineWordmark } from '../components/EPurseBrandLockup';
import CenterModal from '../components/CenterModal';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_EMOJI, ACCOUNT_TYPE_LABEL } from '../constants/categories';
import { requestSmsPermission, smsSupported } from '../services/smsService';
import { requestLocationPermission } from '../services/locationService';
import { requestContactsPermission } from '../services/contactsService';
import { requestNotificationPermissions } from '../utils/notifications';
import { runInitialInboxSweep } from '../utils/inboxSweep';
import { shouldShowAccountConfirmation } from '../utils/onboardingRouting';
import { INPUT_LIMITS, sanitizeName, isValidName, sanitizeAmount } from '../utils/validation';

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
  disabledBackground: string;
  disabledText: string;
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
  dueDay?: number | null;
  statementDay?: number | null;
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
const WINDOW_H = Dimensions.get('window').height;

const CONFIRM_ACCOUNT_TYPES = [
  ACCOUNT_TYPES.BANK,
  ACCOUNT_TYPES.DEBIT_CARD,
  ACCOUNT_TYPES.CREDIT_CARD,
  ACCOUNT_TYPES.WALLET,
];

const ordinalDay = (day?: number | null) => {
  if (!day) return null;
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
};

type IconKind = 'smartphone' | 'folder' | 'group';

interface Slide {
  key: string;
  icon: IconKind;
  eyebrow: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    key: 'tracking',
    icon: 'smartphone',
    eyebrow: 'CAPTURE → REVIEW',
    title: 'Know where it goes.',
    body: 'Turn supported bank messages into a clear ledger\non your device, then review every detail\nbefore relying on it.',
  },
  {
    key: 'strategy',
    icon: 'folder',
    eyebrow: 'UNDERSTAND → PLAN',
    title: 'Plan with perspective.',
    body: 'See spending patterns, build category budgets and\ngive every savings goal a place in your\nmonthly plan.',
  },
  {
    key: 'shared',
    icon: 'group',
    eyebrow: 'SHARE → SETTLE',
    title: 'Shared costs. Private records.',
    body: 'Organize groups, splits, lending and borrowing without turning your financial history into a shared\ncloud ledger.',
  },
];

const AUTO_SWIPE_MS = 3100;
const AUTO_TRANSITION_MS = 1250;

/**
 * Play's "prominent disclosure" requirement, in one place: WHAT is accessed
 * and WHY, shown before the matching OS permission dialog — see the
 * `handleGetStarted` / `proceedFromDisclosure` split below. `smsSupported` is
 * a plain module-level constant (`Platform.OS === 'android'`), so this can be
 * built once rather than re-computed per render.
 */
const DISCLOSURE_MESSAGE = [
  smsSupported
    ? '• SMS — reads bank and card messages ON THIS DEVICE to detect transactions automatically. Message text is processed on-device; it is never uploaded as raw text.'
    : null,
  '• Contacts — lets you pick people when splitting an expense or tracking money lent/borrowed.',
  '• Location — tags a transaction with the city it happened in, from your device\'s approximate location.',
  '\nEach is optional — skip any of them here or later and grant it from Settings whenever you\'re ready.',
].filter(Boolean).join('\n\n');

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

const GroupIcon = ({ color, size = 40 }: { color: string; size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx={9} cy={8} r={3} stroke={color} strokeWidth={1.6} />
    <Circle cx={17} cy={9} r={2.3} stroke={color} strokeWidth={1.6} />
    <Path d="M3.5 19c.4-3.3 2.4-5 5.5-5s5.1 1.7 5.5 5" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    <Path d="M14 14.5c3.5-.7 5.7.8 6.3 3.8" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
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

const renderSlideIcon = (kind: IconKind, color: string, size = 48) => {
  if (kind === 'smartphone') return <SmartphoneIcon color={color} size={size} />;
  if (kind === 'folder') return <FolderGridIcon color={color} size={size} />;
  return <GroupIcon color={color} size={size} />;
};

const PreviewBar = ({ width, color, track }: { width: `${number}%`; color: string; track: string }) => (
  <View style={[previewStyles.barTrack, { backgroundColor: track }]}>
    <View style={[previewStyles.barFill, { width, backgroundColor: color }]} />
  </View>
);

const OnboardingPreview = ({ kind, theme }: { kind: IconKind; theme: Theme }) => {
  if (kind === 'smartphone') {
    return (
      <View style={[previewStyles.shell, { backgroundColor: theme.card, borderColor: theme.divider }]}>
        <View style={previewStyles.previewTopRow}>
          <View>
            <Text style={[previewStyles.kicker, { color: theme.textSecondary }]}>SEPTEMBER</Text>
            <Text style={[previewStyles.amount, { color: theme.textPrimary }]}>₹15,717</Text>
          </View>
          <View style={[previewStyles.statusPill, { backgroundColor: theme.success + '18' }]}>
            <Text style={[previewStyles.statusText, { color: theme.success }]}>On track</Text>
          </View>
        </View>
        <View style={[previewStyles.insightCard, { backgroundColor: theme.primary + '0D' }]}>
          <Text style={[previewStyles.insightTitle, { color: theme.textPrimary }]}>Category breakdown</Text>
          <View style={previewStyles.metricRow}>
            <Text style={[previewStyles.metricLabel, { color: theme.textSecondary }]}>Travel &amp; Cabs</Text>
            <Text style={[previewStyles.metricValue, { color: theme.textPrimary }]}>₹6,440</Text>
          </View>
          <PreviewBar width="78%" color={theme.info} track={theme.info + '18'} />
          <View style={previewStyles.metricRow}>
            <Text style={[previewStyles.metricLabel, { color: theme.textSecondary }]}>Bills &amp; Utility</Text>
            <Text style={[previewStyles.metricValue, { color: theme.textPrimary }]}>₹4,769</Text>
          </View>
          <PreviewBar width="58%" color={theme.primary} track={theme.primary + '18'} />
        </View>
        <View style={[previewStyles.reviewChip, { backgroundColor: theme.background, borderColor: theme.divider }]}>
          <View style={[previewStyles.reviewDot, { backgroundColor: theme.warning }]} />
          <Text style={[previewStyles.reviewText, { color: theme.textPrimary }]}>1 transaction ready to review</Text>
        </View>
      </View>
    );
  }

  if (kind === 'folder') {
    return (
      <View style={[previewStyles.shell, { backgroundColor: theme.card, borderColor: theme.divider }]}>
        <View style={previewStyles.previewTopRow}>
          <View>
            <Text style={[previewStyles.kicker, { color: theme.textSecondary }]}>MONTHLY PLAN</Text>
            <Text style={[previewStyles.amount, { color: theme.textPrimary }]}>₹15.54k</Text>
          </View>
          <View style={[previewStyles.ring, { borderColor: theme.success }]}>
            <Text style={[previewStyles.ringValue, { color: theme.success }]}>89%</Text>
            <Text style={[previewStyles.ringLabel, { color: theme.textSecondary }]}>used</Text>
          </View>
        </View>
        <View style={[previewStyles.planSummary, { backgroundColor: theme.success + '12' }]}>
          <Text style={[previewStyles.planSummaryTitle, { color: theme.success }]}>₹1.96k remaining</Text>
          <Text style={[previewStyles.planSummaryBody, { color: theme.textSecondary }]}>₹980 available per day</Text>
        </View>
        {[
          ['Travel & Cabs', '99%', '96%'],
          ['Bills & Utility', '95%', '88%'],
          ['Food & Dining', '78%', '72%'],
        ].map(([label, value, width]) => (
          <View key={label} style={previewStyles.planRow}>
            <View style={previewStyles.metricRow}>
              <Text style={[previewStyles.metricLabel, { color: theme.textPrimary }]}>{label}</Text>
              <Text style={[previewStyles.metricValue, { color: theme.textSecondary }]}>{value}</Text>
            </View>
            <PreviewBar width={width as `${number}%`} color={theme.primary} track={theme.primary + '15'} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[previewStyles.shell, { backgroundColor: theme.card, borderColor: theme.divider }]}>
      <View style={previewStyles.previewTopRow}>
        <View>
          <Text style={[previewStyles.kicker, { color: theme.textSecondary }]}>WEEKEND TRIP</Text>
          <Text style={[previewStyles.amount, { color: theme.textPrimary }]}>₹21,480</Text>
        </View>
        <View style={previewStyles.avatarStack}>
          {['P', 'A', 'R'].map((initial, index) => (
            <View
              key={initial}
              style={[
                previewStyles.avatar,
                { backgroundColor: index === 1 ? theme.info : index === 2 ? theme.success : theme.primary, marginLeft: index ? -8 : 0 },
              ]}
            >
              <Text style={previewStyles.avatarText}>{initial}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={previewStyles.balanceRow}>
        <View style={[previewStyles.balanceCard, { backgroundColor: theme.success + '12' }]}>
          <Text style={[previewStyles.balanceLabel, { color: theme.textSecondary }]}>YOU LENT</Text>
          <Text style={[previewStyles.balanceValue, { color: theme.success }]}>₹1,770</Text>
        </View>
        <View style={[previewStyles.balanceCard, { backgroundColor: theme.danger + '10' }]}>
          <Text style={[previewStyles.balanceLabel, { color: theme.textSecondary }]}>YOU BORROWED</Text>
          <Text style={[previewStyles.balanceValue, { color: theme.danger }]}>₹0</Text>
        </View>
      </View>
      <View style={[previewStyles.groupZone, { borderColor: theme.divider }]}>
        <View>
          <Text style={[previewStyles.groupZoneTitle, { color: theme.textPrimary }]}>Group Zone</Text>
          <Text style={[previewStyles.groupZoneBody, { color: theme.textSecondary }]}>Add the next transaction automatically</Text>
        </View>
        <View style={[previewStyles.switchTrack, { backgroundColor: theme.primary + '38' }]}>
          <View style={[previewStyles.switchThumb, { backgroundColor: theme.primary }]} />
        </View>
      </View>
    </View>
  );
};

const previewStyles = StyleSheet.create({
  shell: {
    width: '100%', maxWidth: 350, minHeight: 276, borderRadius: 28, borderWidth: 1,
    padding: 20, shadowColor: '#170D32', shadowOpacity: 0.13, shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 }, elevation: 5,
  },
  previewTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  amount: { fontSize: 29, fontWeight: '900', letterSpacing: -0.8, marginTop: 3 },
  statusPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusText: { fontSize: 11, fontWeight: '800' },
  insightCard: { marginTop: 18, borderRadius: 18, padding: 14 },
  insightTitle: { fontSize: 14, fontWeight: '800', marginBottom: 7 },
  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  metricLabel: { fontSize: 11, fontWeight: '600' },
  metricValue: { fontSize: 11, fontWeight: '800' },
  barTrack: { height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 5 },
  barFill: { height: '100%', borderRadius: 999 },
  reviewChip: { marginTop: 14, minHeight: 42, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  reviewDot: { width: 8, height: 8, borderRadius: 4, marginRight: 9 },
  reviewText: { fontSize: 11, fontWeight: '700' },
  ring: { width: 66, height: 66, borderRadius: 33, borderWidth: 7, alignItems: 'center', justifyContent: 'center' },
  ringValue: { fontSize: 16, fontWeight: '900', lineHeight: 18 },
  ringLabel: { fontSize: 9, fontWeight: '700' },
  planSummary: { borderRadius: 15, paddingHorizontal: 14, paddingVertical: 10, marginTop: 14 },
  planSummaryTitle: { fontSize: 13, fontWeight: '800' },
  planSummaryBody: { fontSize: 10, marginTop: 2 },
  planRow: { marginTop: 6 },
  avatarStack: { flexDirection: 'row', paddingLeft: 16 },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  balanceRow: { flexDirection: 'row', marginTop: 20, gap: 10 },
  balanceCard: { flex: 1, borderRadius: 17, paddingHorizontal: 14, paddingVertical: 16 },
  balanceLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  balanceValue: { fontSize: 20, fontWeight: '900', marginTop: 5 },
  groupZone: { marginTop: 14, borderWidth: 1, borderRadius: 17, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupZoneTitle: { fontSize: 13, fontWeight: '800' },
  groupZoneBody: { fontSize: 9, marginTop: 2 },
  switchTrack: { width: 38, height: 22, borderRadius: 11, padding: 3, alignItems: 'flex-end' },
  switchThumb: { width: 16, height: 16, borderRadius: 8 },
});

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
  homeRoute = 'Main',
}: {
  navigation?: Nav;
  accountFilterRoute?: string;
  homeRoute?: string;
}) {
  const theme = useTheme() as Theme;
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => deckStyles(theme), [theme]);

  const setUserName = useEPurseStore((s: any) => s.setUserName);
  const setHasOnboarded = useEPurseStore((s: any) => s.setHasOnboarded);
  const isLoggedIn = useEPurseStore((s: any) => s.isLoggedIn) as boolean;
  const setUserOnboardedAt = useEPurseStore((s: any) => s.setUserOnboardedAt);
  const setSmsPermissionGranted = useEPurseStore((s: any) => s.setSmsPermissionGranted);
  // Inbox-sweep dependencies (one-time onboarding back-fill).
  const ingestMessage = useEPurseStore((s: any) => s.ingestMessage);
  const setLastSmsSync = useEPurseStore((s: any) => s.setLastSmsSync);
  const setLastSmsDate = useEPurseStore((s: any) => s.setLastSmsDate);
  const compactTransactions = useEPurseStore((s: any) => s.compactTransactions);
  const capOnboardingQueue = useEPurseStore((s: any) => s.capOnboardingQueue);

  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);
  const autoScrollValue = useRef(new Animated.Value(0)).current;
  const autoScrollAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const autoScrollListenerRef = useRef<string | null>(null);
  const [width, setWidth] = useState(WINDOW_W);
  const [page, setPage] = useState(0);

  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sweepLabel, setSweepLabel] = useState<string | null>(null);
  const [autoSwipePaused, setAutoSwipePaused] = useState(false);
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(false);
  // Play policy requires this disclosure to appear BEFORE the runtime SMS/
  // contacts/location prompts, not just somewhere in the app — see docs/
  // ANDROID_RELEASE.md §3.5. Gates the SAME permission block that used to
  // fire straight off "Get Started"; nothing about the permissions themselves
  // changed, only that a user now sees why before the OS dialog appears.
  const [showDisclosure, setShowDisclosure] = useState(false);

  const totalPages = SLIDES.length + 1; // info slides + registration (name + Google sign-in)
  const registrationIndex = SLIDES.length;

  const nameValid = isValidName(name);
  // Phone number moved to MyProfileScreen (added later, after onboarding) — this
  // form's only gates are a valid name and a completed Google sign-in.
  const formValid = nameValid;

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
  }, [width]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = e.nativeEvent.contentOffset.x;
      scrollOffsetRef.current = offset;
      const next = Math.round(offset / Math.max(width, 1));
      if (next !== page) setPage(next);
    },
    [page, width],
  );

  const stopAutoScroll = useCallback(() => {
    autoScrollAnimationRef.current?.stop();
    autoScrollAnimationRef.current = null;
    if (autoScrollListenerRef.current) {
      autoScrollValue.removeListener(autoScrollListenerRef.current);
      autoScrollListenerRef.current = null;
    }
  }, [autoScrollValue]);

  const goToPage = useCallback(
    (idx: number) => {
      stopAutoScroll();
      scrollRef.current?.scrollTo({ x: idx * width, animated: true });
      setPage(idx);
    },
    [stopAutoScroll, width],
  );

  const autoGlideToPage = useCallback((idx: number) => {
    stopAutoScroll();
    autoScrollValue.setValue(scrollOffsetRef.current);
    autoScrollListenerRef.current = autoScrollValue.addListener(({ value }) => {
      scrollRef.current?.scrollTo({ x: value, animated: false });
    });

    const animation = Animated.timing(autoScrollValue, {
      toValue: idx * width,
      duration: AUTO_TRANSITION_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    });
    autoScrollAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (autoScrollListenerRef.current) {
        autoScrollValue.removeListener(autoScrollListenerRef.current);
        autoScrollListenerRef.current = null;
      }
      autoScrollAnimationRef.current = null;
      if (finished) scrollRef.current?.scrollTo({ x: idx * width, animated: false });
    });
  }, [autoScrollValue, stopAutoScroll, width]);

  const goNext = useCallback(() => {
    if (page < registrationIndex) goToPage(page + 1);
  }, [page, registrationIndex, goToPage]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotionEnabled(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotionEnabled,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Auto-advance the product story, then stop at registration. Each page change
  // starts a fresh interval, while touch interaction and reduced-motion settings
  // suppress the timer entirely.
  useEffect(() => {
    if (
      page >= registrationIndex
      || autoSwipePaused
      || reduceMotionEnabled
      || submitting
      || showDisclosure
    ) return undefined;

    const timer = setTimeout(() => autoGlideToPage(page + 1), AUTO_SWIPE_MS);
    return () => clearTimeout(timer);
  }, [
    page, registrationIndex, autoSwipePaused, reduceMotionEnabled,
    submitting, showDisclosure, autoGlideToPage,
  ]);

  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  const navAfter = useCallback(
    (route: string) => {
      if (navigation?.replace) navigation.replace(route);
      else navigation?.navigate?.(route);
    },
    [navigation],
  );

  // "Get Started" no longer requests anything itself — it only surfaces the
  // disclosure. The actual permission cascade moved to `proceedFromDisclosure`,
  // fired from that modal's own buttons, so the OS dialogs cannot appear before
  // the user has seen why (Play policy §3.5 — see DISCLOSURE_MESSAGE above).
  const handleGetStarted = useCallback(() => {
    if (!formValid || submitting || !isLoggedIn) return;
    Keyboard.dismiss();
    setShowDisclosure(true);
  }, [formValid, submitting, isLoggedIn]);

  /**
   * @param withPermissions false when the user dismissed the disclosure
   *   instead of continuing — same "denial is non-fatal" contract the
   *   permissions already had individually: skip the WHOLE cascade rather
   *   than firing OS dialogs the user just told us to skip past. They can
   *   still grant everything later from Settings.
   */
  const proceedFromDisclosure = useCallback(async (withPermissions: boolean) => {
    setShowDisclosure(false);
    setSubmitting(true);
    let showAccountConfirmation = false;
    try {
      setUserName?.(name.trim());
      // Capture the absolute onboarding timestamp — drives the 24h widget rule.
      setUserOnboardedAt?.(Date.now());

      if (withPermissions) {
        // Trigger the native SMS permission sheet (Android). On other platforms
        // there's nothing to request, so we proceed straight through.
        if (smsSupported) {
          try {
            const res = await requestSmsPermission();
            if (res?.granted) {
              setSmsPermissionGranted?.(true);
              // Back-fill 3 months of accounts/transactions so the next screen
              // ("Is this yours?") has the discovered cards to confirm.
              const sweep = await runInitialInboxSweep(
                { ingestMessage, setLastSmsDate, setLastSmsSync, compactTransactions, capOnboardingQueue },
                (p) => setSweepLabel(p.label),
              );
              showAccountConfirmation = shouldShowAccountConfirmation({
                smsPermissionGranted: true,
                messagesRead: sweep.total,
                discoveredAccountCount: useEPurseStore.getState().accounts?.length || 0,
              });
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
      }

      setHasOnboarded?.(true);
      // A denied/skipped permission or an empty/unrecognised inbox has no cards
      // or banks to confirm. Go straight home instead of showing an empty
      // "Is this yours?" configuration screen.
      navAfter(showAccountConfirmation ? accountFilterRoute : homeRoute);
    } finally {
      setSweepLabel(null);
      setSubmitting(false);
    }
  }, [
    name, setUserName, setUserOnboardedAt, setSmsPermissionGranted, setHasOnboarded,
    ingestMessage, setLastSmsDate, setLastSmsSync, compactTransactions,
    capOnboardingQueue, navAfter, accountFilterRoute, homeRoute,
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
        <Animated.ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true, listener: onScroll },
          )}
          scrollEventThrottle={16}
          onLayout={onLayout}
          onTouchStart={() => {
            stopAutoScroll();
            setAutoSwipePaused(true);
          }}
          onTouchEnd={() => setAutoSwipePaused(false)}
          onTouchCancel={() => setAutoSwipePaused(false)}
          style={styles.flex}
        >
          {/* Info slides */}
          {SLIDES.map((slide, index) => {
            const inputRange = [
              (index - 1) * width,
              index * width,
              (index + 1) * width,
            ];
            const translateY = scrollX.interpolate({
              inputRange,
              outputRange: [-34, 0, -34],
              extrapolate: 'clamp',
            });
            const translateX = scrollX.interpolate({
              inputRange,
              outputRange: [22, 0, -22],
              extrapolate: 'clamp',
            });
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: [0.965, 1, 0.965],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.62, 1, 0.62],
              extrapolate: 'clamp',
            });

            return (
              <View key={slide.key} style={[styles.page, { width }]}>
                <Animated.View
                  style={[
                    styles.slideInner,
                    { opacity, transform: [{ translateX }, { translateY }, { scale }] },
                  ]}
                >
                <View style={styles.visualStage}>
                  <View style={[styles.visualAura, { backgroundColor: theme.primary + '10' }]} />
                  <OnboardingPreview kind={slide.icon} theme={theme} />
                  <View style={[styles.floatingIcon, { backgroundColor: theme.primary }]}>
                    {renderSlideIcon(slide.icon, '#FFFFFF', 26)}
                  </View>
                </View>
                <Text style={[styles.slideEyebrow, { color: theme.primary }]}>{slide.eyebrow}</Text>
                <Text style={styles.slideTitle}>{slide.title}</Text>
                <Text style={styles.slideBody}>{slide.body}</Text>
                </Animated.View>
              </View>
            );
          })}

          {/* Registration / secure handshake */}
          <View style={[styles.page, { width }]}>
            <View pointerEvents="none" style={[styles.regBubble, styles.regBubbleTop, { backgroundColor: theme.primary + '12' }]} />
            <View pointerEvents="none" style={[styles.regBubble, styles.regBubbleBottom, { backgroundColor: theme.info + '0D' }]} />
            <ScrollView
              contentContainerStyle={styles.regScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.regBrandBlock}>
                <EPurseBrandLockup
                  iconSize={58}
                  wordmarkSize={34}
                  tagline="Financial clarity pays off."
                  taglineColor={theme.textSecondary}
                />
              </View>

              <View style={[styles.regCard, { backgroundColor: theme.card, borderColor: theme.divider }]}>
                <View style={styles.regTitleRow} accessibilityLabel="Make ePurse yours.">
                  <Text style={styles.regTitle}>Make </Text>
                  <EPurseInlineWordmark size={24} />
                  <Text style={styles.regTitle}> yours.</Text>
                </View>
                <Text style={[styles.regSubtitle, { color: theme.textSecondary }]}>Add your name and connect Google to protect access and optional backups.</Text>

                <Text style={styles.label}>Your name</Text>
                <TextInput
                  style={[styles.input, name.length > 0 && !nameValid && styles.inputError]}
                  placeholder="Enter your full name"
                  placeholderTextColor={theme.textSecondary}
                  value={name}
                  onChangeText={(t) => setName(sanitizeName(t))}
                  autoCapitalize="words"
                  returnKeyType="done"
                  maxLength={INPUT_LIMITS.NAME_MAX}
                />

                <GoogleSignInPanel
                  compact
                  disabled={!nameValid}
                  onSuccess={(account) => {
                    if (account.name && !name) setName(sanitizeName(account.name));
                  }}
                />

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: formValid && isLoggedIn ? theme.primary : theme.divider },
                    pressed && formValid && isLoggedIn && styles.primaryBtnPressed,
                  ]}
                  disabled={!formValid || submitting || !isLoggedIn}
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
                    <Text style={[styles.primaryBtnText, !(formValid && isLoggedIn) && { color: theme.textSecondary }]}>
                      Continue
                    </Text>
                  )}
                </Pressable>
              </View>

              <View style={styles.regTrustRow}>
                <View style={[styles.regTrustIcon, { backgroundColor: theme.primary + '12' }]}>
                  <ShieldCheckIcon color={theme.primary} size={18} />
                </View>
                <View style={styles.regTrustCopy}>
                  <Text style={[styles.regTrustLabel, { color: theme.primary }]}>PRIVATE BY DESIGN</Text>
                  <Text style={[styles.regTrustText, { color: theme.textSecondary }]}>Your financial ledger stays on this device by default.</Text>
                </View>
              </View>

              {/* Restore path for a NEW phone. Placed under Get Started, not beside
                  it: setting up fresh is the common case, and a returning user is
                  actively looking for this. Reuses BackupScreen so there is only
                  one restore flow to keep correct. */}
              <Pressable
                style={styles.restoreLink}
                onPress={() => navigation?.navigate?.('Backup', { fromOnboarding: true })}
                accessibilityRole="button"
                accessibilityLabel="Restore from a Google Drive backup"
              >
                <View style={styles.restoreCopy} accessibilityLabel="Already use ePurse? Restore a backup">
                  <Text style={[styles.restoreLinkText, { color: theme.textSecondary }]}>Already use </Text>
                  <EPurseInlineWordmark size={14} color={theme.textSecondary} />
                  <Text style={[styles.restoreLinkText, { color: theme.textSecondary }]}>? </Text>
                  <Text style={[styles.restoreLinkText, { color: theme.primary }]}>Restore a backup</Text>
                </View>
              </Pressable>
            </ScrollView>
          </View>
        </Animated.ScrollView>

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
          <View style={styles.navSlot}>
            {page < registrationIndex ? (
              <Pressable style={styles.nextBtn} onPress={goNext} hitSlop={8}>
                <Text style={[styles.nextText, { color: theme.primary }]}>Next</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Play policy §3.5 — must appear BEFORE the SMS/contacts/location OS
          dialogs, never after. "Not Now" and the backdrop both skip the WHOLE
          permission cascade (see proceedFromDisclosure's withPermissions arg),
          matching how each permission already fails open on its own. */}
      <CenterModal
        visible={showDisclosure}
        title="Before You Continue"
        message={DISCLOSURE_MESSAGE}
        primaryText="Continue"
        onPrimary={() => proceedFromDisclosure(true)}
        secondaryText="Not Now"
        onSecondary={() => proceedFromDisclosure(false)}
        onClose={() => proceedFromDisclosure(false)}
      />
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
  // useMemo, not a selector: it builds a fresh array of fresh objects, which
  // zustand v5 can never compare equal — as a selector this re-renders forever.
  const accountsForLinks = useEPurseStore((s: any) => s.accounts);
  const txnsForLinks = useEPurseStore((s: any) => s.transactions);
  const archivedForLinks = useEPurseStore((s: any) => s.archivedTransactions);
  const declinedForLinks = useEPurseStore((s: any) => s.declinedAccountLinks);
  const linkSuggestions = useMemo(
    () => selectAccountLinkSuggestions({
      accounts: accountsForLinks,
      transactions: txnsForLinks,
      archivedTransactions: archivedForLinks,
      declinedAccountLinks: declinedForLinks,
    }),
    [accountsForLinks, txnsForLinks, archivedForLinks, declinedForLinks]
  ) as Array<{
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
    // Drop any account the user toggled off — it isn't theirs. During this
    // first-run confirmation its imported history must go too; leaving those
    // rows merely unlinked can make a rejected account reappear if a matching
    // account is added later.
    accounts.forEach((a) => {
      if (!isOn(a.id)) deleteAccount?.(a.id, { purgeTransactions: true });
    });
    navAfter(homeRoute);
  }, [accounts, isOn, deleteAccount, navAfter, homeRoute]);

  const maskLabel = useCallback((a: Account) => {
    return a.bankName || a.name || ACCOUNT_TYPE_LABEL[a.type] || 'Account';
  }, []);

  const visibleLinkSuggestions = useMemo(
    () => linkSuggestions.filter((sug) => isOn(sug.cardId) && isOn(sug.bankId)),
    [linkSuggestions, isOn],
  );

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
          We found these from your bank messages. Keep what belongs to you and correct anything we classified incorrectly.
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
            const cycleParts = a.type === ACCOUNT_TYPES.CREDIT_CARD
              ? [
                  a.statementDay ? `Statement around the ${ordinalDay(a.statementDay)}` : null,
                  a.dueDay ? `Payment due around the ${ordinalDay(a.dueDay)}` : null,
                ].filter(Boolean)
              : [];
            return (
              <View
                key={a.id}
                style={[styles.row, !on && styles.rowOff]}
              >
                <View style={styles.rowTop}>
                  <View style={[styles.rowIcon, { backgroundColor: on ? theme.primary + '14' : theme.divider }]}>
                    <Text style={styles.rowEmoji}>{ACCOUNT_TYPE_EMOJI[a.type] || '💳'}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowTitle, !on && styles.rowTitleOff]} numberOfLines={1}>
                      {maskLabel(a)}
                    </Text>
                    <Text style={styles.rowType}>
                      {ACCOUNT_TYPE_LABEL[a.type] || a.type}
                      {a.mask ? `  ··${a.mask}` : ''}
                    </Text>
                  </View>
                  <Switch
                    value={on}
                    onValueChange={() => toggle(a.id)}
                    trackColor={{ false: theme.divider, true: theme.primary }}
                    thumbColor="#FFFFFF"
                    ios_backgroundColor={theme.divider}
                    accessibilityLabel={`${on ? 'Keep' : 'Exclude'} ${maskLabel(a)}`}
                  />
                </View>

                {on ? (
                  <View style={styles.typeToggleRow}>
                    <Text style={styles.typeToggleLabel}>Account type</Text>
                    <View style={styles.segment}>
                      {CONFIRM_ACCOUNT_TYPES.map((type) => {
                        const active = a.type === type;
                        return (
                          <Pressable
                            key={type}
                            onPress={() => { if (!active) setAccountType?.(a.id, type); }}
                            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`Set account type to ${ACCOUNT_TYPE_LABEL[type]}`}
                          >
                            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                              {type === ACCOUNT_TYPES.DEBIT_CARD
                                ? 'Debit'
                                : type === ACCOUNT_TYPES.CREDIT_CARD
                                  ? 'Credit'
                                  : ACCOUNT_TYPE_LABEL[type]}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {on && cycleParts.length > 0 ? (
                  <View style={styles.cycleRow}>
                    <Text style={styles.cycleLabel}>Detected bill cycle</Text>
                    <Text style={styles.cycleValue}>{cycleParts.join(' · ')}</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        {/* Same-account merge suggestions — a debit card + the bank it draws from */}
        {visibleLinkSuggestions.length > 0 ? (
          <View style={styles.mergeBlock}>
            <Text style={styles.mergeHeading}>Looks like the same account</Text>
            {visibleLinkSuggestions.map((sug) => (
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
            {empty ? 'Continue' : 'Confirm Accounts'}
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
  isCreditCard,
  onCancel,
  onSave,
}: {
  visible: boolean;
  accountLabel?: string;
  /**
   * The figure to show in the field. For a credit card this must already be
   * the positive OUTSTANDING amount (`Math.abs(account.balance)`) — the
   * field only ever collects a non-negative number, and the caller (via
   * `setAccountAnchor`) is what turns it back into the card's negative
   * liability balance. Never pass the raw signed `account.balance` for a CC.
   */
  initialValue?: number;
  /** Swaps the copy to "outstanding" language. Doesn't change validation or
   * what's returned to `onSave` — the amount is always entered non-negative
   * either way; only the STORE decides its sign. */
  isCreditCard?: boolean;
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
          <Text style={styles.title}>
            {isCreditCard ? 'Update outstanding balance' : 'Anchor live balance'}
          </Text>
          {!!accountLabel && <Text style={styles.label}>{accountLabel}</Text>}
          <Text style={styles.help}>
            {isCreditCard
              ? "Enter how much you currently owe on this card. We'll keep it in sync from here."
              : "Enter the balance shown in your bank app right now. We'll keep it in sync from here."}
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
              style={[styles.btn, { backgroundColor: valid ? theme.primary : theme.disabledBackground }]}
              disabled={!valid}
              onPress={() => valid && onSave(amount)}
            >
              {/* Disabled = the shared grey tokens (ui-consistency §3d-i). */}
              <Text style={[styles.btnText, { color: valid ? '#FFFFFF' : theme.disabledText }]}>
                {isCreditCard ? 'Update' : 'Anchor'}
              </Text>
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
    regBubble: { position: 'absolute', borderRadius: 999 },
    regBubbleTop: { width: 320, height: 320, top: -155, right: -125 },
    regBubbleBottom: { width: 270, height: 270, bottom: -135, left: -125 },
    restoreLink: {
      alignSelf: 'center',
      paddingVertical: 14,
      paddingHorizontal: 8,
    },
    restoreLinkText: {
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    restoreCopy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' },
    slideInner: {
      flex: 1,
      paddingHorizontal: 24,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 46,
      paddingBottom: 8,
    },
    visualStage: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 28,
      transform: [{ translateY: -18 }],
    },
    visualAura: {
      position: 'absolute',
      width: '112%',
      height: '88%',
      borderRadius: radius.pill,
      transform: [{ rotate: '-5deg' }],
    },
    floatingIcon: {
      position: 'absolute',
      right: 5,
      bottom: -16,
      width: 54,
      height: 54,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 4,
      borderColor: t.background,
      shadowColor: t.shadow,
      shadowOpacity: 0.20,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    slideEyebrow: {
      fontSize: 11,
      fontWeight: '900',
      letterSpacing: 1.8,
      textAlign: 'center',
      marginBottom: 9,
    },
    slideTitle: {
      fontSize: 29,
      fontWeight: '900',
      letterSpacing: -0.7,
      color: t.textPrimary,
      textAlign: 'center',
      marginBottom: spacing.sm,
    },
    slideBody: {
      fontSize: 15,
      lineHeight: 21,
      color: t.textSecondary,
      textAlign: 'center',
      paddingHorizontal: spacing.md,
      maxWidth: 390,
    },
    regScroll: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingVertical: spacing.xl,
      alignItems: 'stretch',
      justifyContent: 'center',
    },
    regBrandBlock: { alignItems: 'center', marginBottom: 70 },
    regCard: {
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
      borderWidth: 1,
      borderRadius: 26,
      padding: 20,
      shadowColor: t.shadow,
      shadowOpacity: 0.10,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    regTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
    regTitle: { fontSize: 24, lineHeight: 27, fontWeight: '900', letterSpacing: -0.5, color: t.textPrimary },
    regSubtitle: { fontSize: 13, lineHeight: 19, marginTop: 5, marginBottom: 10 },
    label: { fontSize: 12, fontWeight: '800', color: t.textSecondary, marginBottom: spacing.sm, marginTop: spacing.md },
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
    primaryBtn: {
      borderRadius: radius.lg,
      paddingVertical: spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.lg,
      minHeight: BUTTON_H,
    },
    primaryBtnPressed: { opacity: 0.9 },
    primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
    btnLoadingRow: { flexDirection: 'row', alignItems: 'center' },
    btnLoadingText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginLeft: spacing.md },
    regTrustRow: {
      flexDirection: 'row', alignItems: 'center', alignSelf: 'center',
      maxWidth: 350, marginTop: 16, paddingHorizontal: 8,
    },
    regTrustIcon: {
      width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10,
    },
    regTrustCopy: { flex: 1 },
    regTrustLabel: { fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 1.2 },
    regTrustText: { fontSize: 11, lineHeight: 16, fontWeight: '600', marginTop: 1 },
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
    // Fixed height so the footer (and the dots inside it) never shifts between
    // a page that shows "Next" and the last page, which shows nothing here.
    navSlot: { minHeight: 40, justifyContent: 'center', alignItems: 'flex-end' },
    nextBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
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
    rowIcon: {
      width: 38, height: 38, borderRadius: radius.md, marginRight: spacing.md,
      alignItems: 'center', justifyContent: 'center',
    },
    rowEmoji: { fontSize: 18 },
    rowText: { flex: 1, marginRight: spacing.md },
    rowTitle: { fontSize: 15, fontWeight: '600', color: t.textPrimary },
    rowTitleOff: { textDecorationLine: 'line-through' },
    rowType: { fontSize: 12, color: t.textSecondary, marginTop: 2 },
    typeToggleRow: {
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: t.divider,
    },
    typeToggleLabel: { fontSize: 12, fontWeight: '700', color: t.textSecondary, marginBottom: spacing.sm },
    segment: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
      backgroundColor: t.background,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.divider,
      padding: 4,
    },
    segmentBtn: {
      paddingVertical: 6,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.pill,
    },
    segmentBtnActive: { backgroundColor: t.primary },
    segmentText: { fontSize: 13, fontWeight: '600', color: t.textSecondary },
    segmentTextActive: { color: '#FFFFFF' },
    cycleRow: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: t.divider,
    },
    cycleLabel: { fontSize: 11, fontWeight: '700', color: t.textSecondary },
    cycleValue: { fontSize: 12, lineHeight: 18, color: t.textPrimary, marginTop: 2 },
    footer: { paddingHorizontal: 24, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: t.divider },
    primaryBtn: { borderRadius: radius.lg, paddingVertical: spacing.xs, alignItems: 'center', justifyContent: 'center', minHeight: BUTTON_H },
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
      // `elevated` numbers, matched to the shared Toast component — this is the
      // same object. Colour stays `t.shadow`: the file is theme-aware and
      // spreading the static token here would half-migrate it.
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.16,
      shadowRadius: 12,
      elevation: 10,
    },
    toastTop: { marginTop: spacing.md },
    toastBottom: { marginBottom: spacing.md },
    toastText: { flex: 1, fontSize: 13, lineHeight: 19, color: t.background },
    // The toast pill is filled with `textPrimary` (inverted snackbar), so the
    // action link must contrast THAT. `background` is the pill's body-text colour
    // — guaranteed readable across all 4 accents and light/dark. Bold + underline
    // signals it's pressable without relying on an accent hue that may wash out
    // (e.g. Carbon's pale mint primaryLight on a near-white dark-mode pill).
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
      // A CENTRED modal (maxWidth 380, all four corners rounded), not a bottom
      // sheet — so it takes the `elevated` numbers, not `sheet`'s upward cast.
      shadowColor: t.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 6,
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
    btn: { borderRadius: radius.lg, minHeight: BUTTON_H, paddingVertical: spacing.xs, paddingHorizontal: spacing.xl, marginLeft: spacing.md, minWidth: 96, alignItems: 'center', justifyContent: 'center' },
    btnGhost: { backgroundColor: 'transparent' },
    btnText: { fontSize: 15, fontWeight: '700' },
  });
