-- =============================================================================
-- No admin rules (decided Oct-15-2026, docs/SHARED_GROUP_SYNC.md §8a). A shared group is a
-- money record between people who trust each other, not a chat group: any member may
-- remove someone (the app allows it only at ₹0) or add a former member back, and anyone
-- holding a member's invite may join — including someone removed earlier. The invite is
-- the members' say-so.
--
-- Replaces the admin checks in remove_member / readd_member and drops group_removals
-- (20261018000000_removals_authors_compaction.sql). The `role` column stays, unused.
-- =============================================================================

create or replace function public.remove_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  perform public._remove_member(p_group_id, p_user_id, 'member_removed');
end;
$$;

create or replace function public.readd_member(p_group_id uuid, p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(p_group_id) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  perform 1 from public.groups where id = p_group_id for update;
  if exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_user_id) then
    return;  -- already back (a retry)
  end if;
  -- Only someone who was in this group: no adding strangers by user id.
  if not exists (select 1 from public.group_events
                 where group_id = p_group_id and system_subject = p_user_id
                   and system_type in ('member_left', 'member_removed')) then
    raise exception 'not a former member' using errcode = '42501';
  end if;
  if (select count(*) from public.group_members where group_id = p_group_id) >= 50 then
    raise exception 'group is full' using errcode = '54000';
  end if;
  if (select count(*) from public.group_members where user_id = p_user_id) >= 100 then
    raise exception 'member has too many groups' using errcode = '54000';
  end if;

  insert into public.group_members (group_id, user_id) values (p_group_id, p_user_id);
  perform public._append_system(p_group_id, 'member_joined', p_user_id);
end;
$$;

-- Same as 20261018000000, without the removal check.
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

drop table if exists public.group_removals;
