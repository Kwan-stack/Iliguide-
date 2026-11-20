-- Match the site UUID / filename upload path used by StaffPages.
-- Check the UUID shape before casting a user supplied Storage path.
drop policy if exists tourism_site_images_manager_insert on storage.objects;
drop policy if exists tourism_site_images_manager_update on storage.objects;
drop policy if exists tourism_site_images_manager_delete on storage.objects;

create policy tourism_site_images_manager_insert on storage.objects
for insert to authenticated with check (bucket_id = 'tourism-site-images'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.can_manage_site((storage.foldername(name))[1]::uuid));

create policy tourism_site_images_manager_update on storage.objects
for update to authenticated using (bucket_id = 'tourism-site-images'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.can_manage_site((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'tourism-site-images'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.can_manage_site((storage.foldername(name))[1]::uuid));

create policy tourism_site_images_manager_delete on storage.objects
for delete to authenticated using (bucket_id = 'tourism-site-images'
  and cardinality(storage.foldername(name)) = 1
  and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and private.can_manage_site((storage.foldername(name))[1]::uuid));

