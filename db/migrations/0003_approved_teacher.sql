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
--   update public.teachers set approved = true where id = '<강사 id>';

alter table public.teachers
  add column if not exists approved boolean not null default false;

-- 이미 있는 강사(= 이 프로젝트를 만든 사람)는 승인 상태로 시작한다.
update public.teachers set approved = true where approved is false;

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
