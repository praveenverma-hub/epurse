import { useEffect } from 'react';
import { useAppReady } from '../hooks/useAppReady';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { whenFirstSweepSettled } from '../hooks/useSmsSync';
import { useRewardStore } from '../store/useRewardStore';
import { useEPurseStore, selectYesterdayTransactionCount, selectGapTransactionCount } from '../store/ePurseStore';

export default function AwareRunBoot() {
  const ready = useAppReady();
  const rewardsHydrated = useStoreHydrated(useRewardStore);
  useEffect(() => {
    if (!ready || !rewardsHydrated) return;
    let cancelled = false;
    void (async () => {
      // Read only after both stores and the first import are ready; otherwise
      // an empty ledger can incorrectly qualify for a no-spending reward.
      await whenFirstSweepSettled();
      if (cancelled) return;
      const state = useEPurseStore.getState();
      const rewards = useRewardStore.getState();
      rewards.checkIn(
        selectYesterdayTransactionCount(state),
        selectGapTransactionCount(state, rewards.lastCheckedInDate),
      );
    })();
    return () => { cancelled = true; };
  }, [ready, rewardsHydrated]);
  return null;
}
