alter table public.bookings
  add column payment_method text not null default 'online'
    check (payment_method in ('online', 'onsite'));

update public.bookings set payment_method = 'onsite' where payment_status = 'not_required';

alter table public.payments add column collected_by uuid references public.profiles(id) on delete set null;

drop function public.lookup_booking(text, text);
drop function private.lookup_booking(text, text);

create function private.lookup_booking(p_booking_reference text, p_guest_access_token text default null)
returns table (
  booking_id uuid, booking_reference text, visitor_name text, visitor_count integer,
  visitor_email text, visitor_phone text, adult_count integer, child_count integer,
  pwd_count integer, total_amount numeric, currency char(3),
  payment_status public.payment_status, payment_method text,
  booking_status public.booking_status, booking_source text, site_id uuid,
  site_name text, slot_date date, starts_at time, ends_at time,
  cancellation_cutoff_at timestamptz, hold_expires_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  return query
  select b.id, b.booking_reference, b.visitor_name, b.visitor_count,
    b.visitor_email, b.visitor_phone, b.adult_count, b.child_count,
    b.pwd_count, b.total_amount, b.currency, b.payment_status, b.payment_method,
    b.booking_status, b.booking_source, b.site_id, s.name,
    sl.slot_date, sl.starts_at, sl.ends_at,
    b.cancellation_cutoff_at, b.hold_expires_at
  from public.bookings b
  join public.tourism_sites s on s.id = b.site_id
  join public.site_slots sl on sl.id = b.slot_id
  where upper(b.booking_reference) = upper(trim(p_booking_reference))
    and (b.visitor_id = (select auth.uid())
      or private.booking_access_valid(b.id, p_guest_access_token)
      or private.can_work_site(b.site_id));
end
$$;

create function public.lookup_booking(p_booking_reference text, p_guest_access_token text default null)
returns table (
  booking_id uuid, booking_reference text, visitor_name text, visitor_count integer,
  visitor_email text, visitor_phone text, adult_count integer, child_count integer,
  pwd_count integer, total_amount numeric, currency char(3),
  payment_status public.payment_status, payment_method text,
  booking_status public.booking_status, booking_source text, site_id uuid,
  site_name text, slot_date date, starts_at time, ends_at time,
  cancellation_cutoff_at timestamptz, hold_expires_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.lookup_booking(p_booking_reference, p_guest_access_token) $$;

create function public.confirm_onsite_booking(p_booking_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'visitor' and p.account_status = 'active'
  ) then raise exception 'Only active visitor accounts can confirm onsite reservations' using errcode = '42501'; end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id and b.visitor_id = auth.uid() for update;
  if not found then raise exception 'Booking not found for this visitor account'; end if;
  if v_booking.booking_status <> 'awaiting_payment' or v_booking.hold_expires_at <= now() then
    raise exception 'This reservation hold has expired';
  end if;
  if exists (select 1 from public.payments p where p.booking_id = v_booking.id) then
    raise exception 'This reservation already has a payment attempt';
  end if;
  update public.bookings set payment_method = 'onsite', payment_status = 'pending', booking_status = 'confirmed', hold_expires_at = null
    where id = v_booking.id;
  update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
end
$$;

create function public.record_onsite_payment(p_booking_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found or not private.can_work_site(v_booking.site_id) then
    raise exception 'You cannot collect payment for this booking' using errcode = '42501';
  end if;
  if v_booking.payment_method <> 'onsite' or v_booking.payment_status <> 'pending' or v_booking.booking_status <> 'confirmed' then
    raise exception 'This onsite payment is not awaiting collection';
  end if;
  insert into public.payments(booking_id, provider, provider_reference, idempotency_key, amount, payment_status, verified_at, collected_by)
  values (v_booking.id, 'onsite', 'Collected onsite by authorized destination staff', 'onsite-' || v_booking.id::text,
    v_booking.total_amount, 'paid', now(), auth.uid());
  update public.bookings set payment_status = 'paid' where id = v_booking.id;
end
$$;

revoke all on function private.lookup_booking(text, text) from public, anon, authenticated, service_role;
grant execute on function private.lookup_booking(text, text) to authenticated;
revoke all on function public.lookup_booking(text, text) from public, anon;
grant execute on function public.lookup_booking(text, text) to authenticated;
revoke all on function public.confirm_onsite_booking(uuid) from public, anon;
grant execute on function public.confirm_onsite_booking(uuid) to authenticated;
revoke all on function public.record_onsite_payment(uuid) from public, anon;
grant execute on function public.record_onsite_payment(uuid) to authenticated;

notify pgrst, 'reload schema';
create or replace view public.booking_payment_daily_metrics with (security_invoker = true) as
select b.site_id,
  (b.created_at at time zone 'Asia/Manila')::date as report_date,
  count(*) filter (where b.payment_method = 'online' and b.payment_status = 'pending')::bigint as online_pending_count,
  count(*) filter (where b.payment_method = 'online' and b.payment_status = 'paid')::bigint as online_paid_count,
  count(*) filter (where b.payment_method = 'onsite' and b.payment_status = 'pending')::bigint as onsite_pending_count,
  count(*) filter (where b.payment_method = 'onsite' and b.payment_status = 'paid')::bigint as onsite_paid_count,
  count(*) filter (where b.payment_status in ('failed', 'expired'))::bigint as failed_or_expired_count
from public.bookings b
group by b.site_id, (b.created_at at time zone 'Asia/Manila')::date;

grant select on public.booking_payment_daily_metrics to authenticated;
