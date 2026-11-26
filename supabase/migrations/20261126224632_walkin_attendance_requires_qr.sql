create or replace function public.confirm_manual_attendance(
  p_booking_reference text, p_site_id uuid, p_action public.attendance_action,
  p_visitor_count integer, p_idempotency_key uuid, p_device jsonb default '{}'::jsonb,
  p_visitor_ids uuid[] default '{}'::uuid[]
)
returns table (
  result text, booking_reference text, visitor_name text, visitor_count integer,
  entered_at timestamptz, exited_at timestamptz,
  entered_count integer, exited_count integer, active_count integer
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    raise exception 'Gatekeeper access denied';
  end if;
  perform private.require_active_gatekeeper_duty(p_site_id);

  select b.* into v_booking
  from public.bookings b
  where b.site_id = p_site_id
    and lower(b.booking_reference) = lower(trim(p_booking_reference))
  for update;
  if not found then raise exception 'Booking does not belong to this destination'; end if;
  if v_booking.booking_source = 'walk_in' then
    raise exception 'Walk-in attendance requires QR ticket verification';
  end if;

  return query select * from private.confirm_booking_attendance(
    v_booking.id, null, p_site_id, p_action, p_visitor_count,
    p_visitor_ids, p_idempotency_key, p_device, false
  );
end
$$;
