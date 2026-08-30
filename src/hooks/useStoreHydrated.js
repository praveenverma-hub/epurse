// =============================================================================
// useStoreHydrated — has the persisted store finished loading from AsyncStorage?
//
// Zustand's `persist` rehydrates ASYNCHRONOUSLY. Nothing in the app waited for
// it, so on a cold start every screen rendered once against an EMPTY store and
// then again against the real one. On the Dashboard that was visible: with no
// transactions, no budget and no bills, every live Home card returns null and the
// carousel falls back to its promo cards — so a user mid-month saw five feature
// banners flash past before their actual data arrived, and because the card ids
// change completely between those two sets, the FlatList unmounted and remounted
// every item underneath the scroll position.
//
// An empty store is not the same thing as a user with no data, and this is how a
// surface tells the two apart.
// =============================================================================

import { useEffect, useState } from 'react';

import { useEPurseStore } from '../store/ePurseStore';

/**
 * @param store any zustand store created with `persist` — defaults to the finance
 *   store. Parameterised because the REWARD store rehydrates separately and the
 *   two race: its payload is tiny (a few counters) while the finance store carries
 *   every transaction, so the rewards land first. Anything reading both has to
 *   wait for both, or it reasons about a half-loaded app.
 */
export const useStoreHydrated = (store = useEPurseStore) => {
  // Rehydration can finish BEFORE a component mounts (a warm start, or simply a
  // small payload), in which case the subscription below never fires — so seed
  // from the current value rather than always starting false.
  const [hydrated, setHydrated] = useState(() => !!store.persist?.hasHydrated?.());

  useEffect(() => {
    if (hydrated) return undefined;
    // Fires on success AND on a rehydration error: a store that failed to load is
    // finished loading, and holding the UI in a skeleton for ever would be worse
    // than showing the empty state.
    const unsub = store.persist?.onFinishHydration?.(() => setHydrated(true));
    // Re-check in case it completed between the useState initialiser and here.
    if (store.persist?.hasHydrated?.()) setHydrated(true);
    return unsub;
  }, [hydrated, store]);

  return hydrated;
};

export default useStoreHydrated;
