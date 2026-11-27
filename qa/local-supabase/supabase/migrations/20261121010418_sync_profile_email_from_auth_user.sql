create or replace function private.sync_profile_email_from_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles
  set email = lower(new.email)
  where id = new.id and email is distinct from lower(new.email);
  return new;
end
$$;

revoke all on function private.sync_profile_email_from_auth_user() from public, anon, authenticated, service_role;

drop trigger if exists sync_profile_email_from_auth_user on auth.users;
create trigger sync_profile_email_from_auth_user
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function private.sync_profile_email_from_auth_user();

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id and p.email is distinct from lower(u.email);
