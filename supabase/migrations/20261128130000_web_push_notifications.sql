create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null check (length(endpoint) between 1 and 2048),
  subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index push_subscriptions_active_user_idx on public.push_subscriptions(user_id) where active;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, public;
create policy push_subscriptions_owner_all on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create table public.push_delivery_attempts (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  status text not null check (status in ('accepted', 'failed', 'expired')),
  provider_status integer,
  created_at timestamptz not null default now()
);
alter table public.push_delivery_attempts enable row level security;
revoke all on public.push_delivery_attempts from anon, public, authenticated;
grant all on public.push_delivery_attempts to service_role;

create schema if not exists extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function private.queue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  dispatch_secret text;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name = 'push_dispatch_url' limit 1;
  select decrypted_secret into dispatch_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
  if endpoint is null or dispatch_secret is null then return new; end if;
  perform net.http_post(
    url := endpoint,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-dispatch-secret', dispatch_secret),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
exception when others then
  raise warning 'Push dispatch enqueue failed for notification %: %', new.id, sqlerrm;
  return new;
end;
$$;
revoke all on function private.queue_notification_push() from public, anon, authenticated;
drop trigger if exists notifications_queue_push on public.notifications;
create trigger notifications_queue_push after insert on public.notifications
for each row execute function private.queue_notification_push();
