#!/usr/bin/env bash
# =============================================================================
# ePurse — EAS Deploy Script
# Usage: ./deploy.sh
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
# STEP 1 — Version
# =============================================================================
CURRENT_VERSION=$(node -p "require('./app.json').expo.version" 2>/dev/null || echo "1.0.0")

step "App version"
dim "Current version in app.json: ${CURRENT_VERSION}"
echo ""
echo -e "  Enter new version ${DIM}(press Enter to keep ${CURRENT_VERSION})${RESET}: \c"
read -r INPUT_VERSION

if [ -z "$INPUT_VERSION" ]; then
  VERSION="$CURRENT_VERSION"
  dim "Keeping version ${VERSION}"
else
  # Basic semver format check: x.y.z
  if ! echo "$INPUT_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
    err "Invalid version format '${INPUT_VERSION}'. Use semver format: x.y.z (e.g. 1.2.0)"
  fi
  VERSION="$INPUT_VERSION"
  ok "Version set to ${VERSION}"

  # Write new version into app.json using node
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('app.json', 'utf8'));
    cfg.expo.version = '${VERSION}';
    fs.writeFileSync('app.json', JSON.stringify(cfg, null, 2) + '\n');
    console.log('  app.json updated');
  "
fi

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
