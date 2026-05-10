#!/usr/bin/env bash
# =============================================================================
# ePurse — EAS Deploy Script
# Usage: ./deploy.sh
#
# Syncs semantic version (x.y.z) to app.json, package.json, Android versionName,
# iOS CFBundleShortVersionString / MARKETING_VERSION.
# Native build counters (Android versionCode, iOS CFBundleVersion) are left to
# EAS production autoIncrement (eas.json) — local bumps would double-increment.
# =============================================================================

set -e

# ── colours ──────────────────────────────────────────────────────────────────
BOLD="\033[1m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
DIM="\033[2m"
RESET="\033[0m"

# ── helpers ───────────────────────────────────────────────────────────────────
header() {
  echo ""
  echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${RESET}"
  echo -e "${CYAN}${BOLD}║        ePurse  ·  EAS Deploy         ║${RESET}"
  echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${RESET}"
  echo ""
}

step() { echo -e "${CYAN}${BOLD}▶  $1${RESET}"; }
ok()   { echo -e "${GREEN}✔  $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠  $1${RESET}"; }
err()  { echo -e "${RED}✘  $1${RESET}"; exit 1; }
dim()  { echo -e "${DIM}   $1${RESET}"; }

# ── guard: must run from project root ────────────────────────────────────────
if [ ! -f "app.json" ] || [ ! -f "eas.json" ]; then
  err "Run this script from the ePurse project root (where app.json lives)."
fi

# ── guard: eas-cli must be available ─────────────────────────────────────────
if ! command -v eas &>/dev/null; then
  warn "eas-cli not found. Installing globally…"
  npm install -g eas-cli || err "Failed to install eas-cli. Try: sudo npm install -g eas-cli"
fi

header

# =============================================================================
# STEP 1 — Version (sync across Expo + native + npm)
# =============================================================================
INITIAL_VERSION=$(node -p "require('./app.json').expo.version" 2>/dev/null || echo "1.0.0")

step "App version"
dim "Current version in app.json: ${INITIAL_VERSION}"
echo ""
echo -e "  Enter new version ${DIM}(press Enter to keep ${INITIAL_VERSION})${RESET}: \c"
read -r INPUT_VERSION

if [ -z "$INPUT_VERSION" ]; then
  VERSION="$INITIAL_VERSION"
  dim "Keeping version ${VERSION}"
else
  # Basic semver format check: x.y.z
  if ! echo "$INPUT_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    err "Invalid version format '${INPUT_VERSION}'. Use semver format: x.y.z (e.g. 1.2.0)"
  fi
  VERSION="$INPUT_VERSION"
  ok "Version set to ${VERSION}"
fi

sync_version_files() {
  export VERSION
  node <<'SYNC_NODE'
const fs = require('fs');

const v = process.env.VERSION;

if (!v || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(v)) {
  console.error('sync_version_files: invalid VERSION');
  process.exit(1);
}

const report = (msg) => console.log(`  ${msg}`);

// ----- app.json -----
const appPath = 'app.json';
const appCfg = JSON.parse(fs.readFileSync(appPath, 'utf8'));
appCfg.expo.version = v;
fs.writeFileSync(appPath, JSON.stringify(appCfg, null, 2) + '\n');
report('app.json → expo.version');

// ----- package.json -----
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = v;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
report('package.json → version');

// ----- Android -----
const gradlePath = 'android/app/build.gradle';
if (fs.existsSync(gradlePath)) {
  let g = fs.readFileSync(gradlePath, 'utf8');
  if (!/versionName\s+"/.test(g)) {
    console.warn('  warn: android/app/build.gradle has no versionName line — skipped');
  } else {
    g = g.replace(/versionName\s+"[^"]*"/, `versionName "${v}"`);
    fs.writeFileSync(gradlePath, g);
    report(`Android → versionName "${v}" (versionCode unchanged — use EAS autoIncrement for prod)`);
  }
} else {
  console.warn('  warn: android/app/build.gradle not found — skipped');
}

// ----- iOS Info.plist -----
const plistPath = 'ios/ePurse/Info.plist';
if (fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, 'utf8');
  plist = plist.replace(
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
    `$1${v}$2`
  );
  fs.writeFileSync(plistPath, plist);
  report('iOS Info.plist → CFBundleShortVersionString (CFBundleVersion unchanged)');
} else {
  console.warn('  warn: ios/ePurse/Info.plist not found — skipped');
}

// ----- Xcode project -----
const pbxPath = 'ios/ePurse.xcodeproj/project.pbxproj';
if (fs.existsSync(pbxPath)) {
  let pbx = fs.readFileSync(pbxPath, 'utf8');
  pbx = pbx.replace(/MARKETING_VERSION = [^;\s]+;/g, `MARKETING_VERSION = ${v};`);
  fs.writeFileSync(pbxPath, pbx);
  report('iOS project.pbxproj → MARKETING_VERSION');
} else {
  console.warn('  warn: ios/ePurse.xcodeproj/project.pbxproj not found — skipped');
}
SYNC_NODE
}

step "Sync version files"
sync_version_files
ok "Version synced across project files"

echo ""

# =============================================================================
# STEP 2 — Platform
# =============================================================================
step "Target platform"
echo ""
echo -e "  ${BOLD}1${RESET}  Android only"
echo -e "  ${BOLD}2${RESET}  iOS only"
echo -e "  ${BOLD}3${RESET}  Both (Android + iOS)"
echo ""
echo -e "  Your choice ${DIM}[1/2/3]${RESET} (default 1): \c"
read -r PLATFORM_CHOICE

case "$PLATFORM_CHOICE" in
  2) PLATFORM="ios";     PLATFORM_LABEL="iOS" ;;
  3) PLATFORM="all";     PLATFORM_LABEL="Android + iOS" ;;
  *)  PLATFORM="android"; PLATFORM_LABEL="Android" ;;
esac

ok "Platform: ${PLATFORM_LABEL}"
echo ""

# =============================================================================
# STEP 3 — Build variant / profile
# =============================================================================
step "Build variant"
echo ""
echo -e "  ${BOLD}1${RESET}  ${CYAN}development${RESET}   ${DIM}— APK with dev client, internal distribution${RESET}"
echo -e "  ${BOLD}2${RESET}  ${YELLOW}preview${RESET}       ${DIM}— Release APK for QA / internal testers${RESET}"
echo -e "  ${BOLD}3${RESET}  ${GREEN}production${RESET}    ${DIM}— AAB for Play Store / IPA for App Store${RESET}"
echo ""
echo -e "  Your choice ${DIM}[1/2/3]${RESET} (default 2): \c"
read -r PROFILE_CHOICE

case "$PROFILE_CHOICE" in
  1) PROFILE="development"; PROFILE_LABEL="development" ;;
  3) PROFILE="production";  PROFILE_LABEL="production" ;;
  *)  PROFILE="preview";    PROFILE_LABEL="preview" ;;
esac

ok "Variant: ${PROFILE_LABEL}"
echo ""

# =============================================================================
# STEP 4 — Auto-submit toggle (production only)
# =============================================================================
AUTO_SUBMIT_FLAG=""
if [ "$PROFILE" = "production" ]; then
  echo -e "  ${BOLD}Auto-submit to store after build?${RESET} ${DIM}[y/N]${RESET}: \c"
  read -r SUBMIT_CHOICE
  if [[ "$SUBMIT_CHOICE" =~ ^[Yy]$ ]]; then
    AUTO_SUBMIT_FLAG="--auto-submit"
    ok "Auto-submit: enabled"
  else
    dim "Auto-submit: skipped"
  fi
  echo ""
fi

# =============================================================================
# STEP 5 — Confirm
# =============================================================================
echo -e "${CYAN}${BOLD}────────────────────────────────────────${RESET}"
echo -e "  ${BOLD}Version  ${RESET} ${VERSION}"
echo -e "  ${BOLD}Platform ${RESET} ${PLATFORM_LABEL}"
echo -e "  ${BOLD}Variant  ${RESET} ${PROFILE_LABEL}"
[ -n "$AUTO_SUBMIT_FLAG" ] && echo -e "  ${BOLD}Submit   ${RESET} yes"
echo -e "${CYAN}${BOLD}────────────────────────────────────────${RESET}"
echo ""
echo -e "  Kick off build? ${DIM}[Y/n]${RESET}: \c"
read -r CONFIRM

if [[ "$CONFIRM" =~ ^[Nn]$ ]]; then
  warn "Cancelled."
  exit 0
fi

echo ""

# =============================================================================
# STEP 6 — Build
# =============================================================================
step "Starting EAS build…"
echo ""

# Build the eas command
if [ "$PLATFORM" = "all" ]; then
  EAS_CMD="eas build --platform android --profile ${PROFILE} ${AUTO_SUBMIT_FLAG} & eas build --platform ios --profile ${PROFILE} ${AUTO_SUBMIT_FLAG} & wait"
else
  EAS_CMD="eas build --platform ${PLATFORM} --profile ${PROFILE} ${AUTO_SUBMIT_FLAG}"
fi

echo -e "${DIM}  Running: ${EAS_CMD}${RESET}"
echo ""

# Execute
eval "$EAS_CMD"

echo ""
ok "Build submitted! Track progress at: https://expo.dev"
echo ""
