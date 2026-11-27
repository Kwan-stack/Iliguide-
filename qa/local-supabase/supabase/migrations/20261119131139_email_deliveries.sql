create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_key text not null,
  template_id integer not null,
  message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (booking_id, event_key)
);

create index if not exists email_deliveries_booking_id_idx on public.email_deliveries (booking_id);
alter table public.email_deliveries enable row level security;
revoke all on public.email_deliveries from anon, authenticated;
