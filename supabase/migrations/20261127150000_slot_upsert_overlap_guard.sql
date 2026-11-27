create or replace function private.prevent_overlapping_site_slots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.site_id::text || ':' || new.slot_date::text, 0)
  );
  if exists (
    select 1
    from public.site_slots s
    where s.site_id = new.site_id
      and s.slot_date = new.slot_date
      and s.id is distinct from new.id
      -- A unique-start conflict is resolved by ON CONFLICT after BEFORE INSERT triggers run.
      and s.starts_at <> new.starts_at
      and new.starts_at < s.ends_at
      and new.ends_at > s.starts_at
  ) then
    raise exception 'Visit slots for the same destination and date cannot overlap';
  end if;
  return new;
end;
$$;
