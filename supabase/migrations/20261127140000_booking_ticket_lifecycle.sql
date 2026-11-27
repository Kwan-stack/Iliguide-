alter table public.bookings add column site_name_snapshot text;

update public.bookings b
set site_name_snapshot = s.name
from public.tourism_sites s
where s.id = b.site_id;

alter table public.bookings alter column site_name_snapshot set not null;

create function private.snapshot_booking_site_name()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select s.name into new.site_name_snapshot from public.tourism_sites s where s.id = new.site_id;
    if new.site_name_snapshot is null then raise exception 'Booking destination is unavailable'; end if;
  elsif new.site_id is distinct from old.site_id then
    select s.name into new.site_name_snapshot from public.tourism_sites s where s.id = new.site_id;
    if new.site_name_snapshot is null then raise exception 'Booking destination is unavailable'; end if;
  end if;
  return new;
end
$$;
revoke all on function private.snapshot_booking_site_name() from public, anon, authenticated, service_role;
create trigger booking_snapshot_site_name
before insert or update of site_id on public.bookings
for each row execute function private.snapshot_booking_site_name();

create or replace function private.lookup_booking(p_booking_reference text, p_guest_access_token text default null)
returns table (
  booking_id uuid, booking_reference text, visitor_name text, visitor_count integer,
  visitor_email text, visitor_phone text, adult_count integer, child_count integer,
  pwd_count integer, total_amount numeric, currency char(3),
  payment_status public.payment_status, booking_status public.booking_status,
  booking_source text, site_id uuid, site_name text, slot_date date,
  starts_at time, ends_at time, cancellation_cutoff_at timestamptz,
  hold_expires_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  select b.id, b.booking_reference, b.visitor_name, b.visitor_count,
    b.visitor_email, b.visitor_phone, b.adult_count, b.child_count,
    b.pwd_count, b.total_amount, b.currency, b.payment_status,
    b.booking_status, b.booking_source, b.site_id, b.site_name_snapshot,
    sl.slot_date, sl.starts_at, sl.ends_at,
    b.cancellation_cutoff_at, b.hold_expires_at
  from public.bookings b
  join public.site_slots sl on sl.id = b.slot_id
  where upper(b.booking_reference) = upper(trim(p_booking_reference))
    and (b.visitor_id = (select auth.uid())
      or private.booking_access_valid(b.id, p_guest_access_token)
      or private.can_work_site(b.site_id));
end
$$;

drop function public.visitor_booking_attendance(uuid);
create function public.visitor_booking_attendance(p_booking_id uuid default null)
returns table (
  booking_id uuid, visitor_count integer, entered_count integer, exited_count integer,
  active_count integer, entered_at timestamptz, exited_at timestamptz, booking_status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.current_role() is distinct from 'visitor' or auth.uid() is null then
    raise exception 'Visitor access denied';
  end if;

  return query
  select b.id, b.visitor_count, coalesce(a.entered_count, 0), coalesce(a.exited_count, 0),
    greatest(coalesce(a.entered_count, 0) - coalesce(a.exited_count, 0), 0), a.entered_at, a.exited_at,
    b.booking_status::text
  from public.bookings b
  left join lateral (
    select coalesce(sum(l.visitor_count) filter (where l.action = 'entry' and l.counts_toward_occupancy), 0)::integer as entered_count,
      coalesce(sum(l.visitor_count) filter (where l.action = 'exit' and l.counts_toward_occupancy), 0)::integer as exited_count,
      min(l.scanned_at) filter (where l.action = 'entry' and l.counts_toward_occupancy) as entered_at,
      max(l.scanned_at) filter (where l.action = 'exit' and l.counts_toward_occupancy) as exited_at
    from public.attendance_logs l where l.booking_id = b.id
  ) a on true
  where b.visitor_id = auth.uid() and (p_booking_id is null or b.id = p_booking_id);
end
$$;
revoke all on function public.visitor_booking_attendance(uuid) from public, anon;
grant execute on function public.visitor_booking_attendance(uuid) to authenticated;

create or replace function private.notify_visitor_of_attendance()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_entered integer;
  v_exited integer;
  v_inside integer;
  v_completed boolean;
begin
  select * into v_booking from public.bookings b where b.id = new.booking_id;
  if v_booking.visitor_id is null then return new; end if;

  select coalesce(sum(l.visitor_count) filter (where l.action = 'entry' and l.counts_toward_occupancy), 0)::integer,
    coalesce(sum(l.visitor_count) filter (where l.action = 'exit' and l.counts_toward_occupancy), 0)::integer
  into v_entered, v_exited
  from public.attendance_logs l where l.booking_id = new.booking_id;
  v_inside := greatest(v_entered - v_exited, 0);
  v_completed := new.action = 'exit' and v_entered >= v_booking.visitor_count and v_exited >= v_booking.visitor_count;

  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  values (
    v_booking.visitor_id,
    v_booking.id,
    case when v_completed then 'Visit Successfully Completed'
      when new.action = 'entry' then 'Visit check-in recorded' else 'Visit check-out recorded' end,
    case when v_completed then 'Your visit to ' || v_booking.site_name_snapshot
      || ' has been successfully completed. Your ticket is no longer active, but you may still access your payment receipt through your booking history. Thank you for visiting!'
      else 'A gatekeeper recorded ' || new.visitor_count::text || ' visitor'
        || case when new.visitor_count = 1 then '' else 's' end
        || case new.action when 'entry' then ' entering ' else ' leaving ' end
        || v_booking.site_name_snapshot || '. ' || v_inside::text || ' visitor'
        || case when v_inside = 1 then '' else 's' end || ' currently inside.' end,
    case when v_completed then 'visit_completed'
      when new.action = 'entry' then 'attendance_entry' else 'attendance_exit' end
  );
  return new;
end
$$;

create function public.expire_unattended_bookings()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  update public.bookings b set booking_status = 'expired'
  from public.site_slots sl
  where sl.id = b.slot_id and b.booking_status = 'confirmed'
    and sl.slot_date < (clock_timestamp() at time zone 'Asia/Manila')::date
    and not exists (
      select 1 from public.attendance_logs a
      where a.booking_id = b.id and a.action = 'entry' and a.counts_toward_occupancy
    );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.expire_unattended_bookings() from public, anon, authenticated;
grant execute on function public.expire_unattended_bookings() to service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'iliguide-expire-unattended-bookings') then
    perform cron.schedule(
      'iliguide-expire-unattended-bookings',
      '*/15 * * * *',
      'select public.expire_unattended_bookings();'
    );
  end if;
end
$$;

notify pgrst, 'reload schema';
