// Test-only stand-in for src/sync/session.ts: the phone acting now is signed in as
// globalThis.__syncUser (Google sign-in itself is out of scope here).
import { PROJECT_ROOT } from './paths.mjs';

const { SyncError } = await import(`${PROJECT_ROOT}/src/sync/errors.ts`);
const { useEPurseStore } = await import(`${PROJECT_ROOT}/src/store/ePurseStore.js`);

export { SyncError };

export async function ensureSyncSession() {
  const userId = globalThis.__syncUser;
  if (!userId) throw new SyncError('SIGN_IN_FAILED', 'Could not connect to shared groups. Try again.');
  if (!useEPurseStore.getState().syncAccount) useEPurseStore.getState().setSyncAccount({ userId });
  return userId;
}
export const signOutSync = async () => {};
export const deleteSyncAccount = async () => {};
