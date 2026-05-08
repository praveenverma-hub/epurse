// =============================================================================
// PermissionScreen — first-launch onboarding + SMS permission request
// -----------------------------------------------------------------------------
// Shown ONCE when the app is opened for the first time.
// Flow:
//   1. Splash-style intro with feature bullets
//   2. "Allow" button  → native Android SMS permission prompt
//   3. On grant → immediately sweep the inbox (real data) → Dashboard
//   4. On deny  → skip SMS, still go to Dashboard (manual-entry only mode)
//
// On iOS / Expo Go the screen still renders but the SMS step is skipped
// gracefully (iOS does not allow third-party SMS access).
// =============================================================================

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import {
  smsSupported,
  requestSmsPermission,
  readInbox,
} from '../services/smsService';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';

// ─── Feature cards shown in the intro ────────────────────────────────────────
const FEATURES = [
  { emoji: '📩', title: 'Auto-import transactions', desc: 'We read your bank & wallet SMSes to track every spend automatically.' },
  { emoji: '📊', title: 'Smart analytics', desc: 'See monthly breakdowns by category — Food, Travel, Shopping & more.' },
  { emoji: '💰', title: 'One wallet view', desc: 'Bank, Credit Card, Paytm & Cash — all balances in one place.' },
  { emoji: '🔒', title: 'Stays on your device', desc: 'All data is stored locally. Nothing leaves your phone.' },
];

// ─── Tiny animated step indicator ─────────────────────────────────────────────
const Dots = ({ total, active }) => (
  <View style={dots.row}>
    {Array.from({ length: total }).map((_, i) => (
      <View key={i} style={[dots.dot, i === active && dots.active]} />
    ))}
  </View>
);
const dots = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF44' },
  active: { width: 18, backgroundColor: '#fff' },
});

// =============================================================================
export default function PermissionScreen({ navigation }) {
  const setHasOnboarded = useEPurseStore((s) => s.setHasOnboarded);
  const setSmsPermissionGranted = useEPurseStore((s) => s.setSmsPermissionGranted);
  const ingestMessage = useEPurseStore((s) => s.ingestMessage);
  const setLastSmsSync = useEPurseStore((s) => s.setLastSmsSync);

  const [step, setStep] = useState(0);   // 0 = feature carousel, 1 = permission ask
  const [loading, setLoading] = useState(false);
  const [syncCount, setSyncCount] = useState(null); // how many SMS were imported

  // ── Entrance animation ──────────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();
  }, [step]);

  const animateStep = (nextStep) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: -20, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(30);
      setStep(nextStep);
    });
  };

  // ── Permission request & inbox sweep ──────────────────────────────────────
  const handleAllow = async () => {
    if (Platform.OS !== 'android' || !smsSupported) {
      // iOS / Expo Go — just skip
      finishOnboarding(false, 0);
      return;
    }

    setLoading(true);
    try {
      const { granted, neverAskAgain } = await requestSmsPermission();

      if (!granted) {
        if (neverAskAgain) {
          Alert.alert(
            'Permission needed',
            'SMS permission was permanently denied. You can enable it in Settings → Apps → ePurse → Permissions.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Skip', onPress: () => finishOnboarding(false, 0) },
            ]
          );
        } else {
          finishOnboarding(false, 0);
        }
        return;
      }

      // ── Permission granted → sweep inbox ───────────────────────────────
      setSmsPermissionGranted(true);

      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const inbox = await readInbox(Date.now() - THIRTY_DAYS);

      // Sort oldest → newest for correct running balance
      const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));
      let imported = 0;
      sorted.forEach((m) => {
        const parsed = ingestMessage(m.body, {
          sender: m.address,
          receivedAt: new Date(m.date).toISOString(),
        });
        if (parsed) imported++;
      });
      setLastSmsSync(Date.now());
      setSyncCount(imported);

      // Brief pause so user can see the success state
      setTimeout(() => finishOnboarding(true, imported), 1200);
    } catch (e) {
      console.warn('[PermissionScreen] error', e?.message);
      finishOnboarding(false, 0);
    } finally {
      setLoading(false);
    }
  };

  const finishOnboarding = (granted, count) => {
    setHasOnboarded(true);
    navigation.replace('Dashboard');
  };

  const handleSkip = () => finishOnboarding(false, 0);

  // ── Carousel page ──────────────────────────────────────────────────────────
  const renderCarousel = () => (
    <Animated.View
      style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
    >
      <Text style={styles.logo}>💳</Text>
      <Text style={styles.appName}>ePurse</Text>
      <Text style={styles.tagline}>Your finances, all in one glance.</Text>

      <View style={styles.featureList}>
        {FEATURES.map((f, i) => (
          <View key={i} style={styles.featureCard}>
            <Text style={styles.featureEmoji}>{f.emoji}</Text>
            <View style={styles.featureText}>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Dots total={2} active={0} />
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => animateStep(1)}
        >
          <LinearGradient
            colors={['#FF9F46', '#FF5A1F']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.btnGradient}
          >
            <Text style={styles.btnText}>Get started →</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

  // ── Permission ask page ────────────────────────────────────────────────────
  const renderPermission = () => (
    <Animated.View
      style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
    >
      <View style={styles.permIconWrap}>
        <Text style={styles.permIcon}>📨</Text>
      </View>

      <Text style={styles.permTitle}>Allow SMS access</Text>
      <Text style={styles.permBody}>
        ePurse reads your bank and payment SMSes to{' '}
        <Text style={styles.bold}>automatically log every transaction</Text> — no
        manual entry needed.
      </Text>

      <View style={styles.privacyBox}>
        <Text style={styles.privacyTitle}>🔒  Your privacy matters</Text>
        <Text style={styles.privacyItem}>• Only financial messages are processed</Text>
        <Text style={styles.privacyItem}>• Data never leaves your device</Text>
        <Text style={styles.privacyItem}>• You can revoke access any time</Text>
      </View>

      {syncCount !== null && (
        <View style={styles.successBadge}>
          <Text style={styles.successText}>
            ✅  Imported {syncCount} transaction{syncCount !== 1 ? 's' : ''} from your inbox!
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        <Dots total={2} active={1} />

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#FF5A1F" size="small" />
            <Text style={styles.loadingText}>Syncing your messages…</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={handleAllow}
              disabled={loading}
            >
              <LinearGradient
                colors={['#FF9F46', '#FF5A1F']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.btnGradient}
              >
                <Text style={styles.btnText}>Allow SMS access</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={handleSkip}>
              <Text style={styles.skipText}>Skip — I'll add manually</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.6, y: 1 }}
      style={styles.root}
    >
      <SafeAreaView style={styles.safe}>
        {step === 0 ? renderCarousel() : renderPermission()}
      </SafeAreaView>
    </LinearGradient>
  );
}

// =============================================================================
const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },

  // ── Carousel ────────────────────────────────────────────────────────────────
  logo: { fontSize: 56, textAlign: 'center' },
  appName: {
    textAlign: 'center',
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
    marginTop: spacing.sm,
    letterSpacing: -1,
  },
  tagline: {
    textAlign: 'center',
    color: '#FFFFFFCC',
    ...typography.body,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },

  featureList: { gap: spacing.md },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF14',
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  featureEmoji: { fontSize: 28, marginTop: 2 },
  featureText: { flex: 1 },
  featureTitle: { color: '#fff', ...typography.bodyBold, fontWeight: '700' },
  featureDesc: { color: '#FFFFFFCC', ...typography.small, marginTop: 2 },

  // ── Permission page ──────────────────────────────────────────────────────────
  permIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFFFFF20',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  permIcon: { fontSize: 44 },
  permTitle: {
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: spacing.md,
    letterSpacing: -0.5,
  },
  permBody: {
    textAlign: 'center',
    color: '#FFFFFFCC',
    ...typography.body,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  bold: { color: '#fff', fontWeight: '700' },

  privacyBox: {
    backgroundColor: '#FFFFFF14',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  privacyTitle: { color: '#fff', ...typography.bodyBold, fontWeight: '700', marginBottom: 4 },
  privacyItem: { color: '#FFFFFFCC', ...typography.small },

  successBadge: {
    marginTop: spacing.lg,
    backgroundColor: '#00C48C22',
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#00C48C66',
  },
  successText: { textAlign: 'center', color: '#00C48C', fontWeight: '700', ...typography.body },

  // ── Shared footer ────────────────────────────────────────────────────────────
  footer: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
    gap: spacing.md,
    alignItems: 'center',
  },

  primaryBtn: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  btnGradient: {
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  skipBtn: { paddingVertical: spacing.sm },
  skipText: { color: '#FFFFFFAA', ...typography.body, textDecorationLine: 'underline' },

  loadingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  loadingText: { color: '#FFFFFFCC', ...typography.body },
});
