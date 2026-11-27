alter table public.site_settings
  add column fee_information_confirmed boolean not null default false,
  add column pwd_discount_percent numeric(5,2) not null default 0
    check (pwd_discount_percent between 0 and 100);

alter table public.bookings
  add column pwd_count integer not null default 0
    check (pwd_count >= 0 and pwd_count <= adult_count + child_count);

create function private.create_booking_hold(
  p_slot_id uuid, p_name text, p_adult_count integer, p_child_count integer,
  p_email text, p_phone text, p_pwd_count integer
)
returns table (
  booking_id uuid, booking_reference text, hold_expires_at timestamptz,
  total_amount numeric, guest_access_token text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_adult_fee numeric(12,2);
  v_child_fee numeric(12,2);
  v_discount_percent numeric(5,2);
  v_fees_confirmed boolean;
  v_discount numeric(12,2) := 0;
  v_total numeric(12,2);
  v_hold record;
begin
  if p_pwd_count is null or p_pwd_count < 0 or p_adult_count is null
     or p_child_count is null or p_pwd_count > p_adult_count + p_child_count then
    raise exception 'PWD visitor count must be between zero and the party size';
  end if;

  select ss.adult_fee, ss.child_fee, ss.pwd_discount_percent, ss.fee_information_confirmed
  into v_adult_fee, v_child_fee, v_discount_percent, v_fees_confirmed
  from public.site_slots sl
  join public.site_settings ss on ss.site_id = sl.site_id
  where sl.id = p_slot_id;
  if not found then raise exception 'This time slot is unavailable'; end if;
  if not v_fees_confirmed then raise exception 'Current destination fee information is not confirmed'; end if;
  if p_pwd_count > 0 then
    if v_discount_percent <= 0 or v_adult_fee <> v_child_fee then
      raise exception 'PWD discount is not configured for this destination';
    end if;
    v_discount := round(v_adult_fee * v_discount_percent / 100 * p_pwd_count, 2);
  end if;
  v_total := v_adult_fee * p_adult_count + v_child_fee * p_child_count - v_discount;

  select * into v_hold from private.create_booking_hold(
    p_slot_id, p_name, p_adult_count, p_child_count, p_email, p_phone
  );
  update public.bookings set total_amount = v_total, pwd_count = p_pwd_count
  where id = v_hold.booking_id;
  return query select v_hold.booking_id, v_hold.booking_reference,
    v_hold.hold_expires_at, v_total, v_hold.guest_access_token;
end
$$;

create function public.create_booking_hold(
  p_slot_id uuid, p_name text, p_adult_count integer, p_child_count integer,
  p_email text, p_phone text, p_pwd_count integer
)
returns table (
  booking_id uuid, booking_reference text, hold_expires_at timestamptz,
  total_amount numeric, guest_access_token text
)
language sql security invoker set search_path = ''
as $$ select * from private.create_booking_hold(
  p_slot_id, p_name, p_adult_count, p_child_count, p_email, p_phone, p_pwd_count
) $$;

revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer)
  to anon, authenticated;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer) from public;
grant execute on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer)
  to anon, authenticated;

drop function public.lookup_booking(text, text);
drop function private.lookup_booking(text, text);

create function private.lookup_booking(p_booking_reference text, p_guest_access_token text default null)
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
  payment_status public.payment_status, booking_status public.booking_status,
  booking_source text, site_id uuid, site_name text, slot_date date,
  starts_at time, ends_at time, cancellation_cutoff_at timestamptz,
  hold_expires_at timestamptz
)
language sql stable security invoker set search_path = ''
as $$ select * from private.lookup_booking(p_booking_reference, p_guest_access_token) $$;

revoke all on function private.lookup_booking(text, text) from public, anon, authenticated, service_role;
grant execute on function private.lookup_booking(text, text) to anon, authenticated;
revoke all on function public.lookup_booking(text, text) from public;
grant execute on function public.lookup_booking(text, text) to anon, authenticated;



alter table public.site_settings
add column if not exists daily_capacity integer check (daily_capacity between 1 and 100000);

create or replace function private.daily_capacity_remaining(p_site_id uuid, p_date date, p_exclude_booking_id uuid default null)
returns integer language sql volatile security definer set search_path = ''
as $$
  select ss.daily_capacity - (
    select coalesce(sum(b.visitor_count), 0)::integer
    from public.bookings b
    join public.site_slots s on s.id = b.slot_id
    where b.site_id = p_site_id and s.slot_date = p_date
      and b.id is distinct from p_exclude_booking_id
      and (b.booking_status = 'confirmed'
        or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()))
  )
  from public.site_settings ss where ss.site_id = p_site_id
$$;

create or replace function private.enforce_daily_capacity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_date date;
begin
  if new.booking_status = 'confirmed'
     or (new.booking_status = 'awaiting_payment' and new.hold_expires_at > now()) then
    select s.slot_date into v_date from public.site_slots s where s.id = new.slot_id;
    perform 1 from public.site_settings ss where ss.site_id = new.site_id for update;
    if private.daily_capacity_remaining(new.site_id, v_date, new.id) < new.adult_count + new.child_count then
      raise exception 'Daily visitor limit reached';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists enforce_daily_capacity on public.bookings;
create trigger enforce_daily_capacity
before insert or update of booking_status, hold_expires_at, adult_count, child_count, slot_id, site_id
on public.bookings for each row execute function private.enforce_daily_capacity();

revoke all on function private.daily_capacity_remaining(uuid, date, uuid) from public, anon, authenticated, service_role;
revoke all on function private.enforce_daily_capacity() from public, anon, authenticated, service_role;

create or replace function private.get_slot_availability(
  p_site_id uuid, p_from date, p_to date
)
returns table (
  slot_id uuid, site_id uuid, slot_date date, starts_at time, ends_at time,
  capacity integer, remaining_capacity integer, status public.slot_status
)
language sql volatile security definer set search_path = ''
as $$
  select s.id, s.site_id, s.slot_date, s.starts_at, s.ends_at, s.capacity,
    least(greatest(s.capacity - coalesce(sum(b.visitor_count) filter (
      where b.booking_status = 'confirmed'
         or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now())
    ), 0)::integer, 0),
      greatest(coalesce(private.daily_capacity_remaining(s.site_id, s.slot_date), 2147483647), 0)),
    s.status
  from public.site_slots s
  join public.tourism_sites t on t.id = s.site_id
  left join public.bookings b on b.slot_id = s.id
  where s.site_id = p_site_id
    and s.slot_date between p_from and p_to
    and p_to >= p_from and p_to <= p_from + 62
    and s.status = 'open'
    and t.status = 'published'
    and exists (
      select 1 from public.site_operating_hours h
      where h.site_id = s.site_id
        and h.weekday = extract(dow from s.slot_date)::smallint
        and not h.is_closed
        and s.starts_at >= h.opens_at
        and s.ends_at <= h.closes_at
    )
    and not exists (
      select 1 from public.site_closures c
      where c.site_id = s.site_id and s.slot_date between c.starts_on and c.ends_on
        and (c.starts_at is null or (c.starts_at < s.ends_at and c.ends_at > s.starts_at))
    )
  group by s.id
  order by s.slot_date, s.starts_at
$$;

create or replace function private.process_paymongo_checkout_event(
  p_event_id text, p_event_type text, p_checkout_session_id text,
  p_provider_payment_id text, p_amount_minor bigint, p_currency text, p_payload jsonb
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_payment public.payments%rowtype; v_booking public.bookings%rowtype;
  v_slot public.site_slots%rowtype; v_used integer;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Server authorization required';
  end if;
  if nullif(p_event_id, '') is null or nullif(p_checkout_session_id, '') is null
     or p_event_type not in ('checkout_session.payment.paid', 'checkout_session.payment.failed')
     or p_currency <> 'PHP' or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid payment event';
  end if;
  select * into v_payment from public.payments p
  where p.provider = 'paymongo' and p.checkout_session_id = p_checkout_session_id
  for update;
  if not found then raise exception 'Checkout session is not linked to a booking'; end if;
  if exists (
    select 1 from public.payment_transactions t
    where t.provider = 'paymongo' and t.provider_event_id = p_event_id
  ) then return 'duplicate'; end if;
  if p_amount_minor <> round(v_payment.amount * 100)::bigint then raise exception 'Payment amount mismatch'; end if;
  insert into public.payment_transactions(
    payment_id, provider, provider_event_id, event_type, amount_minor, currency, payload
  ) values (
    v_payment.id, 'paymongo', p_event_id, p_event_type, p_amount_minor, p_currency,
    jsonb_build_object('event_id', p_event_id, 'event_type', p_event_type)
  );
  select * into v_booking from public.bookings b where b.id = v_payment.booking_id for update;
  if p_event_type = 'checkout_session.payment.failed' then
    update public.payments set payment_status = 'failed' where id = v_payment.id;
    return 'failed';
  end if;
  if v_payment.payment_status = 'paid' then return 'duplicate'; end if;
  update public.payments
  set payment_status = 'paid', provider_payment_id = p_provider_payment_id, verified_at = now()
  where id = v_payment.id;
  if v_booking.booking_status = 'awaiting_payment' and v_booking.hold_expires_at > now() then
    update public.bookings set payment_status = 'paid', booking_status = 'confirmed', hold_expires_at = null
    where id = v_booking.id;
    update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
  else
    select * into v_slot from public.site_slots s where s.id = v_booking.slot_id for update;
    perform 1 from public.site_settings ss where ss.site_id = v_booking.site_id for update;
    select coalesce(sum(b.visitor_count), 0)::integer into v_used
    from public.bookings b where b.slot_id = v_slot.id and b.id <> v_booking.id
      and (b.booking_status = 'confirmed'
        or (b.booking_status = 'awaiting_payment' and b.hold_expires_at > now()));
    if v_used + v_booking.visitor_count <= v_slot.capacity
       and coalesce(private.daily_capacity_remaining(v_booking.site_id, v_slot.slot_date, v_booking.id), 2147483647) >= v_booking.visitor_count
       and v_booking.booking_status = 'expired' then
      update public.bookings set payment_status = 'paid', booking_status = 'confirmed', hold_expires_at = null
      where id = v_booking.id;
      update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
    else
      update public.bookings set payment_status = 'paid', booking_status = 'needs_resolution', hold_expires_at = null
      where id = v_booking.id;
      insert into public.refunds(booking_id, payment_id, amount, reason, refund_status)
      values (v_booking.id, v_payment.id, v_booking.total_amount,
        'Payment succeeded after the reservation hold expired',
        case when p_provider_payment_id is not null then 'queued'::public.refund_status else 'manual_required'::public.refund_status end);
    end if;
  end if;
  if v_booking.visitor_id is not null then
    insert into public.notifications(user_id, title, message, notification_type)
    values (v_booking.visitor_id, 'Booking confirmed',
      'Your payment is confirmed. Your ticket is ready in Bookings.',
      'booking_confirmed');
  end if;
  return 'processed';
end
$$;
