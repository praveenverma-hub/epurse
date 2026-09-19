// Feature gates keyed off the build environment: dev | stage | prod.
// IS_STAGE_BUILD is true in:
//   • expo start (dev mode, __DEV__)
//   • dev-client AND stage builds (EXPO_PUBLIC_APP_VARIANT injected by eas.json / build.sh)
// It is false only in production store builds.
//
// Checks BOTH variant strings, not just __DEV__: a dev build must always also
// count as a stage build (IS_DEV_BUILD ⇒ IS_STAGE_BUILD, matching its own doc
// comment below) regardless of whether the Metro-injected `__DEV__` global
// happens to be true in whatever produced the binary — e.g. `remoteConfig.ts`
// picks its remote-config document off THIS flag alone, and dev-test/dev-prod
// must resolve to the test document deterministically, not by accident of
// __DEV__'s value in a given dev-client build.
export const IS_STAGE_BUILD: boolean =
  __DEV__
  || process.env.EXPO_PUBLIC_APP_VARIANT === 'stage'
  || process.env.EXPO_PUBLIC_APP_VARIANT === 'development';

// Narrower than IS_STAGE_BUILD: true ONLY for the developer's own machine —
// expo start (__DEV__) or an EAS "development" dev-client build (EXPO_PUBLIC_APP_VARIANT
// injected by eas.json) — never a stage APK handed to QA/testers. Use this
// instead of IS_STAGE_BUILD for anything more sensitive than a debug tool,
// e.g. bypassing a login requirement.
export const IS_DEV_BUILD: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_APP_VARIANT === 'development';
