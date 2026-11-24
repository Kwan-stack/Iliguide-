alter table public.reviews
  add column category text not null default 'overall_experience'
  check (category in ('overall_experience', 'cleanliness', 'facilities', 'staff_service', 'safety', 'accessibility'));

create or replace function private.submit_visitor_review(p_booking_id uuid, p_rating smallint, p_category text, p_comment text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings%rowtype;
  v_review_id uuid := gen_random_uuid();
begin
  if not private.user_has_role('visitor'::public.app_role) then
    raise exception 'Active visitor account required';
  end if;
  if p_rating is null or p_rating not between 1 and 5
    or p_category is null
    or p_category not in ('overall_experience', 'cleanliness', 'facilities', 'staff_service', 'safety', 'accessibility')
    or length(trim(coalesce(p_comment, ''))) > 500 then
    raise exception 'Invalid review';
  end if;

  select * into v_booking
  from public.bookings b
  where b.id = p_booking_id and b.visitor_id = (select auth.uid())
  for update;
  if not found then raise exception 'An account booking is required to review'; end if;
  if v_booking.booking_status <> 'completed' then raise exception 'A completed visit is required to review'; end if;

  insert into public.reviews(id, booking_id, visitor_id, site_id, rating, category, comment)
  values (v_review_id, v_booking.id, v_booking.visitor_id, v_booking.site_id, p_rating, p_category, trim(coalesce(p_comment, '')));
  return v_review_id;
end
$$;

create or replace function public.submit_visitor_review(p_booking_id uuid, p_rating smallint, p_category text, p_comment text)
returns uuid
language sql
security definer
set search_path = ''
as $$ select private.submit_visitor_review(p_booking_id, p_rating, p_category, p_comment) $$;

revoke all on function private.submit_visitor_review(uuid, smallint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.submit_visitor_review(uuid, smallint, text, text) from public, anon;
grant execute on function public.submit_visitor_review(uuid, smallint, text, text) to authenticated;
