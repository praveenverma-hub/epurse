// Temporary feature gates for preview / development builds.
// IS_PREVIEW_BUILD is true in:
//   • expo start (dev mode, __DEV__)
//   • EAS preview APKs (EXPO_PUBLIC_APP_VARIANT injected by eas.json)
// It is false in production store builds.
export const IS_PREVIEW_BUILD: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_APP_VARIANT === 'preview';

// Narrower than IS_PREVIEW_BUILD: true ONLY for the developer's own machine —
// expo start (__DEV__) or an EAS "development" dev-client build (EXPO_PUBLIC_APP_VARIANT
// injected by eas.json) — never a preview APK handed to QA/testers. Use this
// instead of IS_PREVIEW_BUILD for anything more sensitive than a debug tool,
// e.g. bypassing a login requirement.
export const IS_DEV_BUILD: boolean =
  __DEV__ || process.env.EXPO_PUBLIC_APP_VARIANT === 'development';
