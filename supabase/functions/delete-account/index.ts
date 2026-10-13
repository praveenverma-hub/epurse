// Delete Account (docs/SHARED_GROUP_SYNC.md §10): removes the caller's memberships
// (purge_user; their events stay as group history), then the auth user. Called by
// the app with the user's own JWT; the service-role key exists only in this
// function's environment.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);
  const userId = data.user.id;

  const { error: purgeError } = await admin.rpc('purge_user', { p_user_id: userId });
  if (purgeError) {
    console.error('purge_user failed', purgeError.message);
    return json({ error: 'purge_failed' }, 500);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('deleteUser failed', deleteError.message);
    return json({ error: 'delete_failed' }, 500);
  }

  return json({ ok: true }, 200);
});
