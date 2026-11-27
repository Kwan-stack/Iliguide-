create unique index notifications_booking_approved_uidx
  on public.notifications (user_id, booking_id)
  where notification_type = 'booking_approved' and booking_id is not null;

create or replace function private.notify_visitor_booking_approved()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.visitor_id is null or new.booking_status <> 'confirmed' or new.payment_status = 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.booking_status = 'confirmed' then return new; end if;

  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  values (new.visitor_id, new.id, 'Booking approved',
    'Your booking ' || new.booking_reference || ' has been approved and is confirmed.', 'booking_approved')
  on conflict (user_id, booking_id)
    where notification_type = 'booking_approved' and booking_id is not null do nothing;
  return new;
end
$$;

create trigger visitor_booking_approved_notice
  after insert or update of booking_status on public.bookings
  for each row execute function private.notify_visitor_booking_approved();

revoke all on function private.notify_visitor_booking_approved() from public, anon, authenticated, service_role;
