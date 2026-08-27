-- RLS 회귀 테스트.
-- RLS 는 깨져도 조용하다 — 화면은 멀쩡한데 남의 데이터가 보인다. 그래서 테스트한다.
--
-- ▶ Neon 콘솔에서 (가장 쉬움)
--     SQL Editor 에 이 파일 전체를 붙여넣고 Run.
--     결과 표의 result 열이 전부 PASS 여야 한다.
--
-- ▶ psql 로
--     psql "$NEON_DATABASE_URL" -f db/tests/rls_test.sql
--
-- ▶ Neon 없이 맨 Postgres 로 (스텁 사용)
--     psql ... -f db/tests/_neon_stubs.sql
--     psql ... -f db/migrations/0001_init.sql
--     psql ... -f db/tests/rls_test.sql
--
-- 마지막 ROLLBACK 때문에 테스트 데이터는 남지 않는다.

begin;

-- 임시 테이블이 아니라 일반 테이블로 만든다. 트랜잭션 안에서 만들었으므로
-- 마지막 ROLLBACK 과 함께 사라진다. temp 테이블로 하면 set role 뒤에
-- 쓸 수 없어서(권한 없음) 결과를 기록하지 못한다.
create table _rls_result (n serial, result text, check_name text, detail text);
grant insert on _rls_result to authenticated, anonymous;
grant usage, select on sequence _rls_result_n_seq to authenticated, anonymous;

-- 강사 두 명. Neon Auth 의 사용자 id 는 text 다.
insert into public.teachers (id, name) values
  ('user_aaaaaaaaaaaaaaaaaaaa', '강사A'),
  ('user_bbbbbbbbbbbbbbbbbbbb', '강사B');

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

do $$
declare
  n int; ok bool; who text;
begin
  -- ---------- 강사 A ----------
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"user_aaaaaaaaaaaaaaaaaaaa"}', true);

  select auth.user_id() into who;
  insert into _rls_result (result, check_name, detail) values (
    case when who = 'user_aaaaaaaaaaaaaaaaaaaa' then 'PASS' else 'FAIL' end,
    'auth.user_id() 가 JWT 의 sub 를 돌려준다', coalesce(who, '(null)'));

  select count(*) into n from public.items;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 1 then 'PASS' else 'FAIL' end, 'A 는 자기 items 만 본다', '기대 1, 실제 ' || n);

  select count(*) into n from public.folders;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 1 then 'PASS' else 'FAIL' end, 'A 는 자기 folders 만 본다', '기대 1, 실제 ' || n);

  select count(*) into n from public.segments;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 1 then 'PASS' else 'FAIL' end, 'A 는 자기 segments 만 본다', '기대 1, 실제 ' || n);

  select count(*) into n from public.teachers;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 1 then 'PASS' else 'FAIL' end, 'A 는 자기 teachers 행만 본다', '기대 1, 실제 ' || n);

  -- owner_id 를 안 실어도 default auth.user_id() 가 채운다
  insert into public.items (title) values ('기본값으로 추가');
  select count(*) into n from public.items
    where title = '기본값으로 추가' and owner_id = 'user_aaaaaaaaaaaaaaaaaaaa';
  insert into _rls_result (result, check_name, detail) values (
    case when n = 1 then 'PASS' else 'FAIL' end, 'owner_id 는 default 로 자동 채워진다', '실제 ' || n);

  -- 남의 소유로 삽입 시도
  ok := false;
  begin
    insert into public.items (owner_id, title) values ('user_bbbbbbbbbbbbbbbbbbbb','탈취');
  exception when others then ok := true;
  end;
  insert into _rls_result (result, check_name, detail) values (
    case when ok then 'PASS' else 'FAIL' end, 'A 는 B 소유 items 를 만들 수 없다',
    case when ok then '거부됨' else '허용됨 — 위험' end);

  -- 부모를 통한 소유권 확인
  ok := false;
  begin
    insert into public.segments (item_id, idx, start_sec, end_sec, text)
      values ('b0000000-0000-0000-0000-000000000002',9,0,1,'침입');
  exception when others then ok := true;
  end;
  insert into _rls_result (result, check_name, detail) values (
    case when ok then 'PASS' else 'FAIL' end, 'A 는 B 아이템에 segments 를 붙일 수 없다',
    case when ok then '거부됨' else '허용됨 — 위험' end);

  ok := false;
  begin
    insert into public.students (class_id, name)
      values ('b0000000-0000-0000-0000-000000000003','침입학생');
  exception when others then ok := true;
  end;
  insert into _rls_result (result, check_name, detail) values (
    case when ok then 'PASS' else 'FAIL' end, 'A 는 B 반에 학생을 넣을 수 없다',
    case when ok then '거부됨' else '허용됨 — 위험' end);

  -- 남의 행 수정/삭제는 에러가 아니라 0건이다
  update public.items set title='탈취' where id='b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 0 then 'PASS' else 'FAIL' end, 'A 의 B 아이템 UPDATE 는 0건', '실제 ' || n);

  delete from public.items where id='b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 0 then 'PASS' else 'FAIL' end, 'A 의 B 아이템 DELETE 는 0건', '실제 ' || n);

  -- ---------- 학생(anonymous) ----------
  -- 권한 자체를 주지 않았으므로 테이블 접근이 막혀야 한다.
  set local role anonymous;
  perform set_config('request.jwt.claims', '', true);

  ok := false;
  begin select count(*) into n from public.items;
  exception when insufficient_privilege then ok := true; end;
  insert into _rls_result (result, check_name, detail) values (
    case when ok then 'PASS' else 'FAIL' end, 'anonymous 는 items 에 접근조차 못 한다',
    case when ok then '권한 거부' else '접근됨 — 위험' end);

  ok := false;
  begin select count(*) into n from public.classes;
  exception when insufficient_privilege then ok := true; end;
  insert into _rls_result (result, check_name, detail) values (
    case when ok then 'PASS' else 'FAIL' end, 'anonymous 는 classes 에 접근조차 못 한다',
    case when ok then '권한 거부' else '접근됨 — 위험' end);

  ok := false;
  begin select count(*) into n from public.students;
  exception when insufficient_privilege then ok := true; end;
  insert into _rls_result (result, check_name, detail) values (
    case when ok then 'PASS' else 'FAIL' end, 'anonymous 는 students 에 접근조차 못 한다',
    case when ok then '권한 거부' else '접근됨 — 위험' end);

  -- ---------- 신원 없는 authenticated ----------
  -- 토큰이 없으면 auth.user_id() 가 null 이고, null = null 은 참이 아니므로
  -- 어떤 행도 보이지 않아야 한다.
  set local role authenticated;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.items;
  insert into _rls_result (result, check_name, detail) values (
    case when n = 0 then 'PASS' else 'FAIL' end, '토큰 없는 authenticated 는 아무것도 못 본다', '실제 ' || n);

  reset role;

  -- ---------- 반 코드 ----------
  select count(*) into n from generate_series(1,2000) g
    where public.gen_class_code() ~ '[01OIL]';
  insert into _rls_result (result, check_name, detail) values (
    case when n = 0 then 'PASS' else 'FAIL' end,
    '반 코드에 혼동문자(0 O I L 1) 없음', '2000회 중 ' || n || '건');
end $$;

-- 결과. result 열이 전부 PASS 여야 한다.
select
  case when result = 'PASS' then '✅' else '❌' end as " ",
  result as "결과", check_name as "검사 항목", detail as "상세"
from _rls_result order by n;

-- 요약 한 줄
select
  count(*) filter (where result = 'PASS') || ' PASS / ' ||
  count(*) filter (where result = 'FAIL') || ' FAIL' as "요약",
  case when count(*) filter (where result = 'FAIL') = 0
    then '통과 — 다음 단계로 진행하세요'
    else '실패한 항목이 있습니다. 진행하지 말고 알려주세요.' end as "판정"
from _rls_result;

rollback;
