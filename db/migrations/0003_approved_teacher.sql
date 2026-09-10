-- 0003_approved_teacher — 승인된 강사만 돈이 나가는 작업을 할 수 있게
--
-- Neon Auth 는 지금 공개 가입이다 ("Anyone on the web can sign up" — 제한 기능은
-- 아직 없다). RLS 덕분에 낯선 사람이 가입해도 남의 자료는 못 보지만, 자기
-- 공간에서 업로드하고 전사를 돌릴 수는 있다. 그러면 R2 용량과 Deepgram
-- 크레딧이 남의 손에 나간다.
--
-- 그래서 기본값을 false 로 두고, 승인된 강사만 업로드·전사를 하게 한다.
-- 화면을 보는 것(로그인, 목록)은 막지 않는다 — 돈이 나가는 작업만 막는다.
--
-- 두 번째 강사가 생기면 이 값을 true 로 바꿔주면 된다:
--   select public.admin_set_teacher_approval('<강사 id>', true);
-- (0005 에서 추가된 함수다. 손으로 update 를 치면 WHERE 를 빠뜨리는 순간
--  전원이 승인된다 — 아래에서 그 사고를 실제로 겪었다.)

-- 컬럼을 **처음 도입할 때만** 기존 강사를 승인 상태로 올린다.
--
-- 예전에는 여기가 그냥 `update public.teachers set approved = true where
-- approved is false` 였다. 그 문장은 이 파일을 다시 돌리는 것만으로 **그동안
-- 가입한 미승인 계정을 전부 승인해 버린다.** 마이그레이션을 처음부터 다시
-- 적용하는 일은 드물지 않으므로(브랜치 복구, 새 환경 구성) 조건을 건다.
--
-- 판단 기준은 "컬럼이 이 실행 전에 이미 있었는가"다. 없었다면 이번이 최초
-- 도입이고, 그때 존재하던 행 = 이 프로젝트를 만든 사람이다.
do $$
declare
  column_existed boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'teachers'
      and column_name  = 'approved'
  ) into column_existed;

  alter table public.teachers
    add column if not exists approved boolean not null default false;

  if not column_existed then
    update public.teachers set approved = true;
  else
    raise notice 'approved 컬럼이 이미 있어 일괄 승인을 건너뜁니다 (재실행).';
  end if;
end
$$;

comment on column public.teachers.approved is
  '업로드·전사를 허용할지. 공개 가입이라 기본은 false. 사람이 직접 켠다.';


-- whoami() 가 승인 여부까지 함께 돌려주도록 바꾼다.
-- Worker 가 요청 한 번으로 신원과 권한을 모두 확인할 수 있다.
-- 반환 타입이 바뀌므로 create or replace 로는 안 되고 drop 이 필요하다.
drop function if exists public.whoami();

create function public.whoami()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'id', auth.user_id(),
    'approved', coalesce(
      (select t.approved from public.teachers t where t.id = auth.user_id()),
      false)
  )
$$;

grant execute on function public.whoami() to authenticated;
