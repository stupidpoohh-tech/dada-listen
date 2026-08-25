-- Neon 이 제공하는 것들의 최소 스텁.
-- 실제 Neon 에 적용하지 말 것 — 마이그레이션을 맨 Postgres 에서 검증할 때만 쓴다.
-- db/tests/rls_test.sql 상단 주석 참조.
--
-- 실물에서는 pg_session_jwt 확장이 Data API 를 켜면 자동 설치되고,
-- JWK 검증 없이 동작할 때는 PostgREST 호환으로 request.jwt.claims 를 읽는다.
-- 아래 스텁은 그 폴백 동작을 그대로 흉내낸다.

create schema if not exists auth;

-- JWT 의 sub 클레임을 text 로. 실물 auth.user_id() 와 같은 계약.
create or replace function auth.user_id() returns text
  language sql stable as $$
    -- 캐스트 전에 nullif. 빈 문자열을 그대로 ::jsonb 하면 터진다.
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')
  $$;

-- sub 가 UUID 일 때만 값이 나온다. 우리는 쓰지 않지만 실물에 있으므로 함께 둔다.
create or replace function auth.uid() returns uuid
  language sql stable as $$
    select case
      when auth.user_id() ~ '^[0-9a-fA-F-]{36}$' then auth.user_id()::uuid
      else null
    end
  $$;

create or replace function auth.session() returns jsonb
  language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;

-- Data API 가 만들어 주는 역할. 클러스터 전역이라 이미 있을 수 있다.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anonymous')     then create role anonymous;     end if;
end $$;

-- Data API 를 켜면 Neon 이 함께 해 주는 권한 부여. 마이그레이션이 아니라
-- 프로비저닝 쪽 일이므로 스텁에만 둔다 (실물에서 auth 스키마는 우리 소유가 아니다).
grant usage on schema auth to authenticated, anonymous;
grant execute on all functions in schema auth to authenticated, anonymous;
