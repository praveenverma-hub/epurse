// =============================================================================
// Shared-group sync — the Supabase account (docs/SHARED_GROUP_SYNC.md §4, §10).
//
// Sign-in is LAZY: a server account is created only when the user first starts
// or joins a shared group, from the Google login they already have. Users who
// never share never get one. `syncAccount` in the store remembers that one
// exists — it's backed up, so Delete Account on a restored phone still finds it.
// =============================================================================

import * as googleAuth from '../backup/googleAuth';
import { useEPurseStore } from '../store/ePurseStore';
import { isSyncConfigured, isSyncEnabled } from './config';
import { SyncError } from './errors';
import type * as TClient from './client';

// Loaded on first use, so supabase-js and its URL polyfill never load for users who don't share.
const client = () => require('./client') as typeof TClient;

export { SyncError } from './errors';

const store = () => useEPurseStore.getState() as any;

async function signInToSupabase(): Promise<string> {
  const supabase = client().getSupabase();
  const googleEmail: string | undefined = store().googleAccount?.email;

  const { data } = await supabase.auth.getSession();
  const current = data.session?.user;
  if (current && (!googleEmail || current.email === googleEmail)) return current.id;
  if (current) await signOutSync();  // a different Google account is signed in now

  const idToken = await googleAuth.getIdToken();
  const { data: signedIn, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error || !signedIn.user) {
    throw new SyncError('SIGN_IN_FAILED', 'Could not connect to shared groups. Try again.');
  }
  store().setSyncAccount({ userId: signedIn.user.id });
  return signedIn.user.id;
}

/** The signed-in user's Supabase id, signing in first if needed. */
export async function ensureSyncSession(): Promise<string> {
  if (!isSyncEnabled()) throw new SyncError('DISABLED', 'Shared groups are not available yet.');
  return signInToSupabase();
}

/** Ends the Supabase session on this phone. The server account and `syncAccount` stay. */
export async function signOutSync(): Promise<void> {
  if (!isSyncConfigured() || !store().syncAccount) return;
  try {
    await client().getSupabase().auth.signOut({ scope: 'local' });
  } finally {
    client().clearSupabaseSession();
  }
}

/**
 * Delete Account's server step — runs BEFORE the Google revoke and the local wipe,
 * and throws if it can't finish: once this phone is wiped nothing could retry it.
 */
export async function deleteSyncAccount(): Promise<void> {
  if (!store().syncAccount || !isSyncConfigured()) return;

  try {
    await signInToSupabase();
    const { error } = await client().getSupabase().functions.invoke('delete-account', { method: 'POST' });
    if (error) throw error;
  } catch {
    throw new SyncError('DELETE_FAILED', 'Could not delete your shared groups. Check your connection and try again.');
  }

  await signOutSync().catch(() => {});
  store().setSyncAccount(null);
}
