-- =============================================================================
-- Three server fixes found by the scenario suite (docs/SHARED_GROUP_SYNC.md §8a, §9, §10;
-- src/utils/__tests__/groupScenarios.test.mjs), Oct-15-2026.
--
-- 1. REMOVED STAYS REMOVED. Someone the admin removed could come straight back through any
--    open invite (one posted in the group chat). The server now remembers the removal:
--    redeem_invite refuses them; only the admin's Add Back (readd_member) lets them in again.
--    Leaving by choice is not a removal — they can be invited back as before.
--
-- 2. AUTHORS SURVIVE DELETE ACCOUNT. author_id was "on delete set null", so after a Delete
--    Account that person's past events had no author, and a phone that later rebuilds the
--    history (a new member, a restored phone) skipped them as "not a member" — and computed
--    different balances from everyone else. The id stays now: a random uuid of an account
--    that no longer exists, with nothing else attached to it.
--
-- 3. COMPACTION KEEPS EVENT IDS. append_events is idempotent by looking up event_id, and a
--    dormant group's compaction deleted those rows — so a resend after it (a restored phone's
--    outbox, a retry) was stored again and counted twice. Compacted ids are kept.
-- =============================================================================

-- ── 1. Removals ──────────────────────────────────────────────────────────────

create table public.group_removals (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null,
  primary key (group_id, user_id)
);
alter table public.group_removals enable row level security;
revoke all on public.group_removals from anon, authenticated;   -- functions only

create or replace function public.remove_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_members
                 where group_id = p_group_id and user_id = auth.uid() and role = 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform public._remove_member(p_group_id, p_user_id, 'member_removed');
  if exists (select 1 from public.groups where id = p_group_id) then
    insert into public.group_removals (group_id, user_id) values (p_group_id, p_user_id) on conflict do nothing;
  end if;
end;
$$;

create or replace function public.readd_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_members
                 where group_id = p_group_id and user_id = auth.uid() and role = 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id) then
    return;  -- already back (a retry)
  end if;
  if not exists (select 1 from public.group_events
                 where group_id = p_group_id and system_subject = p_user_id
                   and system_type in ('member_left', 'member_removed'))
     and not exists (select 1 from public.group_removals where group_id = p_group_id and user_id = p_user_id) then
    raise exception 'not a former member' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where group_id = p_group_id) >= 50 then
    raise exception 'group is full' using errcode = '54000';
  end if;
  if (select count(*) from public.group_members where user_id = p_user_id) >= 100 then
    raise exception 'member has too many groups' using errcode = '54000';
  end if;

  delete from public.group_removals where group_id = p_group_id and user_id = p_user_id;
  insert into public.group_members (group_id, user_id) values (p_group_id, p_user_id);
  perform public._append_system(p_group_id, 'member_joined', p_user_id);
end;
$$;

-- Same as 20261016000000_dormant_groups.sql, plus the removal check.
create or replace function public.redeem_invite(p_invite_id uuid, p_token text)
returns table (r_group_id uuid, r_key_epoch int, r_last_seq bigint)
language plpgsql security definer set search_path = '' as $$
declare inv public.group_invites;
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;

  select * into inv from public.group_invites where id = p_invite_id for update;
  if not found or inv.token_hash <> extensions.digest(p_token, 'sha256') then
    raise exception 'invalid invite' using errcode = '42501';
  end if;

  -- Already a member (e.g. a retried redeem): succeed without consuming anything.
  if not exists (select 1 from public.group_members where group_id = inv.group_id and user_id = auth.uid()) then
    if inv.used_at is not null or inv.revoked_at is not null or inv.expires_at <= now() then
      raise exception 'invite expired or used' using errcode = '42501';
    end if;
    if not exists (select 1 from public.groups where id = inv.group_id) then
      raise exception 'group has ended' using errcode = '42501';
    end if;
    if exists (select 1 from public.group_removals where group_id = inv.group_id and user_id = auth.uid()) then
      raise exception 'removed from group' using errcode = '42501';
    end if;
    if (select count(*) from public.group_members where group_id = inv.group_id) >= 50 then
      raise exception 'group is full' using errcode = '54000';
    end if;
    if (select count(*) from public.group_members where user_id = auth.uid()) >= 100 then
      raise exception 'too many groups' using errcode = '54000';
    end if;

    perform 1 from public.groups where id = inv.group_id for update;
    insert into public.group_members (group_id, user_id) values (inv.group_id, auth.uid());
    update public.group_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
    perform public._append_system(inv.group_id, 'member_joined', auth.uid());
  end if;

  return query select g.id, g.key_epoch, g.last_seq from public.groups g where g.id = inv.group_id;
end;
$$;

-- ── 2. Authors stay ──────────────────────────────────────────────────────────

alter table public.group_events drop constraint if exists group_events_author_id_fkey;

-- ── 3. Compacted event ids ───────────────────────────────────────────────────

create table public.group_compacted_ids (
  event_id uuid primary key,
  group_id uuid not null references public.groups (id) on delete cascade,
  seq      bigint not null
);
alter table public.group_compacted_ids enable row level security;
revoke all on public.group_compacted_ids from anon, authenticated;   -- functions only

-- Same as 20261016000000_dormant_groups.sql, but a compacted event_id is still "already stored".
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
  if not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 50 then
    raise exception 'batch must hold 1-50 events' using errcode = '22023';
  end if;

  select last_seq, key_epoch into v_seq, v_epoch from public.groups where id = p_group_id for update;

  for e in select value from jsonb_array_elements(p_events) loop
    v_id := (e ->> 'event_id')::uuid;

    select group_id, seq into v_found_g, v_found_s from public.group_events where event_id = v_id;
    if not found then
      select group_id, seq into v_found_g, v_found_s from public.group_compacted_ids where event_id = v_id;
    end if;
    if found then
      if v_found_g <> p_group_id then
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

-- Same as 20261016000000_dormant_groups.sql, but the compacted ids are kept first.
create or replace function public.purge_expired() returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.group_compacted_ids (event_id, group_id, seq)
  select e.event_id, e.group_id, e.seq
  from public.group_events e join public.groups g on g.id = e.group_id
  where g.expires_at <= now() and g.checkpoint_seq is not null and e.seq < g.checkpoint_seq
  on conflict do nothing;

  delete from public.group_events e
  using public.groups g
  where e.group_id = g.id and g.expires_at <= now() and g.checkpoint_seq is not null and e.seq < g.checkpoint_seq;

  update public.groups
  set dormant_at = coalesce(dormant_at, now()),
      expires_at = case when checkpoint_seq is not null then 'infinity'::timestamptz else expires_at end
  where expires_at <= now();

  delete from public.group_invites where expires_at <= now() - interval '7 days';
end;
$$;

revoke execute on function public.purge_expired() from public, anon, authenticated;
grant execute on function public.purge_expired() to service_role;

-- ── Housekeeping ─────────────────────────────────────────────────────────────
-- Never scheduled; purge_expired is the one compaction (dormant groups only).
drop function if exists public.compact_groups();
