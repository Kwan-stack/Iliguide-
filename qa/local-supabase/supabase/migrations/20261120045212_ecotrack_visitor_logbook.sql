create table public.reservation_visitors (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  visitor_type text not null check (visitor_type in ('adult', 'child')),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  address text not null check (length(trim(address)) between 1 and 500),
  gender text check (gender in ('female', 'male', 'non_binary', 'prefer_not_to_say')),
  nationality text check (nationality is null or length(trim(nationality)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (booking_id, sequence_number)
);

alter table public.reservation_visitors enable row level security;
grant select on public.reservation_visitors to authenticated;

create policy reservation_visitors_owner_or_manager_read
on public.reservation_visitors for select to authenticated
using (exists (
  select 1 from public.bookings b
  where b.id = reservation_visitors.booking_id
    and (b.visitor_id = (select auth.uid()) or private.can_manage_site(b.site_id))
));

create function private.create_booking_hold(
  p_slot_id uuid, p_name text, p_adult_count integer, p_child_count integer,
  p_email text, p_phone text, p_pwd_count integer, p_visitors jsonb
)
returns table (
  booking_id uuid, booking_reference text, hold_expires_at timestamptz,
  total_amount numeric, guest_access_token text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
  v_hold record;
  v_person jsonb;
  v_index bigint;
  v_name text;
  v_address text;
  v_gender text;
  v_nationality text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'visitor' and p.account_status = 'active'
  ) then
    raise exception 'Only active visitor accounts can make online bookings';
  end if;
  if p_visitors is null or jsonb_typeof(p_visitors) is distinct from 'array' then
    raise exception 'Visitor information is required for every person';
  end if;
  select t.slug into v_slug
  from public.site_slots sl join public.tourism_sites t on t.id = sl.site_id
  where sl.id = p_slot_id;
  if v_slug is null then raise exception 'Choose a valid destination and time slot'; end if;
  if v_slug in ('tinago-falls', 'mimbalot-falls', 'sikyop-agri-tourism-adventure', 'timoga-cold-springs') then
    if jsonb_array_length(p_visitors) <> coalesce(p_adult_count, 0) + coalesce(p_child_count, 0) then
      raise exception 'Provide one visitor record per adult and child';
    end if;
  elsif jsonb_array_length(p_visitors) <> 0 then
    raise exception 'This destination has no published individual visitor information requirements';
  end if;

  for v_person, v_index in
    select item.value, item.ordinality from jsonb_array_elements(p_visitors) with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(v_person) is distinct from 'object' then
      raise exception 'Each visitor record must be an object';
    end if;
    v_name := nullif(trim(v_person ->> 'full_name'), '');
    v_address := nullif(trim(v_person ->> 'address'), '');
    v_gender := nullif(lower(trim(v_person ->> 'gender')), '');
    v_nationality := nullif(trim(v_person ->> 'nationality'), '');
    if v_name is null or length(v_name) > 120 or v_address is null or length(v_address) > 500 then
      raise exception 'Enter each visitor’s full name and complete address';
    end if;
    if v_slug = 'timoga-cold-springs' then
      if v_gender is not null or v_nationality is not null then
        raise exception 'Timoga visitor records require name and address only';
      end if;
    else
      if v_gender is null or v_gender not in ('female', 'male', 'non_binary', 'prefer_not_to_say') then
        raise exception 'Select a gender for each visitor';
      end if;
      if v_slug = 'mimbalot-falls' then
        if v_nationality is null or length(v_nationality) > 100 then
          raise exception 'Enter each Mimbalot visitor’s nationality';
        end if;
      elsif v_nationality is not null then
        raise exception 'Nationality is not collected for this destination';
      end if;
    end if;
  end loop;

  select * into v_hold from private.create_booking_hold(
    p_slot_id, p_name, p_adult_count, p_child_count, p_email, p_phone, p_pwd_count
  );

  insert into public.reservation_visitors (
    booking_id, sequence_number, visitor_type, full_name, address, gender, nationality
  )
  select v_hold.booking_id, item.ordinality::integer,
    case when item.ordinality <= p_adult_count then 'adult' else 'child' end,
    trim(item.value ->> 'full_name'), trim(item.value ->> 'address'),
    nullif(lower(trim(item.value ->> 'gender')), ''), nullif(trim(item.value ->> 'nationality'), '')
  from jsonb_array_elements(p_visitors) with ordinality as item(value, ordinality);

  return query select v_hold.booking_id, v_hold.booking_reference,
    v_hold.hold_expires_at, v_hold.total_amount, v_hold.guest_access_token;
end
$$;

create function public.create_booking_hold(
  p_slot_id uuid, p_name text, p_adult_count integer, p_child_count integer,
  p_email text, p_phone text, p_pwd_count integer, p_visitors jsonb
)
returns table (
  booking_id uuid, booking_reference text, hold_expires_at timestamptz,
  total_amount numeric, guest_access_token text
)
language sql security invoker set search_path = ''
as $$ select * from private.create_booking_hold(
  p_slot_id, p_name, p_adult_count, p_child_count, p_email, p_phone, p_pwd_count, p_visitors
) $$;

revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer)
  from public, anon, authenticated;
revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb)
  to authenticated;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb)
  from public, anon;
grant execute on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb)
  to authenticated;
