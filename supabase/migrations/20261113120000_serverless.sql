-- xyzt without the Node server: the browser talks to Supabase directly, so every rule the server used to
-- enforce (post lifetime, label format, upload limits, who may delete) moves into the database.
-- Written on top of the schema found in the project on 2026-11-13 (see 00000000000000_baseline.sql).
-- Safe to run twice.

-- ---------------------------------------------------------------------------------------------------
-- 1. Label lifetime. Same curve as calcoloValoreLabel() in the old server.js: 7 characters are worth
--    100 minutes, shorter and longer labels decay to 1. Both forms were run over lengths 0..35 and match.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.label_value(label text)
returns integer language sql immutable as $$
  select case
    when char_length(label) = 7 then 100
    when char_length(label) between 1 and 6 then floor(1 + (99::float8 / 6) * (char_length(label) - 1))::int
    when char_length(label) between 8 and 30 then floor(100 - (99::float8 / 23) * (char_length(label) - 7))::int
    else 1
  end
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Server-owned columns: whatever the client sends for id, created_at and expires_at is overwritten.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.stamp_time_post()
returns trigger language plpgsql as $$
begin
  new.id := gen_random_uuid();
  new.label := lower(coalesce(nullif(new.label, ''), 'xyzt'));
  new.author_id := coalesce(nullif(new.author_id, ''), 'anon');
  new.created_at := now();
  new.expires_at := now() + make_interval(mins => 10 + public.label_value(new.label));
  return new;
end $$;

drop trigger if exists trg_stamp_time_post on public.time_posts;
create trigger trg_stamp_time_post before insert on public.time_posts
for each row execute function public.stamp_time_post();

create or replace function public.stamp_space_post()
returns trigger language plpgsql as $$
begin
  new.id := gen_random_uuid();
  new.author_id := coalesce(nullif(new.author_id, ''), 'anon');
  new.created_at := now();
  new.expires_at := now() + interval '27 hours';
  return new;
end $$;

drop trigger if exists trg_stamp_space_post on public.space_posts;
create trigger trg_stamp_space_post before insert on public.space_posts
for each row execute function public.stamp_space_post();

-- ---------------------------------------------------------------------------------------------------
-- 3. Shape of a post. Tables are empty at migration time, so the checks validate immediately.
--    media_url may only point into this project's own bucket: no third-party images in the feed.
-- ---------------------------------------------------------------------------------------------------
alter table public.time_posts
  drop constraint if exists time_posts_label_format,
  drop constraint if exists time_posts_body,
  drop constraint if exists time_posts_media_own_bucket,
  drop constraint if exists time_posts_author_len;
alter table public.time_posts
  add constraint time_posts_label_format check (label ~ '^[a-z0-9]{1,40}$'),
  add constraint time_posts_body check (char_length(coalesce(content, '')) <= 2000
                                        and (coalesce(content, '') <> '' or media_url is not null)),
  add constraint time_posts_media_own_bucket check (media_url is null or media_url ~
    '^https://qpkulphnmtxcprsyhxcj\.supabase\.co/storage/v1/object/public/xyzt-media/[A-Za-z0-9._-]+$'),
  add constraint time_posts_author_len check (char_length(author_id) <= 60);

alter table public.space_posts
  drop constraint if exists space_posts_coords,
  drop constraint if exists space_posts_body,
  drop constraint if exists space_posts_media_own_bucket,
  drop constraint if exists space_posts_author_len;
alter table public.space_posts
  add constraint space_posts_coords check (lat between -90 and 90 and lon between -180 and 180),
  add constraint space_posts_body check (char_length(coalesce(content, '')) <= 2000
                                         and (coalesce(content, '') <> '' or media_url is not null)),
  add constraint space_posts_media_own_bucket check (media_url is null or media_url ~
    '^https://qpkulphnmtxcprsyhxcj\.supabase\.co/storage/v1/object/public/xyzt-media/[A-Za-z0-9._-]+$'),
  add constraint space_posts_author_len check (char_length(author_id) <= 60);

create index if not exists space_posts_geom_idx on public.space_posts using gist (geom);
create index if not exists time_posts_label_created_idx on public.time_posts (label, created_at desc);

-- ---------------------------------------------------------------------------------------------------
-- 4. The per-label cap (30) and the label statistics run with the owner's rights: visitors can no longer
--    write category_stats themselves, and the cap really deletes (as anon it had no delete policy).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.enforce_time_post_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from time_posts
  where id in (
    select id from time_posts where label = new.label order by created_at desc offset 30
  );
  insert into category_stats (category_type, category_id, total_posts)
  values ('TIME', new.label, 1)
  on conflict (category_type, category_id)
  do update set total_posts = category_stats.total_posts + 1, last_activity = now();
  return new;
end $$;

drop policy if exists "Tutti possono inserire statistiche" on public.category_stats;
drop policy if exists "Tutti possono aggiornare le statistiche" on public.category_stats;

-- ---------------------------------------------------------------------------------------------------
-- 5. Admins. One row per admin, written only from the dashboard or the CLI: no policy lets the API in.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Reading and deleting posts. An expired post is invisible at once, whenever the purge runs.
-- ---------------------------------------------------------------------------------------------------
drop policy if exists "Tutti gli utenti possono leggere i post dello spazio" on public.space_posts;
drop policy if exists "Tutti gli utenti possono leggere i post del tempo" on public.time_posts;
drop policy if exists "read live space posts" on public.space_posts;
drop policy if exists "read live time posts" on public.time_posts;
drop policy if exists "admins delete space posts" on public.space_posts;
drop policy if exists "admins delete time posts" on public.time_posts;

create policy "read live space posts" on public.space_posts for select to anon, authenticated
  using (expires_at > now() or public.is_admin());
create policy "read live time posts" on public.time_posts for select to anon, authenticated
  using (expires_at > now() or public.is_admin());
create policy "admins delete space posts" on public.space_posts for delete to authenticated using (public.is_admin());
create policy "admins delete time posts" on public.time_posts for delete to authenticated using (public.is_admin());

revoke update, delete, truncate on public.space_posts, public.time_posts, public.category_stats from anon;
revoke update, truncate on public.space_posts, public.time_posts, public.category_stats from authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 7. Contact messages: anyone may write one, only an admin reads them. Replaces the e-mail the server sent.
--    At most 30 an hour overall, so a script cannot fill the table.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text check (email is null or char_length(email) <= 200),
  message text not null check (char_length(message) between 1 and 4000)
);
alter table public.contact_messages enable row level security;

create or replace function public.stamp_contact_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from contact_messages where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many messages, try again later' using errcode = 'P0001';
  end if;
  new.id := gen_random_uuid();
  new.created_at := now();
  new.email := nullif(trim(new.email), '');
  return new;
end $$;

drop trigger if exists trg_stamp_contact_message on public.contact_messages;
create trigger trg_stamp_contact_message before insert on public.contact_messages
for each row execute function public.stamp_contact_message();

drop policy if exists "anyone writes a contact message" on public.contact_messages;
drop policy if exists "admins read contact messages" on public.contact_messages;
drop policy if exists "admins delete contact messages" on public.contact_messages;
create policy "anyone writes a contact message" on public.contact_messages for insert to anon, authenticated with check (true);
create policy "admins read contact messages" on public.contact_messages for select to authenticated using (public.is_admin());
create policy "admins delete contact messages" on public.contact_messages for delete to authenticated using (public.is_admin());

revoke all on public.contact_messages from anon, authenticated;
grant insert on public.contact_messages to anon, authenticated;
grant select, delete on public.contact_messages to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 8. Uploads: images only, 5 MB at most (the limit multer applied in the server).
-- ---------------------------------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'xyzt-media';

-- ---------------------------------------------------------------------------------------------------
-- 9. Purge, called on a schedule by .github/workflows/purge.yml with the service key (the server's
--    5-minute loop). Deletes expired posts and returns the bucket files nothing refers to any more:
--    files can only be removed through the Storage API, so the workflow deletes those.
--    The 10-minute grace covers a photo uploaded a moment before its post is written.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.purge_expired()
returns setof text language plpgsql security definer set search_path = public as $$
begin
  delete from space_posts where expires_at < now();
  delete from time_posts where expires_at < now();
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'xyzt-media'
      and o.created_at < now() - interval '10 minutes'
      and not exists (select 1 from space_posts s where s.media_url like '%/' || o.name)
      and not exists (select 1 from time_posts t where t.media_url like '%/' || o.name);
end $$;

revoke all on function public.purge_expired() from public, anon, authenticated;
grant execute on function public.purge_expired() to service_role;
