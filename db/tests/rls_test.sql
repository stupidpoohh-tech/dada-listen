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
  n int; ok bool; stole bool; who text; expr text;
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

-- 10~13. 승인 컬럼은 일반 사용자가 건드릴 수 없다 (0005)
--
-- 여기가 P0 였다. teachers_self 정책은 "내 행인가"만 보고 "어떤 컬럼인가"는 보지
-- 않아서, 테이블 단위 권한이 있는 한 누구나 자기 approved 를 true 로 바꿀 수
-- 있었다. 그러면 Worker 의 업로드·전사(유료) 통제가 통째로 뚫린다.
--
-- has_column_privilege 는 **테이블 단위 권한이 있으면 true 를 돌려준다.** 그래서
-- 이 한 줄이 "컬럼 권한이 빠졌다"와 "테이블 권한이 되살아났다"를 동시에 잡는다.
insert into _rls_result (phase, result, check_name, detail) values (
  '정적',
  case when not has_column_privilege('authenticated','public.teachers','approved','update')
       then 'PASS' else 'FAIL' end,
  'authenticated 는 teachers.approved 를 UPDATE 할 수 없다',
  case when has_column_privilege('authenticated','public.teachers','approved','update')
       then '가능함 — 스스로 승인 가능, P0' else '권한 없음' end);

insert into _rls_result (phase, result, check_name, detail) values (
  '정적',
  case when not has_column_privilege('authenticated','public.teachers','approved','insert')
       then 'PASS' else 'FAIL' end,
  'authenticated 는 teachers.approved 를 INSERT 할 수 없다',
  case when has_column_privilege('authenticated','public.teachers','approved','insert')
       then '가능함 — 승인된 채로 가입 가능, P0' else '권한 없음' end);

-- 반대 방향도 지킨다. 너무 걷어내서 프로필을 못 만들면 로그인 자체가 막힌다.
insert into _rls_result (phase, result, check_name, detail) values (
  '정적',
  case when has_column_privilege('authenticated','public.teachers','name','insert')
        and has_column_privilege('authenticated','public.teachers','name','update')
       then 'PASS' else 'FAIL' end,
  'authenticated 는 자기 이름은 만들고 고칠 수 있다',
  'insert '||has_column_privilege('authenticated','public.teachers','name','insert')||
  ' / update '||has_column_privilege('authenticated','public.teachers','name','update'));

select count(*) into n from pg_trigger
  where tgrelid = 'public.teachers'::regclass and tgname = 'teachers_guard_approved'
    and not tgisinternal;
insert into _rls_result (phase, result, check_name, detail) values (
  '정적', case when n = 1 then 'PASS' else 'FAIL' end,
  'approved 를 지키는 트리거가 걸려 있다',
  case when n = 1 then '있음 (테이블 권한이 되살아나도 막는다)'
       else '없음 — 0001 재실행 시 무방비' end);


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

  -- =================================================================
  -- 승인 우회 (P0, 0005) — 실제 역할로 세 가지 경로를 모두 시험한다
  -- =================================================================
  reset role;
  delete from public.teachers where id like 'user_appr%';
  insert into public.teachers (id, name) values ('user_appr_victim','미승인강사');

  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"user_appr_victim"}', true);

  -- (a) 자기 approved 를 직접 올린다
  ok := false;
  begin
    update public.teachers set approved = true where id = auth.user_id();
  exception when others then ok := true; end;
  select coalesce(bool_or(approved), false) into stole
    from public.teachers where id = 'user_appr_victim';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and not stole then 'PASS' else 'FAIL' end,
    '미승인 강사가 자기 approved 를 UPDATE 로 못 올린다',
    case when stole then '승인 탈취됨 — P0' else '거부됨' end);

  -- (b) 처음부터 승인된 채로 가입한다
  reset role;
  delete from public.teachers where id = 'user_appr_new';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"user_appr_new"}', true);
  ok := false;
  begin
    insert into public.teachers (name, approved) values ('새강사', true);
  exception when others then ok := true; end;
  select coalesce(bool_or(approved), false) into stole
    from public.teachers where id = 'user_appr_new';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and not stole then 'PASS' else 'FAIL' end,
    '승인된 채로 프로필을 만들 수 없다',
    case when stole then '승인된 채 생성됨 — P0' else '거부됨' end);

  -- (c) upsert(ON CONFLICT DO UPDATE) 로 훔친다 — 앱이 실제로 쓰는 모양
  reset role;
  delete from public.teachers where id = 'user_appr_up';
  insert into public.teachers (id, name) values ('user_appr_up','업서트강사');
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"user_appr_up"}', true);
  ok := false;
  begin
    insert into public.teachers (id, name, approved) values (auth.user_id(),'업서트강사', true)
      on conflict (id) do update set name = excluded.name, approved = excluded.approved;
  exception when others then ok := true; end;
  select coalesce(bool_or(approved), false) into stole
    from public.teachers where id = 'user_appr_up';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and not stole then 'PASS' else 'FAIL' end,
    'upsert 로도 승인을 훔칠 수 없다',
    case when stole then '승인 탈취됨 — P0' else '거부됨' end);

  -- 정상 경로는 그대로 된다: 프로필 생성 + 이름 변경
  reset role;
  delete from public.teachers where id = 'user_appr_ok';
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"user_appr_ok"}', true);
  ok := true;
  begin
    insert into public.teachers (name) values ('정상강사');
    update public.teachers set name = '이름바꿈' where id = auth.user_id();
  exception when others then ok := false; end;
  select count(*) into n from public.teachers
    where id = 'user_appr_ok' and name = '이름바꿈' and approved = false;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and n = 1 then 'PASS' else 'FAIL' end,
    '일반 강사는 자기 프로필을 만들고 이름을 고칠 수 있다',
    case when ok and n = 1 then '생성·수정 성공, approved 는 false 유지'
         else '막힘 — 로그인이 깨진다' end);

  -- 남의 프로필은 못 고친다 (RLS 가 행을 숨긴다)
  update public.teachers set name = '탈취' where id = 'user_appr_victim';
  select count(*) into n from public.teachers
    where id = 'user_appr_victim' and name = '탈취';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when n = 0 then 'PASS' else 'FAIL' end,
    '다른 강사의 프로필은 고칠 수 없다',
    case when n = 0 then '변경 0건' else '변경됨 — 위험' end);

  -- 관리자(소유자)는 승인·승인취소를 할 수 있다
  reset role;
  ok := true;
  begin
    perform public.admin_set_teacher_approval('user_appr_victim', true);
  exception when others then ok := false; end;
  select coalesce(bool_or(approved), false) into stole
    from public.teachers where id = 'user_appr_victim';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and stole then 'PASS' else 'FAIL' end,
    '관리자는 강사를 승인할 수 있다',
    case when ok and stole then '승인됨' else '승인 실패 — 운영이 막힌다' end);

  -- 승인된 강사가 재로그인해도(= ensureTeacher 의 upsert) 승인이 유지된다
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"user_appr_victim"}', true);
  ok := true;
  begin
    -- PostgREST 의 merge-duplicates upsert 가 만드는 SQL 과 같은 모양
    insert into public.teachers (name) values ('재로그인이름')
      on conflict (id) do update set name = excluded.name;
  exception when others then ok := false; end;
  reset role;
  select count(*) into n from public.teachers
    where id = 'user_appr_victim' and name = '재로그인이름' and approved;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and n = 1 then 'PASS' else 'FAIL' end,
    '승인된 강사는 재로그인해도 승인이 유지된다',
    case when ok and n = 1 then '이름 갱신 + 승인 유지'
         else '승인이 풀렸거나 upsert 가 막혔다' end);

  -- 관리자는 승인을 취소할 수도 있다
  ok := true;
  begin
    perform public.admin_set_teacher_approval('user_appr_victim', false);
  exception when others then ok := false; end;
  select coalesce(bool_or(approved), true) into stole
    from public.teachers where id = 'user_appr_victim';
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok and not stole then 'PASS' else 'FAIL' end,
    '관리자는 승인을 취소할 수 있다',
    case when ok and not stole then '승인 취소됨' else '취소 실패' end);

  -- 관리자 함수는 id 없이 전원 승인하는 사고를 막는다 (0003 에서 실제로 겪었다)
  ok := false;
  begin
    perform public.admin_set_teacher_approval('', true);
  exception when others then ok := true; end;
  insert into _rls_result (phase, result, check_name, detail) values (
    '동작', case when ok then 'PASS' else 'FAIL' end,
    '관리자 함수는 빈 id 로 전원 승인을 거부한다',
    case when ok then '거부됨' else '통과됨 — 전원 승인 사고 위험' end);

  set local role authenticated;

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
