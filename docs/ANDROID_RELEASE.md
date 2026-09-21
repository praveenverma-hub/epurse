# Android Release Plan — ePurse

Target: first production release on Google Play.
Domain: `epurse.co.in`. Package: `com.epurse.app`. EAS project: `aa096ea5-…` (owner `13pvn`).

Status of this document: **plan, nothing executed yet.** Written 2026-09-18 against
`app.json` v1.5.0 / Expo SDK 50 / `versionCode 1`.

---

## 0. Read this first — the four things that can sink the release

These are not checklist items, they are decisions. Everything in §3 onwards is
cheap by comparison; these are not. Settle them before spending a day on store
screenshots.

### 0.1 `READ_SMS` / `RECEIVE_SMS` — a **named permitted use case**, but still declared

**Correction (2026-09-19).** An earlier draft of this document said personal-finance
transaction tracking was not on Google's permitted-use list. **That was wrong.** Verified
against the policy itself, the exceptions table contains, verbatim:

> **SMS-based money management** — "For example, apps that track and manage budget"
> Eligible permissions: `READ_SMS`, `RECEIVE_MMS`, `RECEIVE_SMS`, `RECEIVE_WAP_PUSH`

That is precisely what ePurse is. It also survives into the upcoming policy revision
(effective **2027-01-27**), which trims `READ_CALL_LOG` for account verification but keeps
SMS-based money management on the list. So this is a **declaration to prepare carefully,
not a wall to design around.**

**Precedent.** Axio — the Amazon-owned Indian fintech, formerly Capital Float, and the app
formerly known as **Walnut** (`com.daamitt.walnut.app`) — is the best-known SMS expense
tracker in India and is live on Play today. Its own permission disclosure says SMS is used
by Money Manager to analyse transactional SMS for spend detection, bills and budgeting,
and states that it does not read personal SMS or upload sensitive data. That is the same
exception, argued the same way. (Note that Axio also runs lending products; "fraud
prevention" is *not* a standalone exception, so it is the money-management use case that
carries the expense tracker.)

**What approval actually turns on.** Being eligible is not the same as being approved. The
declaration is judged on whether the permission is *core* and whether an alternative would
do. Prepare:

1. **Permissions Declaration Form** (Play Console → App content → Sensitive app
   permissions), selecting **SMS-based money management**.
2. **Demo video** — unlisted YouTube: install → prominent disclosure → grant SMS → a bank
   SMS arrives → the transaction appears. Show the feature, not the UI tour.
3. **The on-device argument, stated plainly.** Raw SMS never leaves the device, and
   ePurse can actually prove it: the backup payload allow-list in `src/backup/` is a
   parsed-values-only whitelist that structurally cannot carry message bodies, and there
   is no server at all. Make this the first line of the justification — it is a stronger
   position than most applicants have.
4. **Prominent disclosure before the runtime prompt** (§3.5) and a privacy policy whose
   SMS section matches the Data Safety form line for line (§2.2, §5.2).
5. Keep the permission genuinely core. Requesting SMS while the app also works fully
   without it invites the "an alternative exists" rejection.

**Fallbacks are now insurance, not an expectation.** Worth knowing they exist, but they
should not shape v1:
- **Notification listener** (`BIND_NOTIFICATION_LISTENER_SERVICE`) — reads the bank's
  notification rather than its SMS; not a Play restricted permission. The parser is
  text-in/transaction-out, so it is reusable unchanged.
- **Manual entry only** — `AddTransactionScreen` already does the full job.
- **RBI Account Aggregator** — the sanctioned route to real bank transaction data in India,
  and worth understanding for a later version, but it is a regulated integration, not a
  v1 substitute.

Budget for a rejection round anyway: these reviews take days to weeks and often need a
resubmission with a clearer video.

### 0.2 Target API level — **upgraded to Expo SDK 57 (2026-09-19)**

Play requires **API 36** for new apps and updates since 2026-08-31 (extension available to
2026-11-01). The project was on `targetSdk 34`, and it could not be bumped in place: AGP
8.1.1 / Gradle 8.3 cannot do `compileSdk 36`, which needs AGP 8.6+ / Gradle 8.7+.

**Done: Expo SDK 50 → 57.** SDK 54 (the last release supporting the Legacy Architecture)
was the lower-risk option; SDK 57 was chosen instead to land on current and avoid a second
migration. That makes the **New Architecture mandatory** — SDK 55 removed the legacy one.

| | Before | After |
|---|---|---|
| Expo SDK | 50.0.21 | **57.0.24** |
| React Native | 0.73.6 | **0.86.3** |
| React | 18.2.0 | **19.2.3** |
| AGP / Gradle | 8.1.1 / 8.3 | **8.12.0 / 9.3.1** |
| compileSdk / targetSdk | 34 | **36** |
| minSdk | 23 | **24** |
| Architecture | Legacy | **New (bridgeless)** |

Notable dependency moves: Reanimated 3.6 → **4.5.1** (worklets now live in a separate
`react-native-worklets` package, and `babel.config.js` must load
`react-native-worklets/plugin` instead of `react-native-reanimated/plugin`), Skia 0.1.221 →
2.6.2, React Navigation 6 → 7, screens 3 → 4, safe-area-context 4 → 5, svg 14 → 15,
pager-view 6 → 8, lottie 6 → 7, view-shot 3 → 5, zustand 4 → 5, TypeScript 5.3 → 6.

Things that had to change beyond version numbers:

- **`app.json` schema:** top-level `splash` is gone in SDK 57; it is now the
  `expo-splash-screen` plugin's config. `expo-system-ui` had to be added for
  `userInterfaceStyle`.
- **`withEPurseAndroid` broke, loudly and correctly.** RN 0.86's `MainApplication`
  template replaced the immutable `return PackageList(this).packages` with a mutable
  `PackageList(this).packages.apply { add(...) }`. The plugin's existing guard threw
  instead of silently producing an app with no `ScreenSecurityPackage` — which would have
  meant app lock quietly stopping hiding the app from the recents thumbnail. It now
  handles both templates.
- **`android/` is now generated (CNG).** It was regenerated with
  `expo prebuild --clean`, which resolves the drift described in §3.3 permanently. The
  only hand-written native code — the Kotlin modules — is copied back in by the config
  plugin, so nothing is lost. **Do not hand-edit `android/` from here on.**
- **`.npmrc` with `legacy-peer-deps=true`** was added; the React 19 bump makes strict peer
  resolution unsatisfiable across this dependency set.

Status: prebuild clean, all 2144 JS tests passing, release build verified compiling.
**Not yet verified on a device** — see §6.

### 0.3 Login is mandatory → Play's account-deletion requirement applies

`LoginGate` gates the whole app on Google sign-in. That makes ePurse an app with
user accounts, which triggers two hard requirements:

- A **publicly reachable account-deletion URL** (no login required to see it),
  declared in Play Console → App content → Data deletion. Host it at
  `https://epurse.co.in/delete-account`.
- An **in-app** deletion path as well. Check what `MyProfileScreen` / Settings
  currently offers; if it only signs out, it needs a real "Delete Account & Data"
  action (and per the repo's own rule, it confirms through a `CenterModal` first).

Also worth asking: does login need to be mandatory for v1? It adds a reviewer
blocker (§5.4), a deletion requirement, and a Google-verification dependency
(§0.4), in exchange for a Drive backup that is optional to the product. Gating
only the *Backup* screen on sign-in would remove all three at once.

### 0.4 The Google OAuth client will break in the production build

`GOOGLE_ANDROID_CLIENT_ID` is bound to a package name **and an SHA-1 certificate
fingerprint**. Two things break it on release:

- You will sign with a new **upload keystore**, not the debug keystore — different SHA-1.
- **Play App Signing re-signs your AAB**, so the certificate on the user's device
  is Google's app-signing key, with a *third* SHA-1.

Register **all** of these fingerprints on the Android OAuth client in Google Cloud
Console: debug (for local dev), upload, and Play app-signing (available in Play
Console → Setup → App integrity once the app exists). Miss the last one and
sign-in works perfectly in your internal APK and fails for every real user — and
because login is mandatory, that is a 100% crash-to-wall for the whole app.

Also: the **OAuth consent screen must be published**, not left in "Testing" mode.
In Testing, only listed test users can sign in. The `drive.file` scope is a
non-sensitive scope, so publishing it should not require Google's app
verification review — but confirm that in Cloud Console, because if verification
*is* demanded it is a multi-week process.

**Sep-22-2026: 3 of the 4 non-prod build variants have their own package name**
(`com.epurse.app.dtest`/`.dprod`/`.stest`, see §build.sh and `app.config.js`)
so they can be installed side by side without overwriting one another. An
OAuth Android client is keyed on (package name, SHA-1) — a new package name
has **no matching client**, so real Google Sign-In will fail on any of these
3 until you register one. `dev-test`/`dev-prod` don't need this: `IS_DEV_BUILD`
bypasses login there ("Skip sign-in (Debug)"). `stage-test` DOES exercise real
sign-in, so if you need that to work under its package name, add an Android
OAuth client for `com.epurse.app.stest` in Cloud Console using the same
debug-keystore SHA-1 already registered for `com.epurse.app`
(`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` —
`keytool -list -v -keystore android/app/debug.keystore -storepass android`).
**`stage-prod` deliberately keeps the bare `com.epurse.app` package** (same as
`prod`, user's explicit call, so it's a true stand-in for the real app) — it
reuses the existing OAuth client automatically, no new registration needed,
but it also means stage-prod and prod can't be installed side by side; one
replaces the other.

### 0.5 SMS capture — **vendored into our own native module (2026-09-19)**

Both npm packages are gone. `react-native-get-sms-android` (2.1.0) and
`react-native-android-sms-listener` (0.8.0) were last published in **2022** and neither
declared the `namespace` that AGP 8 requires — which is what finally made them
unbuildable under SDK 57, rather than merely stale. They were also flagged by
`expo-doctor` as unmaintained and untested on the New Architecture.

They are replaced by **`plugins/android/SmsModule.kt`** (+ `SmsPackage.kt`), copied in and
registered by the existing `withEPurseAndroid` plugin exactly like `ScreenSecurityModule`.
Both libraries were MIT, so the code was **vendored, not rewritten** — deliberately:

- `receiveMultipart` is kept faithful to the original. A long bank SMS arrives as several
  PDUs, and a botched reassembly **truncates** the body. That does not fail loudly; it
  parses into a subtly wrong transaction, which is the worst failure mode this app has.
- Everything unused was dropped: sending and deleting SMS (most of the original 304-line
  `SmsModule.java`) and the pre-KitKat PDU path, dead at `minSdk 24`.

Net: ~170 lines of Kotlin we own, replacing 544 lines of unmaintained Java, with two fewer
dependencies. Two deliberate improvements over the originals:

- The receiver registers against the **application context**, not `currentActivity`. The
  original used the Activity, which is why it had to re-register on every resume and
  silently listened to nothing whenever that was null.
- `registerReceiver` is guarded against double-registration, and uses
  `RECEIVER_NOT_EXPORTED` on API 33+.

Listening stays foreground-only, matching the old behaviour: anything missed is picked up
by the inbox sweep on next foreground, so a background receiver would cost battery for
nothing.

The JS contract is unchanged — `src/services/smsService.js` still exports `smsSupported`,
`readInbox` and `subscribeToIncomingSms`, and still returns `{_id, address, body, date}`
(`_id` is the dedupe key; without it every sweep re-ingests). It now calls
`NativeModules.EPurseSms.listInbox()` and listens on the `ePurse:smsReceived` device event.
All 2144 tests pass unchanged.

**Still to verify on a real device:** that a live SMS arrives and that a multipart bank
message reassembles whole — the tests cover the parser, not the native bridge.


---

## 1. Accounts and external setup

Start the slow ones today; two of them have multi-week lead times.

| What | Cost | Lead time | Notes |
|---|---|---|---|
| **Google Play Developer account** | $25 one-time | 1–3 days, or weeks | See §1.1 — the org-vs-personal choice matters a lot |
| **D-U-N-S number** (org accounts only) | Free | **up to 30 days** | Start immediately if going the org route |
| **Google Cloud project** | Free | Same day | Already exists — OAuth client `32024277404-…` |
| **Expo / EAS account** | Free tier works | Done | Owner `13pvn`, project id already in `app.json` |
| **Email on `epurse.co.in`** | ~₹125/user/mo | Same day | `support@epurse.co.in` — see §2.1 |
| **Web hosting for `epurse.co.in`** | Free tier fine | Same day | Privacy policy, terms, deletion page — see §2.2 |

### 1.1 Play Developer account — register as an **organisation**, not an individual

This is the decision with the longest tail. Personal developer accounts created
after 2023-11-13 must run a **closed test with at least 12 testers opted in for
14 continuous days** before they can even apply for production access. That is a
minimum two-week delay on top of everything else, and the 12 testers must be real
opted-in Google accounts.

**Organisation accounts are exempt from that requirement** — but they require a
**D-U-N-S number** for the legal entity, which can take up to 30 days to issue
(free, via Dun & Bradstreet). You will also need to verify the org's legal name,
address, and a contact.

Given you own `epurse.co.in` and are using a company email, register as an
organisation and **apply for the D-U-N-S number today** — it is the longest pole
in this tent and it costs nothing to start.

If you would rather not wait: register personal, and start the 12-tester closed
test *in parallel* with the §0.2 SDK upgrade work so the 14 days burn down while
you build.

### 1.2 Google Cloud Console (OAuth / Drive)

- Project: the one holding client `32024277404-…`.
- Enable **Google Drive API**.
- OAuth consent screen: External, app name `ePurse`, support email
  `support@epurse.co.in`, developer contact, **privacy policy URL**, terms URL,
  app logo. Scope: `.../auth/drive.file` **only** (do not add broader Drive
  scopes — it changes the verification burden).
- **Publish** the consent screen (§0.4).
- Android OAuth client: package `com.epurse.app` + all three SHA-1s (§0.4).

---

## 2. The `epurse.co.in` domain — what has to exist on it

### 2.1 Email

Set up `support@epurse.co.in` (Google Workspace, Zoho Mail, or a forwarder).
It is used in three places: the Play listing contact, the OAuth consent screen,
and in-app. Then fix the placeholder in `src/constants/appMeta.ts`:

```
SUPPORT_EMAIL = 'support@epurse.app'   // ← wrong domain, placeholder
             → 'support@epurse.co.in'
```

### 2.2 Pages to publish (all must be live before submission)

| URL | Required by | Must say |
|---|---|---|
| `/privacy` | Play listing (**mandatory**), OAuth consent screen | See below |
| `/terms` | OAuth consent screen, listing (recommended) | Standard |
| `/delete-account` | Play Data deletion (**mandatory**, §0.3) | How to delete in-app + a request route, and what is retained and for how long |
| `/` | Credibility during review | One page describing the app |
| `/support` | Optional but useful | Reuse the in-app FAQ content |

The privacy policy is not boilerplate here — Play reviews it against the Data
Safety form, and this app touches four sensitive sources. It must name, per
source, what is collected, why, and where it goes:

- **SMS** — read on-device to parse transactions; **never transmitted**; raw
  messages are dropped after the retention window (see the `transaction-parser`
  skill for the actual windows, and quote the real number).
- **Contacts** — read to name people in splits and lend/borrow; stays on-device.
- **Location** — coarse city label only, never coordinates; used to tag
  transactions with a place.
- **Google account + Drive** — sign-in identity, and an **encrypted** backup file
  written to the user's *own* Drive via `drive.file` (which means the app can
  only ever see files it created). Say that the backup is a parsed-values-only
  allow-list and contains no raw SMS — that is both true and reassuring.

State plainly that ePurse has no backend server and that financial data never
reaches a server you control. That is the app's strongest privacy claim and it
should be the first line.

---

## 3. Code changes needed before a release build

### 3.1 Signing — **no code change needed if you build with EAS**

`android/app/build.gradle` points `release` at `signingConfigs.debug`, which looks
alarming but is the stock React Native template default. What matters is how you build:

- **`eas build -p android --profile production` (recommended):** EAS writes its own
  `android/app/eas-build.gradle` containing a real `release` signing config from the
  credentials it holds, and that is what signs the AAB. **Important:** EAS only does
  this if `android.signingConfigs.release.storeFile` is *not* already defined in your
  `build.gradle`. It is not defined here, so EAS's injection works — and that is
  exactly why you should **not** hand-add a release signing config to `build.gradle`.
  Doing so would silently switch off EAS's signing and put keystore management back
  on you. **Left unchanged deliberately.**
- **`npm run build:stage-test` / `build:dev-test` (local Gradle):**
  this *does* sign with the debug keystore. That is fine for sideloading a test APK
  and fatal if the artifact is ever uploaded — Play rejects debug-signed uploads.
  Treat those artifacts as test builds only, never store uploads. There is no
  local, debug-signed target for the production environment — see `BUILD.md`.

Actions:

1. Run `eas credentials` (Android → production) and let EAS generate and store the
   upload keystore. Record the SHA-1 it reports.
2. Add that SHA-1, plus the Play app-signing SHA-1, to the OAuth client (§0.4).
3. Verify any artifact before uploading:
   `apksigner verify --print-certs <file>` — if it says `CN=Android Debug`, stop.

### 3.2 Versioning — **fixed (2026-09-19)**

The old setup could silently regress the version and get an upload rejected.
`versionCode 1` was hardcoded in `android/app/build.gradle` while `eas.json` had
`appVersionSource: "local"` + `autoIncrement: true`. Because `android/` is committed,
EAS treats this as a bare project and `autoIncrement` bumps the number **in
`build.gradle`** — but a local `prebuild --clean` regenerates `build.gradle` from `app.json` and **resets the versionCode**. The next
upload would then carry a number Play had already seen, and Play rejects any upload
whose `versionCode` is not strictly higher than the last.

Now:

- `eas.json` → `cli.appVersionSource: "remote"`. EAS holds the version number
  server-side and injects it at build time, so `prebuild` cannot clobber it and two
  machines cannot disagree. `autoIncrement: true` stays on the production profile.
- `app.json` → `android.versionCode: 1` seeds local/prebuild builds so a regenerated
  `build.gradle` is deterministic.

On the first EAS build, initialise the remote counter with
`eas build:version:set -p android` (or let the first production build seed it), and
from then on it increments itself. `versionName` (`1.5.0`) remains the human-facing
string and is still edited by hand in `app.json`.

### 3.3 Strip unused permissions — **done (2026-09-19)**

The manifest was requesting 21 permissions; it now requests 14 and explicitly blocks 7.

Removed, with the source of each traced first:

| Permission | Came from | Why it went |
|---|---|---|
| `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` | `expo-av` config plugin | **`expo-av` had zero imports in the app** — dependency removed outright. A microphone permission on a finance app is a review risk for no feature. |
| `WRITE_CONTACTS` | `expo-contacts` plugin | The app only ever reads contacts. |
| `SYSTEM_ALERT_WINDOW` | stale (hand-added/legacy) | Draw-over-other-apps; nothing uses it. |
| `USE_EXACT_ALARM` | hand-added in commit `f146dad` | Play restricts it to apps whose **core** function is an alarm clock, timer or calendar; it needs a Console declaration and non-qualifying apps are *disallowed from publishing*. A finance app does not qualify. **`SCHEDULE_EXACT_ALARM` was kept** — see below. |
| `ACCESS_FINE_LOCATION` | `expo-location`'s own manifest | `locationService.ts` requests `Location.Accuracy.Lowest` and keeps only a city name, deliberately discarding coordinates. Coarse is all it ever needed, and the permission dialog now asks only for approximate location — which matches what the privacy policy will claim. |

Kept, because they are genuinely used: `READ_SMS`/`RECEIVE_SMS` (core), `READ_CONTACTS`,
`USE_BIOMETRIC`/`USE_FINGERPRINT`, `DETECT_SCREEN_CAPTURE`, `ACCESS_COARSE_LOCATION`,
`POST_NOTIFICATIONS`, `INTERNET`, `RECEIVE_BOOT_COMPLETED` (reschedules reminders after
reboot), `VIBRATE`, and the storage/media trio.

**Why `SCHEDULE_EXACT_ALARM` was kept.** These are two different permissions and only
one of them is a policy risk. `USE_EXACT_ALARM` is auto-granted but restricted to
alarm/calendar apps. `SCHEDULE_EXACT_ALARM` is the alternative Google explicitly
recommends for everyone else: no declaration form, no category restriction, but the
**user** grants it.

Without either one, `expo-notifications` falls back from
`AlarmManagerCompat.setExactAndAllowWhileIdle` to `setAndAllowWhileIdle`
(`ExpoSchedulingDelegate.kt:101`), and that is what would have made reminders late:
Android *batches* inexact alarms so it can wake the device fewer times, and under Doze
an app gets roughly one such firing per maintenance window. A 9:00 PM reminder could
land anywhere in the following ~15 minutes. With `SCHEDULE_EXACT_ALARM` granted, the
alarm fires on the minute.

One caveat to plan for: on **Android 14+ (API 34) this permission is denied by default**.
The app is allowed to ask, but the user has to enable "Alarms & reminders" in system
settings — there is no in-app dialog for it. `expo-notifications` does not expose a
request helper, so if exact timing matters you will want a small prompt in the reminders
UI that deep-links to
`Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`. Until then, behaviour is: exact on
Android ≤13, inexact on 14+ unless the user opts in. Nothing breaks either way.

**Note on the storage permissions.****The structural fix that mattered more than any single permission.** `android/` is
committed *and* hand-edited — git history shows permissions added straight into
`AndroidManifest.xml` (`c77ff1c`, `f146dad`, `e96f1b5`) rather than through `app.json`.
But `expo prebuild --clean` regenerates the whole `android/` tree from `app.json` and
the plugins. The two had drifted, so the committed
manifest and a freshly prebuilt one no longer agreed.

Everything now flows from `app.json`: `android.permissions` is the allow-list and the new
`android.blockedPermissions` emits `tools:node="remove"` entries, which is the only thing
that beats a dependency's own manifest at merge time (deleting a line from your manifest
does not — the library merges it back in). The committed manifest was rewritten to match,
and the match was verified by parsing it with Expo's own `AndroidConfig.Manifest` and
diffing against `app.json`.

**Resolved (2026-09-19): `android/` and `ios/` are GENERATED and no longer committed.**
Both are in `.gitignore`. This was not just tidiness — with either folder present in the
repo, EAS Build refuses to sync `orientation`, `icon`, `userInterfaceStyle`, `plugins`,
`ios`, `android` and `scheme` from `app.json`, so a permission added there would have been
silently dropped from a cloud build. The same drift class, but on the path that produces
the artifact you actually upload. Hand-written natives live in `plugins/android/` and are
copied back by `withEPurseAndroid` on every prebuild. Run `npm run setup` to regenerate.

### 3.4 Placeholders and flags

- `appMeta.ts` — `SUPPORT_EMAIL` (§2.1); `APP_STORE_URL` is an iOS placeholder,
  fine to leave for an Android-only release but make sure nothing renders it.
- `STATIC_CONFIG.rating.enabled` — flip to `true` **after** the listing is live
  (it gates the "Rate ePurse" row precisely because there was no listing).
- `STATIC_CONFIG.smsDiagnostic.enabled` — currently `true`. It is a debug tool;
  turn it off for the store build.
- `STATIC_CONFIG.shop.enabled` / `inviteEarn.enabled` — already `false` for MVP,
  correct. Make sure no store-listing screenshot shows a "coming soon" surface.

### 3.5 Prominent disclosure

Play policy requires an in-app disclosure **before** the runtime permission
prompt for SMS, contacts and location, explaining what is accessed and why.
Check whether `OnboardingExperience` already does this; if it goes straight to
the system dialog, add the disclosure screen. This is a frequent rejection cause
and it is cheap to fix.

### 3.6 Release hardening

- Consider `android.enableProguardInReleaseBuilds=true` (currently off). Test the
  release build hard afterwards — RN + reflection-based libs need ProGuard rules.
- Confirm Hermes is on (`hermesEnabled=true` — it is).
- Run the full suite (`npm test`, 2144 tests) plus a real device pass on a
  **release** build.

---

## 4. Store listing assets

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | `assets/icon.png` exists — verify size |
| Feature graphic | 1024×500 PNG/JPG | **missing, must create** |
| Phone screenshots | 2–8, min 320px, 16:9 or 9:16 | **missing** — Home, Activity, Goals, Budget, Groups, Insights |
| Short description | ≤80 chars | To write |
| Full description | ≤4000 chars | To write |
| App category | Finance | — |
| Content rating | via questionnaire | — |
| Privacy policy URL | §2.2 | — |

For screenshots, `simctl io screenshot` needs an absolute path (see the
running-the-app notes), but prefer real Android device captures for the Play
listing so the status bar and nav bar look native.

---

## 5. Play Console configuration

1. **Create the app** — name, default language, app/game, free/paid (free; note
   that a paid app cannot later become free).
2. **App content** — every one of these is blocking:
   - Privacy policy URL
   - **Data safety form** — the big one. Declare SMS, contacts, location,
     financial info, email. Mark what is *collected* vs merely *accessed on
     device*, and whether it is transmitted (mostly: no). It must agree with the
     privacy policy line for line, or you get a mismatch rejection.
   - **Sensitive app permissions** — the SMS declaration + demo video (§0.1)
   - **Data deletion** — the `/delete-account` URL (§0.3)
   - Content rating questionnaire
   - Target audience (18+; do **not** claim child appeal for a finance app)
   - Government apps / financial features declarations — answer the "financial
     features" question carefully: ePurse tracks spending, it is not a lender,
     payment processor or banking app, and saying so clearly avoids being routed
     into the much heavier finance-app requirements.
   - Ads: none.
3. **Store listing** — §4 assets.
4. **App access** — **critical.** Login is mandatory and reviewers cannot
   receive your bank's SMS. Provide a working test Google account **and** a way
   to see the app populated. If no demo/seed mode exists, the reviewer sees an
   empty app behind a sign-in wall, and that alone can get you rejected. Consider
   a reviewer-only seed path, or write extremely explicit step-by-step
   instructions (including how to fake a transaction by hand).
5. **Setup → App integrity** — grab the Play app-signing SHA-1 and add it to the
   OAuth client (§0.4). Do this the moment the app record exists.

---

## 6. Rollout sequence

```
Internal testing  →  Closed testing  →  Open/Production
   (up to 100)        (12+ testers,        staged rollout
   minutes            14 days if a         10% → 50% → 100%
                      personal account)
```

- **Internal testing** first, always: real AAB, real Play signing, real download
  path. This is where the OAuth SHA-1 mistake (§0.4) shows up, and it is the only
  cheap place to find it.
- **Closed testing** is mandatory-and-timed for personal accounts (§1.1),
  optional but sensible for org accounts.
- **Production** with a **staged rollout**. Watch Play Console → Vitals for ANRs
  and crashes at 10% before widening.

Review times: first submission of an app with restricted permissions commonly
takes **several days to a few weeks**, not hours. Budget for at least one
rejection round on the SMS declaration.

---

## 7. What is left, in order

Updated 2026-09-19. **The engineering blocker is done** — Expo SDK 57, targetSdk 36,
New Architecture, SMS natives vendored in-repo, release APK building green and running on
a real device with SMS capture and app lock working. What remains is mostly account
paperwork and store submission, plus device QA.

**Track A — clock-dependent, start first (nothing else unblocks these)**
1. **D-U-N-S number** if going the organisation route — up to 30 days, free (§1.1).
2. **Register the Play developer account** ($25). Org avoids the 12-tester/14-day gate.
3. **`support@epurse.co.in`** + publish the four pages on the domain (§2):
   `/privacy`, `/terms`, `/delete-account`, `/`.

**Track B — device QA (needs a real phone, not an emulator)**
4. **A MULTIPART bank SMS** — the long kind that arrives as several PDUs. This is the
   riskiest part of the vendored native module: a botched reassembly TRUNCATES the body
   and parses into a silently wrong transaction rather than failing (§0.5).
5. Reminders actually **firing** at the scheduled time (they now schedule correctly;
   delivery on Android 14+ is inexact unless the user grants "Alarms & reminders" — §3.3).
6. ~~App lock **hiding the app from the recents thumbnail** (`ScreenSecurity`).~~
   **Confirmed working on a real device (2026-09-19).**
7. ~~Gesture/worklet behaviour under the New Architecture — especially the
   `AllocationBar` drag, given the known "a worklet must never call an imported
   function" trap.~~ **Confirmed working on a real device (2026-09-19).**
8. There is no local, debug-signed target for the production environment (`build.sh`
   has no `prod-test`) — `dev`/`stage` differ from `prod` precisely in what the build
   flags gate, so a both-flags-false bug can only be caught via an EAS build now
   (`build:prod-local` is the cheapest one: real signing, no cloud quota).

**Track C — code, can land any time**
9. ~~`constants/appMeta.ts` placeholders: `SUPPORT_EMAIL` still `@epurse.app` (§2.1).~~
   **Done (2026-09-19)** — `support@epurse.co.in`.
10. ~~**In-app account deletion** + the public `/delete-account` URL — required
    because login is mandatory (§0.3).~~ **Done (2026-09-19).** Settings gained a
    "Delete Account & Data" row below Logout (`CenterModal` confirm, destructive),
    wired to a NEW `deleteAllUserData` store action modeled field-for-field off
    `partialize` (not the pre-existing `resetAll`, which had drifted — see §7 note
    below) + `googleAuth.revokeAndSignOut` (actually revokes at Google's end, not
    just a local forget) + `Storage.wipeEverything` (`AsyncStorage.clear()`, to also
    catch `useRewardStore`/`useNotificationStore`, which don't share `ePurseStore`'s
    persist-key prefix). `LoginGate` gained a third message
    (`justDeletedAccount`) so it doesn't claim "your data is untouched" right after
    the user deleted it. `docs/site/delete-account.html` written — publish it at
    `https://epurse.co.in/delete-account`. Covered by a data-driven test asserting
    EVERY `partialize` field individually (`test:store`).
11. ~~**Prominent disclosure** before the SMS/contacts/location prompts (§3.5).~~ **Done
    (2026-09-19).** `OnboardingExperience`'s "Get Started" no longer requests SMS/
    contacts/location itself — it opens a `CenterModal` disclosure first (WHAT is
    accessed, WHY, and that each is optional), and the permission cascade only fires
    from that modal's own "Continue". Dismissing it ("Not Now"/backdrop) skips the
    whole cascade rather than firing OS dialogs after the user just declined.
12. ~~Flags for the store build: `STATIC_CONFIG.smsDiagnostic` OFF, `rating` ON once
    listed.~~ **`smsDiagnostic` done (2026-09-19)** — build-time default now `false`,
    remotely re-enabled for dev/stage via `app-config.test.json`. `rating` correctly
    LEFT `false` — there is still no store listing to rate.
13. ~~Optional: swap `MediaLibrary.saveToLibraryAsync` for `expo-sharing`.~~ **Done
    (2026-09-19)**, with a correction to this item's own premise: only 1 of the "3
    storage permissions" was actually `expo-media-library`'s — `READ_MEDIA_IMAGES`,
    the one Play's Data Safety form flags as "Photos and videos" access, now gone
    along with the whole runtime consent prompt. The other two
    (`READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`, both `maxSdkVersion="32"`) turn
    out to belong to `expo-file-system` (used elsewhere, staying, and capped to
    Android ≤12L regardless). `WhatsAppReminderScreen.js`'s banner-share flow changed
    shape slightly to keep working without it: capture → native OS share sheet
    (`Sharing.shareAsync`, no permission needed) → THEN the WhatsApp text link opens,
    with a short confirm step in between explaining the two-part hand-off. Not yet
    exercised on a device with WhatsApp installed.

**Then, in order (each depends on the one before)**
14. ~~**`eas credentials`** → generate the upload keystore; record its SHA-1 (§3.1).~~
    **Done (2026-09-19).** Keystore named "epurse", set as the default Android build
    credentials (shared across dev/stage/prod EAS builds — only `production` actually
    needs it to stay stable). Upload SHA-1: `C9:A8:2D:6F:2B:67:A9:2D:A2:B9:2C:58:2E:FE:02:8D:DF:3D:48:38`.
15. **OAuth**: register debug + upload + **Play app-signing** SHA-1s and PUBLISH the
    consent screen. Miss the third and sign-in fails for every real user (§0.4).
    **Partially done (2026-09-19)** — debug (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`)
    and upload SHA-1s added to the Android OAuth client for `com.epurse.app`. Still
    open: (a) Play app-signing SHA-1 — blocked on the Play account existing (#1/#2);
    (b) consent screen publish status — not yet checked; (c) whether Google's Custom
    URI Scheme restriction (Oct 2023+, new Android clients only) affects this specific
    client — **ruled out (2026-09-19)**: a real (non-bypass) sign-in on a debug-signed
    build reached Google's actual "Sign in to continue to ePurse" page cleanly, no
    error — confirms both the custom-scheme redirect AND the single client_id holding
    multiple SHA-1s (debug + upload) both work in practice, whatever the Console UI's
    single-field form suggested. Still unconfirmed: whether the consent screen is fully
    published (needs someone to actually complete a sign-in with a real account and see
    if it's blocked as "unverified"/testing-only). **Confirmed (2026-09-19)**: real
    account sign-in completed successfully, no "unverified app" block — consent screen
    is live. #15 is closed except for the Play app-signing SHA-1, which stays open
    until the Play account + app exist (#1/#2).
16. **Internal testing build** via `npm run build:prod` (or `build:prod-local` if the EAS
    quota is spent) → verify Google sign-in and Drive backup on a Play-signed artifact.
17. **App content forms** (§5.2): Data Safety, the SMS Permissions Declaration + demo
    video, data deletion URL, content rating, and **App access** (reviewers are behind a
    mandatory sign-in wall with no data — give them credentials and a way to see the app
    populated).
18. Closed testing if required → **staged production rollout** (10% → 50% → 100%).

**Added 2026-09-19, not in the original numbered list — crash reporting (Sentry).**
`@sentry/react-native` wired end-to-end: `src/config/sentry.ts` (`initSentry`,
`environment` tagged dev/stage/production off `constants/buildVariant.ts`),
called at the top of `App.js` + `Sentry.wrap(App)` for a root error boundary,
the `@sentry/react-native` config plugin in `app.json`, and `metro.config.js`
switched to `getSentryExpoConfig` (needed to de-minify a release stack trace
once the source maps are uploaded). Deliberately **crash-only** — no
performance tracing (`tracesSampleRate: 0`), no session replay,
`sendDefaultPii: false` — usage/screen analytics is a separate decision,
deferred (more privacy-policy/Data-Safety surface than crash reporting alone
justifies for MVP). `initSentry()` no-ops under `__DEV__`. **Done (2026-09-19)**
— real DSN, org slug (`praveen-verma`), and project slug (`react-native`) are
all in place, and delivery was confirmed end-to-end via a temporary debug
crash button (since removed). Only `SENTRY_AUTH_TOKEN` (an EAS secret, never
committed — BUILD.md's "Crash reporting (Sentry)" section) is still missing —
without it crashes still reach Sentry fine, just with minified stack traces
instead of readable file/line. **Also**: once the privacy policy page (§2.2)
is actually drafted, it needs a line disclosing Sentry (crash logs / device
diagnostics) as a third-party processor — the Play Data Safety form (§5.2,
item 17) will need the same declaration.

**Found, not fixed (out of scope, non-blocking):** `CategoriesScreen`'s "Reset all
data" button (`resetAll` in `ePurseStore.js`) is a pre-existing debug convenience,
not the release feature above — and it has drifted out of sync with `partialize`,
missing ~15 fields including `goals`, `groups`, `googleAccount`, and `hasOnboarded`.
Harmless today (it's a dev tool, not user-facing), but worth a look before it's
mistaken for equivalent to "Delete Account & Data" — it is not.

## Open questions for you

1. **Is the fallback acceptable** if SMS is refused — notification listener, or
   manual-entry-only for v1? (§0.1)
2. **Org or personal** Play account? Org avoids the 12-tester/14-day gate but
   waits on D-U-N-S. (§1.1)
3. **Must login be mandatory in v1?** Gating only the Backup screen removes the
   deletion requirement, the reviewer blocker and the OAuth-publishing dependency
   in one move. (§0.3)
4. Which legal entity owns the app, for the Play account and the privacy policy?
