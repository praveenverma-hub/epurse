// =============================================================================
// remoteConfig — sanitising, version gating, and fail-open behaviour.
// -----------------------------------------------------------------------------
//   npm run test:remoteConfig
//
// This is the ONE place in the app that trusts something from the network, and
// it feeds a BLOCKING gate — so every failure path (offline, timeout, junk
// JSON, an unknown key, a garbage version string) is tested for the same
// answer: fall back to the build-time default, never lock someone out over a
// malformed file. See the FAIL OPEN note in config/remoteConfig.ts.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const {
  parseVersion, compareVersions, isVersionBelow,
  sanitiseRemoteConfig, fetchRemoteConfig,
  REMOTE_FLAG_KEYS, EMPTY_FLAGS,
  REMOTE_CONFIG_URLS, resolveRemoteConfigEnv, resolveRemoteConfigUrl, resolveRemoteConfigCacheKey,
} = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/config/remoteConfig.ts');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

// ── parseVersion / compareVersions ──────────────────────────────────────────
{
  check('parses a plain dotted version', JSON.stringify(parseVersion('1.5.0')) === JSON.stringify([1, 5, 0]));
  check('rejects a leading "v"', parseVersion('v1.5.0') === null);
  check('rejects a pre-release suffix', parseVersion('1.5.0-beta') === null);
  check('rejects empty string', parseVersion('') === null);
  check('rejects non-numeric segments', parseVersion('1.x.0') === null);
  check('rejects a non-string', parseVersion(42) === null && parseVersion(null) === null && parseVersion(undefined) === null);

  check('equal versions compare 0', compareVersions('1.5.0', '1.5.0') === 0);
  check('shorter/longer with missing segments as 0', compareVersions('1.5', '1.5.0') === 0);
  check('a lower patch compares below', compareVersions('1.5.0', '1.5.1') < 0);
  check('a lower minor compares below even with a higher patch', compareVersions('1.4.9', '1.5.0') < 0);
  check('a higher version compares above', compareVersions('2.0.0', '1.9.9') > 0);
  check('unparseable inputs compare equal (no opinion)', compareVersions('garbage', '1.5.0') === 0);
}

// ── isVersionBelow: the actual gate predicate ───────────────────────────────
{
  check('below the floor → true', isVersionBelow('1.4.0', '1.5.0') === true);
  check('at the floor → false (not below)', isVersionBelow('1.5.0', '1.5.0') === false);
  check('above the floor → false', isVersionBelow('1.6.0', '1.5.0') === false);
  check('no floor set (null) → false — never block with no opinion', isVersionBelow('1.0.0', null) === false);
  check('a garbage floor → false, not a lockout', isVersionBelow('1.0.0', 'not-a-version') === false);
  check('a garbage installed version → false', isVersionBelow('not-a-version', '1.5.0') === false);
}

// ── two environments, picked by EXPO_PUBLIC_BUILD_KIND — never mixed up ────
{
  check('EXPO_PUBLIC_BUILD_KIND="prod" resolves to the PROD env', resolveRemoteConfigEnv('prod') === 'prod');
  check('EXPO_PUBLIC_BUILD_KIND="test" resolves to the TEST env', resolveRemoteConfigEnv('test') === 'test');
  check('absent (plain `expo start`, no build.sh/EAS) defaults to TEST', resolveRemoteConfigEnv(undefined) === 'test');
  check('anything unrecognised also defaults to TEST, not a crash', resolveRemoteConfigEnv('garbage') === 'test');

  check('the two URLs are distinct files', REMOTE_CONFIG_URLS.test !== REMOTE_CONFIG_URLS.prod);
  check('both URLs are our own domain, https, no query string',
    [REMOTE_CONFIG_URLS.test, REMOTE_CONFIG_URLS.prod].every(
      (u) => u.startsWith('https://epurse.co.in/') && !u.includes('?')));

  check('resolveRemoteConfigUrl(test) is the test file', resolveRemoteConfigUrl('test') === REMOTE_CONFIG_URLS.test);
  check('resolveRemoteConfigUrl(prod) is the prod file', resolveRemoteConfigUrl('prod') === REMOTE_CONFIG_URLS.prod);

  check('cache keys are namespaced by env — a device that swaps a build variant cannot read the other one\'s cache',
    resolveRemoteConfigCacheKey('test') !== resolveRemoteConfigCacheKey('prod')
    && resolveRemoteConfigCacheKey('test').includes('test')
    && resolveRemoteConfigCacheKey('prod').includes('prod'));

  // The literal contract build.sh's 5 targets resolve to. There is no
  // `prod-test` — a production build is only ever produced through EAS.
  const TARGETS = [
    { target: 'dev-test',   buildKind: 'test', expect: 'test' },
    { target: 'dev-prod',   buildKind: 'prod', expect: 'prod' },
    { target: 'stage-test', buildKind: 'test', expect: 'test' },
    { target: 'stage-prod', buildKind: 'prod', expect: 'prod' },
    { target: 'prod',       buildKind: 'prod', expect: 'prod' },
  ];
  for (const t of TARGETS) {
    check(`build.sh target "${t.target}" (EXPO_PUBLIC_BUILD_KIND="${t.buildKind}") → ${t.expect} config`,
      resolveRemoteConfigEnv(t.buildKind) === t.expect);
  }
}

// ── sanitiseRemoteConfig: the allow-list ────────────────────────────────────
{
  const now = 1_726_000_000_000;

  check('a well-formed document round-trips',
    JSON.stringify(sanitiseRemoteConfig({
      minSupportedVersion: '1.0.0', latestVersion: '1.6.0', updateMessage: 'Please update.',
      flags: { shop: true, inviteEarn: false, rating: true, smsDiagnostic: false },
    }, now)) === JSON.stringify({
      minSupportedVersion: '1.0.0', latestVersion: '1.6.0', updateMessage: 'Please update.',
      flags: { shop: true, inviteEarn: false, rating: true, smsDiagnostic: false }, fetchedAt: now,
    }));

  check('null / non-object input yields null', sanitiseRemoteConfig(null, now) === null && sanitiseRemoteConfig('junk', now) === null);
  check('an array is rejected (not an object of fields)', sanitiseRemoteConfig([1, 2, 3], now) === null);
  {
    const r = sanitiseRemoteConfig({}, now);
    check('an empty object sanitises to all-null / empty flags', r && r.minSupportedVersion === null && r.latestVersion === null
      && Object.keys(r.flags).length === 0);
  }

  check('a garbage version string is DROPPED, not coerced',
    sanitiseRemoteConfig({ minSupportedVersion: 'not-a-version' }, now).minSupportedVersion === null);

  check('an unknown flag key is dropped',
    !('notAFlag' in sanitiseRemoteConfig({ flags: { notAFlag: true } }, now).flags));

  check('a flag with the wrong TYPE is dropped, never coerced',
    !('shop' in sanitiseRemoteConfig({ flags: { shop: 'true' } }, now).flags)
    && !('shop' in sanitiseRemoteConfig({ flags: { shop: 1 } }, now).flags));

  check('every REMOTE_FLAG_KEYS entry is individually honoured when boolean',
    REMOTE_FLAG_KEYS.every((k) => sanitiseRemoteConfig({ flags: { [k]: true } }, now).flags[k] === true));

  check('an oversized updateMessage is dropped (caps the blocking-screen copy)',
    sanitiseRemoteConfig({ updateMessage: 'x'.repeat(500) }, now).updateMessage === null);

  check('a non-string updateMessage is dropped',
    sanitiseRemoteConfig({ updateMessage: 12345 }, now).updateMessage === null);

  check('EMPTY_FLAGS really is empty', Object.keys(EMPTY_FLAGS).length === 0);
}

// ── fetchRemoteConfig: fails open on every network path ────────────────────
{
  const r1 = await fetchRemoteConfig({
    fetch: async () => ({ ok: true, json: async () => ({ latestVersion: '1.6.0' }) }),
    now: () => 1, url: 'x', timeoutMs: 1000,
  });
  check('a 200 with valid JSON resolves to a sanitised config', r1 && r1.latestVersion === '1.6.0');

  const r2 = await fetchRemoteConfig({ fetch: async () => ({ ok: false, json: async () => ({}) }), now: () => 1, url: 'x', timeoutMs: 1000 });
  check('a non-2xx response resolves to null (fail open)', r2 === null);

  const r3 = await fetchRemoteConfig({ fetch: async () => { throw new TypeError('Network request failed'); }, now: () => 1, url: 'x', timeoutMs: 1000 });
  check('a thrown network error resolves to null, never rejects', r3 === null);

  const r4 = await fetchRemoteConfig({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }), now: () => 1, url: 'x', timeoutMs: 1000 });
  check('unparseable JSON resolves to null', r4 === null);

  const r5 = await fetchRemoteConfig({
    fetch: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('AbortError')));
    }),
    now: () => 1, url: 'x', timeoutMs: 20,
  });
  check('a fetch that never resolves is aborted by the timeout and resolves to null', r5 === null);
}

console.log(`\n${C.bold}──────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}`);
if (fail) process.exit(1);
