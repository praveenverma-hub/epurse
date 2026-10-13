-- Delete Account keeps group history (docs/SHARED_GROUP_SYNC.md §8a, §10).
-- Replaces purge_user: the user's events now STAY (encrypted); deleting the auth
-- user afterwards clears their author_id through the foreign key (on delete set null).

create or replace function public.purge_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_group uuid;
begin
  for v_group in select group_id from public.group_members where user_id = p_user_id loop
    perform public._remove_member(v_group, p_user_id, 'member_deleted');
  end loop;
  delete from public.group_invites where created_by = p_user_id;
end;
$$;

revoke execute on function public.purge_user(uuid) from public, anon, authenticated;
grant execute on function public.purge_user(uuid) to service_role;
