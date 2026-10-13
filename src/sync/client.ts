// =============================================================================
// The one Supabase client for shared-group sync. Created on first use; its
// session is kept in its own encrypted MMKV instance (device-only, never backed up).
// =============================================================================

import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getMmkvDeviceKv } from '../storage/mmkvDeviceKv';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

const SESSION_KV_ID = 'epurse.sync.auth';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const kv = getMmkvDeviceKv(SESSION_KV_ID);
  const created = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: {
        getItem: (k: string) => kv.getString(k) ?? null,
        setItem: (k: string, v: string) => kv.set(k, v),
        removeItem: (k: string) => kv.remove(k),
      },
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  // Outside a browser Supabase doesn't refresh on its own; run it only while foregrounded.
  created.auth.startAutoRefresh();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') created.auth.startAutoRefresh();
    else created.auth.stopAutoRefresh();
  });
  client = created;
  return created;
}

/** Drops the stored session without a network call (the account may already be gone). */
export function clearSupabaseSession(): void {
  getMmkvDeviceKv(SESSION_KV_ID).clearAll();
}
