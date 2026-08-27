-- auth_check — Worker 가 신원을 확인하지 못할 때 여기부터 본다.
--
-- 업로드가 "로그인이 만료되었습니다" 나 "신원 확인에 실패했습니다" 로 죽으면,
-- 대개 토큰이 아니라 **whoami() 쪽**이 문제다. Worker 는 토큰을 그대로 Data API 의
-- /rpc/whoami 에 넘겨 신원을 묻는데, 그 함수가 없거나 실행 권한이 없거나
-- 반환 모양이 옛것이면 요청이 실패한다.
--
-- Neon SQL Editor 에 통째로 붙여넣고 실행한다. 결과 표만 보면 된다.

select
  'whoami() 존재' as 항목,
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'whoami' and p.pronargs = 0
  ) then '있음' else '없음 — 0002_whoami.sql 과 0003_approved_teacher.sql 을 돌리세요' end as 결과

union all
select
  'whoami() 반환 타입',
  coalesce((
    select format_type(p.prorettype, null) || case
      when format_type(p.prorettype, null) = 'jsonb' then ' (맞음)'
      else ' — 옛 버전입니다. 0003_approved_teacher.sql 을 돌리세요' end
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'whoami' and p.pronargs = 0
  ), '함수가 없습니다')

union all
select
  'authenticated 실행 권한',
  case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'whoami' and p.pronargs = 0
      and has_function_privilege('authenticated', p.oid, 'execute')
  ) then '있음' else '없음 — grant execute on function public.whoami() to authenticated;' end

union all
select
  'teachers.approved 컬럼',
  case when exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'teachers' and column_name = 'approved'
  ) then '있음' else '없음 — 0003_approved_teacher.sql 을 돌리세요' end

union all
select
  '승인된 강사 수',
  -- approved 컬럼이 없을 수도 있다 (0003 을 안 돌린 경우). 그런데 그게 바로
  -- 이 점검이 찾으려는 상황이라, 컬럼을 직접 쓰면 점검 자체가 터져 아무것도
  -- 못 보여준다. to_jsonb 로 읽으면 컬럼이 없어도 그냥 null 이다.
  coalesce((
    select count(*) filter (where (to_jsonb(t) ->> 'approved')::boolean)
           || ' 명 / 전체 ' || count(*) || ' 명'
    from public.teachers t
  ), '테이블을 읽을 수 없습니다')

union all
select
  '내 역할',
  current_user;

-- Data API(PostgREST)는 스키마를 캐시한다. 함수를 drop/create 한 직후에는
-- 캐시가 옛것이라 실제로는 있는 함수가 404 로 보일 수 있다. 캐시를 새로 읽게 한다.
notify pgrst, 'reload schema';
