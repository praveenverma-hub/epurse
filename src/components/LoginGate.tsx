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
    <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: theme.card }]}>
      <GoogleSignInPanel title={title} subtitle={subtitle} />
    </View>
  );
};

export default LoginGate;

const styles = StyleSheet.create({
  overlay: { zIndex: 1000, alignItems: 'center', justifyContent: 'center' },
});
