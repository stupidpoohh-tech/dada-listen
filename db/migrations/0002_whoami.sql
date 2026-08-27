-- 0002_whoami — 서버가 토큰의 주인을 확인하는 함수
--
-- Worker 는 미디어를 R2 의 {owner_id}/... 경로에 쓴다. 그러려면 요청자가
-- 누구인지 확실히 알아야 하는데, 클라이언트가 보내는 id 를 믿으면 남의 폴더에
-- 쓸 수 있다.
--
-- JWT 서명을 Worker 에서 직접 검증하는 대신, 토큰을 그대로 Data API 에 넘겨
-- 이 함수를 부른다. Neon 이 서명을 검증하고 Postgres 가 auth.user_id() 를
-- 돌려주므로 위조가 불가능하고, Worker 에 암호 코드가 들어가지 않는다.
--
-- security invoker 여야 한다. definer 로 만들면 함수 소유자 기준으로 돌아
-- 호출자의 신원이 아니라 소유자의 신원이 나온다.

create or replace function public.whoami()
returns text
language sql
stable
security invoker
as $$ select auth.user_id() $$;

grant execute on function public.whoami() to authenticated;
