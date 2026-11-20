create or replace function private.confirm_reservation_without_payment(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'visitor'
      and p.account_status = 'active'
  ) then
    raise exception 'Only active visitor accounts can confirm a reservation';
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = p_booking_id and b.visitor_id = auth.uid()
  for update;
  if not found then raise exception 'Booking not found for this visitor account'; end if;
  if v_booking.booking_status <> 'awaiting_payment'
     or v_booking.hold_expires_at is null
     or v_booking.hold_expires_at <= now() then
    raise exception 'This reservation hold has expired';
  end if;
  if exists (select 1 from public.payments p where p.booking_id = v_booking.id) then
    raise exception 'This reservation has a payment attempt and cannot be confirmed without payment';
  end if;

  update public.bookings
  set payment_status = 'not_required', booking_status = 'confirmed', hold_expires_at = null
  where id = v_booking.id;
  update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
end
$$;

create or replace function public.confirm_reservation_without_payment(p_booking_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.confirm_reservation_without_payment(p_booking_id)
$$;

revoke all on function private.confirm_reservation_without_payment(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.confirm_reservation_without_payment(uuid)
  to authenticated;
revoke all on function public.confirm_reservation_without_payment(uuid)
  from public, anon;
grant execute on function public.confirm_reservation_without_payment(uuid)
  to authenticated;

notify pgrst, 'reload schema';
