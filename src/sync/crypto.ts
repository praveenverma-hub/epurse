// =============================================================================
// Shared-group encryption (docs/SHARED_GROUP_SYNC.md §5). PURE — randomness is
// injected (the app passes expo-crypto's CSPRNG; tests pass a seeded one).
//
// XChaCha20-Poly1305: its 24-byte random nonce is safe without a counter shared
// across phones. The AAD binds each ciphertext to its group, event and key epoch,
// so the server can't move a ciphertext to another group or event id.
// =============================================================================

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToBase64, base64ToBytes, utf8ToBytes, bytesToUtf8 } from '../backup/envelope';

export type RandomBytes = (n: number) => Uint8Array;

export const GROUP_KEY_BYTES = 32;
export const NONCE_BYTES = 24;

export const generateGroupKey = (rand: RandomBytes): Uint8Array => rand(GROUP_KEY_BYTES);

/** RFC 4122 v4 uuid from injected randomness — every id the server sees is one of these. */
export function randomUuid(rand: RandomBytes): string {
  const b = rand(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

const aad = (groupId: string, eventId: string, keyEpoch: number) =>
  utf8ToBytes(`epurse.grp.v1|${groupId}|${eventId}|${keyEpoch}`);

export type SealedEvent = { nonce: string; ciphertext: string };
/** The server's `group_events` check (~16 KB of plaintext). */
export const MAX_CIPHERTEXT_CHARS = 21848;

export function sealEvent(
  key: Uint8Array, groupId: string, eventId: string, keyEpoch: number, plaintext: string, rand: RandomBytes,
): SealedEvent {
  const nonce = rand(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce, aad(groupId, eventId, keyEpoch)).encrypt(utf8ToBytes(plaintext));
  return { nonce: bytesToBase64(nonce), ciphertext: bytesToBase64(ct) };
}

/** null when the key is wrong or anything was tampered with — never throws. */
export function openEvent(
  key: Uint8Array, groupId: string, eventId: string, keyEpoch: number, sealed: SealedEvent,
): string | null {
  try {
    const nonce = base64ToBytes(sealed.nonce);
    if (nonce.length !== NONCE_BYTES) return null;
    const pt = xchacha20poly1305(key, nonce, aad(groupId, eventId, keyEpoch)).decrypt(base64ToBytes(sealed.ciphertext));
    return bytesToUtf8(pt);
  } catch {
    return null;
  }
}

/** Hex sha256 — what `create_invite` stores in place of the raw invite token. */
export const sha256Hex = (s: string): string =>
  Array.from(sha256(utf8ToBytes(s)), (x) => x.toString(16).padStart(2, '0')).join('');

// base64url (no padding) for invite links: `+`/`/` would need escaping in a URL.
export const toBase64Url = (b: Uint8Array): string =>
  bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromBase64Url = (s: string): Uint8Array | null =>
  /^[A-Za-z0-9_-]*$/.test(s) ? base64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/')) : null;
