-- 0005_teachers_approval_privileges — 강사가 스스로를 승인하지 못하게 막는다
--
-- 무엇이 뚫려 있었나 (P0)
--   0001 은 `grant select, insert, update, delete on all tables ... to authenticated`
--   로 **테이블 단위** 권한을 줬고, teachers_self 정책은 "그 행이 내 행인가"만 볼 뿐
--   "어떤 컬럼을 건드리는가"는 보지 않는다. 0003 이 approved 를 그 테이블에 얹으면서,
--   일반 사용자가 자기 행의 approved 를 마음대로 true 로 바꿀 수 있게 됐다.
--
--   격리된 DB 에서 실제로 세 경로 모두 성공하는 것을 확인했다:
--     (a) update public.teachers set approved = true where id = auth.user_id()
--     (b) insert into public.teachers (name, approved) values ('x', true)
--     (c) insert ... on conflict (id) do update set approved = excluded.approved
--   그리고 whoami() 는 그 값을 그대로 돌려주므로, Worker 의 업로드·전사(유료) 승인
--   통제가 통째로 무력화된다.
--
-- 어떻게 막나
--   **컬럼 단위 권한**으로 approved 를 아예 쓸 수 없게 한다. 단, 테이블 단위 권한이
--   남아 있으면 컬럼 권한은 검사조차 되지 않으므로(테이블 권한이 먼저 통과시킨다)
--   **먼저 회수하는 것이 핵심**이다. 회수 없이 grant 만 추가하면 아무것도 바뀌지 않는다.
--
--   RLS 정책은 그대로 둔다. 정책은 "행"을 고르는 도구고, 여기서 필요한 것은
--   "컬럼" 통제라 권한 계층이 맞는 자리다.
--
-- 되돌리기 (필요하면)
--   grant insert, update on public.teachers to authenticated;
--   drop trigger teachers_guard_approved on public.teachers;
--   -- 단, 그 순간 이 취약점이 그대로 되살아난다.

-- =====================================================================
-- 전부 한 트랜잭션으로 묶는다.
--
-- 아래 1) 이 먼저 돌고 2) 가 실패하면 authenticated 는 teachers 에 INSERT 를
-- 아예 못 하게 되고, 그러면 **첫 로그인의 프로필 생성이 깨져 로그인 자체가
-- 막힌다.** 부분 적용이 가용성 사고로 이어지는 구조라 원자성이 필요하다.
-- =====================================================================
begin;

-- =====================================================================
-- 1) 테이블 단위 INSERT/UPDATE 회수 → 컬럼 단위로 다시 부여
-- =====================================================================
revoke insert, update on public.teachers from authenticated;

-- id 는 default auth.user_id() 가 채우지만, 클라이언트가 실어 보내도 되게 열어둔다.
-- 어차피 teachers_self 정책의 with check (id = auth.user_id()) 가 남의 id 를 막는다.
grant insert (id, name) on public.teachers to authenticated;

-- 이름만 고칠 수 있다. approved / created_at / id 는 못 건드린다.
grant update (name) on public.teachers to authenticated;

-- SELECT 와 DELETE 는 그대로 둔다. 자기 프로필을 지우면 다시 만들 때 approved 가
-- 기본값 false 로 돌아가므로 권한 상승이 아니라 오히려 하락이다.


-- =====================================================================
-- 2) 심층 방어 — 트리거
--
-- 컬럼 권한만으로 충분하지만, 0001 을 다시 돌리면 `grant ... on all tables`
-- 한 줄이 테이블 단위 권한을 되살려 이 수정을 **조용히** 무력화한다.
-- 그때도 approved 만은 지키도록 한 겹 더 둔다.
--
-- security invoker 다(기본값). definer 로 하면 current_user 가 함수 소유자로
-- 바뀌어 정작 "누가 부르는가"를 알 수 없다.
-- =====================================================================
create or replace function public.teachers_guard_approved()
returns trigger
language plpgsql
as $$
declare
  is_admin boolean;
begin
  -- 신뢰하는 관리자 = 이 테이블의 소유자(또는 그 역할의 멤버). Neon 에서는
  -- neondb_owner 다. authenticated 는 그 멤버가 아니다.
  select pg_has_role(current_user, c.relowner, 'member')
    into is_admin
    from pg_class c
    where c.oid = 'public.teachers'::regclass;

  if is_admin then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.approved is distinct from false then
      raise exception 'approved 는 직접 설정할 수 없습니다'
        using errcode = '42501',
              hint = '승인은 관리자가 public.admin_set_teacher_approval() 로 합니다.';
    end if;
  elsif new.approved is distinct from old.approved then
    raise exception 'approved 는 직접 변경할 수 없습니다'
      using errcode = '42501',
            hint = '승인은 관리자가 public.admin_set_teacher_approval() 로 합니다.';
  end if;

  return new;
end
$$;

drop trigger if exists teachers_guard_approved on public.teachers;
create trigger teachers_guard_approved
  before insert or update on public.teachers
  for each row execute function public.teachers_guard_approved();


-- =====================================================================
-- 3) 관리자 승인 경로
--
-- 손으로 `update public.teachers set approved = true` 를 치는 것이 지금까지의
-- 관리자 경로였는데, WHERE 를 빠뜨리면 전원이 승인된다 — 0003 에서 실제로 그런
-- 문장이 있었다. id 를 반드시 받게 해서 그 사고를 구조적으로 막는다.
--
-- **security invoker 다.** definer 로 두면 실수로 authenticated 에 execute 를
-- 주는 순간 완전한 권한 상승 통로가 된다. invoker 면 그래도 컬럼 권한에서 막힌다.
-- 즉 이 함수는 편의이자 감사 흔적이지, 권한을 새로 만들어 주지 않는다.
-- =====================================================================
create or replace function public.admin_set_teacher_approval(
  target_id text,
  approve   boolean
)
returns public.teachers
language plpgsql
as $$
declare
  result public.teachers;
begin
  if target_id is null or length(trim(target_id)) = 0 then
    raise exception '강사 id 를 지정해야 합니다 (전체 승인 사고 방지)';
  end if;

  update public.teachers
     set approved = approve
   where id = target_id
  returning * into result;

  if not found then
    raise exception '그런 강사가 없습니다: %', target_id;
  end if;

  return result;
end
$$;

-- 일반 사용자에게는 주지 않는다. 관리자(소유자) 접속으로만 부른다.
revoke all on function public.admin_set_teacher_approval(text, boolean) from public;

comment on function public.admin_set_teacher_approval(text, boolean) is
  '강사 승인/승인취소. 관리자(테이블 소유자) 접속으로만 실행된다. id 필수.';

commit;
