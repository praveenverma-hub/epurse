#!/usr/bin/env bash
# =============================================================================
# ePurse — Clean Script
# Usage: ./clean.sh [--cache] [--deps] [--native] [--android] [--pods] [--gradle] [--dry-run]
#
# Removes everything that is INSTALLED or GENERATED, so the tree is back to what
# git actually tracks. This script only ever DELETES — it never installs or
# regenerates. `./setup.sh` is its exact inverse and puts all of it back.
#
#   (default)   Full clean: caches + node_modules + android/ + ios/.
#               Restore with `npm run setup`.
#
#   Targeted — pass any of these to clean ONLY that (the fast paths):
#   --cache     Metro/Haste, watchman, .expo, node_modules/.cache
#   --deps      node_modules
#   --native    android/ and ios/ — both are GENERATED from app.json + plugins
#               (see docs/ANDROID_RELEASE.md). Hand-written natives live in
#               plugins/android/ and are copied back by withEPurseAndroid on the
#               next prebuild, so nothing hand-written is lost here.
#   --android   android build output only (build, app/build, .gradle, .cxx) —
#               keeps android/ itself, for a stale-Gradle fix with no reinstall
#   --pods      ios/Pods, Podfile.lock, ios/build — keeps ios/ itself
#   --gradle    Also clear Gradle's GLOBAL caches (~/.gradle). Slow to rebuild
#               (re-downloads dependencies), so it is never part of the default.
#   --dry-run   Print what would be removed and touch nothing.
# =============================================================================

set -e

# ── colours ──────────────────────────────────────────────────────────────────
BOLD="\033[1m"
CYAN="\033[1;36m"
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
DIM="\033[2m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DO_DEPS=false
DO_NATIVE=false
DO_GRADLE=false
DRY_RUN=false
# Targeted flags. If none are passed, the default full clean runs instead.
DO_CACHE=false
DO_ANDROID=false
DO_PODS=false
TARGETED=false

for arg in "$@"; do
  case "$arg" in
    --cache)   DO_CACHE=true;   TARGETED=true ;;
    --android) DO_ANDROID=true; TARGETED=true ;;
    --pods)    DO_PODS=true;    TARGETED=true ;;
    --deps)    DO_DEPS=true;    TARGETED=true ;;
    --native)  DO_NATIVE=true;  TARGETED=true ;;
    --gradle)  DO_GRADLE=true ;;
    # Kept as an alias: --all used to mean "default + deps + native", which IS
    # the default now. Accepting it keeps old muscle memory and docs working.
    --all)     TARGETED=false ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo -e "${YELLOW}unknown option: $arg${RESET} (try --help)"; exit 1 ;;
  esac
done

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}║          ePurse  ·  Clean            ║${RESET}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${RESET}"
$DRY_RUN && echo -e "${YELLOW}dry run — nothing will be deleted${RESET}"
# The default is a FULL clean: caches, dependencies and both native projects.
# `--android`/`--pods` are not included — they clean build output *inside*
# android//ios/, which is pointless when those directories are being removed.
if ! $TARGETED; then
  DO_CACHE=true; DO_DEPS=true; DO_NATIVE=true
fi

echo ""

step() { echo -e "${CYAN}▸ $1${RESET}"; }
note() { echo -e "  ${DIM}$1${RESET}"; }

# Only ever called with paths we construct ourselves, never with user input.
nuke() {
  for target in "$@"; do
    [ -e "$target" ] || continue
    local size
    size=$(du -sh "$target" 2>/dev/null | cut -f1 || echo "?")
    if $DRY_RUN; then
      note "would remove $target (${size})"
    else
      rm -rf "$target"
      note "removed $target (${size})"
    fi
  done
}

# ── 1. JS bundler caches ─────────────────────────────────────────────────────
# Metro keys its cache on a project hash, not on package.json, so adding or
# removing a dependency leaves a stale map behind that still resolves the old
# module graph. This is the one that produces impossible "cannot resolve" errors.
if $DO_CACHE; then
step "Metro / Haste caches"
TMP="${TMPDIR:-/tmp}"
TMP="${TMP%/}"   # TMPDIR carries a trailing slash on macOS
nuke "$TMP"/metro-* "$TMP"/haste-map-* "$TMP"/react-*
nuke node_modules/.cache .expo

if command -v watchman >/dev/null 2>&1; then
  step "watchman"
  if $DRY_RUN; then
    note "would run: watchman watch-del-all"
  else
    watchman watch-del-all >/dev/null 2>&1 && note "watches cleared" || note "watchman present but no watches"
  fi
fi
fi

# ── 2. Android build output ──────────────────────────────────────────────────
if $DO_ANDROID; then
step "Android build output"
if [ -d android ]; then
  # A running daemon holds the old JDK/AGP config and will happily reuse it.
  if ! $DRY_RUN && [ -x android/gradlew ]; then
    (cd android && ./gradlew --stop >/dev/null 2>&1) || true
    note "gradle daemons stopped"
  fi
  nuke android/build android/app/build android/.gradle android/.cxx android/app/.cxx
else
  note "no android/ directory (nothing to clean)"
fi
fi

if $DO_PODS && [ -d ios ]; then
  step "iOS Pods & build output"
  # Podfile.lock goes too: a stale lock is the reason `pod install` keeps
  # resolving the version you just changed away from.
  nuke ios/build ios/Pods ios/Podfile.lock
  note "run \`npx pod-install\` (or cd ios && pod install) before the next iOS build"
fi

# ── 3. Optional: global Gradle caches ────────────────────────────────────────
if $DO_GRADLE; then
  step "Gradle global caches ${DIM}(will re-download dependencies)${RESET}"
  nuke "$HOME"/.gradle/caches/build-cache-* "$HOME"/.gradle/caches/transforms-*
fi

# ── 4. Dependencies ──────────────────────────────────────────────────────────
# Removed, NOT reinstalled. This script deletes and setup.sh restores; doing
# half of setup's job here is what made the two scripts stop being inverses.
if $DO_DEPS; then
  step "node_modules"
  nuke node_modules
fi

# ── 5. The native projects ───────────────────────────────────────────────────
# Both are GENERATED from app.json + the config plugins and are gitignored, so
# removing them loses nothing: `setup.sh` prebuilds them back, and the
# hand-written natives in plugins/android/ are copied in by withEPurseAndroid.
if $DO_NATIVE; then
  step "Native projects (android/, ios/)"
  # A live daemon holds the old JDK/AGP config and open file handles under
  # android/ — stop it before the directory goes.
  if ! $DRY_RUN && [ -x android/gradlew ]; then
    (cd android && ./gradlew --stop >/dev/null 2>&1) || true
    note "gradle daemons stopped"
  fi
  nuke android ios
fi

echo ""
echo -e "${GREEN}${BOLD}✔ Clean complete${RESET}"
if $DO_DEPS || $DO_NATIVE; then
  echo -e "${DIM}  node_modules / native projects are GONE — restore before building:${RESET}"
  echo -e "${DIM}  npm run setup${RESET}"
else
  echo -e "${DIM}  Caches only. Full clean (deps + native): ./clean.sh${RESET}"
fi
echo -e "${DIM}  Then build  : npm run build:stage-test   (debug-signed, never upload)${RESET}"
echo ""
