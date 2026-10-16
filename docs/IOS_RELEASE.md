# iOS Release — Readiness Audit (Oct-16-2026)

iOS has never been built (no `ios/` folder). On iOS ePurse **cannot read SMS**, so every iOS user is a
manual-entry user: no auto accounts (Accounts tab hidden via `selectAccountsTracked`), no review queue,
no bill SMS. This file lists what breaks, misleads, or is missing. **Living checklist:** whenever a change fixes
an item, tick it (`[x]` + date + what changed); add newly found iOS issues under the right level.
Companion to `docs/ANDROID_RELEASE.md`.

Severity: **P0** = App Store blocker or the app doesn't work · **P1** = real bug / likely rejection ·
**P2** = misleading copy or dead UI · **P3** = polish / verify on device.

---

## P0 — blockers

- [ ] **Google sign-in is mandatory, no Sign in with Apple** (Guideline 4.8, 5.1.1(v)).
  `LoginGate.tsx:45` gates the whole app; onboarding's registration page is Google-only (since Oct-17-26 the
  user's name also comes from Google — making Google optional means asking for a name again);
  login scope already asks `drive.file` (`googleAuth.ts:103`). **Decision needed:** make Google optional (ask only
  when the user turns on Drive backup / shared groups — fixes both guidelines) **or** add Sign in with Apple.
- [ ] **No iOS Google OAuth client.** `backup/config.ts:32` `GOOGLE_IOS_CLIENT_ID = ''` → falls back to the Android
  client, which won't work on iOS. Create an iOS client for the bundle id, set it, add its reversed id to the
  `scheme` in `app.base.json`, add it to Supabase's authorised Google client ids (`sync/session.ts:34`).
- [ ] **Build pipeline.** `eas.json`: `stage.ios` is simulator-only, `production.ios` empty, no `ascAppId`/`appleTeamId`
  in submit. Variants only suffix `android.package` (`app.config.js:66-90`) — iOS dev/stage/prod share
  `com.epurse.app` and overwrite each other. Needs Apple Developer account, App Store Connect app, certs via EAS.
- [ ] **Privacy manifest.** No `ios.privacyManifests` / `PrivacyInfo.xcprivacy`; RN/Expo/MMKV/Sentry use
  required-reason APIs (UserDefaults CA92.1, file timestamps C617.1, boot time 35F9.1, disk space E174.1).

## P1 — bugs and likely rejections

- [ ] **Rewards give a free daily bonus and the streak never breaks.** `selectYesterdayTransactionCount` and
  `selectGapTransactionCount` count only `source === 'sms'` (`ePurseStore.js:8015, 8033`) → on iOS every day is a
  "zero-spend" SAVINGS day (+50 RP / +5 EPC × multiplier, `EpcClaimBottomSheet` "No transactions were recorded
  yesterday") even after manual spends, and missed days are always forgiven. Earning by review is also dead
  (`recordReview` only from the queue). **Decision needed:** how Aware Run works for manual users.
- [ ] **App lock re-prompts on iOS.** `AppLockGate.tsx:92` locks on `inactive`, which iOS fires for the Face ID sheet
  itself, Control Center, Notification Center and permission alerts → likely Face ID loop. On iOS lock on
  `background` only; use `inactive` just for a privacy cover. No app-switcher/screenshot protection on iOS
  (`ScreenSecurity` is Android-only) — add `expo-screen-capture` (`enableAppSwitcherProtectionAsync`).
- [ ] **64 pending local notifications cap.** Reminders (3 queued per repeating reminder, no limit on count) +
  31-day push plan + CC due reminders can exceed it; iOS silently drops the rest. Add a global budget (~60, soonest
  first) across `reconcileReminders` and the push plan.
- [ ] **Keychain survives uninstall.** Google refresh token in SecureStore (`googleAuth.ts`) outlives a reinstall →
  app looks signed in with empty data. Clear SecureStore on first run when an MMKV/SQLite sentinel is missing.
- [ ] **iPad.** `supportsTablet: true` + portrait-only + phone layouts (`Dimensions.get` in 23 files) → set
  `supportsTablet: false` for v1.
- [ ] **Placeholder features visible** (2.1/2.2): Invite & Earn "coming soon", Shop "Coming soon", Rate row
  "Coming soon". Hide on iOS. Remote config can switch on `shop` / `inviteEarn` / `smsDiagnostic` after review
  (`config/remoteConfig.ts:128`) — keep those off on iOS (2.3.1).
- [ ] **Remote config isn't per-platform.** One `latestVersion`/`minSupportedVersion` (`docs/site/app-config.json`)
  would block/nag iOS before its build is approved. Add per-platform keys.
- [ ] **Other-platform mentions** (2.3.10): Dashboard pull-to-refresh toast "Automatic SMS capture needs Android."
  (`DashboardScreen.js:479`); Help FAQ "On Android…" (`HelpSupportScreen.tsx:19`).
- [ ] **Purpose strings.** Remove `NSUserNotificationsUsageDescription` (not a real key; claims it "detects
  financial messages"). Location string promises "see your spending on a map" — there is no map; reword to the city
  label it actually stores.
- [ ] **Recap PDF export** requires plain `expo-file-system` (`recapExport.ts:26`) — `cacheDirectory` undefined /
  `moveAsync` throws on SDK 57 → always falls back to share with a random name (Android SAF path dead too). Import
  `expo-file-system/legacy`.

## P2 — misleading copy / dead UI for a manual user

- [ ] Onboarding slide 1 "Turn supported bank messages into a clear ledger" (`OnboardingExperience.tsx:180`).
- [ ] Home promo card "Your bank SMS, read automatically" (`homeCards.js:45`); header "Not synced yet" forever
  (`DashboardScreen.js:423`, `lastSmsDate` never set).
- [ ] Review Queue welcome card "New transactions land here to review…" shows on a fresh install, nothing ever lands
  (`DailyQueueStack.js:248, 542`).
- [ ] Rewards copy "per reviewed transaction", "no SMS queue means a mindful day" (`rewardConfig.ts:240-249`,
  shown in `ProfileScreen`), check-in push "review your queue" (`useRewardStore.ts:342`).
- [ ] Card bills: manual `dueDay` never creates a due reminder or Home bill card; status stuck "No statement yet"
  (`ccStatement.js:58`). Copy "Synced from your bank SMS" (`AccountDetailsScreen.tsx:1126-1140`),
  `CCBillPaymentSheet.js:115`, `GoalFundModal.tsx:196`, `LentBorrowedScreen.js:381`, `ReminderFaqScreen.tsx:44`.
- [ ] Notification settings show rows that never fire on iOS: Card Bill Due, Card Payment Received, Review Reminder
  (`NotificationsScreen.tsx:46, 48, 72`).
- [ ] Insights "Spend by account" shows one "Unknown" bar with no accounts (`AnalyticsScreen.js:318`) — gate on
  `selectAccountsTracked`.
- [ ] Invite share text "automatically from bank SMS" (`InviteEarnScreen.tsx:55`, flag off by default).

## P3 — config / verify on a device

- [ ] Invite links: add `ios.associatedDomains: ["applinks:epurse.co.in"]` + `apple-app-site-association` for
  `/join*` on the website (custom-scheme fallback works meanwhile).
- [ ] Shared-group push: APNs key in EAS credentials (docs cover Firebase/Android only).
- [ ] Sentry: valid `SENTRY_AUTH_TOKEN` EAS secret for dSYM upload (local token 401s).
- [ ] Export compliance: set `ios.config.usesNonExemptEncryption` (SQLCipher, E2EE sync, backup crypto) and answer
  App Store Connect's questions.
- [ ] `APP_STORE_URL` placeholder (`appMeta.ts:18`); prefer `expo-store-review` for rating.
- [ ] App Privacy labels: Sentry crash data, Google name/email, synced group data.
- [ ] Account deletion: confirm the Supabase `delete-account` function removes all server data; the
  epurse.co.in/delete-account page must exist.
- [ ] Device checks: DateField/TimeField iOS modal over `AppModal` (double native modal, light-only picker);
  `KeyboardAvoidingView` without `keyboardVerticalOffset` on 8 screens; OverflowMenu/AnchoredMenu `onDismiss`
  actions; status bar needs `UIViewControllerBasedStatusBarAppearance = NO`; SQLCipher/MMKV first pod build;
  iCloud backup exclusion (Android has `allowBackup: false`); `shouldShowAlert` → `shouldShowBanner/List`;
  confirm dev login bypass (`useGoogleSession.ts:94`) is off in production.

## Already fine on iOS

SMS paths skip cleanly (`syncNow()` → `'unsupported'`, no hang) · onboarding drops the SMS disclosure, sweep and
AccountFilter step · Accounts tab hidden for manual users (tracking off by default on iOS; Settings → Track Account
Balances just flips there — the Android-only SMS offer is skipped, Oct-17-26) · contacts, location, haptics, CSV export, WhatsApp links
· notification permission flow and channels · subscriptions, GhostLineChart, HabitLeakMatrix, recaps and budgets
work on manual data · no WebView / payment / crypto / loan wording · EPC is earn-only ("no real-money payment").
