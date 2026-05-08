import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import AppNavigator from './src/navigation/AppNavigator';
import { useSmsSync } from './src/hooks/useSmsSync';

// Boots the Android SMS listener whenever auto-import is enabled in the store.
// No-ops on iOS / Expo Go / web.
function SmsSyncBoot() {
  useSmsSync();
  return null;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SmsSyncBoot />
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
