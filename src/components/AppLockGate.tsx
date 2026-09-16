// AppLockGate — Face ID/Fingerprint gate over the whole app, mounted once at
// the root (App.js) as a sibling AFTER AppNavigator so it paints on top.
// Re-locks on backgrounding and re-prompts on return; mirrors the same
// LocalAuthentication pattern AccountDetailsScreen uses per-screen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AppStateStatus, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEPurseStore } from '../store/ePurseStore';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { isAppLockSuppressed, consumeAppLockSuppress } from '../utils/appLockSuppress';

// Guarded require, not a static import: requireNativeModule() throws at
// module-evaluation time if the native side isn't linked in a given build,
// and a static `import` can't be try/caught — it would take the whole app
// down before anything renders. FLAG_SECURE is a hardening extra; it must
// never be able to crash the app it's meant to protect.
let ScreenCapture: typeof import('expo-screen-capture') | null = null;
try {
  ScreenCapture = require('expo-screen-capture');
} catch {
  ScreenCapture = null;
}

const typography = typographyBase as unknown as Record<string, TextStyle>;

const AppLockGate: React.FC = () => {
  const theme = useTheme();
  const hydrated = useStoreHydrated();
  const appLockEnabled = useEPurseStore((s: any) => s.appLockEnabled) as boolean;

  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const authInFlight = useRef(false);

  const authenticate = useCallback(async () => {
    if (!appLockEnabled) { setUnlocked(true); return; }
    if (authInFlight.current) return;
    authInFlight.current = true;
    setFailed(false);
    try {
      const secLevel = await LocalAuthentication.getEnrolledLevelAsync();
      // No biometrics enrolled — don't trap the user behind a lock they have no
      // way to open (mirrors AccountDetailsScreen's own gate).
      if (secLevel <= LocalAuthentication.SecurityLevel.NONE) {
        setUnlocked(true);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock ePurse',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });
      setUnlocked(result.success);
      setFailed(!result.success);
    } catch {
      setUnlocked(false);
      setFailed(true);
    } finally {
      authInFlight.current = false;
    }
  }, [appLockEnabled]);

  useEffect(() => {
    if (hydrated) authenticate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Android takes the recent-apps (task switcher) thumbnail at the native
  // window-compositor level the instant the Activity pauses — before our JS
  // AppState listener below gets a chance to flip `unlocked` and repaint the
  // lock overlay, so the real screen leaked into the thumbnail even though
  // re-opening the app correctly re-locked it. FLAG_SECURE (set here via
  // expo-screen-capture) blanks that thumbnail at the OS level regardless of
  // JS timing. It must stay set for as long as app lock is enabled, not just
  // while the overlay is showing. No-op on iOS (no equivalent API) — there
  // the app-switcher snapshot is taken after `willResignActive`, which is
  // when the AppState listener already covers the screen, so this JS-timed
  // approach is sufficient on that platform.
  useEffect(() => {
    if (!hydrated || !ScreenCapture) return;
    const fn = appLockEnabled ? ScreenCapture.preventScreenCaptureAsync : ScreenCapture.allowScreenCaptureAsync;
    fn().catch(() => {});
  }, [hydrated, appLockEnabled]);

  const appState = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (next === 'background' || next === 'inactive') {
        // Locks the INSTANT the app leaves the foreground — like other
        // finance apps, not only once it's reopened. Deliberately NOT gated
        // on `authInFlight`: backgrounding always wins, even if a Face ID
        // prompt happens to be mid-flight (e.g. the user backgrounds the app
        // from that very system sheet) — that guard is only for the
        // re-auth-on-return path below, so we never double-invoke the prompt.
        // An expected native interruption (contacts permission prompt,
        // Linking.openSettings…) is the one exception — not the user
        // actually leaving the app.
        if (isAppLockSuppressed()) return;
        if (appLockEnabled) setUnlocked(false);
      } else if (next === 'active' && prev !== 'active') {
        if (authInFlight.current) return;
        if (isAppLockSuppressed()) { consumeAppLockSuppress(); return; }
        if (appLockEnabled) authenticate();
      }
    });
    return () => sub.remove();
  }, [appLockEnabled, authenticate]);

  // Not hydrated yet: cover with a blank surface (we don't know if lock is on)
  // rather than a lock screen that flashes for the majority who have it off.
  if (!hydrated) return <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.background, zIndex: 999 }]} />;
  if (!appLockEnabled || unlocked) return null;

  return (
    <View style={[StyleSheet.absoluteFillObject, styles.overlay, { backgroundColor: theme.card }]}>
      <View style={[styles.iconCircle, { backgroundColor: theme.primary + '1A' }]}>
        <Ionicons name="lock-closed" size={28} color={theme.primary} />
      </View>
      <Text style={[styles.title, { color: theme.textPrimary }]}>ePurse is locked</Text>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        {failed ? "That didn't work — try again." : 'Verify your identity to continue.'}
      </Text>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: theme.primary }]}
        onPress={authenticate}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Unlock ePurse"
      >
        <Text style={styles.btnText}>Unlock</Text>
      </TouchableOpacity>
    </View>
  );
};

export default AppLockGate;

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: spacing.xl },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { ...typography.h2, marginBottom: spacing.xs },
  hint: { ...typography.small, marginBottom: spacing.xl, textAlign: 'center' },
  btn: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.lg },
  btnText: { color: '#fff', ...typography.body, fontWeight: '700' },
});
