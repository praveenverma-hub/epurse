// =============================================================================
// Shared-group sync — Supabase projects (docs/SHARED_GROUP_SYNC.md).
//
// Both values per project are PUBLIC by design: the anon key reaches only what
// row-level security allows. The service-role key lives only in the
// delete-account Edge Function's secrets — never in the app or in git.
//
// Two projects, split on the same axis as remote config (REMOTE_CONFIG_ENV), so
// test builds never write into the production database.
// =============================================================================

import { REMOTE_CONFIG_ENV, type RemoteConfigEnv } from '../config/remoteConfig';
import { getFeatureFlag } from '../hooks/useFeatureFlag';

const SUPABASE_PROJECTS: Record<RemoteConfigEnv, { url: string; anonKey: string }> = {
  test: { url: '', anonKey: '' },
  prod: { url: '', anonKey: '' },
};

export const SUPABASE_URL = SUPABASE_PROJECTS[REMOTE_CONFIG_ENV].url;
export const SUPABASE_ANON_KEY = SUPABASE_PROJECTS[REMOTE_CONFIG_ENV].anonKey;

export const isSyncConfigured = (): boolean => !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

/** Whether new sharing may start. Deleting an existing server account ignores this. */
export const isSyncEnabled = (): boolean => getFeatureFlag('sharedSync') && isSyncConfigured();
