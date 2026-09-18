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
// Hand-written Kotlin that prebuild would otherwise drop, plus the ReactPackage
// name each one contributes to MainApplication.
const KOTLIN_SOURCES = [
  'ScreenSecurityModule.kt',
  'ScreenSecurityPackage.kt',
  // Vendored SMS natives — see SmsModule.kt for why they are not npm packages.
  'SmsModule.kt',
  'SmsPackage.kt',
];

const REACT_PACKAGES = ['ScreenSecurityPackage', 'SmsPackage'];

const withNativeSources = (config) =>
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

const withPackagesRegistered = (config) =>
  withMainApplication(config, (cfg) => {
    let contents = cfg.modResults.contents;
    const missing = REACT_PACKAGES.filter((name) => !contents.includes(`${name}()`));
    if (!missing.length) return cfg;

    // RN 0.86 / SDK 57 hands back a MUTABLE list to add into...
    const applyAnchor = 'PackageList(this).packages.apply {';
    // ...while RN <= 0.81 returned an immutable one to concatenate onto. Both are
    // supported so this plugin survives the next template change in one direction.
    const concatAnchor = 'return PackageList(this).packages';

    if (contents.includes(applyAnchor)) {
      contents = contents.replace(
        applyAnchor,
        applyAnchor + missing.map((name) => `\n          add(${name}())`).join('')
      );
    } else if (contents.includes(concatAnchor)) {
      contents = contents.replace(
        concatAnchor,
        concatAnchor + missing.map((name) => ` + ${name}()`).join('')
      );
    } else {
      // Failing loudly matters: a silently unregistered package means app lock
      // stops hiding the app from the recents thumbnail, and SMS capture — the
      // whole product — quietly reads nothing.
      throw new Error(
        'withEPurseAndroid: could not find the package list in MainApplication. ' +
          `Looked for \`${applyAnchor}\` and \`${concatAnchor}\`; the RN template ` +
          `may have changed again. Unregistered would be: ${missing.join(', ')}.`
      );
    }

    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = function withEPurseAndroid(config) {
  config = withIconBackground(config);
  config = withNativeSources(config);
  config = withPackagesRegistered(config);
  return config;
};
