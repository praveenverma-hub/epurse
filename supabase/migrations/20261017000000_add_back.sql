-- =============================================================================
-- Add Back (docs/SHARED_GROUP_SYNC.md §8a, Oct-15-2026): the admin re-adds someone who
-- left or was removed — no new invite. Their phone still holds the group key (no key
-- rotation yet) and resumes the group on its next sync; `member_joined` un-archives
-- their old member on every phone, exactly as a rejoin by invite does.
--
-- Only a FORMER member: their leave/removal marker must be in the group's history.
-- After a dormant group's compaction that marker may be gone → a new invite instead.
-- =============================================================================

create function public.readd_member(p_group_id uuid, p_user_id uuid) returns void
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

revoke execute on function public.readd_member(uuid, uuid) from public, anon;
grant execute on function public.readd_member(uuid, uuid) to authenticated;
