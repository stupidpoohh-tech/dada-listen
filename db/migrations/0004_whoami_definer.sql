-- 0004_whoami_definer — whoami() 가 auth 스키마에 닿을 수 있게
--
-- 증상: 업로드가 403 으로 죽었다.
--   {"code":"42501","message":"permission denied for schema auth"}
--
-- 원인: whoami() 는 security invoker 라 호출자(authenticated) 권한으로 돈다.
-- 그런데 authenticated 에게는 auth 스키마 USAGE 가 없어서 auth.user_id() 를
-- 부를 수 없다.
--
-- 그러면 왜 앱 화면은 멀쩡했나: **RLS 정책 식은 호출자가 아니라 테이블 소유자
-- 권한으로 평가된다.** 그래서 정책 안의 auth.user_id() 는 잘 돌고 목록도 잘
-- 나온다. 함수로 직접 부를 때만 막힌다. (실제 Postgres 로 확인했다.)
--
-- 고치는 방법은 둘이다:
--   (a) grant usage on schema auth to authenticated
--   (b) whoami() 를 security definer 로
-- (a) 는 우리 소유가 아닌 스키마의 권한을 건드리는 데다, 필요 이상으로 넓게
-- 연다. (b) 로 간다 — 우리가 만든 함수 하나만 바꾼다.
--
-- security definer 여도 신원은 그대로 호출자의 것이다. auth.user_id() 는 역할이
-- 아니라 **세션에 실린 JWT** 를 읽기 때문이다. 소유자 권한으로 도는 동안
-- teachers 를 RLS 없이 보게 되지만, 조건이 `t.id = auth.user_id()` 라
-- 호출자 본인 행 말고는 닿지 않는다.

drop function if exists public.whoami();

create function public.whoami()
returns jsonb
language sql
stable
security definer
-- search_path 를 고정한다. 안 그러면 호출자가 임시 스키마로 public 이나 auth 를
-- 가려서 소유자 권한으로 엉뚱한 코드를 돌릴 수 있다. pg_temp 는 반드시 맨 뒤.
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'id', auth.user_id(),
    'approved', coalesce(
      (select t.approved from public.teachers t where t.id = auth.user_id()),
      false)
  )
$$;

-- 강사만. 학생(anonymous)에게는 주지 않는다 — 학생은 반 코드로만 들어온다 (D-005).
grant execute on function public.whoami() to authenticated;
