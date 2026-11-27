-- Edge Functions use the service role for privileged, RLS-bypassing operations.
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
