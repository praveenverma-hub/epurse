// =============================================================================
// useFeatureFlag — read a SECTION switch, remote override first, build-time
// default second.
//
//   const SHOP_ENABLED = useFeatureFlag('shop');
//
// This is the only way those four switches should be read from a component.
// Reading `STATIC_CONFIG.shop.enabled` straight is still correct TypeScript and
// still compiles — it just silently opts that call site out of ever being
// switched off in production, which is the whole point of the mechanism.
//
// Why a hook and not a constant: the previous shape was
// `const SHOP_ENABLED = STATIC_CONFIG.shop.enabled` at MODULE scope, evaluated
// once when the file is first imported. A value that arrives from the network
// after that can never reach it. The hook subscribes instead, so the screen
// re-renders when the override lands.
//
// The selector returns a boolean-or-undefined — a primitive — so it is stable
// under zustand v5's reference comparison with nothing extra. Do NOT "tidy"
// this into a selector that computes the fallback inside the store read; see
// constants/empty.ts for why an allocating selector loops.
// =============================================================================

import { useRemoteConfigStore } from '../store/useRemoteConfigStore';
import { flagDefault, type RemoteFlagKey } from '../config/remoteConfig';

export function useFeatureFlag(key: RemoteFlagKey): boolean {
  const override = useRemoteConfigStore((s) => s.flags[key]);
  return override ?? flagDefault(key);
}

/**
 * The same answer outside React (effects, store actions, one-off checks).
 * Prefer the hook anywhere a render depends on it — this one cannot re-render.
 */
export function getFeatureFlag(key: RemoteFlagKey): boolean {
  return useRemoteConfigStore.getState().flags[key] ?? flagDefault(key);
}

export default useFeatureFlag;
