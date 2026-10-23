-- =============================================================================
-- Shared-groups audit fixes (docs/audits/shared-groups-2026-10-23/REPORT.md), Oct-24-2026.
-- Tested against real PostgreSQL (PGlite) by `npm run test:sql`.
--
-- 1. INVITE TOKENS (F01). `token_hash <> digest(NULL)` is NULL, and IF skips a NULL
--    condition — so a NULL token redeemed any invite whose id was known. Every
--    comparison of a caller's input is now null-safe, and NULL/blank inputs are refused.
-- 2. LIMITS UNDER LOCKS (F14). Group size, open invites and a user's group count are
--    counted AFTER the locks that serialise them (group row; per-user advisory lock),
--    and membership is re-checked after waiting on the group row.
-- 3. INVITE FOR A PERSON (F05). An invite can name the group member it's for (an opaque
--    member uuid — the server still sees no names). Redeeming it stamps that member on
--    the `member_joined` row, and the rules on every phone let the joiner become ONLY
--    that member (sync/fold.ts). Editing the link no longer changes who they become.
-- 4. CHECKPOINTS NEED A SECOND PHONE (F02). Compaction deletes history only up to a
--    checkpoint that ANOTHER member's phone has checked against its own full history
--    (`ack_checkpoint`). One member alone can no longer make an unchecked summary the
--    only record.
-- 5. FORMER MEMBERS ARE REMEMBERED (Add Back after compaction). The leave/remove row
--    could be compacted away, and then Add Back failed. Kept in its own table now.
-- 6. A LEAVER'S OPEN INVITES STOP WORKING (F09).
-- 7. PUSH REACHES EVERY MEMBER (100-token cap): each member's 2 newest phones, ≤ 100.
-- =============================================================================

-- ── Columns and tables ───────────────────────────────────────────────────────

alter table public.group_invites add column member_id uuid;
alter table public.group_events  add column system_member uuid;
alter table public.groups        add column verified_checkpoint_seq bigint;

create table public.group_former_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null,
  primary key (group_id, user_id)
);
alter table public.group_former_members enable row level security;
revoke all on public.group_former_members from anon, authenticated;   -- functions only

-- Everyone who left or was removed and isn't back.
insert into public.group_former_members (group_id, user_id)
select distinct e.group_id, e.system_subject
from public.group_events e
where e.system_type in ('member_left', 'member_removed')
  and not exists (select 1 from public.group_members m where m.group_id = e.group_id and m.user_id = e.system_subject)
on conflict do nothing;

-- One user's group count is checked by several functions; this serialises them.
create function public._lock_user(p_user_id uuid) returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('epurse-user:' || p_user_id::text, 0));
$$;

-- ── Internal helpers ─────────────────────────────────────────────────────────

drop function public._append_system(uuid, text, uuid);
create function public._append_system(p_group_id uuid, p_type text, p_subject uuid, p_member uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_seq bigint;
begin
  update public.groups set last_seq = last_seq + 1 where id = p_group_id returning last_seq into v_seq;
  insert into public.group_events (group_id, seq, event_id, system_type, system_subject, system_member)
  values (p_group_id, v_seq, gen_random_uuid(), p_type, p_subject, p_member);
end;
$$;

-- Same as 20261013000000, plus: remembered as a former member, and their open invites stop working.
create or replace function public._remove_member(p_group_id uuid, p_user_id uuid, p_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.groups where id = p_group_id for update;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if not found then return; end if;

  if not exists (select 1 from public.group_members where group_id = p_group_id) then
    delete from public.groups where id = p_group_id;
    return;
  end if;

  if not exists (select 1 from public.group_members where group_id = p_group_id and role = 'admin') then
    update public.group_members set role = 'admin'
    where group_id = p_group_id
      and user_id = (select user_id from public.group_members
                     where group_id = p_group_id order by joined_at, user_id limit 1);
  end if;

  update public.group_invites set revoked_at = now()
  where group_id = p_group_id and created_by = p_user_id and used_at is null and revoked_at is null;
  if p_type in ('member_left', 'member_removed') then
    insert into public.group_former_members (group_id, user_id) values (p_group_id, p_user_id) on conflict do nothing;
  end if;

  perform public._append_system(p_group_id, p_type, p_user_id);
end;
$$;

-- ── Client functions ─────────────────────────────────────────────────────────

create or replace function public.create_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_group_id is null then raise exception 'bad request' using errcode = '22023'; end if;
  perform public._lock_user(auth.uid());

  if exists (select 1 from public.groups where id = p_group_id) then
    if exists (select 1 from public.group_members where group_id = p_group_id and user_id = auth.uid()) then
      return;  -- retry of a create that already landed
    end if;
    raise exception 'group id in use' using errcode = '23505';
  end if;

  if (select count(*) from public.group_members where user_id = auth.uid()) >= 100 then
    raise exception 'too many groups' using errcode = '54000';
  end if;

  insert into public.groups (id, created_by) values (p_group_id, auth.uid());
  insert into public.group_members (group_id, user_id, role) values (p_group_id, auth.uid(), 'admin');
  perform public._append_system(p_group_id, 'group_created', auth.uid());
end;
$$;

-- Same as 20261018000000, but membership is checked after the group lock and NULLs are refused.
create or replace function public.append_events(p_group_id uuid, p_events jsonb)
returns table (r_event_id uuid, r_seq bigint)
language plpgsql security definer set search_path = '' as $$
declare
  e          jsonb;
  v_id       uuid;
  v_seq      bigint;
  v_epoch    int;
  v_found_g  uuid;
  v_found_s  bigint;
  v_inserted boolean := false;
begin
  if p_events is null or jsonb_typeof(p_events) is distinct from 'array'
     or jsonb_array_length(p_events) not between 1 and 50 then
    raise exception 'batch must hold 1-50 events' using errcode = '22023';
  end if;

  select last_seq, key_epoch into v_seq, v_epoch from public.groups where id = p_group_id for update;
  if not found or not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  for e in select value from jsonb_array_elements(p_events) loop
    v_id := (e ->> 'event_id')::uuid;
    if v_id is null then raise exception 'bad request' using errcode = '22023'; end if;

    select group_id, seq into v_found_g, v_found_s from public.group_events where event_id = v_id;
    if not found then
      select group_id, seq into v_found_g, v_found_s from public.group_compacted_ids where event_id = v_id;
    end if;
    if found then
      if v_found_g is distinct from p_group_id then
        raise exception 'event id in use' using errcode = '23505';
      end if;
      r_event_id := v_id; r_seq := v_found_s; return next;
      continue;
    end if;

    if (e ->> 'key_epoch')::int is distinct from v_epoch then
      raise exception 'stale key epoch' using errcode = '22023';
    end if;

    v_seq := v_seq + 1;
    insert into public.group_events (group_id, seq, event_id, author_id, key_epoch, nonce, ciphertext)
    values (p_group_id, v_seq, v_id, auth.uid(), v_epoch, e ->> 'nonce', e ->> 'ciphertext');
    v_inserted := true;
    r_event_id := v_id; r_seq := v_seq; return next;
  end loop;

  if v_inserted then
    update public.groups
    set last_seq = v_seq, last_event_at = now(), expires_at = now() + interval '90 days', dormant_at = null
    where id = p_group_id;
  end if;
end;
$$;

-- Same as 20261016000000, but a NULL base seq no longer skips the "nothing newer" check.
create or replace function public.append_checkpoint(p_group_id uuid, p_base_seq bigint, p_event jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid := (p_event ->> 'event_id')::uuid;
  v_last  bigint;
  v_epoch int;
begin
  if p_base_seq is null or v_id is null then raise exception 'bad request' using errcode = '22023'; end if;

  select last_seq, key_epoch into v_last, v_epoch from public.groups where id = p_group_id for update;
  if not found or not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  if exists (select 1 from public.group_events where event_id = v_id and group_id = p_group_id) then
    return true;  -- retry of a checkpoint that already landed
  end if;
  if v_last is distinct from p_base_seq then return false; end if;
  if (p_event ->> 'key_epoch')::int is distinct from v_epoch then
    raise exception 'stale key epoch' using errcode = '22023';
  end if;

  insert into public.group_events (group_id, seq, event_id, author_id, key_epoch, nonce, ciphertext)
  values (p_group_id, v_last + 1, v_id, auth.uid(), v_epoch, p_event ->> 'nonce', p_event ->> 'ciphertext');

  -- Not activity: the compaction date stays where the last real change put it.
  update public.groups
  set last_seq = v_last + 1, checkpoint_seq = v_last + 1, checkpoint_at = now()
  where id = p_group_id;
  return true;
end;
$$;

-- A phone with the full history checked the group's latest checkpoint and it matched.
-- Only another member's word counts: the author vouching for their own summary proves nothing.
-- false = not the latest checkpoint any more, or it's my own (nothing to retry either way).
create function public.ack_checkpoint(p_group_id uuid, p_seq bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_cp bigint;
begin
  if p_seq is null then raise exception 'bad request' using errcode = '22023'; end if;
  select checkpoint_seq into v_cp from public.groups where id = p_group_id for update;
  if not found or not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if v_cp is distinct from p_seq then return false; end if;
  if exists (select 1 from public.group_events
             where group_id = p_group_id and seq = p_seq and author_id is not distinct from auth.uid()) then
    return false;
  end if;
  update public.groups set verified_checkpoint_seq = greatest(coalesce(verified_checkpoint_seq, 0), p_seq)
  where id = p_group_id;
  return true;
end;
$$;

-- p_member_id: the group member (opaque uuid) the invite is for; null = a new person.
drop function public.create_invite(uuid, uuid, text);
create function public.create_invite(p_invite_id uuid, p_group_id uuid, p_token_hash text, p_member_id uuid default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_expires timestamptz := now() + interval '48 hours';
begin
  if p_invite_id is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad request' using errcode = '22023';
  end if;
  perform 1 from public.groups where id = p_group_id for update;
  if not found or not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if (select count(*) from public.group_invites
      where group_id = p_group_id and used_at is null and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'too many open invites' using errcode = '54000';
  end if;

  insert into public.group_invites (id, group_id, created_by, token_hash, expires_at, member_id)
  values (p_invite_id, p_group_id, auth.uid(), decode(p_token_hash, 'hex'), v_expires, p_member_id);
  return v_expires;
end;
$$;

-- r_member_id: who the invite says I am (null = a new person) — on a retry too.
drop function public.redeem_invite(uuid, text);
create function public.redeem_invite(p_invite_id uuid, p_token text)
returns table (r_group_id uuid, r_key_epoch int, r_last_seq bigint, r_member_id uuid)
language plpgsql security definer set search_path = '' as $$
declare inv public.group_invites;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- invite.ts makes 32-byte tokens (43+ base64url chars); anything shorter isn't one.
  if p_invite_id is null or p_token is null or char_length(p_token) < 32 then
    raise exception 'invalid invite' using errcode = '42501';
  end if;
  perform public._lock_user(auth.uid());

  select * into inv from public.group_invites where id = p_invite_id for update;
  if not found or inv.token_hash is distinct from extensions.digest(p_token, 'sha256') then
    raise exception 'invalid invite' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = inv.group_id for update;
  if not found then raise exception 'group has ended' using errcode = '42501'; end if;

  -- Already a member (e.g. a retried redeem): succeed without consuming anything.
  if not exists (select 1 from public.group_members where group_id = inv.group_id and user_id = auth.uid()) then
    if inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
      raise exception 'invite expired or used' using errcode = '42501';
    end if;
    if (select count(*) from public.group_members where group_id = inv.group_id) >= 50 then
      raise exception 'group is full' using errcode = '54000';
    end if;
    if (select count(*) from public.group_members where user_id = auth.uid()) >= 100 then
      raise exception 'too many groups' using errcode = '54000';
    end if;

    insert into public.group_members (group_id, user_id) values (inv.group_id, auth.uid());
    delete from public.group_former_members where group_id = inv.group_id and user_id = auth.uid();
    update public.group_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
    perform public._append_system(inv.group_id, 'member_joined', auth.uid(), inv.member_id);
  end if;

  return query select g.id, g.key_epoch, g.last_seq, inv.member_id from public.groups g where g.id = inv.group_id;
end;
$$;

-- Same as 20261019000000, but "former member" survives compaction and the counts are locked.
create or replace function public.readd_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then raise exception 'bad request' using errcode = '22023'; end if;
  perform public._lock_user(p_user_id);
  perform 1 from public.groups where id = p_group_id for update;
  if not found or not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id) then
    return;  -- already back (a retry)
  end if;
  -- Only someone who was in this group: no adding strangers by user id.
  if not exists (select 1 from public.group_former_members where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'not a former member' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where group_id = p_group_id) >= 50 then
    raise exception 'group is full' using errcode = '54000';
  end if;
  if (select count(*) from public.group_members where user_id = p_user_id) >= 100 then
    raise exception 'member has too many groups' using errcode = '54000';
  end if;

  delete from public.group_former_members where group_id = p_group_id and user_id = p_user_id;
  insert into public.group_members (group_id, user_id) values (p_group_id, p_user_id);
  perform public._append_system(p_group_id, 'member_joined', p_user_id);
end;
$$;

create or replace function public.remove_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user_id is null then raise exception 'bad request' using errcode = '22023'; end if;
  if not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  perform public._remove_member(p_group_id, p_user_id, 'member_removed');
end;
$$;

create or replace function public.register_push_token(p_token text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,180}\]$' then
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

-- ── Server-only ──────────────────────────────────────────────────────────────

-- Same as 20261018000000, but only up to a checkpoint another member's phone has checked.
create or replace function public.purge_expired() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_compacted_ids (event_id, group_id, seq)
  select e.event_id, e.group_id, e.seq
  from public.group_events e join public.groups g on g.id = e.group_id
  where g.expires_at <= now() and g.verified_checkpoint_seq is not null and e.seq < g.verified_checkpoint_seq
  on conflict do nothing;

  delete from public.group_events e
  using public.groups g
  where e.group_id = g.id and g.expires_at <= now() and g.verified_checkpoint_seq is not null
    and e.seq < g.verified_checkpoint_seq;

  update public.groups
  set dormant_at = coalesce(dormant_at, now()),
      expires_at = case when verified_checkpoint_seq is not null then 'infinity'::timestamptz else expires_at end
  where expires_at <= now();

  delete from public.group_invites where expires_at <= now() - interval '7 days';
end;
$$;

-- Same as 20261015000000, but each member's 2 newest phones (50 × 2 = Expo's 100 per request).
create or replace function public._on_group_activity() returns trigger
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
        from (select pt.token,
                     row_number() over (partition by pt.user_id order by pt.updated_at desc) as n
              from public.push_tokens pt
              join public.group_members m on m.user_id = pt.user_id and m.group_id = new.id
              where pt.user_id is distinct from auth.uid()) t
       where t.n <= 2;
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

-- ── Grants ───────────────────────────────────────────────────────────────────

revoke execute on function
  public._lock_user(uuid), public._append_system(uuid, text, uuid, uuid),
  public.ack_checkpoint(uuid, bigint), public.create_invite(uuid, uuid, text, uuid), public.redeem_invite(uuid, text)
  from public, anon, authenticated;
grant execute on function
  public.ack_checkpoint(uuid, bigint), public.create_invite(uuid, uuid, text, uuid), public.redeem_invite(uuid, text)
  to authenticated;
