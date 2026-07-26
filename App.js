import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import AppNavigator from './src/navigation/AppNavigator';
import { useSmsSync } from './src/hooks/useSmsSync';
import { useEPurseStore } from './src/store/ePurseStore';
import { configureNotificationHandler, setupAndroidChannel, setupBudgetAlertChannel } from './src/utils/notifications';
import { ToastProvider } from './src/components/Toast';

// =============================================================================
// Background workers — mounted once at the root, render nothing.
// =============================================================================

/** Sets up push notification handler + Android channel once at startup. */
function NotificationBoot() {
  useEffect(() => {
    configureNotificationHandler();
    setupAndroidChannel();
    setupBudgetAlertChannel();
  }, []);
  return null;
}

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

/**
 * Snapshots the previous month's budget into history when the calendar month
 * rolls over. Also fires the mid-cycle nudge once we're past day 15 (deduped
 * per cycle in the store). Both run at launch and on every return to foreground
 * so they're robust to users who leave the app open across midnight.
 */
function BudgetRolloverBoot() {
  const rollover   = useEPurseStore((s) => s.rolloverBudgetIfNeeded);
  const nudge      = useEPurseStore((s) => s.maybeFireMidmonthNudge);
  const subAlerts  = useEPurseStore((s) => s.maybeFireSubscriptionAlerts);
  const recap      = useEPurseStore((s) => s.maybeQueueMonthlyRecap);
  useEffect(() => {
    rollover();
    nudge();
    subAlerts();
    recap();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        rollover();
        nudge();
        subAlerts();
        recap();
      }
    });
    return () => sub.remove();
  }, [rollover, nudge, subAlerts, recap]);
  return null;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ToastProvider>
          <StatusBar style="light" />
          <NotificationBoot />
          <SmsSyncBoot />
          <CompactionBoot />
          <BudgetRolloverBoot />
          <AppNavigator />
        </ToastProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
