#!/usr/bin/env bash
# =============================================================================
# ePurse — Build Script
# Usage: ./build.sh <target> [--eas-local] [--ios]
#
# Two independent axes, combined into one target name:
#
#   ENVIRONMENT  — what the APP does. Sets EXPO_PUBLIC_APP_VARIANT, which drives
#                  the flags in src/constants/buildVariant.ts.
#     dev     → IS_DEV_BUILD + IS_STAGE_BUILD true   (debug tools, login bypass)
#     stage   → IS_STAGE_BUILD true                  (debug tools, no bypass)
#     prod    → both false                           (nothing gated on)
#
#   WHERE      — who BUILDS and SIGNS it. Also decides which remote-config
#                document the app fetches (EXPO_PUBLIC_BUILD_KIND, read by
#                src/config/remoteConfig.ts): every "-test" target talks to
#                the test document, every "-prod"/prod target to the real one.
#     -test   → plain Gradle on this machine. DEBUG-SIGNED: sideload only.
#     -prod   → the EAS pipeline, with real signing credentials. Distributable.
#
#   --eas-local  runs a -prod build's EAS pipeline HERE instead of in the cloud.
#               Same real signing, same artifact, but it does NOT consume the
#               EAS build quota — which is the whole point once the free cloud
#               builds are used up. Needs the Android SDK + JDK locally.
#
#   Targets:  dev-test    dev-prod
#             stage-test  stage-prod
#                         prod
#
# There is no `prod-test` — every "-test" target is a debug-signed sideload
# talking to the test remote-config document; a production ENVIRONMENT build
# is only ever produced (and only ever fetches the real config) through the
# EAS pipeline, cloud or --eas-local.
#
# Signing: see docs/ANDROID_RELEASE.md §3.1 for why build.gradle must be left
# alone rather than given a release signingConfig.
# =============================================================================

set -e

BOLD="\033[1m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
DIM="\033[2m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

ENV=""
LOCAL=false
EAS_LOCAL=false
PLATFORM="android"
TARGET=""

for arg in "$@"; do
  case "$arg" in
    dev-test)    ENV="development"; LOCAL=true  ; TARGET="$arg" ;;
    dev-prod)    ENV="development"; LOCAL=false ; TARGET="$arg" ;;
    stage-test)  ENV="stage";       LOCAL=true  ; TARGET="$arg" ;;
    stage-prod)  ENV="stage";       LOCAL=false ; TARGET="$arg" ;;
    prod|prod-prod) ENV="production"; LOCAL=false; TARGET="prod" ;;
    --eas-local) EAS_LOCAL=true ;;
    --ios)       PLATFORM="ios" ;;
    -h|--help)   sed -n '2,37p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo -e "${YELLOW}unknown option: $arg${RESET} (try --help)"; exit 1 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo -e "${RED}Pick a target:${RESET}"
  echo -e "  ${BOLD}dev-test${RESET}    ${DIM}local dev client${RESET}  ${BOLD}dev-prod${RESET}    ${DIM}EAS dev client${RESET}"
  echo -e "  ${BOLD}stage-test${RESET}  ${DIM}local APK${RESET}         ${BOLD}stage-prod${RESET}  ${DIM}EAS APK for testers${RESET}"
  echo -e "  ${BOLD}prod${RESET}        ${DIM}EAS AAB for Play${RESET}"
  echo -e "${DIM}  add --eas-local to a -prod target to run EAS here (real signing, no cloud quota)${RESET}"
  exit 1
fi

if $EAS_LOCAL && $LOCAL; then
  echo -e "${RED}--eas-local applies to a -prod target; a -test target already builds here.${RESET}"
  exit 1
fi

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}║          ePurse  ·  Build            ║${RESET}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${RESET}"
echo -e "  target    ${BOLD}${TARGET}${RESET}"
echo -e "  platform  ${BOLD}${PLATFORM}${RESET}"
if $LOCAL; then WHERE="this machine (plain Gradle)"
elif $EAS_LOCAL; then WHERE="this machine (EAS pipeline, no cloud quota)"
else WHERE="EAS cloud"; fi
echo -e "  builds on ${BOLD}${WHERE}${RESET}"
echo ""

# ── EAS ──────────────────────────────────────────────────────────────────────
# eas.json owns the env vars and the signing credentials; never duplicate them.
if ! $LOCAL; then
  if $EAS_LOCAL; then
    # Same pipeline and the same credentials as a cloud build, just executed here.
    echo -e "${DIM}running the EAS pipeline locally — this does not use a cloud build${RESET}"
    exec npx eas build -p "$PLATFORM" --profile "$ENV" --local
  fi
  exec npx eas build -p "$PLATFORM" --profile "$ENV"
fi

# ── Local ────────────────────────────────────────────────────────────────────
if [ "$PLATFORM" = "ios" ]; then
  echo -e "${YELLOW}Local iOS builds go through Xcode — run: npx expo run:ios --configuration Release${RESET}"
  exit 1
fi

echo -e "${YELLOW}${BOLD}⚠ Built here, so DEBUG-SIGNED. Sideload only — never upload to Play.${RESET}"
echo ""

# LOCAL is only ever true for dev-test/stage-test now (production has no
# "-test" target), so ENV is always "development" or "stage" here.
export EXPO_PUBLIC_APP_VARIANT="$ENV"
echo -e "${DIM}EXPO_PUBLIC_APP_VARIANT=${ENV}${RESET}"

# The WHERE-axis signal src/config/remoteConfig.ts reads to pick its
# remote-config document: every "-test" target fetches the test document.
# The matching 'prod' value is set per eas.json build profile instead.
export EXPO_PUBLIC_BUILD_KIND="test"
echo -e "${DIM}EXPO_PUBLIC_BUILD_KIND=test${RESET}"

# Sentry's Gradle step uploads source maps on every RELEASE build and FAILS the
# whole build without a token — so a local build needs one too, not just EAS.
# `.env.local` is gitignored; cloud builds read the matching EAS secret instead.
# Without it, skip the upload rather than die: a local sideload does not need
# symbolicated stack traces, and a hard failure here would block testing.
if [ -f .env.local ]; then
  set -a; . ./.env.local; set +a
fi
if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
  echo -e "${DIM}no SENTRY_AUTH_TOKEN — skipping source-map upload${RESET}"
else
  echo -e "${DIM}SENTRY_AUTH_TOKEN loaded — source maps will upload${RESET}"
fi

# android/ is generated and no longer committed, so it may simply not be here.
if [ ! -d android ]; then
  echo -e "${YELLOW}android/ missing — generating it first${RESET}"
  npx expo prebuild -p android
fi

case "$TARGET" in
  dev-test)
    # Dev client + Metro attached; installs straight to the connected device.
    exec npx expo run:android
    ;;
  stage-test)
    cd android && ./gradlew assembleRelease
    echo ""
    echo -e "${GREEN}${BOLD}✔ APK${RESET} ${DIM}android/app/build/outputs/apk/release/app-release.apk${RESET}"
    ;;
esac
echo ""
