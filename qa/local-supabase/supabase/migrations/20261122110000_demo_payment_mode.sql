alter table public.tourism_payment_settings
  add column demo_mode boolean not null default true check (demo_mode);

alter table public.payments
  add column payment_mode text not null default 'historical' check (payment_mode in ('historical', 'demo')),
  add column payment_started_at timestamptz;
grant select (payment_mode, payment_started_at) on public.payments to authenticated;

revoke select, insert, update on public.tourism_payment_settings from public, anon, authenticated;
grant select (id, demo_mode, payment_window_minutes, onsite_instructions) on public.tourism_payment_settings to authenticated;
grant update (onsite_instructions, updated_by) on public.tourism_payment_settings to authenticated;

create function private.mark_demo_payment()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.provider in ('manual', 'onsite') and new.payment_mode = 'historical' then
    new.payment_mode := 'demo';
  end if;
  if new.provider = 'manual' and new.payment_started_at is null then new.payment_started_at := now(); end if;
  return new;
end
$$;

create function private.protect_demo_reference()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.payment_mode = 'demo' and new.transaction_reference is not null
     and new.transaction_reference not like 'DEMO-%' then
    raise exception 'Demo transaction reference must use the DEMO- prefix';
  end if;
  if old.payment_mode = 'demo' and old.payment_status <> 'rejected' and old.transaction_reference is not null
     and new.transaction_reference is distinct from old.transaction_reference then
    raise exception 'Demo transaction reference cannot be changed';
  end if;
  return new;
end
$$;
create trigger payments_demo_reference_immutable before update on public.payments
  for each row execute function private.protect_demo_reference();

create function private.watermark_demo_receipt()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.payment_mode = 'demo' and new.payment_status = 'paid'
     and (new.receipt_reference is null or new.receipt_reference not like 'ILG-DEMO-RCP-%') then
    new.receipt_reference := 'ILG-DEMO-RCP-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  end if;
  return new;
end
$$;
create trigger payments_demo_receipt before insert or update on public.payments
  for each row execute function private.watermark_demo_receipt();
create trigger payments_demo_mode before insert on public.payments
  for each row execute function private.mark_demo_payment();

create function public.simulate_manual_payment(p_booking_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_reference text;
begin
  if private.current_role() is distinct from 'visitor' then
    raise exception 'Only active visitor accounts can simulate payment' using errcode = '42501';
  end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found or v_booking.booking_status <> 'awaiting_payment' or v_booking.payment_method <> 'online' then
    raise exception 'Reservation is not awaiting demo payment';
  end if;
  select * into v_payment from public.payments p where p.booking_id = p_booking_id and p.provider = 'manual' for update;
  if not found or v_payment.payment_mode <> 'demo' or v_payment.payment_status not in ('pending', 'rejected')
     or v_payment.payment_deadline <= now() then raise exception 'Demo payment deadline expired'; end if;
  if v_payment.payment_status = 'rejected' then
    v_reference := 'DEMO-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
    update public.payments set payment_status = 'pending', rejection_reason = null,
      transaction_reference = v_reference where id = v_payment.id;
    update public.bookings set payment_status = 'pending' where id = p_booking_id;
    return v_reference;
  end if;
  if v_payment.transaction_reference is not null then return v_payment.transaction_reference; end if;
  v_reference := 'DEMO-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  update public.payments set transaction_reference = v_reference where id = v_payment.id;
  update public.bookings set payment_status = 'pending' where id = p_booking_id;
  return v_reference;
end
$$;
revoke all on function public.simulate_manual_payment(uuid) from public, anon;
grant execute on function public.simulate_manual_payment(uuid) to authenticated;

create or replace view public.booking_daily_metrics with (security_invoker = true) as
select b.site_id,
  (b.created_at at time zone 'Asia/Manila')::date as report_date,
  count(*)::bigint as booking_count,
  sum(b.visitor_count)::bigint as visitor_count,
  count(*) filter (where b.booking_source = 'walk_in')::bigint as walk_in_count,
  count(*) filter (where b.booking_source = 'online')::bigint as online_count,
  coalesce(sum(b.total_amount) filter (where b.payment_status = 'paid' and not exists (
    select 1 from public.payments p where p.booking_id = b.id and p.payment_mode = 'demo'
  )), 0)::numeric(14,2) as paid_revenue
from public.bookings b
group by b.site_id, (b.created_at at time zone 'Asia/Manila')::date;

create or replace view public.booking_payment_daily_metrics with (security_invoker = true) as
select b.site_id,
  (b.created_at at time zone 'Asia/Manila')::date as report_date,
  count(*) filter (where b.payment_method = 'online' and b.payment_status = 'pending')::bigint as online_pending_count,
  count(*) filter (where b.payment_method = 'online' and b.payment_status = 'paid' and not exists
    (select 1 from public.payments p where p.booking_id = b.id and p.payment_mode = 'demo'))::bigint as online_paid_count,
  count(*) filter (where b.payment_method = 'onsite' and b.payment_status = 'pending')::bigint as onsite_pending_count,
  count(*) filter (where b.payment_method = 'onsite' and b.payment_status = 'paid' and not exists
    (select 1 from public.payments p where p.booking_id = b.id and p.payment_mode = 'demo'))::bigint as onsite_paid_count,
  count(*) filter (where b.payment_status in ('failed', 'expired'))::bigint as failed_or_expired_count
from public.bookings b
group by b.site_id, (b.created_at at time zone 'Asia/Manila')::date;

update public.tourism_payment_settings set
  demo_mode = true,
  payment_window_minutes = 15
where id;

create or replace function public.begin_manual_payment(p_booking_id uuid, p_payment_application text)
returns table (payment_id uuid, payment_deadline timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_payment public.payments%rowtype; v_deadline timestamptz;
begin
  if private.current_role() is distinct from 'visitor' then
    raise exception 'Only active visitor accounts can begin online payment' using errcode = '42501';
  end if;
  if p_payment_application is null or p_payment_application not in ('gcash', 'maya') then raise exception 'Choose a supported payment application'; end if;
  select * into v_booking from public.bookings b
    where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found or v_booking.booking_status <> 'awaiting_payment' or v_booking.hold_expires_at <= now()
     or v_booking.total_amount <= 0 then raise exception 'This reservation hold is unavailable'; end if;
  if not exists (select 1 from public.tourism_payment_settings s where s.id and s.demo_mode) then
    raise exception 'Demo payments are not enabled';
  end if;
  select * into v_payment from public.payments p where p.booking_id = p_booking_id and p.provider = 'manual' for update;
  if found then
    if v_payment.payment_status = 'pending' and v_payment.payment_deadline > now() then
      update public.payments set payment_application = p_payment_application where id = v_payment.id;
      return query select v_payment.id, v_payment.payment_deadline;
      return;
    end if;
    raise exception 'A manual payment session already exists for this reservation';
  end if;
  v_deadline := now() + interval '15 minutes';
  insert into public.payments(booking_id, provider, payment_mode, payment_application, amount, payment_status, payment_deadline, payment_started_at)
    values (v_booking.id, 'manual', 'demo', p_payment_application, v_booking.total_amount, 'pending', v_deadline, now())
    returning * into v_payment;
  update public.bookings set payment_method = 'online', hold_expires_at = v_deadline where id = v_booking.id;
  update public.booking_holds set expires_at = v_deadline where booking_id = v_booking.id and status = 'active';
  return query select v_payment.id, v_deadline;
end
$$;

create or replace function public.review_manual_payment(p_payment_id uuid, p_approve boolean, p_rejection_reason text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_reference text;
begin
  if private.current_role() is distinct from 'tourism_office' then
    raise exception 'Tourism Office access required' using errcode = '42501';
  end if;
  select * into v_payment from public.payments p where p.id = p_payment_id and p.provider = 'manual' for update;
  if not found or v_payment.payment_mode <> 'demo' or v_payment.payment_status <> 'pending_verification' or v_payment.proof_submitted_at is null then
    raise exception 'Demo payment is not awaiting verification';
  end if;
  select * into v_booking from public.bookings b where b.id = v_payment.booking_id for update;
  if p_approve then
    update public.payments set payment_status = 'paid', verified_at = now(), verified_by = (select auth.uid())
      where id = v_payment.id;
    update public.bookings set payment_status = 'paid', booking_status = 'confirmed', hold_expires_at = null where id = v_booking.id;
    update public.booking_holds set status = 'consumed' where booking_id = v_booking.id;
    insert into public.notifications(user_id, title, message, notification_type)
      select v_booking.visitor_id, 'Demo payment approved', 'Your demo payment was approved. Your booking is confirmed. Demo receipt is available in My Bookings.', 'payment_verified'
      where v_booking.visitor_id is not null;
    select receipt_reference into v_reference from public.payments where id = v_payment.id;
    return v_reference;
  end if;
  if nullif(trim(p_rejection_reason), '') is null or length(trim(p_rejection_reason)) > 1000 then
    raise exception 'A rejection reason is required';
  end if;
  if v_payment.payment_deadline <= now() then
    update public.payments set payment_status = 'expired', rejection_reason = trim(p_rejection_reason) where id = v_payment.id;
    update public.bookings set payment_status = 'expired', booking_status = 'expired', hold_expires_at = null where id = v_booking.id;
    update public.booking_holds set status = 'expired' where booking_id = v_booking.id;
  else
    update public.payments set payment_status = 'rejected', rejection_reason = trim(p_rejection_reason) where id = v_payment.id;
    update public.bookings set payment_status = 'rejected', hold_expires_at = v_payment.payment_deadline where id = v_booking.id;
    update public.booking_holds set expires_at = v_payment.payment_deadline where booking_id = v_booking.id and status = 'active';
  end if;
  insert into public.notifications(user_id, title, message, notification_type)
    select v_booking.visitor_id, 'Demo payment needs attention',
      case when v_payment.payment_deadline <= now() then 'Your demo proof was rejected after the deadline. The reservation expired.'
        else 'Your demo proof was rejected: ' || trim(p_rejection_reason) || '. You may resubmit before the deadline.' end,
      'payment_rejected'
    where v_booking.visitor_id is not null;
  return null;
end
$$;

revoke all on function public.begin_manual_payment(uuid, text) from public, anon;
grant execute on function public.begin_manual_payment(uuid, text) to authenticated;
revoke all on function public.review_manual_payment(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_manual_payment(uuid, boolean, text) to authenticated;

create or replace function public.record_onsite_payment(p_booking_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_reference text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found or not private.can_work_site(v_booking.site_id) then
    raise exception 'You cannot collect payment for this booking' using errcode = '42501';
  end if;
  if v_booking.payment_method <> 'onsite' or v_booking.payment_status <> 'pending' or v_booking.booking_status <> 'confirmed' then
    raise exception 'This onsite payment is not awaiting collection';
  end if;
  v_reference := 'ILG-DEMO-RCP-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  insert into public.payments(booking_id, provider, provider_reference, idempotency_key, amount,
    payment_status, verified_at, verified_by, receipt_reference, collected_by)
  values (v_booking.id, 'onsite', 'Simulated onsite collection', 'onsite-' || v_booking.id::text,
    v_booking.total_amount, 'paid', now(), auth.uid(), v_reference, auth.uid());
  update public.bookings set payment_status = 'paid' where id = v_booking.id;
  if v_booking.visitor_id is not null then
    insert into public.notifications(user_id, title, message, notification_type)
    values (v_booking.visitor_id, 'Demo onsite payment recorded', 'A Gatekeeper recorded your simulated onsite payment. Your demo receipt is available in My Bookings.', 'payment_verified');
  end if;
end
$$;

revoke all on function public.record_onsite_payment(uuid) from public, anon;
grant execute on function public.record_onsite_payment(uuid) to authenticated;

notify pgrst, 'reload schema';
