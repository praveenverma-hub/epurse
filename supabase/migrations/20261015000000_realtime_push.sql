-- =============================================================================
-- Phase 4 (docs/SHARED_GROUP_SYNC.md §7a): tell other phones a group changed.
--
--   • Realtime: every new event broadcasts `{ seq }` on the PRIVATE channel
--     `group:<id>`; only members can listen (policy on realtime.messages). Phones
--     that are open pull at once.
--   • Push: generic text via Expo's push service, at most once per 10 minutes per
--     group, never for a checkpoint, never to the person who made the change.
--     The server still learns nothing new: no name, amount or event type.
--
-- Neither may ever fail a write: both are wrapped and their errors swallowed.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

alter table public.groups add column last_push_at timestamptz;

-- ── Push tokens (one per phone; a user keeps at most 5) ──────────────────────

create table public.push_tokens (
  token      text primary key check (char_length(token) between 20 and 200),
  user_id    uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- No policies: reachable only through the functions below.
revoke all on public.push_tokens from anon, authenticated;

create function public.register_push_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,180}\]$' then
    raise exception 'bad push token' using errcode = '22023';
  end if;
  -- A phone that switched accounts moves its token to the new one.
  insert into public.push_tokens (token, user_id) values (p_token, auth.uid())
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
  delete from public.push_tokens
  where user_id = auth.uid()
    and token not in (select token from public.push_tokens where user_id = auth.uid()
                      order by updated_at desc limit 5);
end;
$$;

create function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

-- ── The trigger: every seq bump on a group ───────────────────────────────────

create function public._on_group_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_msgs jsonb;
begin
  begin
    perform realtime.send(jsonb_build_object('seq', new.last_seq), 'poke', 'group:' || new.id::text, true);
  exception when others then null;
  end;

  if new.checkpoint_seq is distinct from new.last_seq
     and (old.last_push_at is null or old.last_push_at < now() - interval '10 minutes') then
    begin
      select jsonb_agg(jsonb_build_object(
               'to', t.token,
               'title', 'New Group Activity',
               'body', 'Someone updated a group you share.',
               'channelId', 'shared-groups',
               'data', jsonb_build_object('type', 'shared_group', 'groupId', new.id)))
        into v_msgs
        from (select pt.token
              from public.push_tokens pt
              join public.group_members m on m.user_id = pt.user_id and m.group_id = new.id
              where pt.user_id is distinct from auth.uid()
              order by pt.updated_at desc
              limit 100) t;
      if v_msgs is not null then
        perform net.http_post(
          url     := 'https://exp.host/--/api/v2/push/send',
          body    := v_msgs,
          headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
        );
        new.last_push_at := now();
      end if;
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;

create trigger group_activity
before update of last_seq on public.groups
for each row when (new.last_seq > old.last_seq)
execute function public._on_group_activity();

-- ── Who may listen on `group:<id>` ───────────────────────────────────────────

create policy group_pokes_read on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() ~ '^group:[0-9a-f-]{36}$'
  and public.is_member(substr(realtime.topic(), 7)::uuid)
);
-- No insert policy: phones can't broadcast; only the trigger above does.

-- ── Grants + housekeeping ────────────────────────────────────────────────────

revoke execute on function
  public.register_push_token(text), public.unregister_push_token(text), public._on_group_activity()
  from public, anon, authenticated;
grant execute on function public.register_push_token(text), public.unregister_push_token(text) to authenticated;

-- A phone re-registers at least daily while sharing; one silent for 60 days is gone.
-- 21:45 UTC = 03:15 IST
select cron.schedule('prune-push-tokens', '45 21 * * *',
  $$delete from public.push_tokens where updated_at < now() - interval '60 days'$$);
