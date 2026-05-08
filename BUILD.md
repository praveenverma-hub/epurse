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
npm run build:apk               # alias for: eas build -p android --profile preview
```

When it finishes (~10 min in the cloud) EAS gives you a download URL. Open it on your phone to install. You may need to enable "Install unknown apps" for your browser the first time.

---

## Option 3 — Local APK (fastest CI, requires Android SDK)

If you have Android Studio + the Android SDK installed locally:

```bash
cd ~/Desktop/pvn/ePurse
npm install
npm run build:apk-local
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

1. Build with `npm run build:apk-local` (or `npx expo run:android`) — Expo Go *cannot* read SMS.
2. Open the app → tap the gear icon (top-right of the dashboard) → **Categories & Settings**.
3. Toggle **Auto-import SMS** on. The OS prompt asks for `READ_SMS` + `RECEIVE_SMS`.
4. The app pulls the last 30 days of inbox messages, parses them, and auto-updates account balances. Live SMS arriving thereafter are added in real time.

### Notes

- **Dedup is built in** — a message you paste manually after the listener already caught it won't double-count (5-minute window, matches on amount + account mask + merchant).
- **Balance updates** are applied every time a transaction lands (real, simulated, or manual). Deleting a transaction reverses the balance change.
- **Play Store policy**: `READ_SMS` is restricted. To publish, declare ePurse as a "financial transaction tracker" in the permissions form — Google reviews these manually.
- **iOS**: Apple does not allow third-party apps to read SMS. The toggle is disabled on iOS, and the simulated/paste flow is the only option there.

---

## Troubleshooting

- **"Network response timed out"** in Expo Go → use `npx expo start --tunnel`.
- **EAS asks to log in** → free signup at https://expo.dev.
- **`expo` command not found** → use `npx expo` instead of `expo`.
- **Metro fails to start** → delete `node_modules` and `.expo`, then `npm install` again.
- **`iconBackground` AAPT error during build** → already fixed via the `withEPurseAndroid` config plugin in `plugins/`. If it ever recurs, add `<color name="iconBackground">#FF5A1F</color>` to `android/app/src/main/res/values/colors.xml`.
- **SMS auto-import toggle is greyed out** → either the app is iOS / Expo Go (no native module), or you haven't run `prebuild` after adding the SMS libraries. Run `npx expo prebuild --clean && npx expo run:android`.
