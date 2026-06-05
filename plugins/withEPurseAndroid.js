// =============================================================================
// withEPurseAndroid — local Expo config plugin
// -----------------------------------------------------------------------------
// Why this exists:
//   1. Expo CLI 50's prebuild occasionally drops the `iconBackground` colour
//      that adaptive-icon XML references — leading to AAPT errors during
//      `:app:processDebugResources`. This plugin guarantees the colour is
//      always present in `values/colors.xml`.
//   2. It's a clean home for any future Android-only tweaks (e.g. extra
//      activity flags, manifest meta-data, etc.).
// =============================================================================

// Use expo's sub-export (not the standalone @expo/config-plugins package) so the
// version always matches the installed Expo SDK. See `expo-doctor`.
const { withAndroidColors, AndroidConfig } = require('expo/config-plugins');

const ICON_BG = '#FF5A1F';

const withIconBackground = (config) =>
  withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.setColorItem(
      { $: { name: 'iconBackground' }, _: ICON_BG },
      cfg.modResults
    );
    return cfg;
  });

module.exports = function withEPurseAndroid(config) {
  config = withIconBackground(config);
  return config;
};
