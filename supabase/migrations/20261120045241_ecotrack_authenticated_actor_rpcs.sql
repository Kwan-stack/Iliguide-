revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text) from public, anon, authenticated;
revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer) from public, anon, authenticated;
revoke all on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb) from public, anon;
grant execute on function private.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb) to authenticated;
grant execute on function public.create_booking_hold(uuid, text, integer, integer, text, text, integer, jsonb) to authenticated;

revoke all on function private.confirm_free_booking(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.confirm_free_booking(uuid, text) from public, anon;
grant execute on function private.confirm_free_booking(uuid, text) to authenticated;
grant execute on function public.confirm_free_booking(uuid, text) to authenticated;

revoke all on function private.lookup_booking(text, text) from public, anon, authenticated, service_role;
revoke all on function public.lookup_booking(text, text) from public, anon;
grant execute on function private.lookup_booking(text, text) to authenticated;
grant execute on function public.lookup_booking(text, text) to authenticated;

revoke all on function private.register_walk_in(uuid, uuid, text, integer, integer, integer, text, text) from public, anon, authenticated, service_role;
revoke all on function public.register_walk_in(uuid, uuid, text, integer, integer, text, text, numeric, text) from public, anon, authenticated;
revoke all on function private.register_walk_in(uuid, uuid, text, integer, integer, text, text, numeric, text) from public, anon, authenticated, service_role;
revoke all on function public.register_walk_in_with_visitors(uuid, uuid, text, integer, integer, integer, text, text, jsonb) from public, anon;
grant execute on function public.register_walk_in_with_visitors(uuid, uuid, text, integer, integer, integer, text, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
