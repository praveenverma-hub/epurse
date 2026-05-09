// =============================================================================
// PermissionScreen — first-launch onboarding
// -----------------------------------------------------------------------------
// Shown ONCE (gated by hasOnboarded in the store). Three steps:
//
//   0. Welcome carousel + feature bullets
//   1. Name input — "What should we call you?"
//   2. Permission ask + inbox sweep with a live progress bar
//
// On grant we ingest the last 30 days of inbox messages right here in the
// foreground, with progress reporting, so the user sees what's happening.
// On deny we still proceed (manual-entry mode).
// On iOS / Expo Go the SMS step is gracefully skipped.
// =============================================================================

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
  AppState,
  ActivityIndicator,
  Linking,
  Alert,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { useEPurseStore } from "../store/ePurseStore";
import {
  smsSupported,
  hasSmsPermission,
  requestSmsPermission,
  readInbox,
} from "../services/smsService";
import {
  colors,
  radius,
  spacing,
  typography,
  shadows,
} from "../constants/theme";

const FEATURES = [
  {
    emoji: "📩",
    title: "Auto-import transactions",
    desc: "We read your bank & wallet SMSes to track every spend automatically.",
  },
  {
    emoji: "📊",
    title: "Smart analytics",
    desc: "See monthly breakdowns by category — Food, Travel, Shopping & more.",
  },
  {
    emoji: "💰",
    title: "One wallet view",
    desc: "Bank, Credit Card, Paytm & Cash — all balances in one place.",
  },
  {
    emoji: "🔒",
    title: "Stays on your device",
    desc: "All data is stored locally. Nothing leaves your phone.",
  },
];

const Dots = ({ total, active }) => (
  <View style={dots.row}>
    {Array.from({ length: total }).map((_, i) => (
      <View key={i} style={[dots.dot, i === active && dots.active]} />
    ))}
  </View>
);
const dots = StyleSheet.create({
  row: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFFFFF44" },
  active: { width: 18, backgroundColor: "#fff" },
});

// =============================================================================
export default function PermissionScreen({ navigation }) {
  const setHasOnboarded = useEPurseStore((s) => s.setHasOnboarded);
  const setSmsPermissionGranted = useEPurseStore(
    (s) => s.setSmsPermissionGranted,
  );
  const setUserName = useEPurseStore((s) => s.setUserName);
  const setLastSmsSync = useEPurseStore((s) => s.setLastSmsSync);
  const setLastSmsDate = useEPurseStore((s) => s.setLastSmsDate);
  const ingestMessage = useEPurseStore((s) => s.ingestMessage);
  const compactTransactions = useEPurseStore((s) => s.compactTransactions);
  const storedName = useEPurseStore((s) => s.userName);

  const [step, setStep] = useState(0); // 0 = welcome, 1 = name, 2 = permission
  const [name, setName] = useState(storedName || "");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null); // { current, total, label }

  // ── Entrance animation ─────────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }),
    ]).start();
  }, [step]);

  const animateStep = (nextStep) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -20,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(30);
      setStep(nextStep);
    });
  };

  const finishOnboarding = useCallback(() => {
    setHasOnboarded(true);
    navigation.replace("Dashboard");
  }, [setHasOnboarded, navigation]);

  // ── Inbox sweep with live progress ─────────────────────────────────────────
  const sweepInboxWithProgress = useCallback(async () => {
    setProgress({ current: 0, total: 0, label: "Reading inbox…" });

    // Fetch from the 1st of the month 3 months ago — matches the raw
    // retention window so the very first sync covers the full history we keep.
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime();

    let inbox = [];
    try {
      inbox = await readInbox(since);
    } catch (e) {
      console.warn("[onboarding] readInbox failed", e?.message);
    }
    const total = inbox.length;
    if (total === 0) {
      setProgress({
        current: 0,
        total: 0,
        label: "No financial messages found",
      });
      setLastSmsSync(Date.now());
      return;
    }

    // Sort oldest → newest so balances accumulate chronologically.
    const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));

    // Process in small batches, yielding to the event loop between each so
    // the progress UI can repaint smoothly.
    const BATCH = 25;
    let processed = 0;
    let maxSmsDate = 0;
    setProgress({ current: 0, total, label: "Categorising messages…" });

    for (let i = 0; i < sorted.length; i += BATCH) {
      const chunk = sorted.slice(i, i + BATCH);
      chunk.forEach((m) => {
        ingestMessage(m.body, {
          sender: m.address,
          receivedAt: new Date(m.date).toISOString(),
          smsId: String(m._id), // Android SMS unique ID — prevents re-ingestion
        });
        if ((m.date || 0) > maxSmsDate) maxSmsDate = m.date;
      });
      processed += chunk.length;
      setProgress({
        current: processed,
        total,
        label: "Categorising messages…",
      });
      // yield to the UI thread
      await new Promise((r) => setTimeout(r, 0));
    }

    // Advance the date cursor so useSmsSync never re-fetches these messages
    if (maxSmsDate > 0) setLastSmsDate(maxSmsDate);
    setLastSmsSync(Date.now());
    compactTransactions(true); // first run: force a compaction pass

    setProgress({ current: total, total, label: "Done!" });
    await new Promise((r) => setTimeout(r, 350)); // brief pause so user sees "Done"
  }, [ingestMessage, setLastSmsSync, setLastSmsDate, compactTransactions]);

  // ── Permission request ─────────────────────────────────────────────────────
  const handleAllow = async () => {
    if (Platform.OS !== "android" || !smsSupported) {
      // iOS / Expo Go — nothing to request, just proceed
      finishOnboarding();
      return;
    }

    setLoading(true);
    try {
      const { granted, neverAskAgain } = await requestSmsPermission();

      if (granted) {
        setSmsPermissionGranted(true);
        await sweepInboxWithProgress();
        finishOnboarding();
        return;
      }

      if (neverAskAgain) {
        Alert.alert(
          "Enable SMS in Settings",
          "SMS permission was blocked. Open Settings → Apps → ePurse → Permissions → SMS and set to Allow.",
          [
            { text: "Open Settings", onPress: () => Linking.openSettings() },
            {
              text: "Skip",
              style: "cancel",
              onPress: () => finishOnboarding(),
            },
          ],
        );
      } else {
        finishOnboarding();
      }
    } catch (e) {
      console.warn("[PermissionScreen] handleAllow error", e?.message);
      finishOnboarding();
    } finally {
      setLoading(false);
    }
  };

  // ── AppState — auto-proceed if user grants in Settings then comes back ─────
  useEffect(() => {
    if (step !== 2) return;
    let wentToBackground = false;
    const sub = AppState.addEventListener("change", async (next) => {
      if (next === "background" || next === "inactive") wentToBackground = true;
      if (next === "active" && wentToBackground) {
        wentToBackground = false;
        const ok = await hasSmsPermission();
        if (ok) {
          setSmsPermissionGranted(true);
          setLoading(true);
          await sweepInboxWithProgress();
          finishOnboarding();
        }
      }
    });
    return () => sub.remove();
  }, [step, finishOnboarding, sweepInboxWithProgress, setSmsPermissionGranted]);

  const handleSkip = () => finishOnboarding();

  // ─── Step 0: welcome ───────────────────────────────────────────────────────
  const renderWelcome = () => (
    <Animated.View
      style={[
        styles.content,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
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
        <Dots total={3} active={0} />
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          onPress={() => animateStep(1)}
        >
          <LinearGradient
            colors={["#FF9F46", "#FF5A1F"]}
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

  // ─── Step 1: name input ────────────────────────────────────────────────────
  const renderName = () => (
    <Animated.View
      style={[
        styles.content,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.permIconWrap}>
        <Text style={styles.permIcon}>👋</Text>
      </View>

      <Text style={styles.permTitle}>What should we call you?</Text>
      <Text style={styles.permBody}>
        We'll use this on your dashboard so it feels a little more personal.
      </Text>

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor="#FFFFFF99"
        style={styles.nameInput}
        autoFocus
        returnKeyType="next"
        maxLength={30}
        onSubmitEditing={() => {
          setUserName(name);
          animateStep(2);
        }}
      />

      <View style={styles.footer}>
        <Dots total={3} active={1} />
        <TouchableOpacity
          style={[styles.primaryBtn, !name.trim() && { opacity: 0.5 }]}
          activeOpacity={0.85}
          disabled={!name.trim()}
          onPress={() => {
            setUserName(name);
            animateStep(2);
          }}
        >
          <LinearGradient
            colors={["#FF9F46", "#FF5A1F"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.btnGradient}
          >
            <Text style={styles.btnText}>Continue</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

  // ─── Step 2: permission ask + progress ─────────────────────────────────────
  const renderPermission = () => (
    <Animated.View
      style={[
        styles.content,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.permIconWrap}>
        <Text style={styles.permIcon}>📨</Text>
      </View>

      <Text style={styles.permTitle}>Allow SMS access</Text>
      <Text style={styles.permBody}>
        ePurse reads your bank and payment SMSes to{" "}
        <Text style={styles.bold}>automatically log every transaction</Text> —
        no manual entry needed.
      </Text>

      <View style={styles.privacyBox}>
        <Text style={styles.privacyTitle}>🔒 Your privacy matters</Text>
        <Text style={styles.privacyItem}>
          • Only financial messages are processed
        </Text>
        <Text style={styles.privacyItem}>• Data never leaves your device</Text>
        <Text style={styles.privacyItem}>• You can revoke access any time</Text>
      </View>

      <View style={styles.footer}>
        <Dots total={3} active={2} />

        {progress ? (
          <View style={styles.progressWrap}>
            <Text style={styles.progressLabel}>{progress.label}</Text>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width:
                      progress.total > 0
                        ? `${Math.min(100, (progress.current / progress.total) * 100)}%`
                        : "6%",
                  },
                ]}
              />
            </View>
            {progress.total > 0 && (
              <Text style={styles.progressCount}>
                {progress.current} / {progress.total}
              </Text>
            )}
          </View>
        ) : loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.loadingText}>Waiting for permission…</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={handleAllow}
            >
              <LinearGradient
                colors={["#FF9F46", "#FF5A1F"]}
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

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={[colors.gradientStart, colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.6, y: 1 }}
      style={styles.root}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView style={styles.safe}>
          {step === 0
            ? renderWelcome()
            : step === 1
              ? renderName()
              : renderPermission()}
          <Text style={styles.copyrightText}>
            © All rights reserved by pvn13
          </Text>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },

  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },

  // welcome
  logo: { fontSize: 56, textAlign: "center" },
  appName: {
    textAlign: "center",
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
    marginTop: spacing.sm,
    letterSpacing: -1,
  },
  tagline: {
    textAlign: "center",
    color: "#FFFFFFCC",
    ...typography.body,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },

  featureList: { gap: spacing.md },
  featureCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF14",
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  featureEmoji: { fontSize: 28, marginTop: 2 },
  featureText: { flex: 1 },
  featureTitle: { color: "#fff", ...typography.bodyBold, fontWeight: "700" },
  featureDesc: { color: "#FFFFFFCC", ...typography.small, marginTop: 2 },

  // permission / name
  permIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#FFFFFF20",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: spacing.xl,
  },
  permIcon: { fontSize: 44 },
  permTitle: {
    textAlign: "center",
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    marginBottom: spacing.md,
    letterSpacing: -0.5,
  },
  permBody: {
    textAlign: "center",
    color: "#FFFFFFCC",
    ...typography.body,
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  bold: { color: "#fff", fontWeight: "700" },

  privacyBox: {
    backgroundColor: "#FFFFFF14",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  privacyTitle: {
    color: "#fff",
    ...typography.bodyBold,
    fontWeight: "700",
    marginBottom: 4,
  },
  privacyItem: { color: "#FFFFFFCC", ...typography.small },

  nameInput: {
    backgroundColor: "#FFFFFF14",
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    borderWidth: 1,
    borderColor: "#FFFFFF22",
  },

  // shared footer
  footer: {
    marginTop: "auto",
    paddingTop: spacing.xl,
    gap: spacing.md,
    alignItems: "center",
  },

  primaryBtn: {
    width: "100%",
    borderRadius: radius.lg,
    overflow: "hidden",
    ...shadows.card,
  },
  btnGradient: {
    paddingVertical: spacing.md + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  skipBtn: { paddingVertical: spacing.sm },
  skipText: {
    color: "#FFFFFFAA",
    ...typography.body,
    textDecorationLine: "underline",
  },

  loadingRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  loadingText: { color: "#FFFFFFCC", ...typography.body },

  // progress bar
  progressWrap: {
    width: "100%",
    backgroundColor: "#FFFFFF14",
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  progressLabel: { color: "#fff", ...typography.bodyBold, textAlign: "center" },
  progressBarBg: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FFFFFF22",
    overflow: "hidden",
  },
  progressBarFill: { height: 8, borderRadius: 4, backgroundColor: "#fff" },
  progressCount: {
    color: "#FFFFFFCC",
    ...typography.tiny,
    textAlign: "center",
  },
  copyrightText: {
    color: "#FFFFFF99",
    ...typography.tiny,
    textAlign: "center",
    paddingBottom: spacing.sm,
  },
});
