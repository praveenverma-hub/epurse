// =============================================================================
// ENCRYPTED BACKUP — crypto core tests (Phase 1)
// -----------------------------------------------------------------------------
//   npm run test:backup
//
// Runs the REAL envelope module headlessly (babel-transpiled TS via _store-hook).
// No Google account, no device, no network — the whole security model is a pure
// function of its inputs, and that's the point of testing it here.
//
// The negative cases matter more than the happy path: a backup that silently
// decrypts the WRONG thing is far worse than one that refuses to open.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_store-hook.mjs', import.meta.url);

const {
  sealBackup, openBackup, deriveKey, BackupError,
  bytesToBase64, base64ToBytes, utf8ToBytes, bytesToUtf8,
  BACKUP_FORMAT, ENVELOPE_VERSION, DEFAULT_KDF,
} = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/envelope.ts');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const throws = (fn, code) => {
  try { fn(); return `no throw (expected ${code})`; }
  catch (e) { return e instanceof BackupError && e.code === code ? null : `got ${e.code || e.name}: ${e.message}`; }
};

// Deterministic "randomness" so a test failure is reproducible. Production
// injects expo-crypto's CSPRNG — never this.
let seed = 1;
const fakeRandom = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[i] = seed & 0xff; }
  return out;
};
// Keep scrypt cheap in tests; production uses DEFAULT_KDF (N=16384).
const FAST_KDF = { ...DEFAULT_KDF, N: 1024 };
const opts = { randomBytes: fakeRandom, kdf: FAST_KDF };

const META = { storeVersion: 23, appVersion: '1.5.0', createdAt: '2026-08-09T10:00:00.000Z', device: 'Pixel 8' };
const PAYLOAD = {
  transactions: [{ id: 'IdM0001', amount: 1234.56, merchant: 'BIG BAZAAR', categoryId: 'groceries' }],
  lentBorrowed: [{ id: 'lb_1', kind: 'lent', person: 'Rahul', amount: 500 }],
  groups: [{ id: 'grp_1', name: 'Goa Trip', emoji: '🏖️' }],
  budget: { perCategory: { food: 8000 } },
};

console.log(`\n${C.bold}══════ Encrypted Backup — crypto core ══════${C.reset}\n`);

// ── base64 round-trip (hand-rolled: btoa/Buffer aren't available in Hermes) ──
{
  let ok = true;
  for (let len = 0; len < 260; len++) {
    const bytes = fakeRandom(len);
    const back = base64ToBytes(bytesToBase64(bytes));
    if (back.length !== bytes.length || bytes.some((b, i) => b !== back[i])) { ok = false; break; }
  }
  check('base64: byte-exact round-trip for every length 0…259', ok);
  check('base64: matches Node for a known vector',
    bytesToBase64(new TextEncoder().encode('ePurse ₹1,234')) ===
      Buffer.from('ePurse ₹1,234', 'utf8').toString('base64'));
}

// ── UTF-8 (hand-rolled: Hermes has no TextEncoder/TextDecoder) ──────────────
// This shipped as `new TextEncoder()` and passed every test, because NODE has
// it as a global and the device does not. The last check here is the one that
// matters: it removes the globals so the suite exercises the app's platform,
// not Node's.
{
  const SAMPLES = [
    '', 'plain ascii', 'ePurse ₹1,234',            // 1- and 3-byte
    'Grocèries — café', 'Ω≈ç√∫', '日本語のテキスト',
    '🏖️', '👨‍👩‍👦‍👦', '🇮🇳', '✈️❤️',              // 4-byte + ZWJ + flags + VS16
    'Goa Trip 🏖️ · Rahul owes ₹500',
  ];
  let bytesOk = true, roundOk = true, bad = '';
  for (const s of SAMPLES) {
    const mine = utf8ToBytes(s);
    const node = new Uint8Array(Buffer.from(s, 'utf8'));
    if (mine.length !== node.length || node.some((b, i) => b !== mine[i])) { bytesOk = false; bad = s; break; }
    if (bytesToUtf8(mine) !== s) { roundOk = false; bad = s; break; }
  }
  check('utf8: byte-identical to Node for ascii/₹/CJK/emoji/ZWJ/flags', bytesOk, bad);
  check('utf8: decode(encode(s)) === s for all samples', roundOk, bad);

  // A lone surrogate can reach us from a truncated emoji (the category picker
  // caps input mid-pair). TextEncoder substitutes U+FFFD; match that rather
  // than emitting invalid bytes that would fail to decode.
  check('utf8: lone high surrogate → U+FFFD, like TextEncoder',
    bytesToUtf8(utf8ToBytes('a\uD83D')) === 'a�');

  // Past the 4096 flush boundary — a real ledger is far bigger than one chunk.
  const big = '🏖️₹x'.repeat(5000);
  check('utf8: round-trips past the fromCodePoint chunk boundary', bytesToUtf8(utf8ToBytes(big)) === big);

  // THE regression test.
  const savedEnc = globalThis.TextEncoder, savedDec = globalThis.TextDecoder;
  delete globalThis.TextEncoder; delete globalThis.TextDecoder;
  let noGlobals = null;
  try {
    const env = sealBackup(PAYLOAD, 'hermes has no TextEncoder', META, opts);
    const { payload } = openBackup(env, 'hermes has no TextEncoder');
    noGlobals = JSON.stringify(payload) === JSON.stringify(PAYLOAD) ? null : 'payload differs';
  } catch (e) { noGlobals = `${e.name}: ${e.message}`; }
  finally { globalThis.TextEncoder = savedEnc; globalThis.TextDecoder = savedDec; }
  check('utf8: full seal→open works with TextEncoder/TextDecoder DELETED (device parity)',
    noGlobals === null, noGlobals || '');
}

// ── happy path ──
{
  const env = sealBackup(PAYLOAD, 'correct horse battery staple', META, opts);
  check('seal: produces a versioned envelope', env.format === BACKUP_FORMAT && env.v === ENVELOPE_VERSION);
  check('seal: header carries the meta a restore screen needs before any password',
    env.meta.device === 'Pixel 8' && env.meta.storeVersion === 23);
  check('seal: salt and iv are BOTH present and distinct',
    !!env.kdf.salt && !!env.iv && env.kdf.salt !== env.iv);

  const { payload, meta } = openBackup(env, 'correct horse battery staple');
  check('open: payload round-trips exactly', JSON.stringify(payload) === JSON.stringify(PAYLOAD));
  check('open: unicode (₹, emoji) survives', payload.groups[0].emoji === '🏖️');
  check('open: returns the meta', meta.appVersion === '1.5.0');
}

// ── NO PLAINTEXT LEAK: the whole point of encrypting ──
{
  const env = sealBackup(PAYLOAD, 'pw', META, opts);
  const wire = JSON.stringify(env);
  check('privacy: merchant name does not appear in the file', !wire.includes('BIG BAZAAR'));
  check('privacy: amount does not appear in the file', !wire.includes('1234.56'));
  check('privacy: person name does not appear in the file', !wire.includes('Rahul'));
  check('privacy: group name does not appear in the file', !wire.includes('Goa Trip'));
}

// ── wrong password ──
{
  const env = sealBackup(PAYLOAD, 'right-password', META, opts);
  check('wrong password → BAD_PASSWORD, never a partial import',
    !throws(() => openBackup(env, 'wrong-password'), 'BAD_PASSWORD'));
  check('empty password is still just a wrong password',
    !throws(() => openBackup(env, ''), 'BAD_PASSWORD'));
  check('password is case-sensitive',
    !throws(() => openBackup(env, 'Right-Password'), 'BAD_PASSWORD'));
}

// ── tampering: every field is authenticated ──
{
  const env = sealBackup(PAYLOAD, 'pw', META, opts);

  const flipped = { ...env, ct: (() => {
    const b = base64ToBytes(env.ct); b[0] ^= 0xff; return bytesToBase64(b);
  })() };
  check('tampered ciphertext → BAD_PASSWORD (GCM tag catches it)',
    !throws(() => openBackup(flipped, 'pw'), 'BAD_PASSWORD'));

  check('edited meta.storeVersion is rejected (AAD is authenticated)',
    !throws(() => openBackup({ ...env, meta: { ...env.meta, storeVersion: 999 } }, 'pw'), 'BAD_PASSWORD'),
    'a forged storeVersion could otherwise drive a destructive migration');

  check('edited meta.device is rejected',
    !throws(() => openBackup({ ...env, meta: { ...env.meta, device: 'Attacker' } }, 'pw'), 'BAD_PASSWORD'));

  check('swapped iv is rejected',
    !throws(() => openBackup({ ...env, iv: bytesToBase64(fakeRandom(12)) }, 'pw'), 'BAD_PASSWORD'));

  check('downgraded kdf.N is rejected (no forcing a cheap key)',
    !throws(() => openBackup({ ...env, kdf: { ...env.kdf, N: 2 } }, 'pw'), 'BAD_PASSWORD'));
}

// ── header/ciphertext splicing between two real backups ──
{
  const a = sealBackup({ who: 'A' }, 'pw', META, opts);
  const b = sealBackup({ who: 'B' }, 'pw', { ...META, device: 'Other' }, opts);
  check("one backup's header on another's ciphertext is rejected",
    !throws(() => openBackup({ ...a, ct: b.ct }, 'pw'), 'BAD_PASSWORD'));
}

// ── format / version guards ──
{
  check('a non-ePurse file → UNSUPPORTED_FORMAT',
    !throws(() => openBackup({ format: 'something.else', v: 1 }, 'pw'), 'UNSUPPORTED_FORMAT'));
  check('null input → UNSUPPORTED_FORMAT (no crash)',
    !throws(() => openBackup(null, 'pw'), 'UNSUPPORTED_FORMAT'));
  const env = sealBackup(PAYLOAD, 'pw', META, opts);
  check('a FUTURE envelope version is refused, not guessed at',
    !throws(() => openBackup({ ...env, v: ENVELOPE_VERSION + 1 }, 'pw'), 'UNSUPPORTED_VERSION'));
  check('an unknown cipher is refused',
    !throws(() => openBackup({ ...env, cipher: 'rot13' }, 'pw'), 'UNSUPPORTED_FORMAT'));
}

// ── nonce/salt reuse — the classic GCM catastrophe ──
{
  seed = 1; const one = sealBackup(PAYLOAD, 'pw', META, opts);
  const two = sealBackup(PAYLOAD, 'pw', META, opts);   // continues the stream
  check('two backups never share an iv', one.iv !== two.iv);
  check('two backups never share a salt', one.kdf.salt !== two.kdf.salt);
  check('identical input encrypts to different ciphertext', one.ct !== two.ct);
}

// ── KDF behaviour ──
{
  const salt = fakeRandom(16);
  const k1 = deriveKey('pw', salt, FAST_KDF);
  const k2 = deriveKey('pw', salt, FAST_KDF);
  const k3 = deriveKey('pw2', salt, FAST_KDF);
  check('deriveKey is deterministic for the same password+salt',
    k1.length === 32 && k1.every((b, i) => b === k2[i]));
  check('a different password gives a different key', k1.some((b, i) => b !== k3[i]));
  check('the same password under a different salt gives a different key',
    deriveKey('pw', fakeRandom(16), FAST_KDF).some((b, i) => b !== k1[i]));
  // Unicode passwords must normalise, or a password typed on iOS may not open a
  // backup made on Android (é as one codepoint vs e + combining accent).
  check('unicode passwords are NFKC-normalised across platforms',
    deriveKey('café', salt, FAST_KDF).every((b, i) => b === deriveKey('café', salt, FAST_KDF)[i]));
}

// ── realistic payload size ──
{
  const big = { transactions: Array.from({ length: 800 }, (_, i) => ({
    id: `IdM${i}`, amount: 100 + i, merchant: `MERCHANT ${i}`, categoryId: 'food',
    createdAt: new Date(2026, 6, (i % 28) + 1).toISOString(),
  })) };
  const t0 = Date.now();
  const env = sealBackup(big, 'pw', META, opts);
  const { payload } = openBackup(env, 'pw');
  check('800 transactions round-trip', payload.transactions.length === 800);
  console.log(`      (${Math.round(JSON.stringify(env).length / 1024)} KB envelope, ${Date.now() - t0}ms seal+open at test KDF cost)`);
}

// ── recovery keys ───────────────────────────────────────────────────────────
// A recovery key is DISPLAYED grouped and uppercase but TYPED BACK any old way.
// If seal and open disagreed about normalisation the backup would be permanently
// unopenable — the worst possible bug in this feature — so every shape a user
// might realistically enter must derive the same key.
{
  // From envelope.ts (pure) — random.ts imports expo-crypto and can't load headlessly.
  const { toKeyMaterial, normaliseRecoveryKey, isValidRecoveryKey } =
    await import('/Users/praveenverma/Desktop/pvn/ePurse/src/backup/envelope.ts');

  const KEY = 'A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90 A1B2 C3D4 E5F6 0718 293A 4B5C 6D7E 8F90';
  check('recovery key: the displayed format validates', isValidRecoveryKey(KEY));
  check('recovery key: 64 hex chars after normalising', normaliseRecoveryKey(KEY).length === 64);

  const env = sealBackup(PAYLOAD, toKeyMaterial(KEY), META, opts);
  const variants = [
    ['exactly as shown',      KEY],
    ['lowercase',             KEY.toLowerCase()],
    ['no spaces',             KEY.replace(/ /g, '')],
    ['pasted with newlines',  KEY.replace(/ /g, '\n')],
    ['ragged spacing',        KEY.replace(/ /g, '   ')],
    ['leading/trailing space', `  ${KEY}  `],
  ];
  for (const [label, typed] of variants) {
    let ok = false;
    try { ok = JSON.stringify(openBackup(env, toKeyMaterial(typed)).payload) === JSON.stringify(PAYLOAD); }
    catch { ok = false; }
    check(`recovery key opens when typed ${label}`, ok);
  }

  // One wrong character must still fail — normalisation must not be so loose
  // that it papers over a genuine typo.
  const typo = normaliseRecoveryKey(KEY).replace(/^A/, 'B');
  let rejected = false;
  try { openBackup(env, toKeyMaterial(typo)); } catch (e) { rejected = e.code === 'BAD_PASSWORD'; }
  check('recovery key: a single wrong character is still rejected', rejected);

  // Passwords must NOT be normalised — upper-casing one would weaken it and
  // break every backup already sealed with the original casing.
  const pwEnv = sealBackup(PAYLOAD, toKeyMaterial('MyPassword123'), META, opts);
  check('password: passed through verbatim (not upper-cased)',
    toKeyMaterial('MyPassword123') === 'MyPassword123');
  let caseRejected = false;
  try { openBackup(pwEnv, toKeyMaterial('mypassword123')); } catch (e) { caseRejected = e.code === 'BAD_PASSWORD'; }
  check('password: still case-sensitive after the recovery-key change', caseRejected);
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
