create unique index notifications_review_request_uidx
  on public.notifications (user_id, booking_id)
  where notification_type = 'review_request' and booking_id is not null;

create or replace function private.notify_visitor_review_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visitor_id is null or new.booking_status <> 'completed' then return new; end if;
  if tg_op = 'UPDATE' and old.booking_status = 'completed' then return new; end if;
  if exists (select 1 from public.reviews r where r.booking_id = new.id) then return new; end if;

  insert into public.notifications(user_id, booking_id, title, message, notification_type)
  select new.visitor_id, new.id, 'How was your visit?',
    'Your visit to ' || s.name || ' is complete. Leave an optional review to help future visitors.', 'review_request'
  from public.tourism_sites s
  where s.id = new.site_id
  on conflict (user_id, booking_id)
    where notification_type = 'review_request' and booking_id is not null do nothing;
  return new;
end
$$;

create trigger visitor_review_available_notice
  after insert or update of booking_status on public.bookings
  for each row execute function private.notify_visitor_review_available();

revoke all on function private.notify_visitor_review_available() from public, anon, authenticated, service_role;
