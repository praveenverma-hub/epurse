import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useEPurseStore } from '../store/ePurseStore';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { MOCK_DATA_ENABLED, MOCK_SCENARIO } from '../config/mockData';
import { useRewardStore } from '../store/useRewardStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { seedMockData } from './seedMockData';

let boot;
function MockSession({ children }) {
  const hydrated = useStoreHydrated();
  const rewardsHydrated = useStoreHydrated(useRewardStore);
  const notificationsHydrated = useStoreHydrated(useNotificationStore);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!hydrated || !rewardsHydrated || !notificationsHydrated) return;
    let mounted = true;
    // Strict Mode/remounts must not seed twice.
    boot ||= seedMockData(useEPurseStore).then(() => {
      useEPurseStore.getState().setUserName('Demo User');
      useEPurseStore.getState().setHasOnboarded(true);
      for (let i = 0; i < MOCK_SCENARIO.reviewedTransactions; i++) useRewardStore.getState().recordReview();
    });
    boot.then(() => { if (mounted) setReady(true); }, (e) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, [hydrated, rewardsHydrated, notificationsHydrated]);
  // Match the real app's viewport exactly: a debug banner above the navigator
  // consumes height while screens still apply their own top safe-area inset.
  if (ready) return children;
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
    <Text style={{ color: '#ffffff', textAlign: 'center' }}>{error || 'Preparing test scenario…'}</Text>
  </View>;
}
export default function MockDataBoundary({ children }) {
  return MOCK_DATA_ENABLED ? <MockSession>{children}</MockSession> : children;
}
