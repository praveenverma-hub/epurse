// =============================================================================
// Phone fingerprints for linking group members to contacts (Oct-17-26). PURE.
//
// Whoever adds a person from their contacts puts a FINGERPRINT of the number in the
// encrypted group history — never the number. Another member's phone fingerprints its
// own contacts the same way and links the matches, so "Rohit" in the group is the same
// person as their contact "Rohit Sharma" without anyone typing anything.
//
// Keyed with the group's key (the server never has it), and deliberately slow (PBKDF2):
// a number can't be read back from it. Phone numbers are short, so a group member who
// already holds the key could still try every number — the slowness makes that very
// costly, not impossible. It never decides a balance; it only links people.
// =============================================================================

import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js';
import { base64ToBytes, utf8ToBytes } from '../backup/envelope';

/** ~3 ms per number in node, a few ms more on a phone: a few seconds for a whole address book. */
export const PHONE_KEY_ITERATIONS = 5000;

/** The number as the last 10 digits (drops +91 / 0 prefixes), or null if too short. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const d = (phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}

export const isPhoneKey = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

/**
 * The group's FIRST key (lowest epoch) — fingerprints must stay the same when keys
 * rotate, or a later joiner couldn't match the old ones.
 */
export function phoneKeySecret(keys: Record<string, string> | null | undefined): Uint8Array | null {
  const epochs = Object.keys(keys || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!epochs.length) return null;
  const b64 = keys![String(epochs[0])];
  return b64 ? base64ToBytes(b64) : null;
}

const cache = new Map<string, string | null>();

/**
 * phoneKey for a group's keys, cached per group + number — the sync engine re-plans on
 * every store write, and a fingerprint costs milliseconds.
 */
export function cachedPhoneKey(keys: Record<string, string> | null | undefined, phone: string | null | undefined): string | null {
  const secret = phoneKeySecret(keys);
  const digits = phoneDigits(phone);
  if (!secret || !digits) return null;
  const id = `${bytesToHex(secret)}|${digits}`;
  if (!cache.has(id)) cache.set(id, phoneKey(secret, digits));
  return cache.get(id) ?? null;
}

/** The fingerprint of `phone` in the group whose secret is `secret` (phoneKeySecret). */
export function phoneKey(secret: Uint8Array, phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  const salt = sha256(concatBytes(utf8ToBytes('epurse-phone-v1'), secret));
  return bytesToHex(pbkdf2(sha256, utf8ToBytes(digits), salt, { c: PHONE_KEY_ITERATIONS, dkLen: 32 }));
}
