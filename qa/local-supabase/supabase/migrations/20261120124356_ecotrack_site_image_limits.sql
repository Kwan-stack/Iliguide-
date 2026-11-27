create or replace function private.enforce_site_image_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  image_count integer;
begin
  if tg_op = 'DELETE' then
    perform id from public.tourism_sites where id = old.site_id for update;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.site_id is not distinct from new.site_id then return new; end if;
    perform id
    from public.tourism_sites
    where id in (old.site_id, new.site_id)
    order by id
    for update;
  else
    perform id from public.tourism_sites where id = new.site_id for update;
  end if;

  select count(*) into image_count
  from public.site_images
  where site_id = new.site_id;

  if image_count >= 3 then
    raise exception 'A destination can have at most 3 photos.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.require_published_site_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and not exists (
    select 1 from public.site_images where site_id = new.id
  ) then
    raise exception 'A published destination must have at least 1 photo.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.keep_published_site_photo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  destination_status public.site_status;
begin
  select status into destination_status
  from public.tourism_sites
  where id = old.site_id;

  if destination_status = 'published' and not exists (
    select 1 from public.site_images where site_id = old.site_id
  ) then
    raise exception 'A published destination must keep at least 1 photo.' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists site_images_limit_before_insert on public.site_images;
create trigger site_images_limit_before_insert
before insert on public.site_images
for each row execute function private.enforce_site_image_limit();

drop trigger if exists site_images_limit_before_site_change on public.site_images;
create trigger site_images_limit_before_site_change
before update of site_id on public.site_images
for each row execute function private.enforce_site_image_limit();

drop trigger if exists site_images_lock_destination_before_delete on public.site_images;
create trigger site_images_lock_destination_before_delete
before delete on public.site_images
for each row execute function private.enforce_site_image_limit();

drop trigger if exists tourism_sites_require_photo_on_insert on public.tourism_sites;
create trigger tourism_sites_require_photo_on_insert
before insert on public.tourism_sites
for each row execute function private.require_published_site_photo();

drop trigger if exists tourism_sites_require_photo_on_publish on public.tourism_sites;
create trigger tourism_sites_require_photo_on_publish
before update of status on public.tourism_sites
for each row execute function private.require_published_site_photo();

drop trigger if exists site_images_keep_published_destination_photo on public.site_images;
create constraint trigger site_images_keep_published_destination_photo
after delete on public.site_images
deferrable initially deferred
for each row execute function private.keep_published_site_photo();

drop trigger if exists site_images_keep_published_photo_after_move on public.site_images;
create constraint trigger site_images_keep_published_photo_after_move
after update on public.site_images
deferrable initially deferred
for each row execute function private.keep_published_site_photo();

revoke all on function private.enforce_site_image_limit() from public, anon, authenticated, service_role;
revoke all on function private.require_published_site_photo() from public, anon, authenticated, service_role;
revoke all on function private.keep_published_site_photo() from public, anon, authenticated, service_role;
