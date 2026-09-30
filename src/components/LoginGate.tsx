// =============================================================================
// LoginGate — gates the whole app on Google sign-in, mounted once at the root
// (App.js) as a sibling AFTER AppLockGate so it paints on top of everything,
// including the lock screen: without a valid session nothing else matters.
//
// Structurally mirrors AppLockGate (sibling overlay, not a navigator route) —
// deliberately, so this covers BOTH cases with no navigation.reset anywhere:
//   1. Retrofit: an already-onboarded install that predates mandatory login.
//   2. Mid-session revocation: AuthSessionBoot flips isLoggedIn false the
//      instant a refresh fails, and this simply reappears.
// AppNavigator's `initialRouteName` is read ONCE at mount — a stack-screen
// approach would need a navigation.reset fired at the exact moment
// hasOnboarded && !isLoggedIn becomes true post-mount, which is the same bug
// class already hit once in this codebase. An overlay needs no such moment:
// Main stays mounted underneath, and this just stops rendering once
// isLoggedIn flips true, on sign-in AND on logout alike.
//
// Unlike AppLockGate, this is NOT wired to AppState — it must not re-prompt on
// every background/foreground cycle, only for the three events above (the
// third being deleteAllUserData — see its own doc comment in ePurseStore.js
// for why hasOnboarded is left untouched and this is the overlay it relies on).
// =============================================================================
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing } from '../constants/theme';
import GoogleSignInPanel from './GoogleSignInPanel';
import EPurseBrandLockup from './EPurseBrandLockup';

const LoginGate: React.FC = () => {
  const theme = useTheme();
  const hydrated = useStoreHydrated();
  const hasOnboarded = useEPurseStore((s: any) => s.hasOnboarded) as boolean;
  const isLoggedIn = useEPurseStore((s: any) => s.isLoggedIn) as boolean;
  const sessionExpired = useEPurseStore((s: any) => s.sessionExpired) as boolean;
  const justDeletedAccount = useEPurseStore((s: any) => s.justDeletedAccount) as boolean;

  // Not hydrated yet: we don't know hasOnboarded/isLoggedIn — cover with a
  // blank surface rather than flash the gate for users who won't see it.
  if (!hydrated) return <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, zIndex: 1000 }]} />;
  if (!hasOnboarded) return null; // fresh installs: the onboarding slide owns this
  if (isLoggedIn) return null;

  // Three distinct reasons to be here, three distinct messages — a session that
  // "expired" and data that the user just chose to delete are not the same
  // event, and telling someone their untouched data survived a deletion they
  // just confirmed would be actively wrong, not just imprecise.
  const title = justDeletedAccount ? 'Account Deleted' : sessionExpired ? 'Sign Back In' : 'Sign In To Continue';
  const subtitle = justDeletedAccount
    ? 'Your data has been deleted from this device\nSign in to start fresh.'
    : sessionExpired
      ? 'Your Google session expired. Sign in again\nto keep using ePurse.'
      : 'ePurse now requires a Google sign-in. Your data\non this device is untouched.';

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <View pointerEvents="none" style={[styles.orb, styles.orbTop, { backgroundColor: theme.primary + '12' }]} />
      <View pointerEvents="none" style={[styles.orb, styles.orbBottom, { backgroundColor: theme.info + '0D' }]} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.brandHeader}>
            <EPurseBrandLockup
              iconSize={58}
              wordmarkSize={34}
              tagline="Financial clarity pays off."
              taglineColor={theme.textSecondary}
            />
          </View>

          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.divider }]}>
            <GoogleSignInPanel title={title} subtitle={subtitle} />
            <View style={[styles.trustLine, { borderTopColor: theme.divider }]}>
              <View style={[styles.trustIcon, { backgroundColor: theme.primary + '12' }]}>
                <Ionicons name="shield-checkmark-outline" size={17} color={theme.primary} />
              </View>
              <View style={styles.trustCopy}>
                <Text style={[styles.trustLabel, { color: theme.primary }]}>PRIVATE BY DESIGN</Text>
                <Text style={[styles.trustText, { color: theme.textSecondary }]}>Google sign-in protects access. Your financial ledger stays on this device by default.</Text>
              </View>
            </View>
          </View>

          <Text style={[styles.footer, { color: theme.textSecondary }]}>Secure access · Optional encrypted backup</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

export default LoginGate;

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, overflow: 'hidden' },
  safe: { flex: 1 },
  brandHeader: { alignItems: 'center', marginBottom: 70 },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  orb: { position: 'absolute', borderRadius: 999 },
  orbTop: { width: 320, height: 320, top: -155, right: -125 },
  orbBottom: { width: 270, height: 270, bottom: -135, left: -125 },
  card: {
    width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 28,
    paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.lg,
    shadowColor: '#170D32', shadowOpacity: 0.11,
    shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 5,
  },
  trustLine: {
    flexDirection: 'row', alignItems: 'center', borderTopWidth: 1,
    marginTop: spacing.lg, paddingTop: spacing.md, paddingHorizontal: spacing.xs,
  },
  trustIcon: {
    width: 32, height: 32, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm,
  },
  trustCopy: { flex: 1 },
  trustLabel: { fontSize: 9, lineHeight: 12, fontWeight: '700', letterSpacing: 1.2 },
  trustText: { fontSize: 10, lineHeight: 15, fontWeight: '500', marginTop: 2 },
  footer: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2, marginTop: 18 },
});
