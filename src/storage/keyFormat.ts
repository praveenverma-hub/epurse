// =============================================================================
// Encryption-key encoding for on-device storage (SQLCipher + MMKV).
//
// PURE — no expo imports, so it runs in the headless test runner. Same split as
// backup/envelope.ts vs backup/random.ts: the logic that, if wrong, makes data
// permanently unreadable must be testable without a device.
// =============================================================================

const HEX = '0123456789abcdef';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** SQLCipher raw key: 32 random bytes as 64 hex chars, used as-is (no KDF on every open). */
export const DB_KEY_BYTES = 32;
/** MMKV AES-256 takes a key STRING of ≤32 bytes: 24 random bytes base64url → exactly 32 chars. */
export const KV_KEY_BYTES = 24;

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}

/** base64url, no padding. Only ever called with a multiple of 3 bytes. */
export function bytesToKvKey(bytes: Uint8Array): string {
  if (bytes.length % 3 !== 0) throw new Error('Key bytes must be a multiple of 3.');
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  return s;
}

export const isDbKey = (k: unknown): k is string => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);
export const isKvKey = (k: unknown): k is string => typeof k === 'string' && /^[A-Za-z0-9_-]{32}$/.test(k);

/** The statement that unlocks a SQLCipher database. Must run before any other statement. */
export function dbKeyPragma(hex: string): string {
  // Validated here because it is interpolated into SQL.
  if (!isDbKey(hex)) throw new Error('Invalid database key.');
  return `PRAGMA key = "x'${hex}'";`;
}
