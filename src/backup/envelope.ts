// =============================================================================
// Encrypted backup envelope — the security core of Google Drive backup.
//
// PURE: no React Native, no Expo, no network, no file system. Everything here is
// a function of its inputs, so the whole security model is testable headlessly
// (see backupCrypto.test.mjs) without a Google account or a device.
//
// Format
// ------
//   { format, v, kdf{algo,salt,N,r,p}, cipher, iv, ct, meta{…} }
//
// The header is PLAINTEXT — a restore screen has to show "which device, when,
// what app version" BEFORE it can ask for a password. So `meta` deliberately
// carries no money: no amounts, no counts, no names. Everything sensitive lives
// inside `ct`.
//
// The header is still AUTHENTICATED: it's fed to AES-GCM as additional
// authenticated data (AAD), so editing `meta.storeVersion` to force a bad
// migration, or swapping one backup's header onto another's ciphertext, fails
// the auth tag instead of being silently accepted.
//
// Choices worth keeping
// ---------------------
// • AES-256-GCM, not CBC. GCM is authenticated: tampering and a wrong password
//   are the SAME failure (tag mismatch), so we never decrypt garbage into the
//   store. CBC would need a separate HMAC and a careful compose order.
// • scrypt, not PBKDF2. Memory-hard, so a stolen backup file is far more
//   expensive to attack with GPUs. N is stored in the envelope so the cost can
//   be raised later without orphaning old backups.
// • A fresh random salt AND iv per backup. Never derive once and reuse: GCM
//   catastrophically leaks the key stream if an (key, iv) pair repeats.
// =============================================================================
import { gcm } from '@noble/ciphers/aes.js';
import { scrypt } from '@noble/hashes/scrypt.js';

export const BACKUP_FORMAT = 'epurse.backup';
/** Envelope schema version — bump only when the ENVELOPE shape changes. */
export const ENVELOPE_VERSION = 1;

/**
 * scrypt cost. N=16384 (16 MB) is a deliberate middle: 32 MB was too heavy for
 * low-end Android, and anything below this is cheap to brute-force. Stored per
 * envelope so raising it later still opens old backups.
 */
export const DEFAULT_KDF = { algo: 'scrypt' as const, N: 16384, r: 8, p: 1, dkLen: 32 };

const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce — the size GCM is defined for

export type BackupMeta = {
  /** zustand persist version, so restore can refuse a FUTURE backup. */
  storeVersion: number;
  appVersion: string;
  createdAt: string;
  /** Human label for the restore list, e.g. "Pixel 8". Never a phone number. */
  device: string;
};

export type BackupEnvelope = {
  format: typeof BACKUP_FORMAT;
  v: number;
  kdf: { algo: 'scrypt'; salt: string; N: number; r: number; p: number; dkLen: number };
  cipher: 'aes-256-gcm';
  iv: string;
  ct: string;
  meta: BackupMeta;
};

/** Typed failures so the UI can say the right thing instead of "something went wrong". */
export type BackupErrorCode =
  | 'UNSUPPORTED_FORMAT'   // not one of our files at all
  | 'UNSUPPORTED_VERSION'  // newer envelope than this app understands
  | 'BAD_PASSWORD'         // tag mismatch — wrong password OR tampered bytes
  | 'CORRUPT';             // decrypted, but the payload isn't the JSON we wrote

export class BackupError extends Error {
  code: BackupErrorCode;
  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

// ── base64 ───────────────────────────────────────────────────────────────────
// Hand-rolled because `btoa`/`atob` are not dependable in Hermes and `Buffer`
// doesn't exist in React Native. Byte-exact round-trip is covered by tests.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64.indexOf(clean[i]);
    const c1 = B64.indexOf(clean[i + 1]);
    const c2 = B64.indexOf(clean[i + 2]);
    const c3 = B64.indexOf(clean[i + 3]);
    if (p < len) out[p++] = (c0 << 2) | (c1 >> 4);
    if (p < len) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (p < len) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

// ── UTF-8 ────────────────────────────────────────────────────────────────────
// Hand-rolled for the SAME reason as base64 above: Hermes has no `TextEncoder`
// or `TextDecoder`. This originally used them and passed every test, because
// Node supplies them as globals — the suite was testing a platform the app does
// not run on. On device it threw "TextEncoder does not exist" and the backup
// failed. `utf8HasNoGlobals` in the crypto suite now deletes both globals before
// running the round-trip, so this can never regress unnoticed.
//
// Note @noble's own `utf8ToBytes` is NOT a fix — it is `new TextEncoder()`
// underneath. Everything we hand to noble is already bytes.
export function utf8ToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    let cp = s.charCodeAt(i);
    // Recombine a surrogate PAIR into one code point, so emoji (category icons,
    // notes, group names) survive: encoded per-half they'd be mojibake.
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000; i += 1; }
    }
    // A LONE surrogate is not encodable; TextEncoder substitutes U+FFFD, so do the same.
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;

    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

export function bytesToUtf8(b: Uint8Array): string {
  let out = '';
  let chunk: number[] = [];
  for (let i = 0; i < b.length;) {
    const b0 = b[i]; i += 1;
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 < 0xe0) { cp = ((b0 & 31) << 6) | (b[i] & 63); i += 1; }
    else if (b0 < 0xf0) { cp = ((b0 & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63); i += 2; }
    else { cp = ((b0 & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); i += 3; }
    chunk.push(cp);
    // Flush periodically: fromCodePoint(...) with a whole backup's worth of code
    // points at once overflows the argument stack on a large ledger.
    if (chunk.length >= 4096) { out += String.fromCodePoint(...chunk); chunk = []; }
  }
  if (chunk.length) out += String.fromCodePoint(...chunk);
  return out;
}

const utf8 = { encode: utf8ToBytes, decode: bytesToUtf8 };

// ── key derivation ───────────────────────────────────────────────────────────
/**
 * Password → 32-byte key. Exported so the UI can derive ONCE and reuse across a
 * multi-file session rather than paying scrypt's cost per call.
 */
export function deriveKey(password: string, salt: Uint8Array, kdf = DEFAULT_KDF): Uint8Array {
  return scrypt(utf8.encode(password.normalize('NFKC')), salt, {
    N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen,
  });
}

/**
 * The AAD is the header minus the ciphertext, canonicalised. Key order is FIXED
 * by construction here (not by JSON.stringify of a rebuilt object) so seal and
 * open always produce byte-identical AAD.
 */
function headerAad(env: Omit<BackupEnvelope, 'ct'>): Uint8Array {
  return utf8.encode(JSON.stringify([
    env.format, env.v, env.cipher, env.iv,
    env.kdf.algo, env.kdf.salt, env.kdf.N, env.kdf.r, env.kdf.p, env.kdf.dkLen,
    env.meta.storeVersion, env.meta.appVersion, env.meta.createdAt, env.meta.device,
  ]));
}

// ── seal / open ──────────────────────────────────────────────────────────────
export type SealOptions = {
  /** Injected so tests are deterministic. Production passes a CSPRNG. */
  randomBytes: (n: number) => Uint8Array;
  kdf?: typeof DEFAULT_KDF;
};

export function sealBackup(
  payload: unknown,
  password: string,
  meta: BackupMeta,
  opts: SealOptions,
): BackupEnvelope {
  const kdf = opts.kdf || DEFAULT_KDF;
  const salt = opts.randomBytes(SALT_BYTES);
  const iv = opts.randomBytes(IV_BYTES);
  const key = deriveKey(password, salt, kdf);

  const header: Omit<BackupEnvelope, 'ct'> = {
    format: BACKUP_FORMAT,
    v: ENVELOPE_VERSION,
    kdf: { algo: kdf.algo, salt: bytesToBase64(salt), N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen },
    cipher: 'aes-256-gcm',
    iv: bytesToBase64(iv),
    meta,
  };

  const ct = gcm(key, iv, headerAad(header)).encrypt(utf8.encode(JSON.stringify(payload)));
  return { ...header, ct: bytesToBase64(ct) };
}

export function openBackup<T = unknown>(
  envelope: BackupEnvelope,
  password: string,
): { payload: T; meta: BackupMeta } {
  if (!envelope || envelope.format !== BACKUP_FORMAT) {
    throw new BackupError('UNSUPPORTED_FORMAT', 'This file is not an ePurse backup.');
  }
  if (typeof envelope.v !== 'number' || envelope.v > ENVELOPE_VERSION) {
    throw new BackupError(
      'UNSUPPORTED_VERSION',
      'This backup was made by a newer version of ePurse. Update the app, then restore.',
    );
  }
  if (envelope.cipher !== 'aes-256-gcm' || envelope.kdf?.algo !== 'scrypt') {
    throw new BackupError('UNSUPPORTED_FORMAT', 'Unrecognised encryption in this backup.');
  }

  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = deriveKey(password, salt, envelope.kdf);

  const { ct, ...header } = envelope;
  let plain: Uint8Array;
  try {
    plain = gcm(key, iv, headerAad(header)).decrypt(base64ToBytes(ct));
  } catch {
    // GCM cannot distinguish "wrong key" from "edited bytes" — by design. Both
    // mean: do not import. The message leads with the likely cause.
    throw new BackupError('BAD_PASSWORD', 'Wrong password, or this backup file has been altered.');
  }

  try {
    return { payload: JSON.parse(utf8.decode(plain)) as T, meta: envelope.meta };
  } catch {
    throw new BackupError('CORRUPT', 'The backup decrypted but its contents are unreadable.');
  }
}

// ── recovery keys ────────────────────────────────────────────────────────────
/** Strip the display grouping so a pasted or typed recovery key compares equal. */
export const normaliseRecoveryKey = (raw: string): string => (raw || '').replace(/\s+/g, '').toUpperCase();

export const isValidRecoveryKey = (raw: string): boolean => /^[0-9A-F]{64}$/.test(normaliseRecoveryKey(raw));

/**
 * The exact bytes handed to scrypt, for BOTH sealing and opening.
 *
 * A recovery key is shown grouped and uppercase (`A1B2 C3D4 …`) but gets typed
 * back with any spacing, and often lowercase. If seal and open disagreed by a
 * single character the backup would be permanently unopenable — so the rule
 * lives here, in one function that both sides call. Never normalise at a call site.
 *
 * A real password is passed through UNTOUCHED: trimming or upper-casing it would
 * silently weaken it and break existing backups.
 */
export function toKeyMaterial(input: string): string {
  return isValidRecoveryKey(input) ? normaliseRecoveryKey(input) : input;
}
