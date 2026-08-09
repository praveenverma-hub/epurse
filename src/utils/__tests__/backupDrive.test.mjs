// =============================================================================
// ENCRYPTED BACKUP — Drive client (Phase 4)
// -----------------------------------------------------------------------------
//   npm run test:drive
//
// `fetch` and the token getter are injected, so every branch is exercised
// against a fake Google — including the ones you cannot reproduce on demand with
// a real account: an expired token, a full Drive, a revoked grant, a truncated
// upload. Those are exactly the paths that decide whether a user loses data.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_store-hook.mjs', import.meta.url);

const { uploadBackup, listBackups, downloadBackup, deleteBackup, pruneBackups, DriveError } =
  await import('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/driveClient.ts');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const res = (status, body, ok = status < 400) => ({
  ok, status,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const expectCode = async (fn, code) => {
  try { await fn(); return `no throw (expected ${code})`; }
  catch (e) { return e instanceof DriveError && e.code === code ? null : `got ${e.code || e.name}: ${e.message}`; }
};

// ── configuration coherence ─────────────────────────────────────────────────
// A Google Android OAuth client only accepts the reversed-client-id redirect,
// and Android only hands control back if that scheme is registered in app.json.
// Get either wrong and sign-in dies with an opaque error AFTER the user has
// already approved consent — so assert them against each other here.
{
  const { readFileSync } = await import('node:fs');
  const cfg = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/config.ts');
  const appJson = JSON.parse(readFileSync('/Users/praveenverma/Desktop/pvn/ePurse/app.json', 'utf8'));
  const schemes = [].concat(appJson.expo.scheme || []);

  // backupService mirrors the store's persist version by hand so a restore can
  // refuse a backup from a NEWER app. Nothing checked they agreed, and they
  // silently drifted the first time the store version was bumped — a stale
  // constant here means a future backup restores instead of being refused.
  {
    const svc   = readFileSync('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/backupService.ts', 'utf8');
    const store = readFileSync('/Users/praveenverma/Desktop/pvn/ePurse/src/store/ePurseStore.js', 'utf8');
    const svcV   = Number((svc.match(/const STORE_VERSION = (\d+)/) || [])[1]);
    const storeV = Number((store.match(/\n\s*version:\s*(\d+),/) || [])[1]);
    check('config: backupService STORE_VERSION matches the store persist version',
      Number.isFinite(svcV) && svcV === storeV, `backupService ${svcV} vs store ${storeV}`);
  }

  check('config: a real client id is set (not the placeholder)', cfg.isBackupConfigured());
  check('config: client id has the expected Google shape',
    /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(cfg.GOOGLE_ANDROID_CLIENT_ID),
    cfg.GOOGLE_ANDROID_CLIENT_ID);
  check('config: redirect uses the reversed-client-id scheme, not a custom one',
    cfg.googleRedirectUri().startsWith('com.googleusercontent.apps.') &&
    cfg.googleRedirectUri().endsWith(':/oauthredirect'),
    cfg.googleRedirectUri());
  check('config: app.json registers that redirect scheme (else the browser cannot return)',
    schemes.includes(cfg.googleRedirectScheme()),
    `app.json schemes = ${JSON.stringify(schemes)}`);
  check("config: the app's own 'epurse' scheme is still registered", schemes.includes('epurse'));
  check('config: only drive.file is requested (broader scopes need Google review)',
    cfg.DRIVE_SCOPE === 'https://www.googleapis.com/auth/drive.file', cfg.DRIVE_SCOPE);
}

console.log(`\n${C.bold}══════ Encrypted Backup — Drive client ══════${C.reset}\n`);

// ── upload ──────────────────────────────────────────────────────────────────
{
  const calls = [];
  const deps = {
    getAccessToken: async () => 'tok-1',
    fetch: async (url, init) => {
      calls.push({ url, init });
      return res(200, { id: 'f1', name: 'epurse-backup-x.json', size: '120', modifiedTime: '2026-08-09T10:00:00Z' });
    },
  };
  const file = await uploadBackup(deps, '{"ct":"opaque"}', { createdAt: '2026-08-09T10:00:00.000Z', device: 'Pixel 8' });
  check('upload: returns the created file', file.id === 'f1');
  check('upload: uses the multipart upload endpoint',
    calls[0].url.includes('/upload/drive/v3/files') && calls[0].url.includes('uploadType=multipart'));
  check('upload: sends the bearer token', calls[0].init.headers.Authorization === 'Bearer tok-1');
  check('upload: file name is timestamped, not fixed (so backups do not overwrite)',
    calls[0].init.body.includes('epurse-backup-2026-08-09T10-00-00'));
  check('upload: appProperties carry only non-sensitive metadata',
    calls[0].init.body.includes('Pixel 8') && !calls[0].init.body.includes('amount'));
  check('upload: the encrypted body is sent verbatim', calls[0].init.body.includes('{"ct":"opaque"}'));
}

// ── checksum: a truncated upload must NOT be reported as success ────────────
{
  const deps = {
    getAccessToken: async () => 't',
    fetch: async () => res(200, { id: 'f1', md5Checksum: 'deadbeefdeadbeefdeadbeefdeadbeef' }),
  };
  check('upload: a checksum mismatch is rejected, not silently accepted',
    !(await expectCode(() => uploadBackup(deps, 'hello', {}), 'CHECKSUM')),
    'otherwise a truncated backup sits in Drive looking valid until it is needed');
}
{
  // Correct md5 of "hello" — the happy path must still pass.
  const deps = {
    getAccessToken: async () => 't',
    fetch: async () => res(200, { id: 'f1', md5Checksum: '5d41402abc4b2a76b9719d911017c592' }),
  };
  const f = await uploadBackup(deps, 'hello', {});
  check('upload: a MATCHING checksum passes', f.id === 'f1');
}

// ── 401 → refresh once, then give up ───────────────────────────────────────
{
  let tokenCalls = 0, fetchCalls = 0;
  const deps = {
    getAccessToken: async () => { tokenCalls += 1; return `tok-${tokenCalls}`; },
    fetch: async () => { fetchCalls += 1; return fetchCalls === 1 ? res(401, 'expired') : res(200, { files: [] }); },
  };
  await listBackups(deps);
  check('401: retries ONCE with a freshly fetched token', tokenCalls === 2 && fetchCalls === 2);
}
{
  // Hard cap, so losing the single-retry guard fails the suite in milliseconds
  // instead of hanging it — a test that catches a bug by never finishing is
  // nearly as bad as no test at all.
  let fetchCalls = 0;
  const deps = {
    getAccessToken: async () => 'tok',
    fetch: async () => {
      fetchCalls += 1;
      if (fetchCalls > 5) throw new Error('unbounded retry: the single-attempt guard is gone');
      return res(401, 'revoked');
    },
  };
  check('401 twice → UNAUTHORIZED (does not spin)',
    !(await expectCode(() => listBackups(deps), 'UNAUTHORIZED')));
  check('401 twice → exactly two attempts, never a retry loop', fetchCalls === 2, `${fetchCalls} attempts`);
}

// ── error mapping the UI depends on ────────────────────────────────────────
{
  const withStatus = (status, body) => ({ getAccessToken: async () => 't', fetch: async () => res(status, body) });
  check('403 + quota body → QUOTA (user action, not a bug)',
    !(await expectCode(() => listBackups(withStatus(403, '{"error":{"message":"storageQuotaExceeded"}}')), 'QUOTA')));
  check('403 without quota → UNAUTHORIZED',
    !(await expectCode(() => listBackups(withStatus(403, '{"error":{"message":"insufficientPermissions"}}')), 'UNAUTHORIZED')));
  check('404 on download → NOT_FOUND (backup deleted from Drive since listing)',
    !(await expectCode(() => downloadBackup(withStatus(404, 'gone'), 'f1'), 'NOT_FOUND')));
  check('500 → DRIVE with Google\'s message attached',
    !(await expectCode(() => listBackups(withStatus(500, 'backend error')), 'DRIVE')));

  const offline = { getAccessToken: async () => 't', fetch: async () => { throw new TypeError('Network request failed'); } };
  check('a thrown fetch → NETWORK, not an unhandled crash',
    !(await expectCode(() => listBackups(offline), 'NETWORK')));
}

// ── list / download / delete ───────────────────────────────────────────────
{
  const files = [
    { id: 'f3', name: 'epurse-backup-3.json', modifiedTime: '2026-08-09T00:00:00Z' },
    { id: 'f2', name: 'epurse-backup-2.json', modifiedTime: '2026-08-08T00:00:00Z' },
  ];
  let listedUrl = '';
  const deps = {
    getAccessToken: async () => 't',
    fetch: async (url) => { listedUrl = url; return res(200, { files }); },
  };
  const out = await listBackups(deps);
  check('list: returns the files', out.length === 2 && out[0].id === 'f3');
  check('list: filters to OUR backups only', decodeURIComponent(listedUrl).includes("name contains 'epurse-backup'"));
  check('list: excludes trashed files', decodeURIComponent(listedUrl).includes('trashed = false'));
  check('list: newest first', decodeURIComponent(listedUrl).includes('orderBy=modifiedTime desc'));
}
{
  const deps = { getAccessToken: async () => 't', fetch: async (url) => res(200, url.includes('alt=media') ? '{"format":"epurse.backup"}' : {}) };
  const body = await downloadBackup(deps, 'f1');
  check('download: returns the raw file body for decryption', body.includes('epurse.backup'));
}
{
  let method = '';
  const deps = { getAccessToken: async () => 't', fetch: async (_u, init) => { method = init.method; return res(204, ''); } };
  await deleteBackup(deps, 'f1');
  check('delete: issues DELETE', method === 'DELETE');

  const gone = { getAccessToken: async () => 't', fetch: async () => res(404, 'not found') };
  let threw = false;
  try { await deleteBackup(gone, 'f1'); } catch { threw = true; }
  check('delete: a 404 is success — the file is already gone', !threw);
}

// ── retention ──────────────────────────────────────────────────────────────
{
  const files = Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: `epurse-backup-${i}.json` }));
  const deleted = [];
  const deps = {
    getAccessToken: async () => 't',
    fetch: async (url, init) => {
      if (init?.method === 'DELETE') { deleted.push(url.split('/').pop()); return res(204, ''); }
      return res(200, { files });
    },
  };
  const removed = await pruneBackups(deps, 5);
  check('prune: keeps the newest 5, deletes the rest', removed === 3 && deleted.length === 3);
  check('prune: deletes the OLDEST, never the newest', !deleted.includes('f0') && deleted.includes('f7'));
}
{
  // A cleanup failure must never fail the backup that just succeeded.
  const files = Array.from({ length: 7 }, (_, i) => ({ id: `f${i}` }));
  const deps = {
    getAccessToken: async () => 't',
    fetch: async (_u, init) => (init?.method === 'DELETE' ? res(500, 'boom') : res(200, { files })),
  };
  let threw = false;
  try { await pruneBackups(deps, 5); } catch { threw = true; }
  check('prune: a failed delete does not fail the whole backup', !threw);
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
