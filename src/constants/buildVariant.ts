// Feature gates keyed off the build environment: dev | stage | prod.
// IS_STAGE_BUILD is true in:
//   • expo start (dev mode, __DEV__)
//   • stage builds (EXPO_PUBLIC_APP_VARIANT injected by eas.json / build.sh)
// It is false in production store builds.
export const IS_STAGE_BUILD: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_APP_VARIANT === 'stage';

// Narrower than IS_STAGE_BUILD: true ONLY for the developer's own machine —
// expo start (__DEV__) or an EAS "development" dev-client build (EXPO_PUBLIC_APP_VARIANT
// injected by eas.json) — never a stage APK handed to QA/testers. Use this
// instead of IS_STAGE_BUILD for anything more sensitive than a debug tool,
// e.g. bypassing a login requirement.
export const IS_DEV_BUILD: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_APP_VARIANT === 'development';
