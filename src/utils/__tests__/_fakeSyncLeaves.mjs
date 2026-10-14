// Test-only leaves for src/sync: Sentry reporting and Expo randomness.
import { randomBytes as nodeRandom } from 'node:crypto';

export const randomBytes = (n) => new Uint8Array(nodeRandom(n));
export const report = (what, data) => { (globalThis.__syncReports ||= []).push({ what, data }); };
