-- =============================================================================
-- Groups no longer END from inactivity (decided Oct-15-2026, replaces the 90/365-day
-- deletion and the manual "Share Again"). After 90 quiet days a group goes DORMANT:
-- the server keeps the group row, its members and its latest checkpoint, and drops
-- the events before that checkpoint. The next change from any member wakes it, and
-- every phone carries on as if nothing happened — no new invites, no re-upload.
--
--   • is_member / redeem_invite: no expiry check any more (nothing is hidden).
--   • append_events: activity pushes the compaction date out again and wakes it.
--   • append_checkpoint: no longer buys 365 days — it's what compaction keeps.
--   • purge_expired (daily cron, same job): compacts groups quiet past expires_at.
--     A group with no checkpoint yet keeps its events and is retried daily.
--
-- What a group still ends by: everyone leaving, being removed, Delete Account.
-- Cost: ~1–2 KB per dormant group (the checkpoint). Late joiners after compaction get
-- the balances (checkpoint), not the older expenses — same rule as any checkpoint.
-- =============================================================================

alter table public.groups add column dormant_at timestamptz;

create or replace function public.is_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = auth.uid()
  );
$$;

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

create or replace function public.append_checkpoint(p_group_id uuid, p_base_seq bigint, p_event jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid := (p_event ->> 'event_id')::uuid;
  v_last  bigint;
  v_epoch int;
begin
  if not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  select last_seq, key_epoch into v_last, v_epoch from public.groups where id = p_group_id for update;

  if exists (select 1 from public.group_events where event_id = v_id and group_id = p_group_id) then
    return true;  -- retry of a checkpoint that already landed
  end if;
  if v_last <> p_base_seq then return false; end if;
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

create or replace function public.purge_expired() returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Quiet for 90 days and checkpointed: keep everything from the checkpoint on.
  delete from public.group_events e
  using public.groups g
  where e.group_id = g.id and g.expires_at <= now() and g.checkpoint_seq is not null and e.seq < g.checkpoint_seq;

  -- Compacted ones wait for the next activity; un-checkpointed ones are looked at again tomorrow.
  update public.groups
  set dormant_at = coalesce(dormant_at, now()),
      expires_at = case when checkpoint_seq is not null then 'infinity'::timestamptz else expires_at end
  where expires_at <= now();

  delete from public.group_invites where expires_at <= now() - interval '7 days';
end;
$$;

revoke execute on function public.purge_expired() from public, anon, authenticated;
grant execute on function public.purge_expired() to service_role;
