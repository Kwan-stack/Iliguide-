-- Standalone PostgreSQL smoke test; uses stubs, not Supabase Auth/RLS.
create schema private;
create type public.attendance_action as enum ('entry', 'exit');

create table public.bookings (
  id uuid primary key,
  site_id uuid not null,
  booking_reference text not null,
  booking_source text not null
);

create function private.current_role()
returns text language sql as $$ select 'gatekeeper'::text $$;

create function private.user_has_site_role(uuid, text)
returns boolean language sql as $$ select true $$;

create function private.require_active_gatekeeper_duty(uuid)
returns void language plpgsql as $$ begin return; end $$;

create table private.attendance_calls (booking_id uuid not null);

create function private.confirm_booking_attendance(
  uuid, bytea, uuid, public.attendance_action, integer, uuid[], uuid, jsonb, boolean
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language plpgsql as $$
begin
  insert into private.attendance_calls values ($1);
  return query select 'confirmed'::text, 'QA'::text, 'Visitor'::text, 1,
    null::timestamptz, null::timestamptz, 1, 0, 1;
end
$$;

insert into public.bookings values
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'QA-WALKIN', 'walk_in'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'QA-BOOKING', 'visitor');

\i supabase/migrations/20261126224632_walkin_attendance_requires_qr.sql

do $$
declare
  v_calls integer;
begin
  begin
    perform * from public.confirm_manual_attendance(
      'QA-WALKIN', '20000000-0000-4000-8000-000000000001', 'entry', 1,
      '30000000-0000-4000-8000-000000000001'
    );
    raise exception 'walk-in manual confirmation unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm <> 'Walk-in attendance requires QR ticket verification' then
      raise;
    end if;
  end;

  select count(*) into v_calls from private.attendance_calls;
  if v_calls <> 0 then
    raise exception 'walk-in reached attendance confirmation';
  end if;

  perform * from public.confirm_manual_attendance(
    'QA-BOOKING', '20000000-0000-4000-8000-000000000001', 'entry', 1,
    '30000000-0000-4000-8000-000000000002'
  );

  select count(*) into v_calls from private.attendance_calls;
  if v_calls <> 1 then
    raise exception 'non-walk-in manual confirmation did not delegate once';
  end if;
end
$$;

select 'PASS: walk-in manual attendance rejected before delegation; regular booking delegated once.' as result;
