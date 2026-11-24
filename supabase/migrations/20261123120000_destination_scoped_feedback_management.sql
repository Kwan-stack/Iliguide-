alter table public.reviews
  add column if not exists category text not null default 'overall_experience'
    check (category in ('overall_experience', 'cleanliness', 'facilities', 'staff_service', 'safety', 'accessibility')),
  add column if not exists moderation_note text;

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (reason in ('inaccurate', 'inappropriate', 'spam', 'other')),
  details text not null default '' check (length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'actioned', 'dismissed')),
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);
create index review_reports_status_created_idx on public.review_reports(status, created_at desc);
create index review_reports_review_idx on public.review_reports(review_id, status);
create index review_reports_reporter_created_idx on public.review_reports(reporter_id, created_at desc);

create table public.review_moderation_history (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  site_id uuid not null references public.tourism_sites(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  old_status public.review_status not null,
  new_status public.review_status not null,
  note text,
  created_at timestamptz not null default now()
);
create index review_moderation_history_site_created_idx on public.review_moderation_history(site_id, created_at desc);

alter table public.review_reports enable row level security;
alter table public.review_moderation_history enable row level security;

drop policy if exists reviews_public_read on public.reviews;
create policy reviews_anon_published_read on public.reviews for select to anon
  using (review_status = 'published' and private.can_read_site_data(site_id));
create policy reviews_authenticated_scoped_read on public.reviews for select to authenticated
  using (
    ((select private.user_has_role('visitor')) and (review_status = 'published' or visitor_id = (select auth.uid())))
    or (select private.can_manage_site(site_id))
  );
drop policy if exists reviews_moderate on public.reviews;
create policy reviews_moderate on public.reviews for update to authenticated
  using (private.can_manage_site(site_id))
  with check (private.can_manage_site(site_id));

create policy review_reports_scoped_read on public.review_reports for select to authenticated
  using (
    ((select private.user_has_role('visitor')) and reporter_id = (select auth.uid()))
    or exists (
      select 1 from public.reviews r
      where r.id = review_id and private.can_manage_site(r.site_id)
    )
  );
create policy review_history_managers_read on public.review_moderation_history for select to authenticated
  using (private.can_manage_site(site_id));

revoke insert, update, delete on public.reviews from anon, authenticated;
revoke all on public.review_reports, public.review_moderation_history from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant select on public.review_reports, public.review_moderation_history to authenticated;

create or replace function private.log_review_moderation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.review_status is distinct from new.review_status and new.moderated_by is not null then
    insert into public.review_moderation_history(review_id, site_id, actor_id, old_status, new_status, note)
    values (new.id, new.site_id, new.moderated_by, old.review_status, new.review_status, new.moderation_note);
  end if;
  return new;
end
$$;
revoke all on function private.log_review_moderation() from public, anon, authenticated, service_role;
create trigger review_moderation_history_after_status
after update of review_status on public.reviews
for each row execute function private.log_review_moderation();

create or replace function private.submit_visitor_review(p_booking_id uuid, p_rating smallint, p_category text, p_comment text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_booking public.bookings%rowtype; v_review_id uuid := gen_random_uuid();
begin
  if not private.user_has_role('visitor') then raise exception 'Active visitor account required'; end if;
  if p_rating is null or p_rating not between 1 and 5
    or p_category is null
    or p_category not in ('overall_experience', 'cleanliness', 'facilities', 'staff_service', 'safety', 'accessibility')
    or length(trim(coalesce(p_comment, ''))) > 500 then
    raise exception 'Invalid review';
  end if;
  select * into v_booking from public.bookings b
  where b.id = p_booking_id and b.visitor_id = (select auth.uid()) for update;
  if not found then raise exception 'An account booking is required to review'; end if;
  if v_booking.booking_status <> 'completed' then raise exception 'A completed visit is required to review'; end if;
  insert into public.reviews(id, booking_id, visitor_id, site_id, rating, category, comment)
  values (v_review_id, v_booking.id, v_booking.visitor_id, v_booking.site_id, p_rating, p_category, trim(coalesce(p_comment, '')));
  return v_review_id;
end
$$;

create or replace function public.submit_visitor_review(p_booking_id uuid, p_rating smallint, p_category text, p_comment text)
returns uuid language sql security definer set search_path = ''
as $$ select private.submit_visitor_review(p_booking_id, p_rating, p_category, p_comment) $$;

create or replace function private.update_visitor_review(p_review_id uuid, p_rating smallint, p_category text, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_updated_id uuid;
begin
  if not private.user_has_role('visitor') then raise exception 'Active visitor account required'; end if;
  if p_rating is null or p_rating not between 1 and 5
    or p_category is null
    or p_category not in ('overall_experience', 'cleanliness', 'facilities', 'staff_service', 'safety', 'accessibility')
    or length(trim(coalesce(p_comment, ''))) > 500 then
    raise exception 'Invalid review';
  end if;
  update public.reviews r set rating = p_rating, category = p_category, comment = trim(coalesce(p_comment, '')),
    review_status = 'pending', moderated_by = null, moderated_at = null, moderation_note = null
  from public.bookings b
  where r.id = p_review_id and r.visitor_id = (select auth.uid())
    and b.id = r.booking_id and b.booking_status = 'completed'
  returning r.id into v_updated_id;
  if v_updated_id is null then raise exception 'Review not found or no longer editable'; end if;
end
$$;

create or replace function public.update_visitor_review(p_review_id uuid, p_rating smallint, p_category text, p_comment text)
returns void language sql security definer set search_path = ''
as $$ select private.update_visitor_review(p_review_id, p_rating, p_category, p_comment) $$;

create or replace function private.submit_review_report(p_review_id uuid, p_reason text, p_details text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_report_id uuid := gen_random_uuid();
begin
  if not private.user_has_role('visitor') then raise exception 'Active visitor account required'; end if;
  if p_reason is null or p_reason not in ('inaccurate', 'inappropriate', 'spam', 'other')
    or length(trim(coalesce(p_details, ''))) > 1000 then
    raise exception 'Invalid report';
  end if;
  if not exists (select 1 from public.reviews r where r.id = p_review_id and r.review_status = 'published') then
    raise exception 'Published review not found';
  end if;
  insert into public.review_reports(id, review_id, reporter_id, reason, details)
  values (v_report_id, p_review_id, (select auth.uid()), p_reason, trim(coalesce(p_details, '')));
  return v_report_id;
end
$$;

create or replace function public.submit_review_report(p_review_id uuid, p_reason text, p_details text default '')
returns uuid language sql security definer set search_path = ''
as $$ select private.submit_review_report(p_review_id, p_reason, p_details) $$;

create or replace function private.moderate_review(p_review_id uuid, p_status public.review_status, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_site_id uuid;
begin
  if p_status is null or p_status not in ('published', 'hidden') or length(trim(coalesce(p_note, ''))) > 1000 then
    raise exception 'Invalid moderation action';
  end if;
  select site_id into v_site_id from public.reviews where id = p_review_id;
  if v_site_id is null or not private.can_manage_site(v_site_id) then raise exception 'Destination access required'; end if;
  update public.reviews set review_status = p_status, moderated_by = (select auth.uid()), moderated_at = now(),
    moderation_note = nullif(trim(coalesce(p_note, '')), '') where id = p_review_id;
  update public.review_reports set status = case when p_status = 'hidden' then 'actioned' else 'dismissed' end,
    resolved_by = (select auth.uid()), resolved_at = now(), resolution_note = nullif(trim(coalesce(p_note, '')), '')
  where review_id = p_review_id and status = 'pending';
end
$$;

create or replace function public.moderate_review(p_review_id uuid, p_status public.review_status, p_note text default '')
returns void language sql security definer set search_path = ''
as $$ select private.moderate_review(p_review_id, p_status, p_note) $$;

create or replace function private.resolve_review_report(p_report_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_site_id uuid;
begin
  if p_status is null or p_status not in ('actioned', 'dismissed') or length(trim(coalesce(p_note, ''))) > 1000 then
    raise exception 'Invalid report resolution';
  end if;
  select r.site_id into v_site_id from public.review_reports rr join public.reviews r on r.id = rr.review_id where rr.id = p_report_id;
  if v_site_id is null or not private.can_manage_site(v_site_id) then raise exception 'Destination access required'; end if;
  update public.review_reports set status = p_status, resolved_by = (select auth.uid()), resolved_at = now(),
    resolution_note = nullif(trim(coalesce(p_note, '')), '') where id = p_report_id;
end
$$;

create or replace function public.resolve_review_report(p_report_id uuid, p_status text, p_note text default '')
returns void language sql security definer set search_path = ''
as $$ select private.resolve_review_report(p_report_id, p_status, p_note) $$;

create or replace function private.submit_review(p_booking_id uuid, p_guest_access_token text, p_rating smallint, p_comment text default '')
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  return private.submit_visitor_review(p_booking_id, p_rating, 'overall_experience', p_comment);
end
$$;

create or replace function private.update_own_review(p_review_id uuid, p_rating smallint, p_comment text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_category text;
begin
  select category into v_category from public.reviews
  where id = p_review_id and visitor_id = (select auth.uid());
  if v_category is null then raise exception 'Review not found or no longer editable'; end if;
  perform private.update_visitor_review(p_review_id, p_rating, v_category, p_comment);
end
$$;

create or replace function private.delete_own_review(p_review_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_deleted_id uuid;
begin
  if not private.user_has_role('visitor') then raise exception 'Active visitor account required'; end if;
  delete from public.reviews r where r.id = p_review_id and r.visitor_id = (select auth.uid())
  returning r.id into v_deleted_id;
  if v_deleted_id is null then raise exception 'Review not found'; end if;
end
$$;

revoke all on function private.submit_visitor_review(uuid, smallint, text, text),
  private.update_visitor_review(uuid, smallint, text, text),
  private.submit_review_report(uuid, text, text), private.moderate_review(uuid, public.review_status, text),
  private.resolve_review_report(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_visitor_review(uuid, smallint, text, text),
  public.update_visitor_review(uuid, smallint, text, text), public.submit_review_report(uuid, text, text),
  public.moderate_review(uuid, public.review_status, text), public.resolve_review_report(uuid, text, text)
  from public, anon;
grant execute on function public.submit_visitor_review(uuid, smallint, text, text),
  public.update_visitor_review(uuid, smallint, text, text), public.submit_review_report(uuid, text, text),
  public.moderate_review(uuid, public.review_status, text), public.resolve_review_report(uuid, text, text)
  to authenticated;
