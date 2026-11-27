alter table public.site_announcements
  add column body_preview text generated always as (left(body, 320)) stored;
