#!/usr/bin/env bash
# =============================================================================
# ePurse — Build Script
# Usage: ./build.sh <target> [--ios]
#
# Two independent axes, combined into one target name:
#
#   ENVIRONMENT  — what the APP does. Sets EXPO_PUBLIC_APP_VARIANT, which drives
#                  the flags in src/constants/buildVariant.ts.
#     dev     → IS_DEV_BUILD + IS_STAGE_BUILD true   (debug tools, login bypass)
#     stage   → IS_STAGE_BUILD true                  (debug tools, no bypass)
#     prod    → both false                           (nothing gated on)
#
#   WHERE      — who BUILDS and SIGNS it. Changes nothing about the app itself.
#     -test   → this machine. DEBUG-SIGNED: sideload only, Play rejects it.
#     -prod   → EAS cloud, real signing credentials, distributable.
#
#   Targets:  dev-test    dev-prod
#             stage-test  stage-prod
#             prod-test   prod
#
# `prod-test` exists so the production code paths can be exercised locally —
# it is the only way to catch a "works in stage, breaks in prod" bug before
# a store upload, since those two differ precisely in what the flags gate.
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
PLATFORM="android"
TARGET=""

for arg in "$@"; do
  case "$arg" in
    dev-test)    ENV="development"; LOCAL=true  ; TARGET="$arg" ;;
    dev-prod)    ENV="development"; LOCAL=false ; TARGET="$arg" ;;
    stage-test)  ENV="stage";       LOCAL=true  ; TARGET="$arg" ;;
    stage-prod)  ENV="stage";       LOCAL=false ; TARGET="$arg" ;;
    prod-test)   ENV="production";  LOCAL=true  ; TARGET="$arg" ;;
    prod|prod-prod) ENV="production"; LOCAL=false; TARGET="prod" ;;
    --ios)       PLATFORM="ios" ;;
    -h|--help)   sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo -e "${YELLOW}unknown option: $arg${RESET} (try --help)"; exit 1 ;;
  esac
done

if [ -z "$TARGET" ]; then
  echo -e "${RED}Pick a target:${RESET}"
  echo -e "  ${BOLD}dev-test${RESET}    ${DIM}local dev client${RESET}        ${BOLD}dev-prod${RESET}    ${DIM}EAS dev client${RESET}"
  echo -e "  ${BOLD}stage-test${RESET}  ${DIM}local APK${RESET}               ${BOLD}stage-prod${RESET}  ${DIM}EAS APK for testers${RESET}"
  echo -e "  ${BOLD}prod-test${RESET}   ${DIM}local AAB (verify only)${RESET} ${BOLD}prod${RESET}        ${DIM}EAS AAB for Play${RESET}"
  exit 1
fi

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}║          ePurse  ·  Build            ║${RESET}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${RESET}"
echo -e "  target    ${BOLD}${TARGET}${RESET}"
echo -e "  platform  ${BOLD}${PLATFORM}${RESET}"
echo -e "  builds on ${BOLD}$($LOCAL && echo "this machine" || echo "EAS cloud")${RESET}"
echo ""

# ── EAS ──────────────────────────────────────────────────────────────────────
# eas.json owns the env vars and the signing credentials; never duplicate them.
if ! $LOCAL; then
  exec npx eas build -p "$PLATFORM" --profile "$ENV"
fi

# ── Local ────────────────────────────────────────────────────────────────────
if [ "$PLATFORM" = "ios" ]; then
  echo -e "${YELLOW}Local iOS builds go through Xcode — run: npx expo run:ios --configuration Release${RESET}"
  exit 1
fi

echo -e "${YELLOW}${BOLD}⚠ Built here, so DEBUG-SIGNED. Sideload only — never upload to Play.${RESET}"
echo ""

# production deliberately leaves the variant UNSET, matching eas.json: an empty
# string would still be a defined value to `process.env`.
if [ "$ENV" != "production" ]; then
  export EXPO_PUBLIC_APP_VARIANT="$ENV"
  echo -e "${DIM}EXPO_PUBLIC_APP_VARIANT=${ENV}${RESET}"
else
  unset EXPO_PUBLIC_APP_VARIANT
  echo -e "${DIM}EXPO_PUBLIC_APP_VARIANT unset (production)${RESET}"
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
  prod-test)
    cd android && ./gradlew bundleRelease
    echo ""
    echo -e "${GREEN}${BOLD}✔ AAB${RESET} ${DIM}android/app/build/outputs/bundle/release/app-release.aab${RESET}"
    echo -e "${YELLOW}  Debug-signed — Play will reject it. Use 'npm run build:prod' for a real store bundle.${RESET}"
    ;;
esac
echo ""
