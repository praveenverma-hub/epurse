// =============================================================================
// Cryptographic randomness for backups.
//
// Deliberately its OWN module, not part of envelope.ts: `envelope.ts` takes
// `randomBytes` as an injected option precisely so it imports nothing native and
// can be tested headlessly. This file is the production wiring, and is the only
// place in the backup code that touches an Expo module.
//
// `expo-crypto.getRandomBytes` is a CSPRNG (SecRandomCopyBytes / SecureRandom).
// NEVER use Math.random here: it is a predictable PRNG, and a guessable salt or
// IV undoes AES-GCM completely — with a repeated (key, iv) pair, GCM leaks the
// key stream and the backup can be decrypted without the password.
// =============================================================================
import * as Crypto from 'expo-crypto';

export const randomBytes = (byteCount: number): Uint8Array => Crypto.getRandomBytes(byteCount);

/**
 * A 32-byte recovery key, rendered as 64 uppercase hex characters and grouped in
 * blocks of 4 for transcription (the format WhatsApp uses for the same job).
 * Offered as an alternative to a password: 256 bits of entropy can't be
 * brute-forced, whereas a human-chosen password can.
 */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(32);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return (hex.match(/.{1,4}/g) || []).join(' ');
}

// The pure helpers (normalise / validate / toKeyMaterial) deliberately live in
// envelope.ts, NOT here: this module imports expo-crypto, and anything that
// touches a native module cannot be exercised in the headless test runner. Key
// NORMALISATION must be testable — getting it wrong makes backups unopenable.
export { normaliseRecoveryKey, isValidRecoveryKey, toKeyMaterial } from './envelope';
