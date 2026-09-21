// =============================================================================
// remoteConfig.ts — the small amount of configuration the app is allowed to
// learn AFTER it ships, without a store release.
//
// Two jobs, one document, one network request per launch:
//
//   1. VERSION GATING   — `minSupportedVersion` blocks a build we can no longer
//                         support (hard update); `latestVersion` nudges (soft).
//   2. SECTION FLAGS    — a remote override for a hand-picked subset of
//                         `STATIC_CONFIG`, so a section can be switched off in
//                         production without shipping an APK.
//
// TWO documents, not one: `REMOTE_CONFIG_URLS.test` for every "-test"
// build.sh target, `.prod` for every "-prod"/prod one — see the constants
// below for exactly which axis decides that. Everyone testing a lower
// `minSupportedVersion` or an early flag flip is doing it against the test
// file; the prod file only ever changes on purpose. One store, keyed by
// `REMOTE_CONFIG_CACHE_KEY` (which already bakes the env in), holds whichever
// one THIS build fetches.
//
// ── Why a static JSON file and not a service ──
// ePurse makes exactly ONE other network call in its entire lifetime (Google
// Drive backup). That is the privacy claim, and it is worth protecting: this is
// a plain GET of a public file on our own domain, with no body, no identifiers
// and no cookies. Firebase Remote Config would do the same job and cost us that
// sentence, so it was not used.
//
// ── The rules this module is built around ──
//
//   FAIL OPEN. Every failure path — offline, 404, malformed JSON, a key we do
//   not recognise, a version string we cannot parse — resolves to "no opinion",
//   and the app behaves exactly as its build-time defaults say. A config server
//   that is down must never be able to brick an install, and a BLOCKING gate
//   driven by a remote value is the one place where that is a real risk.
//
//   ALLOW-LIST, NEVER MERGE. Unknown keys are dropped and every value is type-
//   checked before it is stored. The file is fetched over HTTPS from a domain we
//   own, but it is still the only untrusted input in the app, and it reaches a
//   full-screen gate. `Object.assign(defaults, json)` would let a typo'd key
//   sit in the cache forever.
//
//   ONLY WHAT SURVIVES A RESTART. See REMOTE_FLAG_KEYS below — a flag is
//   remotable only if flipping it at the NEXT launch is good enough, because
//   that is all this can honestly promise.
//
// Everything here is pure and dependency-free apart from `fetchRemoteConfig`,
// whose `fetch` is injected — `remoteConfig.test.mjs` exercises the whole
// sanitiser and both version paths headlessly.
// =============================================================================

import { STATIC_CONFIG } from './staticConfig';

/**
 * TWO documents, not one — a dev/QA build must never be gated or flagged by
 * the same file that governs everyone else's install, and production must
 * never see a value we're still trying out on ourselves.
 *
 * Both are public, static JSON files on our own domain — no query string, no
 * headers, nothing that could identify the installation.
 */
export const REMOTE_CONFIG_URLS = {
  test: 'https://epurse.co.in/app-config.test.json',
  prod: 'https://epurse.co.in/app-config.json',
} as const;

export type RemoteConfigEnv = keyof typeof REMOTE_CONFIG_URLS;

/**
 * Which document a build fetches is decided by `build.sh`'s own target-name
 * SUFFIX — every "-test" target fetches the test document, every "-prod"/
 * `prod` target fetches the real one:
 *
 *   dev-test / stage-test          (plain local Gradle) → 'test'
 *   dev-prod / stage-prod / prod   (the EAS pipeline)    → 'prod'
 *
 * There is no `prod-test` — see `build.sh`'s header. `EXPO_PUBLIC_BUILD_KIND`
 * carries the signal: `build.sh`'s LOCAL branch (only ever reached by
 * dev-test/stage-test now) exports it as `'test'`; every `eas.json` build
 * profile's `env` block sets it to `'prod'` (development/stage/production
 * profiles ALL get `'prod'` — every EAS-triggered build is `'prod'` by
 * construction, since EAS is never invoked for a "-test" target at all).
 * Absent entirely (plain `expo start`, no build.sh/EAS involved) defaults to
 * `'test'` — the most test-like context there is.
 */
export const resolveRemoteConfigEnv = (buildKind: string | undefined): RemoteConfigEnv =>
  buildKind === 'prod' ? 'prod' : 'test';

export const resolveRemoteConfigUrl = (env: RemoteConfigEnv): string => REMOTE_CONFIG_URLS[env];

/** The URL THIS build actually fetches. */
export const REMOTE_CONFIG_ENV: RemoteConfigEnv = resolveRemoteConfigEnv(process.env.EXPO_PUBLIC_BUILD_KIND);
export const REMOTE_CONFIG_URL: string = resolveRemoteConfigUrl(REMOTE_CONFIG_ENV);

/**
 * AsyncStorage key (via `utils/storage`, which adds the `@ePurse:` prefix).
 * Namespaced by env regardless: since Sep-2026 (see `app.config.js`) the 4
 * non-prod targets each carry their own `applicationIdSuffix`, so they're
 * already OS-level isolated from `prod` and from each other — but keep the
 * per-env key anyway as defense in depth (e.g. a future target that reuses a
 * package id, or a manual override) rather than relying on that isolation.
 */
export const resolveRemoteConfigCacheKey = (env: RemoteConfigEnv): string => `remoteConfig:${env}`;
export const REMOTE_CONFIG_CACHE_KEY: string = resolveRemoteConfigCacheKey(REMOTE_CONFIG_ENV);

/** Give up rather than hold the boot path open on a slow network. */
export const FETCH_TIMEOUT_MS = 8000;

/** Don't re-fetch on every foreground; a config file changes a few times a year. */
export const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// ─── What is remotable ───────────────────────────────────────────────────────

/**
 * The `STATIC_CONFIG` switches a remote file may override, and nothing else.
 *
 * All four are SECTIONS — a whole feature the user can reach or cannot. Each is
 * read through `useFeatureFlag`, so flipping one re-renders the screens that
 * show it, and turning one off removes an entry point rather than changing the
 * shape of something already on screen.
 *
 * DELIBERATELY NOT REMOTABLE: `header.*`, `theme.canvasThemes` and
 * `dashboard.*`. Those are look-and-layout choices captured at MODULE LOAD
 * (`const CANVAS_THEMES_ENABLED = …` in themes.js, and every `StyleSheet.create`
 * that reads from it), so a value arriving after the first render cannot reach
 * them. Listing one here would produce a switch that silently does nothing —
 * which is worse than not having it.
 */
export const REMOTE_FLAG_KEYS = ['shop', 'inviteEarn', 'rating', 'smsDiagnostic'] as const;

export type RemoteFlagKey = (typeof REMOTE_FLAG_KEYS)[number];

export type RemoteFlags = Readonly<Partial<Record<RemoteFlagKey, boolean>>>;

/** The build-time value a flag falls back to whenever there is no override. */
export const flagDefault = (key: RemoteFlagKey): boolean => STATIC_CONFIG[key].enabled;

export interface RemoteConfig {
  /** Below this, the app is unusable and `UpdateRequiredGate` blocks it. `null` = no opinion. */
  minSupportedVersion: string | null;
  /** The newest release. Above the installed version, the user gets a bell nudge. */
  latestVersion: string | null;
  /** Optional one-line reason shown on the blocking screen. */
  updateMessage: string | null;
  flags: RemoteFlags;
  /** Epoch ms this config was accepted — set by us, never read from the file. */
  fetchedAt: number;
}

/** No opinion on anything: what every failure resolves to. */
export const EMPTY_FLAGS: RemoteFlags = Object.freeze({});

// ─── Versions ────────────────────────────────────────────────────────────────

/**
 * `"1.5.0"` → `[1, 5, 0]`, or `null` for anything that is not a plain numeric
 * dotted version. Returning null (rather than coercing) is what makes the gate
 * fail open on a typo — `"v1.5"`, `"1.5.0-beta"` and `""` all mean "no opinion"
 * instead of "block everyone".
 */
export const parseVersion = (v: unknown): number[] | null => {
  if (typeof v !== 'string') return null;
  const parts = v.trim().split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,6}$/.test(p)) return null;
    nums.push(Number(p));
  }
  return nums;
};

/** -1 / 0 / 1, comparing segment by segment with missing segments as 0. */
export const compareVersions = (a: string, b: string): number => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0; // unparseable compares equal → no opinion
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
};

/** True only when both parse AND `version` is strictly older than `floor`. */
export const isVersionBelow = (version: string, floor: string | null): boolean => {
  if (!floor || !parseVersion(version) || !parseVersion(floor)) return false;
  return compareVersions(version, floor) < 0;
};

// ─── Sanitising ──────────────────────────────────────────────────────────────

const asVersion = (v: unknown): string | null => (parseVersion(v) ? (v as string).trim() : null);

const asMessage = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  // Capped so a runaway string can't push the button off a small screen.
  return t.length > 0 && t.length <= 200 ? t : null;
};

/**
 * Turn whatever the network returned into a `RemoteConfig`, or `null` if there
 * is nothing usable in it. Only known keys survive, and only at the right type;
 * a flag that is a string, a number or `"false"` is DROPPED rather than coerced,
 * so a mistake in the file leaves the build-time default in place.
 */
export const sanitiseRemoteConfig = (raw: unknown, now: number): RemoteConfig | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;

  const flags: Partial<Record<RemoteFlagKey, boolean>> = {};
  const rawFlags = src.flags;
  if (rawFlags && typeof rawFlags === 'object' && !Array.isArray(rawFlags)) {
    for (const key of REMOTE_FLAG_KEYS) {
      const v = (rawFlags as Record<string, unknown>)[key];
      if (typeof v === 'boolean') flags[key] = v;
    }
  }

  return {
    minSupportedVersion: asVersion(src.minSupportedVersion),
    latestVersion:       asVersion(src.latestVersion),
    updateMessage:       asMessage(src.updateMessage),
    flags:               Object.freeze(flags),
    fetchedAt:           now,
  };
};

// ─── Fetching ────────────────────────────────────────────────────────────────

export interface FetchDeps {
  fetch: typeof fetch;
  now: () => number;
  url: string;
  timeoutMs: number;
}

const defaultDeps = (): FetchDeps => ({
  fetch: globalThis.fetch,
  now: Date.now,
  url: REMOTE_CONFIG_URL,
  timeoutMs: FETCH_TIMEOUT_MS,
});

/**
 * One GET, bounded by a timeout, that never throws and never rejects. `null`
 * means "we learned nothing" — the caller keeps whatever it already had.
 */
export const fetchRemoteConfig = async (overrides: Partial<FetchDeps> = {}): Promise<RemoteConfig | null> => {
  const deps = { ...defaultDeps(), ...overrides };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const res = await deps.fetch(deps.url, {
      method: 'GET',
      // `no-store` matters: a CDN-cached 404 from before the file existed would
      // otherwise stick around for as long as its max-age.
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return sanitiseRemoteConfig(await res.json(), deps.now());
  } catch {
    // Offline, DNS failure, timeout, malformed JSON — all the same answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
};
