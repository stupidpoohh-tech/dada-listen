-- p0_snapshot — 0005 적용 **전** 권한 상태를 기록해 둔다 (읽기 전용)
--
-- 왜 필요한가: 적용 후에 "무엇이 바뀌었나"를 비교할 기준이 있어야 하고,
-- 되돌려야 할 때 원래 권한 모양을 알아야 한다.
--
-- 이 스크립트는 강사 이름·id 를 출력하지 않는다. 승인 상태 자체는
-- db/checks/approved_audit.sql 로 따로 본다.
--
-- **문장이 하나다.** 웹 SQL Editor 는 여러 문장을 넣으면 마지막 결과만
-- 보여줄 수 있고, psql 전용 명령(\echo 등)은 아예 오류가 난다. 그래서
-- 전부 한 개의 SELECT 로 합쳤다.
--
-- 결과를 파일로 저장해 두고, 적용 후 같은 것을 다시 돌려 비교한다.

with t as (select to_regclass('public.teachers') as oid)
select 구분, 이름, 내용 from (

  -- 테이블 단위 권한. 적용 전에는 authenticated=arwd (a=insert, w=update) 가
  -- 보이고, 적용 후에는 authenticated=rd 만 남아야 한다.
  select 1 as sort, '테이블 권한' as 구분, c.relname::text as 이름,
         coalesce(array_to_string(c.relacl, E'\n'), '(기본값 — 부여된 권한 없음)') as 내용
  from pg_class c, t where c.oid = t.oid

  union all
  -- 컬럼 단위 권한. 적용 후에는 id=a, name=aw 만 있고
  -- approved 와 created_at 에는 아무 권한도 없어야 한다.
  select 2, '컬럼 권한', a.attname::text,
         coalesce(array_to_string(a.attacl, E'\n'), '(없음)')
  from pg_attribute a, t
  where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped

  union all
  select 3, '트리거', tg.tgname::text || ' (상태 ' || tg.tgenabled::text || ')',
         pg_get_triggerdef(tg.oid)
  from pg_trigger tg, t
  where tg.tgrelid = t.oid and not tg.tgisinternal

  union all
  select 4, '함수',
         p.proname::text || case when p.prosecdef then ' [security definer]'
                                 else ' [security invoker]' end,
         '실행권한: ' ||
         coalesce(array_to_string(p.proacl, ', '), '(기본값 — PUBLIC 실행 가능)') ||
         E'\n' || pg_get_functiondef(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('whoami', 'admin_set_teacher_approval', 'teachers_guard_approved')

  union all
  select 5, 'RLS 정책', pol.polname::text,
         'USING: ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '(없음)') ||
         E'\nWITH CHECK: ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '(없음)')
  from pg_policy pol, t where pol.polrelid = t.oid

  union all
  select 6, 'RLS 상태', 'teachers',
         'row security = ' || c.relrowsecurity::text ||
         ' / force = ' || c.relforcerowsecurity::text ||
         '  (force=false 이므로 소유자는 RLS 를 우회한다 = 관리자 경로)'
  from pg_class c, t where c.oid = t.oid

) s order by sort, 이름;
