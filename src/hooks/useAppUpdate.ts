// =============================================================================
// useAppUpdate — is this build too old to run, and is there a newer one?
//
// Two distinct answers, deliberately not one enum:
//
//   blocked — the installed version is below `minSupportedVersion`. HARD: the
//             user cannot use the app. `UpdateRequiredGate` covers everything.
//   nudge   — there is a newer version than the installed one. SOFT: the app
//             works normally and the user is told once, through the bell.
//
// `blocked` stays FALSE until the cached config has been read (`loaded`), so a
// user on a perfectly fine version never sees the gate flash on launch.
//
// Both fail open by construction: `isVersionBelow` returns false whenever
// either side is absent or unparseable, so "we don't know" always resolves to
// "let them in". See the FAIL OPEN note in config/remoteConfig.ts.
// =============================================================================

import { useRemoteConfigStore } from '../store/useRemoteConfigStore';
import { isVersionBelow } from '../config/remoteConfig';
import { APP_VERSION } from '../constants/appMeta';

export interface AppUpdateState {
  /** Block the app: this build is below the supported floor. */
  blocked: boolean;
  /** A newer version exists; the app still works. */
  nudge: boolean;
  /** The version being nudged towards — the bell entry dedupes on it. */
  latestVersion: string | null;
  /** Optional line from the config file, shown on the blocking screen. */
  message: string | null;
}

export function useAppUpdate(): AppUpdateState {
  // Four primitive selectors rather than one object selector: an object built
  // inside a zustand v5 selector is a new reference every call and loops.
  const loaded = useRemoteConfigStore((s) => s.loaded);
  const minSupportedVersion = useRemoteConfigStore((s) => s.minSupportedVersion);
  const latestVersion = useRemoteConfigStore((s) => s.latestVersion);
  const message = useRemoteConfigStore((s) => s.updateMessage);

  return {
    blocked: loaded && isVersionBelow(APP_VERSION, minSupportedVersion),
    nudge: isVersionBelow(APP_VERSION, latestVersion),
    latestVersion,
    message,
  };
}

export default useAppUpdate;
