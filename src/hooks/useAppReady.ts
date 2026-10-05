import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useStoreHydrated } from './useStoreHydrated';
import { useEPurseStore } from '../store/ePurseStore';
import { useAppLockSession } from '../store/useAppLockSession';

/** User-facing work waits for sign-in, unlock and an active app. */
export function useAppReady() {
  const hydrated = useStoreHydrated();
  const onboarded = useEPurseStore((s) => s.hasOnboarded);
  const loggedIn = useEPurseStore((s) => s.isLoggedIn);
  const lockEnabled = useEPurseStore((s) => s.appLockEnabled);
  const unlocked = useAppLockSession((s) => s.unlocked);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return hydrated && onboarded && loggedIn && active && (!lockEnabled || unlocked);
}
