create function public.visitor_booking_attendance(p_booking_id uuid)
returns table (
  visitor_count integer, entered_count integer, exited_count integer, active_count integer,
  entered_at timestamptz, exited_at timestamptz, booking_status text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.current_role() is distinct from 'visitor' or auth.uid() is null then
    raise exception 'Visitor access denied';
  end if;

  return query
  select b.visitor_count, coalesce(a.entered_count, 0), coalesce(a.exited_count, 0),
    greatest(coalesce(a.entered_count, 0) - coalesce(a.exited_count, 0), 0),
    a.entered_at, a.exited_at, b.booking_status::text
  from public.bookings b
  left join lateral (
    select coalesce(sum(l.visitor_count) filter (where l.action = 'entry' and l.counts_toward_occupancy), 0)::integer as entered_count,
      coalesce(sum(l.visitor_count) filter (where l.action = 'exit' and l.counts_toward_occupancy), 0)::integer as exited_count,
      min(l.scanned_at) filter (where l.action = 'entry' and l.counts_toward_occupancy) as entered_at,
      max(l.scanned_at) filter (where l.action = 'exit' and l.counts_toward_occupancy) as exited_at
    from public.attendance_logs l where l.booking_id = b.id
  ) a on true
  where b.id = p_booking_id and b.visitor_id = auth.uid();
end
$$;
revoke all on function public.visitor_booking_attendance(uuid) from public, anon;
grant execute on function public.visitor_booking_attendance(uuid) to authenticated;

create function private.notify_visitor_of_attendance()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_inside integer;
begin
  select * into v_booking from public.bookings b where b.id = new.booking_id;
  if v_booking.visitor_id is null then return new; end if;

  select greatest(coalesce(sum(case when l.action = 'entry' then l.visitor_count else -l.visitor_count end), 0), 0)::integer
  into v_inside from public.attendance_logs l where l.booking_id = new.booking_id and l.counts_toward_occupancy;

  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  values (
    v_booking.visitor_id,
    v_booking.id,
    case new.action when 'entry' then 'Visit check-in recorded' else 'Visit check-out recorded' end,
    'A gatekeeper recorded ' || new.visitor_count::text || ' visitor'
      || case when new.visitor_count = 1 then '' else 's' end
      || case new.action when 'entry' then ' entering ' else ' leaving ' end
      || (select s.name from public.tourism_sites s where s.id = new.site_id)
      || '. ' || v_inside::text || ' visitor' || case when v_inside = 1 then '' else 's' end || ' currently inside.',
    case new.action when 'entry' then 'attendance_entry' else 'attendance_exit' end
  );
  return new;
end
$$;
revoke all on function private.notify_visitor_of_attendance() from public, anon, authenticated, service_role;

create trigger attendance_notify_visitor
after insert on public.attendance_logs
for each row execute function private.notify_visitor_of_attendance();

notify pgrst, 'reload schema';
