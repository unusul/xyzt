-- Schema of the xyzt Supabase project as read from its catalog on 2026-11-13, before any migration.
-- It was created by hand in the SQL editor; this file records it so a new project can be rebuilt.
-- The bucket "xyzt-media" (public) was created from the dashboard.

create extension if not exists postgis;

create table if not exists public.space_posts (
  id uuid primary key default gen_random_uuid(),
  content text,
  media_url text,
  lat double precision,
  lon double precision,
  geom geometry(Point, 4326),
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '27 hours',
  author_id text default 'anon'
);

create table if not exists public.time_posts (
  id uuid primary key default gen_random_uuid(),
  label text,
  content text,
  media_url text,
  created_at timestamptz default now(),
  expires_at timestamptz,
  author_id text default 'anon'
);

create table if not exists public.category_stats (
  category_type text,
  category_id text,
  total_posts int default 0,
  last_activity timestamptz default now(),
  primary key (category_type, category_id)
);

create or replace function public.update_geom() returns trigger language plpgsql as $$
begin
  new.geom = ST_SetSRID(ST_MakePoint(new.lon, new.lat), 4326);
  return new;
end $$;

drop trigger if exists space_update_geom on public.space_posts;
create trigger space_update_geom before insert on public.space_posts
for each row execute function public.update_geom();

create or replace function public.enforce_time_post_limit() returns trigger language plpgsql as $$
begin
  delete from time_posts
  where id in (select id from time_posts where label = new.label order by created_at desc offset 30);
  insert into category_stats (category_type, category_id, total_posts)
  values ('TIME', new.label, 1)
  on conflict (category_type, category_id)
  do update set total_posts = category_stats.total_posts + 1, last_activity = now();
  return new;
end $$;

drop trigger if exists trigger_time_post_limit on public.time_posts;
create trigger trigger_time_post_limit after insert on public.time_posts
for each row execute function public.enforce_time_post_limit();

create or replace function public.get_nearby_space_posts(user_lat float, user_lon float, radius_meters float)
returns setof public.space_posts language plpgsql as $$
begin
  return query
  select * from space_posts
  where ST_DWithin(geom, ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography, radius_meters)
    and expires_at > now()
  order by created_at desc
  limit 30;
end $$;

alter table public.space_posts enable row level security;
alter table public.time_posts enable row level security;
alter table public.category_stats enable row level security;

create policy "Tutti gli utenti possono leggere i post dello spazio" on public.space_posts for select to anon, authenticated using (true);
create policy "Tutti gli utenti possono pubblicare nello spazio" on public.space_posts for insert to anon, authenticated with check (true);
create policy "Tutti gli utenti possono leggere i post del tempo" on public.time_posts for select to anon, authenticated using (true);
create policy "Tutti gli utenti possono pubblicare nel tempo" on public.time_posts for insert to anon, authenticated with check (true);
create policy "Tutti possono leggere le statistiche" on public.category_stats for select to anon, authenticated using (true);
create policy "Tutti possono inserire statistiche" on public.category_stats for insert to anon, authenticated with check (true);
create policy "Tutti possono aggiornare le statistiche" on public.category_stats for update to anon, authenticated using (true) with check (true);
create policy "Permetti upload pubblico" on storage.objects for insert to public with check (bucket_id = 'xyzt-media');
