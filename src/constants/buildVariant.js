// Temporary feature gates for preview / development builds.
// IS_PREVIEW_BUILD is true in:
//   • expo start (dev mode, __DEV__)
//   • EAS preview APKs (EXPO_PUBLIC_APP_VARIANT injected by eas.json)
// It is false in production store builds.
export const IS_PREVIEW_BUILD =
  // eslint-disable-next-line no-undef
  __DEV__ || process.env.EXPO_PUBLIC_APP_VARIANT === 'preview';
