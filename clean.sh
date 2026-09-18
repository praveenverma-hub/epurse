#!/usr/bin/env bash
# =============================================================================
# ePurse — Clean Script
# Usage: ./clean.sh [--deps] [--native] [--gradle] [--all] [--dry-run]
#
# Clears the caches that survive a dependency change and then lie to you. The
# failure mode is always the same shape: a build that fails on something you
# already fixed, or succeeds on something you already deleted.
#
#   (default)   Everything safe: caches + android + pods. Fast, fixes most cases.
#
#   Targeted — pass any of these to clean ONLY that:
#   --cache     Metro/Haste, watchman, .expo, node_modules/.cache
#   --android   android/build, app/build, .gradle, .cxx (+ stops gradle daemons)
#   --pods      ios/Pods, Podfile.lock, ios/build
#   --deps      Reinstall node_modules. For "Unable to resolve module X" where X
#               really is installed, or after changing a native dependency.
#   --native    Regenerate android/ via `expo prebuild --clean`. android/ is
#               GENERATED — see docs/ANDROID_RELEASE.md. Only hand-written
#               natives in plugins/android/ survive, copied back by the plugin.
#   --gradle    Also clear Gradle's GLOBAL caches (~/.gradle). Slow to rebuild
#               (re-downloads dependencies), so it is never part of --all.
#   --all       = default + --deps + --native
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
# Targeted flags. If none are passed, all three run — that is the default sweep.
DO_CACHE=false
DO_ANDROID=false
DO_PODS=false
TARGETED=false

for arg in "$@"; do
  case "$arg" in
    --cache)   DO_CACHE=true;   TARGETED=true ;;
    --android) DO_ANDROID=true; TARGETED=true ;;
    --pods)    DO_PODS=true;    TARGETED=true ;;
    --deps)    DO_DEPS=true ;;
    --native)  DO_NATIVE=true ;;
    --gradle)  DO_GRADLE=true ;;
    --all)     DO_DEPS=true; DO_NATIVE=true ;;
    --dry-run) DRY_RUN=true ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo -e "${YELLOW}unknown option: $arg${RESET} (try --help)"; exit 1 ;;
  esac
done

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}║          ePurse  ·  Clean            ║${RESET}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${RESET}"
$DRY_RUN && echo -e "${YELLOW}dry run — nothing will be deleted${RESET}"
if ! $TARGETED; then
  DO_CACHE=true; DO_ANDROID=true; DO_PODS=true
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

# ── 4. Optional: dependencies ────────────────────────────────────────────────
if $DO_DEPS; then
  step "node_modules"
  nuke node_modules
  if ! $DRY_RUN; then
    note "reinstalling…"
    npm install --no-audit --no-fund
    note "dependencies reinstalled"
  fi
fi

# ── 5. Optional: regenerate the native project ───────────────────────────────
if $DO_NATIVE; then
  step "Regenerating android/ ${DIM}(expo prebuild --clean)${RESET}"
  if $DRY_RUN; then
    note "would run: npx expo prebuild --clean -p android"
  else
    npx expo prebuild --clean -p android
    note "android/ regenerated from app.json + plugins"
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}✔ Clean complete${RESET}"
$DO_NATIVE || echo -e "${DIM}  Native config changed? re-run with --native${RESET}"
$DO_DEPS   || echo -e "${DIM}  Dependency changed? re-run with --deps${RESET}"
echo -e "${DIM}  Restore with: npm run setup${RESET}"
echo -e "${DIM}  Then build  : npm run build:stage-test   (debug-signed, never upload)${RESET}"
echo ""
