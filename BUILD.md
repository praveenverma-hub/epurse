# Building & installing ePurse on your phone

You have three options, fastest first.

---

## Option 1 — Expo Go (no build, ~30 seconds) ⚡ recommended for testing

This is the fastest way to try the app. No APK, no signing, no waiting.

1. Install the **Expo Go** app on your phone
   - Android: https://play.google.com/store/apps/details?id=host.exp.exponent
   - iOS: https://apps.apple.com/app/expo-go/id982107779
2. On your laptop, in the project folder:
   ```bash
   cd ~/Desktop/pvn/ePurse
   npm install      # only the first time
   npx expo start
   ```
3. A QR code appears in the terminal. Scan it with Expo Go (Android) or the Camera app (iOS).
4. Done — the app loads on your phone. Edits hot-reload instantly.

If your phone and laptop are on different networks, run `npx expo start --tunnel` instead.

---

## Option 2 — Standalone APK via EAS Build (cloud, ~10 min)

Produces a real installable `.apk` file. Free tier is generous (30 builds/month).

```bash
# one-time setup
npm install -g eas-cli
eas login                       # sign up free at https://expo.dev

cd ~/Desktop/pvn/ePurse
eas build:configure             # accepts the eas.json that's already in the project

# build the APK
npm run build:stage-prod        # alias for: eas build -p android --profile stage
```

When it finishes (~10 min in the cloud) EAS gives you a download URL. Open it on your phone to install. You may need to enable "Install unknown apps" for your browser the first time.

---

## Option 3 — Local APK (fastest CI, requires Android SDK)

If you have Android Studio + the Android SDK installed locally:

```bash
cd ~/Desktop/pvn/ePurse
npm install
npm run build:stage-test
```

The signed-debug APK lands at:
```
android/app/build/outputs/apk/release/app-release.apk
```

Copy it to your phone via USB / Drive / AirDroid and install.

---

## iOS notes

- **Expo Go (Option 1)** works on iOS without any signing.
- Building an installable `.ipa` requires an Apple Developer account ($99/year). With one, run `npm run build:ios`.
- Without a paid account you can install on a simulator via `eas build -p ios --profile preview` (set to `simulator: true`, already configured).

---

## SMS auto-import (Android only)

ePurse now ships with two SMS modes:

1. **Simulated / paste flow** — works everywhere (Expo Go, iOS, web). Tap "Simulate SMS" on the dashboard or paste an SMS in *Add transaction → From SMS*.
2. **Real SMS reading** — Android only, requires a custom dev build.

### Enabling real SMS reading

1. Build with `npm run build:stage-test` (or `npm run build:dev-test`) — Expo Go *cannot* read SMS.
2. Open the app → tap the gear icon (top-right of the dashboard) → **Categories & Settings**.
3. Toggle **Auto-import SMS** on. The OS prompt asks for `READ_SMS` + `RECEIVE_SMS`.
4. The app pulls the last 30 days of inbox messages, parses them, and auto-updates account balances. Live SMS arriving thereafter are added in real time.

### Notes

- **Dedup is built in** — a message you paste manually after the listener already caught it won't double-count (5-minute window, matches on amount + account mask + merchant).
- **Balance updates** are applied every time a transaction lands (real, simulated, or manual). Deleting a transaction reverses the balance change.
- **Play Store policy**: `READ_SMS` is restricted. To publish, declare ePurse as a "financial transaction tracker" in the permissions form — Google reviews these manually.
- **iOS**: Apple does not allow third-party apps to read SMS. The toggle is disabled on iOS, and the simulated/paste flow is the only option there.

---

## Restoring after a clean (`./setup.sh`)

The inverse of `clean.sh` — puts back dependencies and the native project.

```bash
npm run setup           # npm install → expo prebuild → verify
npm run setup:clean     # same, but prebuild --clean (regenerate android/ from scratch)
npm run setup:ios       # also prebuild ios/ and run pod install (macOS)

npm run prebuild        # just regenerate android/
npm run prebuild:clean  # ...from scratch
```

`setup` ends with two checks worth knowing about:

- **Import verification** — resolves every external import in `src/` and `App.js`
  against the installed tree. This exists because of a real SDK-57 failure:
  `@expo/vector-icons` arrived transitively under SDK 50, vanished in 57, and 63
  files imported it. **No JS test catches that** — the tests are Node-side and never
  resolve the app's React imports, so the first thing to notice was a 3-minute
  release bundle. This catches it in about a second.
- **`expo-doctor`** — catches missing *peer* dependencies, which the import check
  cannot see (nothing imports them directly). It found `expo-font`, a peer of
  `@expo/vector-icons`, whose absence crashes the app outside Expo Go.

## Environment builds (`./build.sh`)

Two independent axes, combined into one target name.

**Environment** — what the *app* does. Sets `EXPO_PUBLIC_APP_VARIANT`, which drives
the flags in `src/constants/buildVariant.ts`:

| Environment | `EXPO_PUBLIC_APP_VARIANT` | `IS_DEV_BUILD` | `IS_STAGE_BUILD` | Effect |
|---|---|---|---|---|
| `dev` | `development` | ✅ | ✅ | debug tools + login bypass |
| `stage` | `stage` | ❌ | ✅ | debug tools, no bypass |
| `prod` | *(unset)* | ❌ | ❌ | nothing gated on |

**Where** — who builds and signs it. Changes nothing about the app itself:

- `-test` → **this machine**, debug-signed. Sideload only; Play rejects it.
- `-prod` → **EAS cloud**, real signing credentials, distributable.

```bash
npm run build:dev-test      # local dev client (Metro attached)
npm run build:dev-prod      # EAS dev client, shareable

npm run build:stage-test    # local release APK
npm run build:stage-prod    # EAS APK for testers

npm run build:prod-test     # local AAB — verification only
npm run build:prod          # EAS AAB for Play

npm run build:ios           # EAS, stage profile
```

`prod-test` is worth knowing about: it is the only way to exercise the
**production** code paths locally. `dev` and `stage` differ from `prod` precisely
in what those flags gate, so a bug that only appears with both flags false will
not show up in any stage build — and the next place you would find it is a store
upload.

**Local builds are debug-signed** (the stock React Native template default). EAS
injects real credentials; see `docs/ANDROID_RELEASE.md` §3.1 for why `build.gradle`
must be left alone rather than given a release signingConfig.

## Cleaning caches (`./clean.sh`)

Most "impossible" build failures are stale caches, not broken code — a build that
fails on something you already fixed, or succeeds on something you already deleted.
Metro is the usual culprit: it keys its cache on a project hash rather than on
`package.json`, so adding or removing a dependency leaves a map behind that still
resolves the old module graph.

```bash
npm run clean            # everything safe: caches + android + pods

# targeted
npm run clean:cache      # Metro/Haste, watchman, .expo, node_modules/.cache
npm run clean:pods       # ios/Pods, Podfile.lock, ios/build
npm run clean:android    # android build output + .cxx, stops gradle daemons
npm run clean:deps       # reinstall node_modules
npm run clean:native     # regenerate android/ (expo prebuild --clean)
npm run clean:gradle     # Gradle GLOBAL caches (re-downloads dependencies)
npm run clean:all        # clean + deps + native

./clean.sh --dry-run     # print what would be removed, delete nothing
```

Which one to reach for:

| Symptom | Use |
|---|---|
| Odd bundling error, changes not picked up | `npm run clean:cache` |
| `Unable to resolve module X` when X *is* installed | `npm run clean:deps` |
| Changed `app.json`, a config plugin, or `plugins/android/*.kt` | `npm run clean:native` |
| iOS build resolving a pod version you already changed | `npm run clean:pods` |
| Gradle resolving a dependency version that no longer exists | `npm run clean:gradle` |
| No idea | `npm run clean` |

Flags compose: `./clean.sh --cache --android` cleans just those two. Passing no
target flag runs all three.

`clean:pods` also deletes `Podfile.lock` — a stale lock is exactly why `pod install`
keeps resolving the version you just changed away from. Run `npx pod-install`
afterwards.

`--gradle` is deliberately excluded from `--all`: it re-downloads every dependency
and is rarely what you need.

**Note:** `android/` is GENERATED. `clean:native` regenerates it from `app.json` +
the config plugins, and only hand-written natives in `plugins/android/` survive
(the plugin copies them back). Never hand-edit `android/`.

## Troubleshooting

- **"Network response timed out"** in Expo Go → use `npx expo start --tunnel`.
- **EAS asks to log in** → free signup at https://expo.dev.
- **`expo` command not found** → use `npx expo` instead of `expo`.
- **Metro fails to start** → delete `node_modules` and `.expo`, then `npm install` again.
- **`iconBackground` AAPT error during build** → already fixed via the `withEPurseAndroid` config plugin in `plugins/`. If it ever recurs, add `<color name="iconBackground">#FF5A1F</color>` to `android/app/src/main/res/values/colors.xml`.
- **SMS auto-import toggle is greyed out** → either the app is iOS / Expo Go (no native module), or you haven't run `prebuild` after adding the SMS libraries. Run `npx expo prebuild --clean && npx expo run:android`.
