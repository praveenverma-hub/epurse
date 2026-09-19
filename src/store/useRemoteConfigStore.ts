// =============================================================================
// useRemoteConfigStore — holds the one remote config document, and nothing else.
//
// Shape note: everything except `flags` is a flat primitive. That is deliberate
// under zustand v5, where a selector's result is compared BY REFERENCE — a
// selector returning a primitive is stable for free, and the one object here
// (`flags`) is only ever replaced when its contents actually differ, so
// `s.flags[key]` never churns. See constants/empty.ts for the failure mode.
//
// Two phases, in this order, both driven by `RemoteConfigBoot` in App.js:
//
//   1. hydrate() — read the cached document. Synchronous as far as the user is
//      concerned, and the reason a section stays switched off across a restart
//      while the device is offline.
//   2. refresh() — one network GET, throttled. Whatever it learns is applied and
//      written back to the cache for the next launch.
//
// `loaded` means "the cache has been read", NOT "the network answered". Only
// the blocking gate waits on it, and only to avoid flashing itself at someone
// who is about to turn out to be on a perfectly fine version.
// =============================================================================

import { create } from 'zustand';

import { Storage } from '../utils/storage';
import { STATIC_CONFIG } from '../config/staticConfig';
import {
  EMPTY_FLAGS,
  REMOTE_CONFIG_CACHE_KEY,
  REFRESH_INTERVAL_MS,
  fetchRemoteConfig,
  sanitiseRemoteConfig,
  type RemoteConfig,
  type RemoteFlagKey,
  type RemoteFlags,
} from '../config/remoteConfig';

interface State {
  flags: RemoteFlags;
  minSupportedVersion: string | null;
  latestVersion: string | null;
  updateMessage: string | null;
  /** The cached document has been read (it may have been absent). */
  loaded: boolean;

  hydrate: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
}

/**
 * Module scope, not store state, on purpose: nothing renders from these, and
 * putting a timestamp that changes on every foreground into the store would
 * wake every subscriber for no visible reason.
 */
let lastAttemptAt = 0;
let inFlight: Promise<void> | null = null;

const sameFlags = (a: RemoteFlags, b: RemoteFlags): boolean => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k as RemoteFlagKey] === b[k as RemoteFlagKey]);
};

export const useRemoteConfigStore = create<State>()((set, get) => {
  /** Write a document into state, holding `flags`' reference steady if it didn't change. */
  const apply = (cfg: RemoteConfig): void => {
    const prev = get().flags;
    set({
      flags: sameFlags(prev, cfg.flags) ? prev : cfg.flags,
      minSupportedVersion: cfg.minSupportedVersion,
      latestVersion: cfg.latestVersion,
      updateMessage: cfg.updateMessage,
    });
  };

  return {
    flags: EMPTY_FLAGS,
    minSupportedVersion: null,
    latestVersion: null,
    updateMessage: null,
    loaded: false,

    hydrate: async () => {
      if (!STATIC_CONFIG.remoteConfig.enabled) {
        set({ loaded: true });
        return;
      }
      // Re-sanitised on the way OUT of the cache as well as on the way in: the
      // allow-list may have SHRUNK since the document was written, and a key we
      // have since retired must not come back to life from disk.
      const cached = sanitiseRemoteConfig(await Storage.get(REMOTE_CONFIG_CACHE_KEY), Date.now());
      if (cached) apply(cached);
      set({ loaded: true });
    },

    refresh: async (force = false) => {
      if (!STATIC_CONFIG.remoteConfig.enabled) return;
      if (inFlight) return inFlight;
      const now = Date.now();
      if (!force && now - lastAttemptAt < REFRESH_INTERVAL_MS) return;
      lastAttemptAt = now;

      inFlight = (async () => {
        const cfg = await fetchRemoteConfig();
        if (!cfg) return; // offline / 404 / junk — keep whatever we already had
        apply(cfg);
        await Storage.set(REMOTE_CONFIG_CACHE_KEY, cfg);
      })().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
});

/** Test seam — `refresh()` throttles across calls, which a test needs to undo. */
export const __resetRemoteConfigThrottle = (): void => {
  lastAttemptAt = 0;
  inFlight = null;
};
