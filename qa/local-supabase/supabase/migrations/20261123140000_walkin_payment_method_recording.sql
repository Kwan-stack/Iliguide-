create function private.register_walk_in_with_payment(
  p_site_id uuid, p_slot_id uuid, p_name text, p_adult_count integer,
  p_child_count integer, p_pwd_count integer, p_email text, p_phone text,
  p_visitors jsonb, p_payment_method text
)
returns table (booking_id uuid, booking_reference text, total_amount numeric, guest_access_token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_booking record;
  v_payment_method text := pg_catalog.lower(pg_catalog.btrim(p_payment_method));
begin
  if v_payment_method is null or v_payment_method not in ('cash', 'gcash', 'maya') then
    raise exception 'Choose cash, GCash, or Maya for this walk-in';
  end if;

  select * into v_booking from private.register_walk_in_with_visitors(
    p_site_id, p_slot_id, p_name, p_adult_count, p_child_count, p_pwd_count,
    p_email, p_phone, p_visitors
  );
  if not found then raise exception 'Walk-in registration failed'; end if;

  update public.bookings
  set payment_method = case when v_payment_method = 'cash' then 'onsite' else 'online' end,
      payment_status = 'paid'
  where id = v_booking.booking_id and payment_status = 'not_required';
  if not found then raise exception 'Walk-in payment was already recorded'; end if;

  insert into public.payments (
    booking_id, provider, payment_mode, payment_application, provider_reference,
    idempotency_key, amount, payment_status, verified_at, verified_by, collected_by
  ) values (
    v_booking.booking_id,
    case when v_payment_method = 'cash' then 'cash' else 'manual' end,
    case when v_payment_method = 'cash' then 'historical' else 'demo' end,
    case when v_payment_method = 'cash' then null else v_payment_method end,
    case when v_payment_method = 'cash' then 'Cash collected by Gatekeeper at walk-in'
      else 'Gatekeeper recorded online walk-in payment; demo tracking' end,
    'walk-in-' || v_booking.booking_id::text,
    v_booking.total_amount, 'paid', now(), (select auth.uid()), (select auth.uid())
  );

  return query select v_booking.booking_id, v_booking.booking_reference,
    v_booking.total_amount, v_booking.guest_access_token;
end
$$;
revoke all on function private.register_walk_in_with_payment(uuid, uuid, text, integer, integer, integer, text, text, jsonb, text)
  from public, anon, authenticated, service_role;

create function public.register_walk_in_with_payment(
  p_site_id uuid, p_slot_id uuid, p_name text, p_adult_count integer,
  p_child_count integer, p_pwd_count integer, p_email text, p_phone text,
  p_visitors jsonb, p_payment_method text
)
returns table (booking_id uuid, booking_reference text, total_amount numeric, guest_access_token text)
language sql security definer set search_path = ''
as $$ select * from private.register_walk_in_with_payment(
  p_site_id, p_slot_id, p_name, p_adult_count, p_child_count, p_pwd_count,
  p_email, p_phone, p_visitors, p_payment_method
) $$;
revoke all on function public.register_walk_in_with_payment(uuid, uuid, text, integer, integer, integer, text, text, jsonb, text)
  from public, anon;
grant execute on function public.register_walk_in_with_payment(uuid, uuid, text, integer, integer, integer, text, text, jsonb, text)
  to authenticated;

notify pgrst, 'reload schema';
