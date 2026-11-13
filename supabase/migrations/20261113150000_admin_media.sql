-- An admin who deletes a post from the admin page also deletes its photo, at once, through the Storage API.
-- Storage needs both policies: it reads the object before removing it.
-- Without them the photo would stay reachable by its address until the hourly purge.
drop policy if exists "admins read media objects" on storage.objects;
drop policy if exists "admins delete media objects" on storage.objects;

create policy "admins read media objects" on storage.objects for select to authenticated
  using (bucket_id = 'xyzt-media' and public.is_admin());
create policy "admins delete media objects" on storage.objects for delete to authenticated
  using (bucket_id = 'xyzt-media' and public.is_admin());
