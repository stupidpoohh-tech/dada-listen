-- Supabase 가 제공하는 것들의 최소 스텁.
-- 실제 Supabase 에 적용하지 말 것 — 마이그레이션을 맨 Postgres 에서
-- 검증할 때만 쓴다. supabase/tests/rls_test.sql 상단 주석 참조.
create schema if not exists auth;
create schema if not exists storage;
-- 역할은 클러스터 전역이라 이미 있을 수 있다.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table storage.buckets (
  id text primary key, name text not null, public bool not null default false
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$ select string_to_array(name, '/') $$;
