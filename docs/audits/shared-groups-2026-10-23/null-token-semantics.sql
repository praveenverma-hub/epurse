-- Optional isolated PostgreSQL probe. No application tables or data are changed.
-- Demonstrates the nullable boolean guard used by redeem_invite.
-- pgcrypto's digest(NULL, ...) returns NULL; substitute NULL::bytea below
-- so this probe does not require an extension installation.
do $$
declare
  rejected boolean := false;
  invite_was_found boolean := true;
begin
  if not invite_was_found or decode('abcd', 'hex') <> null::bytea then
    rejected := true;
  end if;
  if rejected then raise exception 'Unexpected: original guard rejected NULL'; end if;
  if not (decode('abcd', 'hex') is distinct from null::bytea) then
    raise exception 'Unexpected: null-safe comparison failed';
  end if;
  raise notice 'Original guard allows NULL; IS DISTINCT FROM rejects it.';
end;
$$;
