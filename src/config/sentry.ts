// =============================================================================
// sentry.ts — crash/error reporting only. No performance tracing, no session
// replay, no breadcrumb network capture — those all ship more data off-device
// than a "we don't have a backend" finance app should take on for an MVP.
//
// Disabled entirely under `__DEV__` (plain `expo start`/Metro): local
// hot-reload errors and dev-only warnings would otherwise burn the free-tier
// quota with noise nobody needs a report for. Enabled for every dev-client,
// stage, and production BUILD, tagged with `environment` so the three never
// mix in one Sentry project — same dev/stage/production vocabulary as
// `constants/buildVariant.ts`.
//
// DSN is not a secret — Sentry's client DSNs are meant to sit in the shipped
// bundle, that's how the SDK reaches the right project.
// =============================================================================
import * as Sentry from '@sentry/react-native';

import { IS_DEV_BUILD, IS_STAGE_BUILD } from '../constants/buildVariant';

export const SENTRY_DSN = 'https://a5d7c8202b45d076eacededc732bf929@o4512113140760576.ingest.de.sentry.io/4512113144365136';

export const SENTRY_ENVIRONMENT: 'development' | 'stage' | 'production' =
  IS_DEV_BUILD ? 'development' : IS_STAGE_BUILD ? 'stage' : 'production';

/**
 * Best-effort, matching the rest of the app's pattern for anything that
 * touches a native module right at boot (`AuthSessionBoot`, `googleAuth`'s
 * revoke): a build installed before `@sentry/react-native`'s native side has
 * actually been rebuilt (a dev-client that predates this change) must not
 * crash on launch just because crash reporting itself isn't wired up yet.
 */
export function initSentry(): void {
  if (__DEV__ || !SENTRY_DSN) return;
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: SENTRY_ENVIRONMENT,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
  } catch (e) {
    console.warn('Sentry.init failed', e);
  }
}
