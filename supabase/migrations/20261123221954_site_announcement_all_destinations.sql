alter table public.site_announcements
  add column announcement_group_id uuid not null default gen_random_uuid();

create index site_announcements_group_idx
  on public.site_announcements (announcement_group_id);

alter table public.notifications
  add column site_announcement_group_id uuid;

update public.notifications n
set site_announcement_group_id = a.announcement_group_id
from public.site_announcements a
where n.site_announcement_id = a.id
  and n.site_announcement_group_id is null;

create unique index notifications_announcement_group_uidx
  on public.notifications (user_id, site_announcement_group_id)
  where site_announcement_group_id is not null;

create or replace function private.notify_visitors_of_announcement()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' or new.published_at > now()
     or (new.expires_at is not null and new.expires_at <= now()) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then return new; end if;

  insert into public.notifications(
    user_id, site_announcement_id, site_announcement_group_id, title, message, notification_type
  )
  select distinct b.visitor_id, new.id, new.announcement_group_id, new.title, new.body, 'site_announcement'
  from public.bookings b
  join public.site_slots slot on slot.id = b.slot_id
  where b.site_id = new.site_id and b.visitor_id is not null
    and b.booking_status in ('confirmed', 'awaiting_payment', 'needs_resolution')
    and slot.slot_date >= timezone('Asia/Manila', now())::date
  on conflict (user_id, site_announcement_group_id)
    where site_announcement_group_id is not null do nothing;
  return new;
end
$$;

revoke all on function private.notify_visitors_of_announcement() from public, anon, authenticated, service_role;
