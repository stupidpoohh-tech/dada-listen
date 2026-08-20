-- RLS 회귀 테스트.
-- RLS 는 깨져도 조용하다 — 화면은 멀쩡한데 남의 데이터가 보인다. 그래서 테스트한다.
--
-- 로컬 Supabase 에 대고 실행:
--     supabase start
--     psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/tests/rls_test.sql
--
-- Supabase 없이 맨 Postgres 에서 실행 (스텁 사용):
--     psql ... -f supabase/tests/_supabase_stubs.sql
--     psql ... -f supabase/migrations/0001_init.sql
--     psql ... -f supabase/tests/rls_test.sql
--
-- 모든 줄이 PASS 여야 한다.

begin;

grant usage on schema public to anon, authenticated;
grant all    on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;

-- 강사 두 명. teachers 행은 on_auth_user_created 트리거가 만든다.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','a@example.com'),
  ('22222222-2222-2222-2222-222222222222','b@example.com');

insert into public.folders (id, owner_id, name) values
  ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','A폴더'),
  ('b0000000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','B폴더');
insert into public.items (id, owner_id, folder_id, title) values
  ('a0000000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','A음원'),
  ('b0000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','b0000000-0000-0000-0000-000000000001','B음원');
insert into public.segments (item_id, idx, start_sec, end_sec, text) values
  ('a0000000-0000-0000-0000-000000000002',0,0,3,'A sentence.'),
  ('b0000000-0000-0000-0000-000000000002',0,0,3,'B sentence.');
insert into public.classes (id, owner_id, name, code) values
  ('a0000000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','A반','AAA111'),
  ('b0000000-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222','B반','BBB222');

do $$
declare n int; ok bool;
begin
  -- ---------- 강사 A ----------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);

  select count(*) into n from public.items;
  raise notice '% A 는 자기 items 만 본다 (기대 1, 실제 %)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  select count(*) into n from public.folders;
  raise notice '% A 는 자기 folders 만 본다 (기대 1, 실제 %)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  select count(*) into n from public.segments;
  raise notice '% A 는 자기 segments 만 본다 (기대 1, 실제 %)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  select count(*) into n from public.teachers;
  raise notice '% A 는 자기 teachers 행만 본다 (기대 1, 실제 %)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- 남의 소유로 삽입 시도
  ok := false;
  begin
    insert into public.items (owner_id, title)
      values ('22222222-2222-2222-2222-222222222222','탈취');
  exception when others then ok := true;
  end;
  raise notice '% A 는 B 소유 items 를 만들 수 없다', case when ok then 'PASS' else 'FAIL' end;

  -- 부모를 통한 소유권 확인 (남의 아이템에 세그먼트 붙이기)
  ok := false;
  begin
    insert into public.segments (item_id, idx, start_sec, end_sec, text)
      values ('b0000000-0000-0000-0000-000000000002',9,0,1,'침입');
  exception when others then ok := true;
  end;
  raise notice '% A 는 B 아이템에 segments 를 붙일 수 없다', case when ok then 'PASS' else 'FAIL' end;

  ok := false;
  begin
    insert into public.students (class_id, name)
      values ('b0000000-0000-0000-0000-000000000003','침입학생');
  exception when others then ok := true;
  end;
  raise notice '% A 는 B 반에 학생을 넣을 수 없다', case when ok then 'PASS' else 'FAIL' end;

  -- 남의 행 수정/삭제는 에러가 아니라 0건이다
  update public.items set title='탈취' where id='b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  raise notice '% A 의 B 아이템 UPDATE 는 0건 (실제 %)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  delete from public.items where id='b0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  raise notice '% A 의 B 아이템 DELETE 는 0건 (실제 %)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;

  -- 자기 것은 되어야 한다
  insert into public.items (owner_id, title)
    values ('11111111-1111-1111-1111-111111111111','정상추가');
  get diagnostics n = row_count;
  raise notice '% A 는 자기 소유 items 를 만들 수 있다 (실제 %)',
    case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- ---------- 학생(anon) ----------
  -- 정책이 없으므로 기본 거부. 학생 접근은 반 코드 RPC 로만 연다.
  set local role anon;
  perform set_config('request.jwt.claim.sub','', true);

  select count(*) into n from public.items;
  raise notice '% anon 은 items 를 못 본다 (실제 %)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  select count(*) into n from public.classes;
  raise notice '% anon 은 classes 를 못 본다 (실제 %)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  select count(*) into n from public.students;
  raise notice '% anon 은 students 를 못 본다 (실제 %)', case when n = 0 then 'PASS' else 'FAIL' end, n;
  select count(*) into n from public.segments;
  raise notice '% anon 은 segments 를 못 본다 (실제 %)', case when n = 0 then 'PASS' else 'FAIL' end, n;

  reset role;

  -- ---------- 반 코드 ----------
  select count(*) into n from generate_series(1,2000) g
    where public.gen_class_code() ~ '[01OIL]';
  raise notice '% 반 코드에 혼동문자(0 O I L 1) 없음 (2000회 중 % 건)',
    case when n = 0 then 'PASS' else 'FAIL' end, n;
end $$;

rollback;
