import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import AppNavigator from './src/navigation/AppNavigator';
import { useSmsSync } from './src/hooks/useSmsSync';
import { useEPurseStore } from './src/store/ePurseStore';

// =============================================================================
// Background workers — mounted once at the root, render nothing.
// =============================================================================

/** Boots the Android SMS listener while a real permission is held. */
function SmsSyncBoot() {
  useSmsSync();
  return null;
}

/**
 * Enforces the data retention policy:
 *   • Runs once on launch
 *   • Re-runs whenever the app returns to foreground
 * The store action itself is throttled (max once every 6 hrs), so calling
 * this often is cheap.
 */
function CompactionBoot() {
  const compact = useEPurseStore((s) => s.compactTransactions);
  useEffect(() => {
    compact();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') compact();
    });
    return () => sub.remove();
  }, [compact]);
  return null;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SmsSyncBoot />
        <CompactionBoot />
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
