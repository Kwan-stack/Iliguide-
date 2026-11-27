create or replace function public.update_staff_assignment(
  p_assignment_id uuid,
  p_full_name text,
  p_site_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.staff_assignments%rowtype;
  v_is_tourism_office boolean := private.user_has_role('tourism_office');
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not v_is_tourism_office and not private.user_has_role('site_admin') then
    raise exception 'Only staff administrators can edit assignments' using errcode = '42501';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) not between 1 and 120 then
    raise exception 'Name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if p_site_id is null or not exists (select 1 from public.tourism_sites where id = p_site_id) then
    raise exception 'Choose a valid destination' using errcode = '22023';
  end if;

  select * into v_assignment
  from public.staff_assignments
  where id = p_assignment_id
  for update;
  if not found then
    raise exception 'Staff assignment not found' using errcode = 'P0002';
  end if;
  if not v_is_tourism_office and (
    v_assignment.staff_role <> 'gatekeeper'
    or not private.can_manage_site(v_assignment.site_id)
    or not private.can_manage_site(p_site_id)
  ) then
    raise exception 'You cannot edit this staff assignment' using errcode = '42501';
  end if;

  update public.profiles set full_name = btrim(p_full_name) where id = v_assignment.profile_id;
  update public.staff_assignments set site_id = p_site_id where id = v_assignment.id;
end;
$$;

revoke all on function public.update_staff_assignment(uuid, text, uuid) from public, anon;
grant execute on function public.update_staff_assignment(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
