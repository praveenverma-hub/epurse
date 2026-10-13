-- Checkpoints + retention timers (docs/SHARED_GROUP_SYNC.md §8b, §9).
--
--   • append_checkpoint: a member's phone posts an encrypted checkpoint, accepted only
--     while nothing newer has arrived, so a checkpoint never races a new expense.
--   • Timers: 90 days after the last activity; 365 days when the last thing in the group
--     is a checkpoint (a ~1–2 KB record of people and who owes whom).
--   • compact_groups deletes events before each group's checkpoint. It is NOT scheduled:
--     turn it on only once late joiners can fetch history from another member (phase 5/6).

alter table public.groups
  add column checkpoint_seq bigint,
  add column checkpoint_at  timestamptz;

-- Same as before except the timer (90 days, was 60) and no settled-state bookkeeping.
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
    set last_seq = v_seq, last_event_at = now(), expires_at = now() + interval '90 days'
    where id = p_group_id;
  end if;
end;
$$;

-- p_event: { event_id, key_epoch, nonce, ciphertext } — the encrypted group.checkpoint.
-- false = something newer arrived first; the phone folds it and tries again later.
create function public.append_checkpoint(p_group_id uuid, p_base_seq bigint, p_event jsonb) returns boolean
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

  update public.groups
  set last_seq = v_last + 1, checkpoint_seq = v_last + 1, checkpoint_at = now(),
      expires_at = now() + interval '365 days'
  where id = p_group_id;
  return true;
end;
$$;

-- Deletes every event before each group's latest checkpoint. Not scheduled yet (see top).
create function public.compact_groups() returns void
language sql security definer set search_path = '' as $$
  delete from public.group_events e
  using public.groups g
  where e.group_id = g.id and g.checkpoint_seq is not null and e.seq < g.checkpoint_seq;
$$;

revoke execute on function public.append_checkpoint(uuid, bigint, jsonb), public.compact_groups()
  from public, anon, authenticated;
grant execute on function public.append_checkpoint(uuid, bigint, jsonb) to authenticated;
grant execute on function public.compact_groups() to service_role;
