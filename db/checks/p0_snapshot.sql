-- p0_snapshot — 0005 적용 **전** 상태를 기록해 둔다 (읽기 전용)
--
-- 왜 필요한가: 적용 후에 "무엇이 바뀌었나"를 비교할 기준이 있어야 하고,
-- 되돌려야 할 때 원래 권한 모양을 알아야 한다.
--
-- 사용법 — 결과를 **로컬 파일로** 남긴다. Git 이나 채팅에 올리지 않는다.
--   psql "$NEON_DATABASE_URL" -X -f db/checks/p0_snapshot.sql > ~/p0_before.txt
--
-- 이 스크립트는 강사 이름·id 를 출력하지 않는다 (숫자만).
-- 개별 목록이 필요하면 db/checks/approved_audit.sql 을 따로, 로컬에만 남긴다.

\echo '===== teachers 테이블 권한 (relacl) ====='
select relname as "테이블", coalesce(array_to_string(relacl, E'\n'), '(기본값)') as "ACL"
from pg_class where oid = 'public.teachers'::regclass;

\echo '===== teachers 컬럼 권한 (attacl) ====='
select a.attname as "컬럼", coalesce(array_to_string(a.attacl, E'\n'), '(없음)') as "컬럼 ACL"
from pg_attribute a
where a.attrelid = 'public.teachers'::regclass and a.attnum > 0 and not a.attisdropped
order by a.attnum;

\echo '===== teachers 트리거 ====='
select tgname as "트리거", tgenabled as "상태", pg_get_triggerdef(oid) as "정의"
from pg_trigger
where tgrelid = 'public.teachers'::regclass and not tgisinternal;

\echo '===== 관련 함수 정의 ====='
select p.proname as "함수",
       p.prosecdef as "security definer",
       coalesce(array_to_string(p.proacl, E'\n'), '(기본값: PUBLIC 실행 가능)') as "실행 권한",
       pg_get_functiondef(p.oid) as "정의"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('whoami', 'admin_set_teacher_approval', 'teachers_guard_approved')
order by p.proname;

\echo '===== teachers RLS 정책 ====='
select polname as "정책", pg_get_expr(polqual, polrelid) as "USING",
       pg_get_expr(polwithcheck, polrelid) as "WITH CHECK"
from pg_policy where polrelid = 'public.teachers'::regclass;

\echo '===== 승인 현황 (숫자만) ====='
select count(*) filter (where approved) as "승인됨",
       count(*) filter (where not approved) as "미승인",
       count(*) as "전체"
from public.teachers;
