-- RLS 회귀 테스트.
-- RLS 는 깨져도 조용하다 — 화면은 멀쩡한데 남의 데이터가 보인다. 그래서 테스트한다.
--
-- ▶ Neon 콘솔에서 (가장 쉬움)
--     SQL Editor 에 이 파일 전체를 붙여넣고 Run.
--     결과 표의 "결과" 열에 FAIL 이 하나도 없어야 한다.
--
-- ▶ psql 로
--     psql "$NEON_DATABASE_URL" -f db/tests/rls_test.sql
--
-- 이 테스트는 두 단계로 나뉜다.
--
--   [정적 검사]  권한과 정책이 의도대로 걸려 있는지 카탈로그에서 확인한다.
--                역할 전환이 필요 없어서 어떤 접속 계정으로도 항상 돈다.
--
--   [동작 검사]  실제로 authenticated / anonymous 역할이 되어 남의 데이터가
--                보이는지 시험한다. SET ROLE 권한이 있어야 하며, 없으면
--                SKIP 으로 표시하고 넘어간다 (에러로 죽지 않는다).
--
-- 마지막 ROLLBACK 때문에 테스트 데이터는 남지 않는다.

begin;

create table _rls_result (n serial, phase text, result text, check_name text, detail text);

do $$
declare
  n int; ok bool; who text; expr text;
  can_switch bool := false;
  t text;
  tables_all constant text[] := array[
    'teachers','folders','items','segments','gap_overrides',
    'classes','students','assignments','attempts','asr_usage'];
begin

-- =====================================================================
-- [정적 검사] 역할 전환 없이 확인할 수 있는 것들
-- =====================================================================

-- 1. 신원 함수가 존재하고 JWT 의 sub 를 돌려준다
perform set_config('request.jwt.claims', '{"sub":"user_probe"}', true);
begin
  select auth.user_id() into who;
  insert into _rls_result (phase, result, check_name, detail) values (
    '정적', case when who = 'user_probe' then 'PASS' else 'FAIL' end,
    'auth.user_id() 가 JWT 의 sub 를 돌려준다', coalesce(who,'(null)'));
exception when others then
  insert into _rls_result (phase, result, check_name, detail) values (
    '정적','FAIL','auth.user_id() 가 JWT 의 sub 를 돌려준다','함수 없음: '||sqlerrm);
end;

-- 2. 모든 콘텐츠 테이블에 RLS 가 켜져 있다
select count(*) into n from pg_tables t
  where t.schemaname='public' and t.tablename = any(tables_all) and not t.rowsecurity;
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  '모든 콘텐츠 테이블에 RLS 가 켜져 있다',
  case when n = 0 then array_length(tables_all,1)||'개 전부 켜짐'
       else n||'개가 꺼져 있음 — 위험' end);

-- 3. anonymous 는 어떤 테이블에도 권한이 없다  ← 학생 차단의 핵심
n := 0;
foreach t in array tables_all loop
  if has_table_privilege('anonymous','public.'||t,'select')
     or has_table_privilege('anonymous','public.'||t,'insert')
     or has_table_privilege('anonymous','public.'||t,'update')
     or has_table_privilege('anonymous','public.'||t,'delete') then
    n := n + 1;
  end if;
end loop;
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  'anonymous 는 어떤 테이블에도 권한이 없다',
  case when n = 0 then '전부 차단됨' else n||'개 테이블에 권한 있음 — 위험' end);

-- 4. authenticated 는 테이블 권한을 갖는다 (RLS 가 그 위에서 좁힌다)
select count(*) into n from unnest(tables_all) x(t)
  where not has_table_privilege('authenticated','public.'||x.t,'select');
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  'authenticated 는 테이블 select 권한을 갖는다',
  case when n = 0 then '전부 부여됨' else n||'개 누락' end);

-- 5. 전역 공개 정책(using true)이 없다
select count(*) into n from pg_policies p
  where p.schemaname='public'
    and (coalesce(p.qual,'') = 'true' or coalesce(p.with_check,'') = 'true');
select string_agg(p.tablename||'.'||p.policyname, ', ') into expr from pg_policies p
  where p.schemaname='public'
    and (coalesce(p.qual,'') = 'true' or coalesce(p.with_check,'') = 'true');
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  'using(true) 같은 전역 공개 정책이 없다',
  case when n = 0 then '없음' else '있음 — 위험: '||expr end);

-- 6. 모든 정책이 authenticated 에게만 걸려 있다
select count(*) into n from pg_policies p
  where p.schemaname='public' and not (p.roles @> array['authenticated']::name[]);
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  '모든 정책이 authenticated 대상이다',
  case when n = 0 then (select count(*)||'개 정책 전부' from pg_policies where schemaname='public')
       else n||'개가 다른 역할 포함 — 확인 필요' end);

-- 7. 소유권 있는 테이블의 정책이 auth.user_id() 를 참조한다
select count(*) into n from pg_policies p
  where p.schemaname='public'
    and p.tablename in ('items','folders','classes','segments','students')
    and coalesce(p.qual,'') not like '%user_id%';
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  '소유권 정책이 auth.user_id() 로 좁힌다',
  case when n = 0 then '전부 참조함' else n||'개가 참조하지 않음 — 위험' end);

-- 8. owner_id 에 default auth.user_id() 가 걸려 있다
select count(*) into n from information_schema.columns c
  where c.table_schema='public' and c.column_name='owner_id'
    and coalesce(c.column_default,'') not like '%user_id%';
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  'owner_id 는 default auth.user_id() 로 채워진다',
  case when n = 0 then '전부 설정됨' else n||'개 누락 — 클라이언트가 소유자를 주장하게 됨' end);

-- 9. 반 코드에 혼동문자가 없다
select count(*) into n from generate_series(1,2000) g
  where public.gen_class_code() ~ '[01OIL]';
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 0 then 'PASS' else 'FAIL' end,
  '반 코드에 혼동문자(0 O I L 1) 없음', '2000회 중 '||n||'건');


-- =====================================================================
-- [동작 검사] 실제 역할이 되어 확인한다
-- =====================================================================

-- 역할 전환이 가능한지 본다. 멤버십이 없으면 한 번 얻어본다
-- (트랜잭션 안이라 ROLLBACK 과 함께 되돌아간다).
if not pg_has_role(current_user,'authenticated','MEMBER') then
  begin
    execute format('grant authenticated, anonymous to %I', current_user);
  exception when others then null;
  end;
end if;

begin
  set local role authenticated;
  reset role;
  can_switch := true;
exception when others then
  can_switch := false;
end;

if not can_switch then
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작','SKIP','실제 역할로 남의 데이터가 보이는지 시험',
    current_user||' 로는 SET ROLE 이 안 됩니다. 위 정적 검사는 모두 유효합니다. '
    '전체를 돌리려면 슈퍼유저 권한이 있는 접속으로 실행하세요.');
else
  grant insert on _rls_result to authenticated, anonymous;
  grant usage, select on sequence _rls_result_n_seq to authenticated, anonymous;

  insert into public.teachers (id, name) values
    ('user_aaaaaaaaaaaaaaaaaaaa','강사A'), ('user_bbbbbbbbbbbbbbbbbbbb','강사B');
  insert into public.folders (id, owner_id, name) values
    ('a0000000-0000-0000-0000-000000000001','user_aaaaaaaaaaaaaaaaaaaa','A폴더'),
    ('b0000000-0000-0000-0000-000000000001','user_bbbbbbbbbbbbbbbbbbbb','B폴더');
  insert into public.items (id, owner_id, folder_id, title) values
    ('a0000000-0000-0000-0000-000000000002','user_aaaaaaaaaaaaaaaaaaaa','a0000000-0000-0000-0000-000000000001','A음원'),
    ('b0000000-0000-0000-0000-000000000002','user_bbbbbbbbbbbbbbbbbbbb','b0000000-0000-0000-0000-000000000001','B음원');
  insert into public.segments (item_id, idx, start_sec, end_sec, text) values
    ('a0000000-0000-0000-0000-000000000002',0,0,3,'A sentence.'),
    ('b0000000-0000-0000-0000-000000000002',0,0,3,'B sentence.');
  insert into public.classes (id, owner_id, name, code) values
    ('a0000000-0000-0000-0000-000000000003','user_aaaaaaaaaaaaaaaaaaaa','A반','AAA111'),
    ('b0000000-0000-0000-0000-000000000003','user_bbbbbbbbbbbbbbbbbbbb','B반','BBB222');

  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"user_aaaaaaaaaaaaaaaaaaaa"}', true);

  select count(*) into n from public.items;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=1 then 'PASS' else 'FAIL' end, 'A 는 자기 items 만 본다','기대 1, 실제 '||n);

  select count(*) into n from public.folders;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=1 then 'PASS' else 'FAIL' end, 'A 는 자기 folders 만 본다','기대 1, 실제 '||n);

  select count(*) into n from public.segments;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=1 then 'PASS' else 'FAIL' end, 'A 는 자기 segments 만 본다','기대 1, 실제 '||n);

  insert into public.items (title) values ('기본값으로 추가');
  select count(*) into n from public.items
    where title='기본값으로 추가' and owner_id='user_aaaaaaaaaaaaaaaaaaaa';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=1 then 'PASS' else 'FAIL' end, 'owner_id 가 실제로 자동 채워진다','실제 '||n);

  ok := false;
  begin insert into public.items (owner_id,title) values ('user_bbbbbbbbbbbbbbbbbbbb','탈취');
  exception when others then ok := true; end;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok then 'PASS' else 'FAIL' end,'A 는 B 소유 items 를 만들 수 없다',
    case when ok then '거부됨' else '허용됨 — 위험' end);

  ok := false;
  begin insert into public.segments (item_id,idx,start_sec,end_sec,text)
        values ('b0000000-0000-0000-0000-000000000002',9,0,1,'침입');
  exception when others then ok := true; end;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok then 'PASS' else 'FAIL' end,'A 는 B 아이템에 segments 를 붙일 수 없다',
    case when ok then '거부됨' else '허용됨 — 위험' end);

  ok := false;
  begin insert into public.students (class_id,name)
        values ('b0000000-0000-0000-0000-000000000003','침입학생');
  exception when others then ok := true; end;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok then 'PASS' else 'FAIL' end,'A 는 B 반에 학생을 넣을 수 없다',
    case when ok then '거부됨' else '허용됨 — 위험' end);

  update public.items set title='탈취' where id='b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=0 then 'PASS' else 'FAIL' end,'A 의 B 아이템 UPDATE 는 0건','실제 '||n);

  delete from public.items where id='b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=0 then 'PASS' else 'FAIL' end,'A 의 B 아이템 DELETE 는 0건','실제 '||n);

  -- 토큰 없는 authenticated 는 아무것도 못 본다
  perform set_config('request.jwt.claims','', true);
  select count(*) into n from public.items;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n=0 then 'PASS' else 'FAIL' end,'토큰 없는 authenticated 는 아무것도 못 본다','실제 '||n);

  -- 학생(anonymous) 은 접근조차 안 된다
  set local role anonymous;
  ok := false;
  begin select count(*) into n from public.items;
  exception when insufficient_privilege then ok := true; end;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok then 'PASS' else 'FAIL' end,'anonymous 는 items 에 접근조차 못 한다',
    case when ok then '권한 거부' else '접근됨 — 위험' end);

  ok := false;
  begin select count(*) into n from public.classes;
  exception when insufficient_privilege then ok := true; end;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok then 'PASS' else 'FAIL' end,'anonymous 는 classes 에 접근조차 못 한다',
    case when ok then '권한 거부' else '접근됨 — 위험' end);

  reset role;
end if;

end $$;

-- 결과
select
  case result when 'PASS' then '✅' when 'FAIL' then '❌' else '⏭️' end as " ",
  phase as "단계", result as "결과", check_name as "검사 항목", detail as "상세"
from _rls_result order by n;

-- 요약
select
  count(*) filter (where result='PASS')||' PASS / '||
  count(*) filter (where result='FAIL')||' FAIL / '||
  count(*) filter (where result='SKIP')||' SKIP' as "요약",
  case when count(*) filter (where result='FAIL') = 0
    then '통과 — 다음 단계로 진행하세요'
    else '실패한 항목이 있습니다. 진행하지 말고 알려주세요.' end as "판정"
from _rls_result;

rollback;
