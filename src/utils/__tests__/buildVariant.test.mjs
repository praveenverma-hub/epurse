// =============================================================================
// buildVariant — every one of build.sh's FIVE named targets resolves to the
// right IS_STAGE_BUILD/IS_DEV_BUILD flags.
// -----------------------------------------------------------------------------
//   npm run test:buildVariant
//
// This is a CONTRACT test between build.sh's target names and this module's
// env-var reading. NOTE this is the ENVIRONMENT axis (what the app behaves
// as) — a DIFFERENT axis from the one config/remoteConfig.ts reads to pick
// its document (EXPO_PUBLIC_BUILD_KIND, the WHERE axis — who signs the
// build; see that file's own header and remoteConfig.test.mjs).
//
// `IS_STAGE_BUILD` must also imply `IS_DEV_BUILD` never does — i.e. every dev
// build is a stage build, checked directly below rather than assumed.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const MODULE_URL = '/Users/praveenverma/Desktop/pvn/ePurse/src/constants/buildVariant.ts';

/**
 * Fresh module evaluation per call: buildVariant.ts reads `process.env` and
 * `__DEV__` at MODULE scope, so re-importing the cached instance would just
 * return the first run's answer. The query string busts Node's ESM cache.
 */
const loadWith = async ({ dev, variant }) => {
  globalThis.__DEV__ = dev;
  if (variant === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT;
  else process.env.EXPO_PUBLIC_APP_VARIANT = variant;
  return import(`${MODULE_URL}?t=${Date.now()}_${Math.random()}`);
};

// ── build.sh's five named targets, exactly as it sets them ─────────────────
// (ENV, LOCAL from build.sh's case statement; __DEV__ mirrors what actually
// produces each binary — a dev client is always __DEV__ true; every kind of
// release build (assembleRelease/EAS) is __DEV__ false. There is no
// `prod-test` — build.sh has no "-test" target for the production ENV.)
const TARGETS = [
  { name: 'dev-test',   dev: true,  variant: 'development', expectStage: true,  expectDev: true  },
  { name: 'dev-prod',   dev: true,  variant: 'development', expectStage: true,  expectDev: true  },
  { name: 'stage-test', dev: false, variant: 'stage',        expectStage: true,  expectDev: false },
  { name: 'stage-prod', dev: false, variant: 'stage',        expectStage: true,  expectDev: false },
  { name: 'prod',       dev: false, variant: undefined,      expectStage: false, expectDev: false },
];

for (const t of TARGETS) {
  const { IS_STAGE_BUILD, IS_DEV_BUILD } = await loadWith(t);
  check(`${t.name}: IS_STAGE_BUILD === ${t.expectStage}`, IS_STAGE_BUILD === t.expectStage,
    `got ${IS_STAGE_BUILD}`);
  check(`${t.name}: IS_DEV_BUILD === ${t.expectDev}`, IS_DEV_BUILD === t.expectDev,
    `got ${IS_DEV_BUILD}`);
}

// ── the subset invariant itself, independent of any specific target ────────
// A dev-client build historically only set `IS_DEV_BUILD` off __DEV__ alone
// without also checking the variant string on IS_STAGE_BUILD's side — so this
// pins the case that would have caught it: __DEV__ false (a release-mode JS
// bundle) but the variant string still says 'development'.
{
  const { IS_STAGE_BUILD, IS_DEV_BUILD } = await loadWith({ dev: false, variant: 'development' });
  check('a dev variant is a stage build even if __DEV__ happens to be false',
    IS_STAGE_BUILD === true && IS_DEV_BUILD === true,
    `IS_STAGE_BUILD=${IS_STAGE_BUILD} IS_DEV_BUILD=${IS_DEV_BUILD}`);
}

// ── `expo start` with no build.sh variant at all ────────────────────────────
{
  const { IS_STAGE_BUILD, IS_DEV_BUILD } = await loadWith({ dev: true, variant: undefined });
  check('plain `expo start` (no variant, __DEV__ true) is both stage and dev',
    IS_STAGE_BUILD === true && IS_DEV_BUILD === true);
}

console.log(`\n${C.bold}──────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}`);
if (fail) process.exit(1);
