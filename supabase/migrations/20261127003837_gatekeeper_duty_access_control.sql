create or replace function private.can_review_site_payment(p_site_id uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.current_role() = 'site_admin' then
    return private.user_has_site_role(p_site_id, 'site_admin');
  end if;
  if private.current_role() is distinct from 'gatekeeper'
     or not private.user_has_site_role(p_site_id, 'gatekeeper') then
    return false;
  end if;
  begin
    perform private.require_active_gatekeeper_duty(p_site_id);
  exception when raise_exception then
    return false;
  end;
  return true;
end
$$;
revoke all on function private.can_review_site_payment(uuid) from public, anon;
grant execute on function private.can_review_site_payment(uuid) to authenticated;
