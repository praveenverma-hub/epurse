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
const {
  withAndroidColors,
  withDangerousMod,
  withMainApplication,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ICON_BG = '#FF5A1F';

const withIconBackground = (config) =>
  withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.setColorItem(
      { $: { name: 'iconBackground' }, _: ICON_BG },
      cfg.modResults
    );
    return cfg;
  });

// ScreenSecurity — the FLAG_SECURE bridge module AppLockGate calls to keep the
// app's content out of the recent-apps thumbnail. It lives in hand-written
// Kotlin under `plugins/android/`, and prebuild (which regenerates `android/`
// wholesale, dropping anything not produced by a plugin) copies it back in and
// re-registers it. `expo-screen-capture` is NOT an option here: its bundled
// manifest caps DETECT_SCREEN_CAPTURE at maxSdkVersion 34 while its native
// OnCreate still calls the API, so it hard-crashes at launch on Android 15+.
const KOTLIN_SOURCES = ['ScreenSecurityModule.kt', 'ScreenSecurityPackage.kt'];

const withScreenSecuritySources = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const pkg = AndroidConfig.Package.getPackage(cfg);
      if (!pkg) throw new Error('withEPurseAndroid: android.package is not set');
      const destDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java',
        ...pkg.split('.')
      );
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of KOTLIN_SOURCES) {
        const src = path.join(__dirname, 'android', file);
        fs.writeFileSync(path.join(destDir, file), fs.readFileSync(src, 'utf8'));
      }
      return cfg;
    },
  ]);

const withScreenSecurityRegistered = (config) =>
  withMainApplication(config, (cfg) => {
    if (cfg.modResults.contents.includes('ScreenSecurityPackage()')) return cfg;
    const anchor = 'return PackageList(this).packages';
    if (!cfg.modResults.contents.includes(anchor)) {
      throw new Error(
        'withEPurseAndroid: could not find the package list in MainApplication — ' +
          'ScreenSecurity would be missing and app lock would silently stop ' +
          'hiding the app from the recents thumbnail.'
      );
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(
      anchor,
      `${anchor} + ScreenSecurityPackage()`
    );
    return cfg;
  });

module.exports = function withEPurseAndroid(config) {
  config = withIconBackground(config);
  config = withScreenSecuritySources(config);
  config = withScreenSecurityRegistered(config);
  return config;
};
