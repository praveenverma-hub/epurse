#!/usr/bin/env bash
# =============================================================================
# ePurse — Setup / Restore Script
# Usage: ./setup.sh [--clean] [--ios] [--no-install] [--no-verify]
#
# The inverse of ./clean.sh — puts back everything a clean removed:
# dependencies, the native project, and (on macOS) CocoaPods.
#
#   (default)     npm install → expo prebuild (android) → verify
#   --clean       prebuild --clean: delete android/ and regenerate from scratch.
#                 Use after changing app.json, a config plugin, or plugins/android/*.kt.
#   --ios         also prebuild ios/ and run pod install (macOS only)
#   --no-install  skip npm install (native regeneration only)
#   --no-verify   skip the import/doctor checks at the end
#
# Verify exists because of a real SDK-57 failure: @expo/vector-icons came in
# transitively under SDK 50, vanished in 57, and 63 files imported it. No JS test
# catches that — they never resolve the app's React imports, so the first thing
# that notices is a 3-minute release bundle. This checks it in about a second.
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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

DO_CLEAN=false
DO_IOS=false
DO_INSTALL=true
DO_VERIFY=true

for arg in "$@"; do
  case "$arg" in
    --clean)      DO_CLEAN=true ;;
    --ios)        DO_IOS=true ;;
    --no-install) DO_INSTALL=false ;;
    --no-verify)  DO_VERIFY=false ;;
    -h|--help)    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo -e "${YELLOW}unknown option: $arg${RESET} (try --help)"; exit 1 ;;
  esac
done

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${CYAN}${BOLD}║          ePurse  ·  Setup            ║${RESET}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""

step() { echo ""; echo -e "${CYAN}▸ $1${RESET}"; }
note() { echo -e "  ${DIM}$1${RESET}"; }
ok()   { echo -e "  ${GREEN}✔ $1${RESET}"; }
warn() { echo -e "  ${YELLOW}! $1${RESET}"; }

# ── 1. Dependencies ──────────────────────────────────────────────────────────
if $DO_INSTALL; then
  step "Installing dependencies"
  # .npmrc pins legacy-peer-deps — React 19 makes strict peer resolution
  # unsatisfiable across this dependency set.
  npm install --no-audit --no-fund
  ok "node_modules restored"
else
  note "skipping npm install (--no-install)"
fi

# ── 2. Native project ────────────────────────────────────────────────────────
# android/ is GENERATED. Hand-written natives live in plugins/android/ and are
# copied back by withEPurseAndroid on every prebuild.
PLATFORMS="android"
$DO_IOS && PLATFORMS="android,ios"

step "Generating native project (${PLATFORMS})"
if $DO_CLEAN; then
  note "prebuild --clean: regenerating from scratch"
  npx expo prebuild --clean -p "$PLATFORMS"
else
  npx expo prebuild -p "$PLATFORMS"
fi
ok "native project generated"

# ── 3. CocoaPods ─────────────────────────────────────────────────────────────
if $DO_IOS; then
  step "CocoaPods"
  if [ "$(uname)" != "Darwin" ]; then
    warn "not macOS — skipping pod install"
  else
    npx pod-install
    ok "pods installed"
  fi
fi

# ── 4. Verify ────────────────────────────────────────────────────────────────
if $DO_VERIFY; then
  step "Verifying every import resolves"
  node -e '
const fs=require("fs"),path=require("path");
const exts=[".js",".jsx",".ts",".tsx"];
const files=[]; const skip=/node_modules|__tests__/;
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory()){if(!skip.test(p))walk(p);} else if(exts.includes(path.extname(e.name)))files.push(p);}})("src");
files.push("App.js");
const mods=new Set();
for(const f of files){const s=fs.readFileSync(f,"utf8");
 for(const m of s.matchAll(/(?:^|[\s;{(])(?:from\s+|require\()\s*["\x27]([^"\x27]+)["\x27]/gm)){
  let n=m[1]; if(n.startsWith(".")||n.startsWith("/")||n.includes(" "))continue;
  const p=n.split("/"); mods.add(n.startsWith("@")?p.slice(0,2).join("/"):p[0]);}}
const missing=[...mods].filter(m=>{
  try{require.resolve(m+"/package.json",{paths:[process.cwd()]});return false;}
  catch(e){try{require.resolve(m,{paths:[process.cwd()]});return false;}catch(e2){return true;}}});
if(missing.length){
  console.error("  \x1b[1;31m✖ unresolved: "+missing.join(", ")+"\x1b[0m");
  console.error("  \x1b[2minstall them with: npx expo install "+missing.join(" ")+"\x1b[0m");
  process.exit(1);
}
console.log("  \x1b[1;32m✔ all "+mods.size+" external imports resolve\x1b[0m");
'
  step "expo-doctor"
  npx expo-doctor || warn "expo-doctor reported issues (see above) — not fatal"
fi

echo ""
echo -e "${GREEN}${BOLD}✔ Setup complete${RESET}"
echo -e "${DIM}  Dev server     : npm start${RESET}"
echo -e "${DIM}  Local dev app  : npm run build:dev-test${RESET}"
echo -e "${DIM}  Local test APK : npm run build:stage-test${RESET}"
echo -e "${DIM}  Store bundle   : npm run build:prod        (EAS, signed)${RESET}"
echo ""
