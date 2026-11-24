create or replace function private.notify_gatekeepers_of_reservation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.booking_source <> 'online' then return new; end if;
  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  select a.profile_id, new.id, 'New reservation received',
    'Reservation ' || new.booking_reference || ' for ' || new.visitor_count || ' visitors on ' || to_char(s.slot_date, 'Mon DD, YYYY') || ' is awaiting payment.',
    'reservation_received'
  from public.staff_assignments a
  join public.site_slots s on s.id = new.slot_id
  where a.site_id = new.site_id and a.staff_role = 'gatekeeper' and a.is_active;
  return new;
end
$$;
revoke all on function private.notify_gatekeepers_of_reservation() from public, anon, authenticated;

create trigger bookings_notify_gatekeepers_after_insert
after insert on public.bookings
for each row execute function private.notify_gatekeepers_of_reservation();

create or replace function private.notify_gatekeepers_of_payment_proof()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.provider <> 'manual' or new.payment_status <> 'pending_verification' or new.proof_submitted_at is null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.payment_status is not distinct from new.payment_status then return new; end if;
  end if;
  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  select a.profile_id, b.id, 'Payment proof needs verification',
    'Reservation ' || b.booking_reference || ' has a payment proof for ' || btrim(new.currency::text) || ' ' || to_char(new.amount, 'FM999,999,990.00') || '.',
    'payment_verification'
  from public.bookings b
  join public.staff_assignments a on a.site_id = b.site_id and a.staff_role = 'gatekeeper' and a.is_active
  where b.id = new.booking_id;
  return new;
end
$$;
revoke all on function private.notify_gatekeepers_of_payment_proof() from public, anon, authenticated;

create trigger payments_notify_gatekeepers_of_proof
after insert or update of payment_status on public.payments
for each row execute function private.notify_gatekeepers_of_payment_proof();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;
