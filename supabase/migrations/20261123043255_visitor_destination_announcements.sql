create table public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 160),
  body text not null check (length(trim(body)) between 1 and 2000),
  category text not null default 'general'
    check (category in ('general', 'operating_hours', 'closure', 'booking', 'safety', 'guideline')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or expires_at > published_at)
);

create index site_announcements_public_idx
  on public.site_announcements (site_id, published_at desc)
  where status = 'published';

alter table public.site_announcements enable row level security;

create policy site_announcements_anon_read on public.site_announcements
  for select to anon
  using (
    status = 'published'
    and published_at <= now()
    and (expires_at is null or expires_at > now())
    and exists (
      select 1 from public.tourism_sites s
      where s.id = site_announcements.site_id and s.status = 'published'
    )
  );

create policy site_announcements_authenticated_read on public.site_announcements
  for select to authenticated
  using (
    private.can_manage_site(site_id)
    or (
      status = 'published'
      and published_at <= now()
      and (expires_at is null or expires_at > now())
      and exists (
        select 1 from public.tourism_sites s
        where s.id = site_announcements.site_id and s.status = 'published'
      )
    )
  );

create policy site_announcements_manage on public.site_announcements
  for all to authenticated
  using (private.can_manage_site(site_id))
  with check (private.can_manage_site(site_id));

create trigger site_announcements_updated_at before update on public.site_announcements
  for each row execute function private.set_updated_at();

grant select on public.site_announcements to anon, authenticated;
grant insert, update, delete on public.site_announcements to authenticated;

alter table public.notifications
  add column site_announcement_id uuid references public.site_announcements(id) on delete cascade;
create unique index notifications_announcement_uidx
  on public.notifications (user_id, site_announcement_id)
  where site_announcement_id is not null;

create or replace function private.notify_visitors_of_announcement()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'published' or new.published_at > now()
     or (new.expires_at is not null and new.expires_at <= now()) then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then return new; end if;

  insert into public.notifications(user_id, site_announcement_id, title, message, notification_type)
  select distinct b.visitor_id, new.id, new.title, new.body, 'site_announcement'
  from public.bookings b
  join public.site_slots slot on slot.id = b.slot_id
  where b.site_id = new.site_id and b.visitor_id is not null
    and b.booking_status in ('confirmed', 'awaiting_payment', 'needs_resolution')
    and slot.slot_date >= timezone('Asia/Manila', now())::date
  on conflict (user_id, site_announcement_id)
    where site_announcement_id is not null do nothing;
  return new;
end
$$;

create trigger site_announcement_visitor_notice
  after insert or update on public.site_announcements
  for each row execute function private.notify_visitors_of_announcement();
revoke all on function private.notify_visitors_of_announcement() from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'site_announcements'
     ) then
    alter publication supabase_realtime add table public.site_announcements;
  end if;
end
$$;
