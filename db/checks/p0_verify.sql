-- p0_verify — 승인 우회(P0) 차단이 실제로 걸려 있는지 확인한다
--
-- **읽기 전용이다.** SELECT 만 한다. 테이블도 역할도 건드리지 않고, 트랜잭션도
-- 필요 없다. 그래서 운영 DB 에 그대로 돌려도 된다.
--
--   ⚠️ db/tests/rls_test.sql 은 운영에 돌리지 말 것.
--      그쪽은 teachers·items·classes 에 실제로 INSERT/DELETE 하고
--      (`delete from public.teachers where id like 'user_appr%'` 포함)
--      연결 역할에 authenticated 를 부여한다. ROLLBACK 으로 되돌긴 하지만
--      운영 테이블에 쓰기와 잠금이 실제로 일어난다. 격리된 Neon 브랜치에서만.
--
-- 사용법
--   psql "$NEON_DATABASE_URL" -X -f db/checks/p0_verify.sql
--   또는 Neon SQL Editor 에 통째로 붙여넣기
--
-- **문장이 하나다.** 웹 SQL Editor 는 여러 문장을 넣으면 마지막 결과만 보여줄
-- 수 있어서, 검사표가 통째로 안 보이는 일이 없도록 하나로 합쳐 두었다.
-- 승인 계정 수는 db/checks/approved_audit.sql 에서 본다.
--
-- 판정: "결과" 열에 FAIL 이 하나도 없어야 한다.
--       "확인불가" 는 통과가 아니다 — 무엇이 없는지 상세를 보고 해결한다.

with ctx as (
  select
    to_regclass('public.teachers')                                        as t_oid,
    to_regrole('authenticated')                                           as auth_oid,
    to_regrole('anonymous')                                               as anon_oid,
    to_regprocedure('public.admin_set_teacher_approval(text,boolean)')    as admin_fn,
    to_regprocedure('public.whoami()')                                    as whoami_fn
),
r(sort_key, 구분, 항목, 결과, 상세) as (

  -- ── 맥락 ────────────────────────────────────────────────────────────
  select 0, '맥락', '접속 역할 / teachers 소유자', 'INFO',
         current_user || ' / ' ||
         coalesce((select c.relowner::regrole::text from pg_class c, ctx
                   where c.oid = ctx.t_oid), '테이블 없음')
  from ctx

  -- ── 역할 자체가 우회 수단이 아닌지 ──────────────────────────────────
  union all
  select 1, '역할', 'authenticated 는 superuser/bypassrls 가 아니다',
         case when ctx.auth_oid is null then '확인불가'
              when not p.rolsuper and not p.rolbypassrls then 'PASS' else 'FAIL' end,
         case when ctx.auth_oid is null then 'authenticated 역할이 없음 (Data API 미설정?)'
              else 'superuser=' || p.rolsuper || ' bypassrls=' || p.rolbypassrls end
  from ctx left join pg_roles p on p.oid = ctx.auth_oid

  union all
  select 2, '역할', 'authenticated 가 상속하는 역할', 'INFO',
         coalesce((select string_agg(g.rolname, ', ')
                   from pg_auth_members m
                   join pg_roles g on g.oid = m.roleid, ctx
                   where m.member = ctx.auth_oid), '없음 (상속 없음)')
  from ctx

  -- ── 핵심: approved 를 쓸 수 있는가 ──────────────────────────────────
  -- has_column_privilege 는 테이블 단위 권한·역할 상속·PUBLIC 을 모두 반영한다.
  -- 그래서 이 한 줄이 "컬럼 권한이 빠졌다"와 "테이블 권한이 되살아났다"를
  -- 동시에 잡는다.
  union all
  select 10, '승인보호', 'authenticated 는 teachers.approved 를 UPDATE 할 수 없다',
         case when ctx.t_oid is null or ctx.auth_oid is null then '확인불가'
              when has_column_privilege('authenticated', ctx.t_oid, 'approved', 'update')
                then 'FAIL' else 'PASS' end,
         case when ctx.t_oid is null or ctx.auth_oid is null then '테이블/역할 없음'
              when has_column_privilege('authenticated', ctx.t_oid, 'approved', 'update')
                then '가능함 — 스스로 승인 가능. 0005 미적용 또는 되돌아감'
              else '권한 없음' end
  from ctx

  union all
  select 11, '승인보호', 'authenticated 는 teachers.approved 를 INSERT 할 수 없다',
         case when ctx.t_oid is null or ctx.auth_oid is null then '확인불가'
              when has_column_privilege('authenticated', ctx.t_oid, 'approved', 'insert')
                then 'FAIL' else 'PASS' end,
         case when ctx.t_oid is null or ctx.auth_oid is null then '테이블/역할 없음'
              when has_column_privilege('authenticated', ctx.t_oid, 'approved', 'insert')
                then '가능함 — 승인된 채로 가입 가능'
              else '권한 없음' end
  from ctx

  union all
  select 12, '승인보호', 'authenticated 는 teachers 테이블 단위 INSERT/UPDATE 가 없다',
         case when ctx.t_oid is null or ctx.auth_oid is null then '확인불가'
              when has_table_privilege('authenticated', ctx.t_oid, 'insert')
                or has_table_privilege('authenticated', ctx.t_oid, 'update')
                then 'FAIL' else 'PASS' end,
         'insert=' || coalesce(has_table_privilege('authenticated', ctx.t_oid, 'insert')::text,'?') ||
         ' update=' || coalesce(has_table_privilege('authenticated', ctx.t_oid, 'update')::text,'?') ||
         ' (테이블 단위가 남아 있으면 컬럼 권한은 검사조차 되지 않는다)'
  from ctx

  union all
  select 13, '승인보호', 'PUBLIC 에 teachers 쓰기 권한이 없다',
         case when ctx.t_oid is null then '확인불가'
              when has_table_privilege('public', ctx.t_oid, 'insert')
                or has_table_privilege('public', ctx.t_oid, 'update')
                or has_column_privilege('public', ctx.t_oid, 'approved', 'update')
                then 'FAIL' else 'PASS' end,
         case when ctx.t_oid is null then '테이블 없음' else 'PUBLIC 쓰기 없음' end
  from ctx

  union all
  select 14, '승인보호', 'anonymous(학생) 은 teachers 에 접근할 수 없다',
         case when ctx.t_oid is null then '확인불가'
              when ctx.anon_oid is null then '확인불가'
              when has_table_privilege('anonymous', ctx.t_oid, 'select')
                or has_table_privilege('anonymous', ctx.t_oid, 'insert')
                or has_table_privilege('anonymous', ctx.t_oid, 'update')
                then 'FAIL' else 'PASS' end,
         case when ctx.anon_oid is null then 'anonymous 역할 없음' else '접근 없음' end
  from ctx

  -- ── 정상 경로가 살아 있는지 (과잉 회수 방지) ────────────────────────
  union all
  select 20, '정상경로', 'authenticated 는 자기 이름을 만들고 고칠 수 있다',
         case when ctx.t_oid is null or ctx.auth_oid is null then '확인불가'
              when has_column_privilege('authenticated', ctx.t_oid, 'name', 'insert')
               and has_column_privilege('authenticated', ctx.t_oid, 'name', 'update')
                then 'PASS' else 'FAIL' end,
         case when ctx.t_oid is null or ctx.auth_oid is null then '테이블/역할 없음'
              else 'name insert=' || has_column_privilege('authenticated', ctx.t_oid, 'name', 'insert') ||
                   ' update=' || has_column_privilege('authenticated', ctx.t_oid, 'name', 'update') ||
                   ' (false 면 로그인 시 프로필 생성이 깨진다)' end
  from ctx

  union all
  select 21, '정상경로', 'authenticated 는 teachers.id 를 UPDATE 할 수 없다',
         case when ctx.t_oid is null or ctx.auth_oid is null then '확인불가'
              when has_column_privilege('authenticated', ctx.t_oid, 'id', 'update')
                then 'FAIL' else 'PASS' end,
         case when ctx.t_oid is null or ctx.auth_oid is null then '테이블/역할 없음'
              when has_column_privilege('authenticated', ctx.t_oid, 'id', 'update')
                then '가능함 — 테이블 단위 권한이 남아 있다'
              else '권한 없음' end
  from ctx

  -- ── 심층 방어: 트리거 ───────────────────────────────────────────────
  union all
  select 30, '트리거', 'approved 보호 트리거가 있고 켜져 있다',
         case when ctx.t_oid is null then '확인불가'
              when tg.tgname is null then 'FAIL'
              when tg.tgenabled = 'O' then 'PASS' else 'FAIL' end,
         case when ctx.t_oid is null then '테이블 없음'
              when tg.tgname is null
                then '없음 — 0001 재실행으로 테이블 권한이 되살아나면 무방비'
              when tg.tgenabled = 'O' then '있음 · 활성(O)'
              else '있으나 비활성(' || tg.tgenabled::text || ') — 보호되지 않음' end
  from ctx left join pg_trigger tg
    on tg.tgrelid = ctx.t_oid and tg.tgname = 'teachers_guard_approved' and not tg.tgisinternal

  -- ── 관리자 함수 ─────────────────────────────────────────────────────
  union all
  select 40, '관리자', 'admin_set_teacher_approval 이 존재한다',
         case when ctx.admin_fn is null then 'FAIL' else 'PASS' end,
         case when ctx.admin_fn is null then '없음 — 0005 미적용' else '있음' end
  from ctx

  union all
  select 41, '관리자', '일반 사용자는 관리자 승인 함수를 실행할 수 없다',
         case when ctx.admin_fn is null or ctx.auth_oid is null then '확인불가'
              when has_function_privilege('authenticated', ctx.admin_fn, 'execute')
                then 'FAIL' else 'PASS' end,
         case when ctx.admin_fn is null then '함수 없음'
              when has_function_privilege('authenticated', ctx.admin_fn, 'execute')
                then '실행 가능 — PUBLIC 회수가 안 됐다'
              else '실행 불가' end
  from ctx

  union all
  select 42, '관리자', '관리자 함수는 security invoker 다',
         case when ctx.admin_fn is null then '확인불가'
              when p.prosecdef then 'FAIL' else 'PASS' end,
         case when ctx.admin_fn is null then '함수 없음'
              when p.prosecdef
                then 'security definer — execute 를 잘못 주면 권한 상승 통로가 된다'
              else 'invoker (권한을 새로 만들지 않는다)' end
  from ctx left join pg_proc p on p.oid = ctx.admin_fn

  -- ── 기존 보호가 그대로인지 (0004 · RLS) ─────────────────────────────
  union all
  select 50, '기존보호', 'whoami() 는 security definer 이고 jsonb 를 돌려준다',
         case when ctx.whoami_fn is null then 'FAIL'
              when p.prosecdef and p.prorettype = 'jsonb'::regtype then 'PASS'
              else 'FAIL' end,
         case when ctx.whoami_fn is null then '없음 — 0002/0004 확인'
              else 'definer=' || p.prosecdef || ' 반환=' || format_type(p.prorettype, null) end
  from ctx left join pg_proc p on p.oid = ctx.whoami_fn

  union all
  select 51, '기존보호', 'teachers 에 RLS 가 켜져 있고 teachers_self 정책이 있다',
         case when ctx.t_oid is null then '확인불가'
              when c.relrowsecurity and pol.cnt > 0 then 'PASS' else 'FAIL' end,
         case when ctx.t_oid is null then '테이블 없음'
              else 'RLS=' || c.relrowsecurity || ' 정책 ' || pol.cnt || '개' end
  from ctx
  left join pg_class c on c.oid = ctx.t_oid
  left join lateral (select count(*) as cnt from pg_policy p where p.polrelid = ctx.t_oid) pol on true

  -- 테이블이 하나도 없어도 "꺼진 것이 0개"라 PASS 로 보인다. 존재 개수까지
  -- 세지 않으면 빈 DB 가 통과해 버린다 — 실제로 그렇게 나왔다.
  union all
  select 52, '기존보호', '콘텐츠 테이블 10개가 있고 전부 RLS 가 켜져 있다',
         case when cnt.present < 10 then '확인불가'
              when cnt.off = 0 then 'PASS' else 'FAIL' end,
         case when cnt.present < 10
                then cnt.present || '/10 개만 존재 — 마이그레이션이 덜 적용됐다'
              when cnt.off = 0 then '10개 전부 켜짐'
              else cnt.off || '개 꺼짐' end
  from lateral (
    select
      count(*) as present,
      count(*) filter (where not c.relrowsecurity) as off
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('teachers','folders','items','segments','gap_overrides',
                        'classes','students','assignments','attempts','asr_usage')
  ) cnt
)
select 구분, 항목, 결과, 상세 from r order by sort_key;
