-- 0006_item_clips — 한 음원을 문항별로 나눠 쓴다
--
-- 20분짜리 모의고사 듣기 한 회차에는 문항이 17개 들어 있다. 통째로 두면 학생이
-- 매번 12번 문제를 찾아 스크럽해야 하고, 갭필도 회차 전체에 걸쳐 뽑힌다.
--
-- **오디오를 자르지 않는다.** 원본 한 개를 R2 에 두고, 아이템마다 그 안의
-- 구간만 가리킨다. 이유:
--   - R2 가 Range 로 스트리밍하므로 재생에 문제가 없다 (D-010).
--   - 저장공간이 17배가 되지 않는다. 업로드도 한 번이면 된다.
--   - 경계가 틀려도 숫자만 고치면 된다. 다시 올릴 필요가 없다.
--
-- 그래서 **부모 아이템을 따로 두지 않는다.** 17개가 전부 대등하게 같은
-- media_key 를 가리킨다. 부모를 두면 그걸 지우는 순간 나머지가 전부 깨진다.
--
-- ⚠️ 음원을 공유하므로, 아이템 하나를 지울 때 R2 오브젝트를 같이 지우면 안 된다.
--    같은 media_key 를 쓰는 다른 아이템이 없을 때만 지운다 (src/lib/store.ts).

begin;

alter table public.items
  add column if not exists clip_start_sec double precision,
  add column if not exists clip_end_sec   double precision,
  add column if not exists question_no    text;

comment on column public.items.clip_start_sec is
  '음원 안에서 이 문항이 시작하는 초. null 이면 파일 전체를 쓴다.';
comment on column public.items.clip_end_sec is
  '음원 안에서 이 문항이 끝나는 초. null 이면 파일 끝까지.';
comment on column public.items.question_no is
  '문항 번호 표시용. "12" 또는 "16~17". 정렬이 아니라 표시에만 쓴다.';

-- 구간은 둘 다 있거나 둘 다 없어야 하고, 끝이 시작보다 뒤여야 한다.
-- 한쪽만 들어가면 재생이 조용히 이상해진다 — 그런 행은 아예 못 만들게 한다.
alter table public.items
  drop constraint if exists items_clip_range_valid;
alter table public.items
  add constraint items_clip_range_valid check (
    (clip_start_sec is null and clip_end_sec is null)
    or (clip_start_sec is not null and clip_end_sec is not null
        and clip_start_sec >= 0 and clip_end_sec > clip_start_sec)
  );

-- 같은 음원을 쓰는 아이템을 빨리 찾기 위한 색인.
-- 삭제할 때 "이 파일을 아직 쓰는 아이템이 있나"를 매번 묻는다.
create index if not exists items_media_key_idx
  on public.items (owner_id, media_key)
  where media_key is not null;

-- 0005 가 teachers 에만 컬럼 권한을 걸었고 items 는 테이블 단위 권한 그대로다.
-- 새 컬럼도 그 권한에 자동으로 포함되므로 따로 부여할 것이 없다.
-- (owner_id 는 여전히 DB 가 채우고, RLS 가 소유자만 보게 한다.)

commit;
