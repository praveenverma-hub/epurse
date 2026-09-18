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

### 0.2 Target API level — **verified blocker**, needs the Expo upgrade

`android/build.gradle` sets `compileSdk`/`targetSdk` **34**. Confirmed against Google's
current policy: since **2026-08-31, new apps and updates must target Android 16
(API 36)**; anything at API 35 or lower is rejected at upload. That deadline has
already passed. An extension can be requested until **2026-11-01**.

**This cannot be fixed by bumping the number.** Measured in this repo:

| | Installed | Needed for `compileSdk 36` |
|---|---|---|
| Android Gradle Plugin | **8.1.1** | 8.6.0+ |
| Gradle | **8.3** | 8.7+ |
| React Native | 0.73.6 | — |
| Expo SDK | 50.0.21 | 54+ |

So API 36 requires an **Expo SDK 50 → 54/55 upgrade**, which is the single largest
engineering item on this page. Specific landmines in this repo:

- `plugins/withEPurseAndroid.js` copies hand-written Kotlin (`ScreenSecurityModule`)
  into the prebuilt `android/` tree — re-verify after the upgrade, and note the
  comment there explaining why `expo-screen-capture` is **not** an option
  (it crashes on Android 15+).
- `newArchEnabled=false` today. Newer Expo SDKs default the New Architecture on;
  Skia, Reanimated, `react-native-pager-view` and the SMS libraries all need
  re-checking. Keep the old architecture if the SDK still allows it — one battle
  at a time.
- `react-native-get-sms-android` and `react-native-android-sms-listener` are both
  unmaintained. They are the most likely things to break against a new RN. Check
  them *first*, before doing the rest of the upgrade — if they don't survive,
  that feeds straight back into §0.1.
- The debug variant is already broken (Reanimated). Verify everything with
  `assembleRelease`, never `assembleDebug`.

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

### 0.5 The two SMS libraries — what survives the Expo upgrade

Both native SMS packages are **unmaintained** (last published 2022) and both predate the
AGP 8 `namespace` requirement — each still declares `package=` in its `AndroidManifest.xml`
with no `namespace` in its `build.gradle`:

| Package | Version | Last published | Job in this app |
|---|---|---|---|
| `react-native-get-sms-android` | 2.1.0 | Jun 2022 | `SmsAndroid.list(...)` — bulk inbox read (onboarding backfill / sync) |
| `react-native-android-sms-listener` | 0.8.0 | Jun 2022 | `SmsListener.addListener(...)` — live incoming SMS |

**They do still compile.** Both AARs in `node_modules/*/android/build/outputs/aar/` are
dated the same minute as the last app build, under the current AGP 8.1.1 / Gradle 8.3.
So this is a *forward* risk, not a present breakage: the question is whether they survive
**AGP 8.6+**, which the API 36 bump requires (§0.2). **Test this first** — before doing
any other upgrade work — because the answer feeds straight back into §0.1.

The good news is that the blast radius is tiny. Both libraries are wrapped by a single
file, `src/services/smsService.js`, behind lazy `require`s and an exported `smsSupported`
flag that already degrades gracefully when neither is linked. Replacing the native layer
touches **one file**, and the parser (pure JS, text in → transaction out) is untouched
either way.

Options, cheapest first:

1. **Keep both, add a namespace shim.** If AGP 8.6 rejects them, the standard fix is a
   `subprojects { afterEvaluate { ... namespace = ... } }` block, or `patch-package`.
   Six lines. Note it would have to live in `plugins/withEPurseAndroid.js`, not in
   `android/build.gradle`, or `prebuild` will wipe it. Cheapest, but you stay on two
   dead dependencies for a core feature.
2. **`expo-sms-listener`** (v1.0.10, Mar 2026) — modern Kotlin on the Expo Modules API,
   with a foreground service and Headless JS for Doze. Covers the *listener* half only;
   still young (v1.0.x, small maintainer base).
   **`@maniac-tech/react-native-expo-read-sms`** (v9.1.2, Mar 2026) is the other
   actively-published option.
3. **Write our own Expo module.** This is the one worth taking seriously. The inbox read
   is a `ContentResolver` query against `content://sms/inbox` and the live feed is a
   `SMS_RECEIVED` `BroadcastReceiver` — on the order of 150 lines of Kotlin, and
   **this repo already has the exact pattern**: `plugins/android/ScreenSecurityModule.kt`
   plus the `withEPurseAndroid` plugin that copies it in and registers it after every
   prebuild. That removes both dead dependencies, makes every future SDK upgrade a
   non-event, and puts the most policy-sensitive code in the repo under our own control.

**Recommendation: option 3, but VENDOR rather than rewrite, and do it as part of the
Expo upgrade — not before.**

Both libraries are **MIT**, so their source can be copied in wholesale (keep the
copyright notice). Take only what is used, port to Kotlin, give it a `namespace`, and
land it in `plugins/android/` beside `ScreenSecurityModule.kt`. Measured surface:

- **Inbox read.** `smsService.js` makes exactly one call —
  `{ box: 'inbox', selection: 'date >= …', minDate, sortOrder: 'date ASC', maxCount: 2000 }`.
  That is a single `ContentResolver` query. `SmsModule.java` is 304 lines because it also
  sends and deletes SMS; we use none of that.
- **Live listener.** 100 lines, of which the whole pre-KitKat `pdus` branch is dead code
  at `minSdkVersion 23`.

Realistically ~150 lines of Kotlin, against 544 lines of unmaintained 2022 Java.

**Why vendor instead of writing fresh:** the one genuinely fiddly part is multipart
reassembly — a long bank SMS arrives as several PDUs, and `SmsReceiver.receiveMultipartMessage`
already handles concatenation and the `isReplace()` case. Get that wrong and you get a
*truncated* message, which does not fail loudly: it silently parses into a wrong
transaction. That logic is worth keeping verbatim rather than re-deriving.

**Why during the upgrade, not now:** nothing is broken today, and if the New Architecture
gets enabled an old bridge module has to be rewritten as an Expo module anyway — so do it
once, at that moment. Note also that if Play refuses `READ_SMS` (§0.1) this module is wasted
work and a `NotificationListenerService` is needed instead, so resolve that question first
if you can. No preparation is needed in the meantime: `smsService.js` already isolates both
libraries behind lazy requires and `smsSupported`, so the swap stays a one-file change.

**What you take on either way** (dependency or not — the difference is only who can fix it):
multipart reassembly, OEM quirks in the SMS content provider on Xiaomi/Samsung, dual-SIM,
and Android's tightening rules on manifest-declared background receivers.

Note that **`react-native-sms-retriever` and `expo-otp-autofill` are not alternatives** —
the SMS Retriever API only ever delivers messages containing your own app's hash, which is
for OTP autofill. Bank SMS will never match.

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
- **`npm run build:apk-local` (`prebuild --clean && ./gradlew assembleRelease`):**
  this *does* sign with the debug keystore. That is fine for sideloading a test APK
  and fatal if the artifact is ever uploaded — Play rejects debug-signed uploads.
  Treat that script's output as a test build only, never a store artifact.

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
`build.gradle`** — but `npm run build:apk-local` runs `prebuild --clean`, which
regenerates `build.gradle` from `app.json` and **resets the versionCode**. The next
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
But `npm run build:apk-local` runs `expo prebuild --clean`, which regenerates the whole
`android/` tree from `app.json` and the plugins. The two had drifted, so the committed
manifest and a freshly prebuilt one no longer agreed.

Everything now flows from `app.json`: `android.permissions` is the allow-list and the new
`android.blockedPermissions` emits `tools:node="remove"` entries, which is the only thing
that beats a dependency's own manifest at merge time (deleting a line from your manifest
does not — the library merges it back in). The committed manifest was rewritten to match,
and the match was verified by parsing it with Expo's own `AndroidConfig.Manifest` and
diffing against `app.json`.

**Pick one model and stick to it:** either `android/` is generated (run `prebuild`, commit
the result, never hand-edit) or it is source (never run `prebuild --clean`). Generated is
the better choice here, since a config plugin already exists. Whichever you pick, run
`npx expo prebuild -p android --clean` once and review the diff before the first store
build, so there are no surprises left in that tree.

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

## 7. Suggested order of work

Run these three tracks in parallel — the waiting items must start first.

**Track A — clock-dependent (start today)**
1. Apply for D-U-N-S (§1.1)
2. Register the Play developer account
3. Set up `support@epurse.co.in` and publish the four web pages (§2)

**Track B — the big engineering item**
4. Decide the SMS question (§0.1) — including whether you will build the fallback
5. Verify the SMS libraries against a newer RN **before** committing to the upgrade
6. Expo SDK 50 → 54/55, targetSdk to the current Play minimum (§0.2)
7. Re-verify: `ScreenSecurity` plugin, Reanimated, Skia, `npm test`, release build on a device

**Track C — release plumbing (can land any time)**
8. Real signing config (§3.1) and versioning (§3.2)
9. Strip unused permissions (§3.3)
10. Placeholders and flags (§3.4), prominent disclosure (§3.5), account deletion (§0.3)
11. Store assets (§4)

**Then, in order**
12. OAuth: all three SHA-1s registered, consent screen published (§0.4)
13. Internal testing build → verify Google sign-in and Drive backup on a Play-signed build
14. App content forms (§5.2), including the SMS declaration + video
15. Closed testing (if required) → staged production rollout

---

## Open questions for you

1. **Is the fallback acceptable** if SMS is refused — notification listener, or
   manual-entry-only for v1? (§0.1)
2. **Org or personal** Play account? Org avoids the 12-tester/14-day gate but
   waits on D-U-N-S. (§1.1)
3. **Must login be mandatory in v1?** Gating only the Backup screen removes the
   deletion requirement, the reviewer blocker and the OAuth-publishing dependency
   in one move. (§0.3)
4. Which legal entity owns the app, for the Play account and the privacy policy?
