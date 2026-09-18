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
// every background/foreground cycle, only for the two events above.
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { useTheme } from '../hooks/useTheme';
import GoogleSignInPanel from './GoogleSignInPanel';

const LoginGate: React.FC = () => {
  const theme = useTheme();
  const hydrated = useStoreHydrated();
  const hasOnboarded = useEPurseStore((s: any) => s.hasOnboarded) as boolean;
  const isLoggedIn = useEPurseStore((s: any) => s.isLoggedIn) as boolean;
  const sessionExpired = useEPurseStore((s: any) => s.sessionExpired) as boolean;

  // Not hydrated yet: we don't know hasOnboarded/isLoggedIn — cover with a
  // blank surface rather than flash the gate for users who won't see it.
  if (!hydrated) return <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, zIndex: 1000 }]} />;
  if (!hasOnboarded) return null; // fresh installs: the onboarding slide owns this
  if (isLoggedIn) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: theme.card }]}>
      <GoogleSignInPanel
        title={sessionExpired ? 'Sign Back In' : 'Sign In To Continue'}
        subtitle={sessionExpired
          ? 'Your Google session expired. Sign in again to keep using ePurse.'
          : 'ePurse now requires a Google sign-in. Your data on this device is untouched.'}
      />
    </View>
  );
};

export default LoginGate;

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, alignItems: 'center', justifyContent: 'center' },
});
