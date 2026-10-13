-- =============================================================================
-- Shared group sync — phases 1–3. Design: docs/SHARED_GROUP_SYNC.md.
--
-- The server stores membership and ciphertext only: no names, no amounts.
-- Clients READ through row-level security and WRITE only through the
-- security-definer functions below; no table grants insert/update/delete.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ── Tables ───────────────────────────────────────────────────────────────────

create table public.groups (
  id            uuid primary key,                -- client-generated, so creating is idempotent
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_seq      bigint      not null default 0,
  key_epoch     int         not null default 1,
  last_event_at timestamptz not null default now(),
  settled_at    timestamptz,                     -- phase 5
  settled_seq   bigint,                          -- phase 5
  expires_at    timestamptz not null default now() + interval '60 days'
);

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

create table public.group_invites (
  id         uuid primary key,
  group_id   uuid not null references public.groups (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  token_hash bytea not null,                     -- sha256(token); the raw token is never stored
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by    uuid references auth.users (id) on delete set null,
  used_at    timestamptz,
  revoked_at timestamptz
);
create index group_invites_group on public.group_invites (group_id);

create table public.group_events (
  group_id       uuid   not null references public.groups (id) on delete cascade,
  seq            bigint not null,
  event_id       uuid   not null unique,
  author_id      uuid references auth.users (id) on delete set null,  -- null on system events
  key_epoch      int,
  nonce          text,                           -- base64, 24 bytes
  ciphertext     text,                           -- base64
  system_type    text check (system_type in
                   ('group_created', 'member_joined', 'member_left', 'member_removed', 'member_deleted')),
  system_subject uuid,
  created_at     timestamptz not null default now(),
  primary key (group_id, seq),
  -- exactly one of: an encrypted data event, or a plaintext system event
  check ((system_type is null) = (ciphertext is not null)),
  check (ciphertext is null or (char_length(nonce) = 32 and char_length(ciphertext) <= 21848 and key_epoch is not null))
);

-- ── Row-level security: members of an unexpired group can read it ───────────

alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invites enable row level security;
alter table public.group_events  enable row level security;

-- Security definer so the policies can read group_members without recursing into its own policy.
create function public.is_member(p_group_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.group_id = p_group_id and m.user_id = auth.uid() and g.expires_at > now()
  );
$$;

create policy groups_read        on public.groups        for select to authenticated using (public.is_member(id));
create policy group_members_read on public.group_members for select to authenticated using (public.is_member(group_id));
create policy group_events_read  on public.group_events  for select to authenticated using (public.is_member(group_id));
-- group_invites: no policy — reachable only through the functions below.

revoke all on public.groups, public.group_members, public.group_invites, public.group_events from anon, authenticated;
grant select on public.groups, public.group_members, public.group_events to authenticated;

-- ── Internal helpers (not callable by clients) ───────────────────────────────

create function public._append_system(p_group_id uuid, p_type text, p_subject uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_seq bigint;
begin
  update public.groups set last_seq = last_seq + 1 where id = p_group_id returning last_seq into v_seq;
  insert into public.group_events (group_id, seq, event_id, system_type, system_subject)
  values (p_group_id, v_seq, gen_random_uuid(), p_type, p_subject);
end;
$$;

-- Removes one member; deletes the group if nobody is left, else keeps one admin.
create function public._remove_member(p_group_id uuid, p_user_id uuid, p_type text) returns void
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

  perform public._append_system(p_group_id, p_type, p_user_id);
end;
$$;

-- ── Client functions ─────────────────────────────────────────────────────────

create function public.create_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;

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

-- p_events: [{ event_id, key_epoch, nonce, ciphertext }], 1–50 items.
-- Idempotent: an event_id already stored returns its existing seq and is not re-applied.
create function public.append_events(p_group_id uuid, p_events jsonb)
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
    set last_seq = v_seq, last_event_at = now(), settled_at = null, settled_seq = null,
        expires_at = now() + interval '60 days'
    where id = p_group_id;
  end if;
end;
$$;

-- p_token_hash: hex sha256 of the invite token. Any member may invite; expires in 48h.
create function public.create_invite(p_invite_id uuid, p_group_id uuid, p_token_hash text) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_expires timestamptz := now() + interval '48 hours';
begin
  if not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if (select count(*) from public.group_invites
      where group_id = p_group_id and used_at is null and revoked_at is null and expires_at > now()) >= 20 then
    raise exception 'too many open invites' using errcode = '54000';
  end if;

  insert into public.group_invites (id, group_id, created_by, token_hash, expires_at)
  values (p_invite_id, p_group_id, auth.uid(), decode(p_token_hash, 'hex'), v_expires);
  return v_expires;
end;
$$;

create function public.redeem_invite(p_invite_id uuid, p_token text)
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
    if exists (select 1 from public.groups where id = inv.group_id and expires_at <= now()) then
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

create function public.leave_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  perform public._remove_member(p_group_id, auth.uid(), 'member_left');
end;
$$;

create function public.remove_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.group_members
                 where group_id = p_group_id and user_id = auth.uid() and role = 'admin') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform public._remove_member(p_group_id, p_user_id, 'member_removed');
end;
$$;

-- ── Server-only functions ────────────────────────────────────────────────────

-- Delete Account (called by the delete-account Edge Function with the service role).
-- Deletes the user's own events; other members' events stay.
create function public.purge_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_group uuid;
begin
  for v_group in select group_id from public.group_members where user_id = p_user_id loop
    delete from public.group_events where group_id = v_group and author_id = p_user_id;
    perform public._remove_member(v_group, p_user_id, 'member_deleted');
  end loop;
  delete from public.group_invites where created_by = p_user_id;
end;
$$;

create function public.purge_expired() returns void
language sql security definer set search_path = '' as $$
  delete from public.groups where expires_at <= now();
  delete from public.group_invites where expires_at <= now() - interval '7 days';
$$;

-- ── Function grants ──────────────────────────────────────────────────────────

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_member(uuid),
  public.create_group(uuid),
  public.append_events(uuid, jsonb),
  public.create_invite(uuid, uuid, text),
  public.redeem_invite(uuid, text),
  public.leave_group(uuid),
  public.remove_member(uuid, uuid)
to authenticated;
grant execute on function public.purge_user(uuid), public.purge_expired() to service_role;

-- 21:30 UTC = 03:00 IST
select cron.schedule('purge-expired-groups', '30 21 * * *', 'select public.purge_expired()');
