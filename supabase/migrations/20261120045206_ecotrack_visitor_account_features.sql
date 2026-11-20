create table public.traveler_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  email text check (email is null or (length(trim(email)) between 3 and 254 and position('@' in email) > 1)),
  phone text check (phone is null or length(trim(phone)) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index traveler_profiles_user_created_idx on public.traveler_profiles(user_id, created_at desc);
create trigger traveler_profiles_updated_at before update on public.traveler_profiles
  for each row execute function private.set_updated_at();
alter table public.traveler_profiles enable row level security;
revoke all on public.traveler_profiles from anon, public;
create policy traveler_profiles_owner_all on public.traveler_profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.traveler_profiles to authenticated;

create table public.visitor_saved_sites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);
create index visitor_saved_sites_site_idx on public.visitor_saved_sites(site_id);
alter table public.visitor_saved_sites enable row level security;
revoke all on public.visitor_saved_sites from anon, public;
create policy visitor_saved_sites_owner_all on public.visitor_saved_sites for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.visitor_saved_sites to authenticated;

create table public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  promotional_announcements boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function private.set_updated_at();
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, public;
create policy notification_preferences_owner_all on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update on public.notification_preferences to authenticated;
insert into public.notification_preferences(user_id)
select id from public.profiles on conflict (user_id) do nothing;

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  subject text not null check (length(trim(subject)) between 3 and 160),
  message text not null check (length(trim(message)) between 10 and 4000),
  status text not null default 'received' check (status in ('received', 'in_progress', 'resolved', 'closed')),
  staff_response text check (staff_response is null or length(staff_response) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_requests_user_created_idx on public.support_requests(user_id, created_at desc);
create index support_requests_booking_idx on public.support_requests(booking_id) where booking_id is not null;
create index support_requests_status_created_idx on public.support_requests(status, created_at desc);
create trigger support_requests_updated_at before update on public.support_requests
  for each row execute function private.set_updated_at();
alter table public.support_requests enable row level security;
revoke all on public.support_requests from anon, public;
create policy support_requests_read_owner_or_office on public.support_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.user_has_role('tourism_office'));
create policy support_requests_insert_owner on public.support_requests for insert to authenticated
  with check (
    user_id = (select auth.uid()) and
    (booking_id is null or exists (
      select 1 from public.bookings b where b.id = booking_id and b.visitor_id = (select auth.uid())
    ))
  );
create policy support_requests_update_office on public.support_requests for update to authenticated
  using (private.user_has_role('tourism_office')) with check (private.user_has_role('tourism_office'));
grant select, insert, update on public.support_requests to authenticated;

create or replace function private.notify_support_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, title, message, notification_type)
    values (new.user_id, 'Support request received',
      'Your request is in the support queue. Track its status in your account.', 'support_update');
  elsif new.status is distinct from old.status then
    insert into public.notifications(user_id, title, message, notification_type)
    values (new.user_id, 'Support request updated',
      'Your request status is now ' || replace(new.status, '_', ' ') || '.', 'support_update');
  elsif new.staff_response is distinct from old.staff_response and new.staff_response is not null then
    insert into public.notifications(user_id, title, message, notification_type)
    values (new.user_id, 'Support replied', 'A response was added to your support request.', 'support_update');
  end if;
  return new;
end
$$;
create trigger support_request_notifications_insert after insert on public.support_requests
  for each row execute function private.notify_support_request();
create trigger support_request_notifications_update after update of status, staff_response on public.support_requests
  for each row execute function private.notify_support_request();

create or replace function private.notify_auth_account_created()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.id) then
    insert into public.notification_preferences(user_id) values (new.id) on conflict do nothing;
    insert into public.notifications(user_id, title, message, notification_type)
    values (new.id, 'Account created', 'Welcome. Confirm your email to finish setting up your visitor account.', 'account_created');
  end if;
  return new;
end
$$;
create trigger zz_notify_auth_account_created after insert on auth.users
  for each row execute function private.notify_auth_account_created();

create or replace function private.notify_auth_email_verified()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and exists (select 1 from public.profiles p where p.id = new.id) then
    insert into public.notifications(user_id, title, message, notification_type)
    values (new.id, 'Email verified', 'Your visitor account is ready to use.', 'email_verified');
  end if;
  return new;
end
$$;
create trigger notify_auth_email_verified after update of email_confirmed_at on auth.users
  for each row execute function private.notify_auth_email_verified();

drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews for select to anon, authenticated
  using (review_status = 'published' or visitor_id = (select auth.uid()) or private.can_manage_site(site_id));

create or replace function private.submit_review(
  p_booking_id uuid, p_guest_access_token text, p_rating smallint, p_comment text default ''
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_review_id uuid := gen_random_uuid();
begin
  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found then raise exception 'An account booking is required to review'; end if;
  if v_booking.booking_status <> 'completed' then raise exception 'A completed visit is required to review'; end if;
  if p_rating is null or p_rating not between 1 and 5 or length(trim(coalesce(p_comment, ''))) > 3000 then
    raise exception 'Invalid review';
  end if;
  insert into public.reviews(id, booking_id, visitor_id, site_id, rating, comment)
  values (v_review_id, v_booking.id, v_booking.visitor_id, v_booking.site_id, p_rating, trim(coalesce(p_comment, '')));
  return v_review_id;
end
$$;

create or replace function private.update_own_review(p_review_id uuid, p_rating smallint, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_updated_id uuid;
begin
  if p_rating is null or p_rating not between 1 and 5 or length(trim(coalesce(p_comment, ''))) > 3000 then
    raise exception 'Invalid review';
  end if;
  update public.reviews r set rating = p_rating, comment = trim(coalesce(p_comment, '')),
    review_status = 'pending', moderated_by = null, moderated_at = null
  from public.bookings b
  where r.id = p_review_id and r.visitor_id = (select auth.uid())
    and b.id = r.booking_id and b.booking_status = 'completed'
  returning r.id into v_updated_id;
  if v_updated_id is null then raise exception 'Review not found or no longer editable'; end if;
end
$$;

create or replace function private.delete_own_review(p_review_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_deleted_id uuid;
begin
  delete from public.reviews r where r.id = p_review_id and r.visitor_id = (select auth.uid())
  returning r.id into v_deleted_id;
  if v_deleted_id is null then raise exception 'Review not found'; end if;
end
$$;

create or replace function public.update_own_review(p_review_id uuid, p_rating smallint, p_comment text)
returns void language sql set search_path = ''
as $$ select private.update_own_review(p_review_id, p_rating, p_comment) $$;
create or replace function public.delete_own_review(p_review_id uuid)
returns void language sql set search_path = ''
as $$ select private.delete_own_review(p_review_id) $$;

revoke all on function private.submit_review(uuid, text, smallint, text) from public, anon, authenticated, service_role;
grant execute on function private.submit_review(uuid, text, smallint, text) to authenticated;
revoke all on function public.submit_review(uuid, text, smallint, text) from public, anon, authenticated;
grant execute on function public.submit_review(uuid, text, smallint, text) to authenticated;
revoke all on function private.update_own_review(uuid, smallint, text) from public, anon, authenticated, service_role;
grant execute on function private.update_own_review(uuid, smallint, text) to authenticated;
revoke all on function public.update_own_review(uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.update_own_review(uuid, smallint, text) to authenticated;
revoke all on function private.delete_own_review(uuid) from public, anon, authenticated, service_role;
grant execute on function private.delete_own_review(uuid) to authenticated;
revoke all on function public.delete_own_review(uuid) from public, anon, authenticated;
grant execute on function public.delete_own_review(uuid) to authenticated;

revoke all on function private.notify_support_request() from public, anon, authenticated, service_role;
revoke all on function private.notify_auth_account_created() from public, anon, authenticated, service_role;
revoke all on function private.notify_auth_email_verified() from public, anon, authenticated, service_role;

alter table public.notifications
  add column booking_id uuid references public.bookings(id) on delete set null;
create unique index notifications_reservation_reminder_uidx
  on public.notifications(user_id, booking_id)
  where notification_type = 'reservation_reminder' and booking_id is not null;

create or replace function private.notify_booking_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.visitor_id is not null and (
    new.site_id is distinct from old.site_id or new.slot_id is distinct from old.slot_id or
    new.adult_count is distinct from old.adult_count or new.child_count is distinct from old.child_count or
    new.pwd_count is distinct from old.pwd_count
  ) then
    insert into public.notifications(user_id, booking_id, title, message, notification_type)
    values (new.visitor_id, new.id, 'Booking details changed',
      'Details for booking ' || new.booking_reference || ' changed. Review it in My bookings.', 'booking_updated');
  end if;
  return new;
end
$$;
create trigger visitor_booking_change_notice
  after update of site_id, slot_id, adult_count, child_count, pwd_count on public.bookings
  for each row execute function private.notify_booking_change();

create or replace function private.notify_cancellation_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype;
begin
  select * into v_booking from public.bookings where id = new.booking_id;
  if new.visitor_id is null then return new; end if;
  if tg_op = 'INSERT' then
    insert into public.notifications(user_id, booking_id, title, message, notification_type)
    values (new.visitor_id, new.booking_id, 'Cancellation request received',
      'Your cancellation request for booking ' || v_booking.booking_reference || ' is awaiting review.', 'cancellation_requested');
  elsif new.request_status is distinct from old.request_status and new.request_status = 'rejected' then
    insert into public.notifications(user_id, booking_id, title, message, notification_type)
    values (new.visitor_id, new.booking_id, 'Cancellation request updated',
      'Your cancellation request for booking ' || v_booking.booking_reference || ' was declined.', 'cancellation_updated');
  end if;
  return new;
end
$$;
create trigger visitor_cancellation_request_notice after insert on public.cancellation_requests
  for each row execute function private.notify_cancellation_change();
create trigger visitor_cancellation_decision_notice after update of request_status on public.cancellation_requests
  for each row execute function private.notify_cancellation_change();

create or replace function private.notify_refund_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_user_id uuid; v_reference text;
begin
  if new.refund_status is distinct from old.refund_status then
    select visitor_id, booking_reference into v_user_id, v_reference
      from public.bookings where id = new.booking_id;
    if v_user_id is not null then
      insert into public.notifications(user_id, booking_id, title, message, notification_type)
      values (v_user_id, new.booking_id, 'Refund status updated',
        'Refund status for booking ' || v_reference || ' is now ' || replace(new.refund_status::text, '_', ' ') || '.', 'refund_updated');
    end if;
  end if;
  return new;
end
$$;
create trigger visitor_refund_status_notice after update of refund_status on public.refunds
  for each row execute function private.notify_refund_change();

create or replace function public.notify_upcoming_reservations()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer; v_visit_day date := timezone('Asia/Manila', now())::date + 1;
begin
  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  select b.visitor_id, b.id, 'Reservation reminder',
    'Your visit for booking ' || b.booking_reference || ' is tomorrow. Review the details in My bookings.', 'reservation_reminder'
  from public.bookings b
  where b.visitor_id is not null and b.booking_status = 'confirmed' and b.slot_date = v_visit_day
  on conflict (user_id, booking_id) where notification_type = 'reservation_reminder' and booking_id is not null do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.notify_upcoming_reservations() from public, anon, authenticated;
grant execute on function public.notify_upcoming_reservations() to service_role;
revoke all on function private.notify_booking_change() from public, anon, authenticated, service_role;
revoke all on function private.notify_cancellation_change() from public, anon, authenticated, service_role;
revoke all on function private.notify_refund_change() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'iliguide-upcoming-reservation-reminders') then
    perform cron.schedule(
      'iliguide-upcoming-reservation-reminders',
      '0 9 * * *',
      'select public.notify_upcoming_reservations();'
    );
  end if;
end
$$;
