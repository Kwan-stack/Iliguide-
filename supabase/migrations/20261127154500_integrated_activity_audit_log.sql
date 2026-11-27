alter table public.audit_logs
  add column transaction_id bigint,
  add column event_type text default 'system_record_updated',
  add column category text default 'System operations',
  add column event_priority smallint not null default 0,
  add column actor_role text,
  add column actor_name text,
  add column site_name text,
  add column booking_reference text,
  add column previous_values jsonb not null default '{}'::jsonb,
  add column updated_values jsonb not null default '{}'::jsonb,
  add column metadata jsonb not null default '{}'::jsonb,
  add column outcome text not null default 'success' check (outcome in ('success', 'rejected')),
  add column search_text text not null default '';

update public.audit_logs
set event_type = case
      when entity_type = 'bookings' and action = 'insert' then 'booking_created'
      when entity_type = 'bookings' then 'booking_record_updated'
      when entity_type = 'payments' and action = 'insert' then 'payment_record_created'
      when entity_type = 'payments' then 'payment_record_updated'
      when entity_type = 'attendance_logs' then 'attendance_recorded'
      else 'historical_record_updated'
    end,
    category = case
      when entity_type in ('bookings', 'booking_holds', 'booking_access_tokens') then 'Booking'
      when entity_type in ('payments', 'refunds', 'payment_transactions') then 'Payment'
      when entity_type = 'attendance_logs' then 'Attendance'
      when entity_type like '%capacity%' or entity_type = 'site_approved_visitor_limits' then 'Carrying capacity'
      when entity_type in ('site_slots', 'site_operating_hours', 'site_closures') then 'Scheduling'
      when entity_type in ('staff_assignments', 'staff_invitations', 'site_gatekeeper_duties') then 'Staff management'
      when entity_type in ('tourism_sites', 'site_settings', 'site_images') then 'Destination management'
      when entity_type = 'site_announcements' then 'Announcements'
      when entity_type in ('reviews', 'review_moderation_history') then 'Feedback'
      else 'System operations'
    end,
    search_text = lower(concat_ws(' ', replace(action, '_', ' '), replace(entity_type, '_', ' '), entity_id::text));

alter table public.audit_logs alter column event_type set not null;
alter table public.audit_logs alter column category set not null;

create index audit_logs_transaction_idx on public.audit_logs(transaction_id, created_at desc);
create index audit_logs_category_created_idx on public.audit_logs(category, created_at desc);

create or replace function private.activity_snapshot(p_entity_type text, p_row jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_row, '{}'::jsonb)) item
  where item.key = any(case p_entity_type
    when 'bookings' then array['booking_reference','visitor_count','adult_count','child_count','total_amount','currency','payment_status','booking_status','booking_source','payment_method','hold_expires_at','cancellation_cutoff_at','qr_issued_at']
    when 'payments' then array['provider','amount','currency','payment_status','verified_at','payment_mode']
    when 'refunds' then array['amount','currency','refund_status','processed_at']
    when 'cancellation_requests' then array['request_status','reviewed_at']
    when 'attendance_logs' then array['action','visitor_count','counts_toward_occupancy','scanned_at']
    when 'tourism_sites' then array['name','category','description','address','latitude','longitude','status']
    when 'site_settings' then array['adult_fee','child_fee','currency','daily_capacity','max_per_booking','cancellation_cutoff_hours']
    when 'site_operating_hours' then array['weekday','opens_at','closes_at','is_closed']
    when 'site_slots' then array['slot_date','starts_at','ends_at','capacity','status']
    when 'site_closures' then array['starts_on','ends_on','starts_at','ends_at','reason']
    when 'site_images' then array['image_role','alt_text','sort_order']
    when 'staff_assignments' then array['staff_role','is_active']
    when 'staff_invitations' then array['staff_role','status','expires_at']
    when 'profiles' then array['full_name','role','account_status']
    when 'site_announcements' then array['title','category','status','published_at','expires_at']
    when 'reviews' then array['rating','review_status','moderated_at']
    when 'site_gatekeeper_duties' then array['duty_date','shift_start_at','shift_end_at','status','change_reason']
    when 'site_gatekeeper_duty_support' then array[]::text[]
    when 'site_capacity_assessments' then array['estimated_capacity','assessment_date','status']
    when 'site_capacity_zones' then array['name','zone_type','measured_area','area_unit']
    when 'site_approved_visitor_limits' then array['visitor_limit','effective_from','effective_to','status','policy_reference']
    when 'site_capacity_rules' then array['near_threshold_percent','almost_threshold_percent','critical_threshold_percent','restrict_at_warning']
    when 'reservation_pwd_verifications' then array['verification_status','verified_at','delete_after']
    else array['site_id']
  end);
$$;

create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_old_values jsonb;
  v_new_values jsonb;
  v_id uuid;
  v_site_id uuid;
  v_booking_id uuid;
  v_booking_reference text;
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_actor_name text;
  v_site_name text;
  v_type text := 'system_record_updated';
  v_category text := 'System operations';
  v_priority smallint := 10;
  v_metadata jsonb := '{}'::jsonb;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_row := coalesce(v_new, v_old);
  v_old_values := private.activity_snapshot(tg_table_name, v_old);
  v_new_values := private.activity_snapshot(tg_table_name, v_new);
  if tg_op = 'UPDATE' and v_old_values = v_new_values
    and not (tg_table_name = 'site_images' and v_old ->> 'storage_path' is distinct from v_new ->> 'storage_path') then return new; end if;

  v_id := coalesce(nullif(v_row ->> 'id', '')::uuid, nullif(v_row ->> 'site_id', '')::uuid,
    nullif(v_row ->> 'duty_id', '')::uuid, nullif(v_row ->> 'booking_id', '')::uuid);
  v_site_id := nullif(v_row ->> 'site_id', '')::uuid;
  if tg_table_name = 'tourism_sites' and tg_op <> 'DELETE' then v_site_id := nullif(v_row ->> 'id', '')::uuid; end if;
  if tg_table_name = 'site_gatekeeper_duty_support' then
    select d.site_id into v_site_id from public.site_gatekeeper_duties d where d.id = nullif(v_row ->> 'duty_id', '')::uuid;
  end if;
  v_booking_id := case when tg_table_name = 'bookings' then nullif(v_row ->> 'id', '')::uuid
    else nullif(v_row ->> 'booking_id', '')::uuid end;
  if tg_table_name in ('payments', 'refunds', 'bookings', 'attendance_logs', 'cancellation_requests', 'reservation_pwd_verifications') then
    select coalesce(v_site_id, b.site_id), b.booking_reference into v_site_id, v_booking_reference
    from public.bookings b where b.id = v_booking_id;
  end if;
  if tg_table_name = 'bookings' then v_booking_reference := v_row ->> 'booking_reference'; end if;
  if v_site_id is not null then
    select s.name into v_site_name from public.tourism_sites s where s.id = v_site_id;
  elsif tg_table_name = 'tourism_sites' then
    v_site_name := v_row ->> 'name';
  end if;
  if v_site_name is null and tg_table_name = 'tourism_sites' then v_site_name := v_row ->> 'name'; end if;
  if v_actor_id is not null then
    select p.full_name, p.role::text into v_actor_name, v_actor_role
    from public.profiles p where p.id = v_actor_id;
  else
    v_actor_role := null;
  end if;

  case tg_table_name
    when 'bookings' then
      v_category := 'Booking';
      if tg_op = 'INSERT' then v_type := 'booking_created'; v_priority := 40;
      elsif (v_old ->> 'qr_issued_at') is distinct from (v_new ->> 'qr_issued_at') and v_new ->> 'qr_issued_at' is not null then v_type := 'ticket_issued'; v_category := 'Booking'; v_priority := 60;
      elsif (v_old ->> 'booking_status') is distinct from (v_new ->> 'booking_status') then
        v_type := case v_new ->> 'booking_status' when 'confirmed' then 'booking_confirmed' when 'cancelled' then 'booking_cancelled' when 'expired' then 'booking_expired' when 'completed' then 'visit_completed' else 'booking_status_updated' end;
        if v_new ->> 'booking_status' = 'completed' then v_category := 'Attendance'; v_priority := 100; else v_priority := 70; end if;
      elsif (v_old ->> 'payment_status') is distinct from (v_new ->> 'payment_status') then
        v_type := case v_new ->> 'payment_status' when 'paid' then 'payment_verified' when 'rejected' then 'payment_rejected' else 'payment_status_updated' end;
        v_category := 'Payment'; v_priority := 80;
      else v_type := 'booking_record_updated'; v_priority := 20; end if;
      select jsonb_build_object('visit_date', sl.slot_date, 'starts_at', sl.starts_at, 'ends_at', sl.ends_at)
        into v_metadata from public.site_slots sl where sl.id = nullif(v_row ->> 'slot_id', '')::uuid;
    when 'payments' then
      v_category := 'Payment';
      if tg_op = 'INSERT' then v_type := case when v_row ->> 'payment_status' = 'pending_verification' then 'payment_submitted' else 'payment_record_created' end; v_priority := 50;
      elsif (v_old ->> 'payment_status') is distinct from (v_new ->> 'payment_status') then
        v_type := case v_new ->> 'payment_status' when 'paid' then case v_new ->> 'provider' when 'manual' then 'payment_verified' else 'payment_recorded' end when 'rejected' then 'payment_rejected' else 'payment_status_updated' end;
        v_priority := case when v_new ->> 'payment_status' in ('paid','rejected') then 80 else 30 end;
      else v_type := 'payment_record_updated'; v_priority := 20; end if;
    when 'attendance_logs' then v_category := 'Attendance'; v_type := case v_row ->> 'action' when 'entry' then 'visitor_checked_in' when 'exit' then 'visitor_checked_out' else 'attendance_recorded' end; v_priority := 90;
    when 'refunds' then v_category := 'Payment'; v_type := case when tg_op = 'INSERT' then 'refund_recorded' else 'refund_status_updated' end; v_priority := 50;
    when 'cancellation_requests' then v_category := 'Booking'; v_type := 'booking_cancellation_reviewed'; v_priority := 50;
    when 'tourism_sites' then
      v_category := 'Destination management';
      v_type := case when tg_op = 'INSERT' then 'destination_created' when tg_op = 'DELETE' then 'destination_removed'
        when v_old ->> 'status' is distinct from v_new ->> 'status' and v_new ->> 'status' = 'temporarily_closed' then 'destination_closed'
        when v_old ->> 'status' is distinct from v_new ->> 'status' and v_old ->> 'status' = 'temporarily_closed' then 'destination_reopened'
        else 'destination_updated' end; v_priority := 50;
    when 'site_settings' then v_category := 'Scheduling'; v_type := 'scheduling_configuration_updated'; v_priority := 40;
    when 'site_operating_hours' then v_category := 'Scheduling'; v_type := 'operating_hours_updated'; v_priority := 40;
    when 'site_slots' then
      v_category := 'Scheduling';
      v_type := case when v_new ->> 'status' = 'closed' and v_old ->> 'status' is distinct from 'closed' then 'booking_slot_closed'
        when v_old ->> 'status' = 'closed' and v_new ->> 'status' = 'open' then 'booking_slot_reopened' else 'booking_schedule_updated' end; v_priority := 40;
    when 'site_closures' then v_category := 'Scheduling'; v_type := case when tg_op = 'DELETE' then 'destination_reopened' else 'destination_closed' end; v_priority := 50;
    when 'site_images' then v_category := 'Destination management'; v_type := case when tg_op = 'DELETE' then 'destination_photo_removed' else 'destination_photo_updated' end; v_priority := 30;
    when 'site_capacity_assessments' then v_category := 'Carrying capacity'; v_type := case when v_new ->> 'status' in ('reviewed','approved_for_operational_use') then 'capacity_assessment_reviewed' else 'capacity_assessment_updated' end; v_priority := 40;
    when 'site_capacity_zones' then v_category := 'Carrying capacity'; v_type := 'capacity_zone_updated'; v_priority := 30;
    when 'site_approved_visitor_limits' then v_category := 'Carrying capacity'; v_type := 'capacity_limit_updated'; v_priority := 60;
    when 'site_capacity_rules' then v_category := 'Carrying capacity'; v_type := 'capacity_configuration_updated'; v_priority := 50;
    when 'staff_assignments' then
      v_category := 'Staff management';
      v_type := case when tg_op = 'INSERT' then 'gatekeeper_assigned' when tg_op = 'DELETE' or v_new ->> 'is_active' = 'false' then 'gatekeeper_assignment_removed' else 'gatekeeper_reassigned' end;
      v_priority := 50;
      select jsonb_build_object(
        'staff_member', p.full_name,
        'previous_destination', old_site.name,
        'updated_destination', new_site.name
      ) into v_metadata
      from public.profiles p
      left join public.tourism_sites old_site on old_site.id = nullif(v_old ->> 'site_id', '')::uuid
      left join public.tourism_sites new_site on new_site.id = nullif(v_new ->> 'site_id', '')::uuid
      where p.id = nullif(v_row ->> 'profile_id', '')::uuid;
    when 'staff_invitations' then v_category := 'Staff management'; v_type := case when tg_op = 'INSERT' then 'staff_invitation_created' when v_new ->> 'status' = 'accepted' then 'staff_account_activated' else 'staff_invitation_updated' end; v_priority := 45;
    when 'profiles' then v_category := 'Security'; v_type := case when tg_op = 'INSERT' then 'account_created' when v_old ->> 'role' is distinct from v_new ->> 'role' or v_old ->> 'account_status' is distinct from v_new ->> 'account_status' then 'staff_account_updated' else 'account_information_updated' end; v_priority := 40;
    when 'site_announcements' then
      v_category := 'Announcements';
      v_type := case when tg_op = 'DELETE' then 'announcement_removed' when v_new ->> 'status' = 'published' and (tg_op = 'INSERT' or v_old ->> 'status' is distinct from 'published') then 'announcement_published' when tg_op = 'INSERT' then 'announcement_drafted' else 'announcement_updated' end; v_priority := 50;
    when 'reviews' then v_category := 'Feedback'; v_type := case when tg_op = 'INSERT' then 'feedback_submitted' when v_old ->> 'review_status' is distinct from v_new ->> 'review_status' then 'feedback_moderated' else 'feedback_updated' end; v_priority := 40;
    when 'site_gatekeeper_duties' then
      v_category := 'Staff management'; v_type := 'gatekeeper_duty_updated'; v_priority := 40;
      select jsonb_build_object(
        'previous_gatekeeper', old_profile.full_name,
        'updated_gatekeeper', new_profile.full_name
      ) into v_metadata
      from public.profiles current_profile
      left join public.profiles old_profile on old_profile.id = nullif(v_old ->> 'primary_gatekeeper_id', '')::uuid
      left join public.profiles new_profile on new_profile.id = nullif(v_new ->> 'primary_gatekeeper_id', '')::uuid
      where current_profile.id = coalesce(nullif(v_new ->> 'primary_gatekeeper_id', '')::uuid, nullif(v_old ->> 'primary_gatekeeper_id', '')::uuid)
      limit 1;
    when 'site_gatekeeper_duty_support' then
      v_category := 'Staff management'; v_type := 'gatekeeper_duty_support_updated'; v_priority := 35;
      select jsonb_build_object('assigned_gatekeeper', p.full_name) into v_metadata
      from public.profiles p where p.id = nullif(v_row ->> 'gatekeeper_id', '')::uuid;
    when 'reservation_pwd_verifications' then v_category := 'Booking'; v_type := 'visitor_eligibility_reviewed'; v_priority := 30;
    else v_type := 'system_record_updated'; v_category := 'System operations'; v_priority := 10;
  end case;

  if tg_table_name = 'site_images' and tg_op = 'UPDATE' and v_old ->> 'storage_path' is distinct from v_new ->> 'storage_path' then
    v_metadata := coalesce(v_metadata, '{}'::jsonb) || jsonb_build_object('image_changed', true);
  end if;
  if tg_table_name = 'staff_assignments' and v_site_name is not null then
    v_metadata := coalesce(v_metadata, '{}'::jsonb) || jsonb_build_object('assigned_destination', v_site_name);
  end if;
  v_metadata := coalesce(v_metadata, '{}'::jsonb);

  insert into public.audit_logs(
    actor_id, site_id, action, entity_type, entity_id, transaction_id, event_type, category, event_priority,
    actor_role, actor_name, site_name, booking_reference, previous_values, updated_values, metadata, outcome, search_text
  ) values (
    v_actor_id, v_site_id, lower(tg_op), tg_table_name, v_id, txid_current(), v_type, v_category, v_priority,
    v_actor_role, v_actor_name, v_site_name, v_booking_reference, v_old_values, v_new_values, v_metadata, 'success',
    lower(concat_ws(' ', replace(v_type, '_', ' '), v_category, v_actor_name, v_site_name, v_booking_reference, v_old_values::text, v_new_values::text, v_metadata::text))
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists audit_profile_privileges on public.profiles;
create trigger audit_profile_created after insert on public.profiles
for each row execute function private.audit_row_change();
create trigger audit_profile_updates after update of full_name, phone, role, account_status on public.profiles
for each row execute function private.audit_row_change();
create trigger audit_site_hours after insert or update or delete on public.site_operating_hours
for each row execute function private.audit_row_change();
create trigger audit_site_images after insert or update or delete on public.site_images
for each row execute function private.audit_row_change();
create trigger audit_staff_invitations after insert or update or delete on public.staff_invitations
for each row execute function private.audit_row_change();
create trigger audit_site_announcements after insert or update or delete on public.site_announcements
for each row execute function private.audit_row_change();
create trigger audit_gatekeeper_duty_support after insert or update or delete on public.site_gatekeeper_duty_support
for each row execute function private.audit_row_change();

revoke all on function private.activity_snapshot(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.audit_row_change() from public, anon, authenticated, service_role;

drop policy if exists audit_logs_read_staff on public.audit_logs;
create policy audit_logs_tourism_office_read on public.audit_logs for select to authenticated
using (private.user_has_role('tourism_office'));

create or replace view public.activity_log_events with (security_invoker = true) as
with source_rows as (
  select a.*, case when a.transaction_id is null then 'audit:' || a.id::text else 'tx:' || a.transaction_id::text end as event_key
  from public.audit_logs a
), grouped as (
  select event_key, max(created_at) as created_at,
    (array_agg(event_type order by event_priority desc, created_at desc))[1] as event_type,
    array_agg(distinct category order by category) as categories,
    (array_agg(distinct site_id order by site_id) filter (where site_id is not null))[1] as site_id,
    coalesce(array_agg(distinct site_id order by site_id) filter (where site_id is not null), array[]::uuid[]) as destination_ids,
    array_agg(distinct site_name order by site_name) filter (where site_name is not null) as destination_names,
    (array_agg(actor_id order by created_at desc))[1] as actor_id,
    (array_agg(actor_name order by created_at desc))[1] as actor_name,
    (array_agg(actor_role order by created_at desc))[1] as actor_role,
    string_agg(distinct booking_reference, ', ' order by booking_reference) filter (where booking_reference is not null) as booking_reference,
    bool_and(outcome = 'success') as successful,
    count(*)::integer as change_count,
    jsonb_agg(jsonb_build_object('event_type', event_type, 'category', category, 'entity_type', entity_type,
      'action', action, 'previous_values', previous_values, 'updated_values', updated_values,
      'metadata', metadata, 'outcome', outcome) order by created_at, id) as changes,
    string_agg(distinct search_text, ' ' order by search_text) as search_text
  from source_rows group by event_key
)
select event_key, created_at, event_type, categories,
  case when cardinality(destination_ids) = 0 then coalesce(destination_names[1], 'System-wide')
    when cardinality(destination_ids) > 1 then 'Multiple destinations'
    else coalesce(destination_names[1], 'Destination unavailable') end as destination,
  site_id, destination_ids, destination_names,
  coalesce(actor_name, case when actor_id is null then 'System' else 'Actor unavailable' end) as actor,
  actor_role, booking_reference, successful, change_count, changes, search_text
from grouped;

revoke all on public.activity_log_events from public, anon;
grant select on public.activity_log_events to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs') then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
end
$$;

notify pgrst, 'reload schema';
