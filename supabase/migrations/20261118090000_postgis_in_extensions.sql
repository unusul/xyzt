-- Supabase security advisor, 2026-11-14: "Table publicly accessible" (rls_disabled_in_public) on
-- public.spatial_ref_sys, PostGIS's table of coordinate systems. It sat in the API-exposed schema with full
-- rights for anon and authenticated (insert, update, delete, truncate), granted by supabase_admin: neither
-- RLS nor a revoke is possible from the postgres role. Removing SRID 4326 there would break every geo query.
-- Fix: reinstall PostGIS in the "extensions" schema, which the REST API does not expose.
-- PostGIS is not relocatable, so it is dropped and created again; space_posts.geom (and its index) go with it
-- and are added back. Written when space_posts was empty: with live posts, geom is rebuilt from lat/lon below.

drop extension if exists postgis cascade;
create extension postgis with schema extensions;

alter table public.space_posts add column if not exists geom extensions.geometry(Point, 4326);
update public.space_posts set geom = extensions.st_setsrid(extensions.st_makepoint(lon, lat), 4326);
create index if not exists space_posts_geom_idx on public.space_posts using gist (geom);

-- Both functions call PostGIS: fix their search_path so they find it whatever role runs them.
create or replace function public.update_geom()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.geom = st_setsrid(st_makepoint(new.lon, new.lat), 4326);
  return new;
end $$;

create or replace function public.get_nearby_space_posts(user_lat float, user_lon float, radius_meters float)
returns setof public.space_posts language plpgsql stable set search_path = public, extensions as $$
begin
  return query
  select * from space_posts
  where st_dwithin(geom::geography, st_setsrid(st_makepoint(user_lon, user_lat), 4326)::geography, radius_meters)
    and expires_at > now()
  order by created_at desc
  limit 30;
end $$;
