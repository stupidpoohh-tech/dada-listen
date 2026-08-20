-- =====================================================================
-- 스키마 초안 — 검토용. 아직 마이그레이션이 아니다.
-- 승인되면 supabase/migrations/0001_init.sql 로 옮긴다.
--
-- 설계 전제 (docs/decisions.md):
--  - 궁극 목표가 다중 강사 SaaS(④)이므로 처음부터 멀티테넌트로 짠다.
--  - 지금 강사는 1명. 강사 초대/가입 UI는 만들지 않는다. 자리만 비워둔다.
--  - 학생은 가입하지 않는다. 반 명단의 한 행일 뿐이다.
-- =====================================================================

-- ---------- 강사 (테넌트) ----------
-- auth.users 를 확장. 지금은 행이 하나.
create table teachers (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------- 콘텐츠 ----------
create table folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references teachers(id) on delete cascade,
  name        text not null,
  color       text not null default '#2f54eb',
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

create type transcript_status as enum ('pending','processing','ready','failed');

create table items (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references teachers(id) on delete cascade,
  folder_id     uuid references folders(id) on delete set null,
  title         text not null,
  tags          text[] not null default '{}',

  -- 미디어: Storage 경로. 버킷은 private, 재생은 서명 URL. (D-010)
  -- 경로 규약: {owner_id}/{item_id}.{ext}
  media_path    text,
  mime          text,
  duration_sec  real,

  -- ASR 상태. 업로드 직후 pending → Edge Function 이 갱신. (D-002)
  status        transcript_status not null default 'pending',
  status_error  text,

  created_at    timestamptz not null default now()
);
create index on items (owner_id, created_at desc);

-- ---------- 세그먼트 (ASR 산출물) ----------
-- 지문을 통짜 문자열로 두지 않는다. (D-003)
-- words: [{"w":"climate","s":12.34,"e":12.81}, ...]
create table segments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references items(id) on delete cascade,
  idx        int  not null,               -- 아이템 내 순서
  start_sec  real not null,
  end_sec    real not null,
  text       text not null,
  words      jsonb not null default '[]',
  unique (item_id, idx)
);
create index on segments (item_id, idx);

-- ---------- 빈칸 override ----------
-- 난이도별 빈칸은 결정론적으로 "생성"하므로 저장하지 않는다. (D-007)
-- 강사가 손으로 켜고 끈 것만 여기 남는다.
-- word 를 함께 저장해야 지문 수정 시 드리프트를 감지할 수 있다. (D-004)
create table gap_overrides (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references items(id) on delete cascade,
  segment_id  uuid not null references segments(id) on delete cascade,
  word_idx    int  not null,              -- segments.words 배열 인덱스
  word        text not null,              -- 드리프트 감지용 원본 단어
  level       text not null,              -- 'easy' | 'normal' | 'hard'
  enabled     bool not null,              -- true=강제 켬, false=강제 끔
  unique (segment_id, word_idx, level)
);

-- ---------- 반 / 학생 / 과제 ----------
-- 학생은 가입하지 않는다. 반 명단의 한 행. (D-005)
create table classes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references teachers(id) on delete cascade,
  name        text not null,
  code        text not null unique,       -- 전역 유일 (④ 대비). 혼동문자 제외
  created_at  timestamptz not null default now()
);

create table students (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index on students (class_id);

create table assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  item_id     uuid not null references items(id) on delete cascade,
  level       text not null default 'normal',
  due_at      timestamptz,
  created_at  timestamptz not null default now()
);

-- 제출. answers 는 빈칸별 선택 기록.
-- listened_sec 는 실제 재생 구간 집계 — 학생이 아무것도 안 해도 남는다. (D-006)
create table attempts (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id    uuid not null references students(id) on delete cascade,
  answers       jsonb not null default '[]',
  score         real,
  listened_sec  real not null default 0,
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  unique (assignment_id, student_id)
);

-- ---------- ASR 사용량 ----------
-- 나중의 요금제/할당량을 위해 강사별로 집계. (D-002)
create table asr_usage (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references teachers(id) on delete cascade,
  item_id     uuid references items(id) on delete set null,
  seconds     real not null,
  created_at  timestamptz not null default now()
);
create index on asr_usage (owner_id, created_at desc);

-- =====================================================================
-- RLS
--   강사: 자기 것만 전부.
--   학생: 로그인하지 않는다(anon). 반 코드를 아는 경우에만 그 반의 것을 본다.
--         → anon 이 테이블을 직접 읽게 두지 않고, 반 코드를 인자로 받는
--           SECURITY DEFINER 함수로만 노출한다. 그래야 "링크를 아는 사람만"이
--           실제로 강제된다. using(true) 전역 공개를 쓰지 않는 이유.
-- =====================================================================
alter table teachers      enable row level security;
alter table folders       enable row level security;
alter table items         enable row level security;
alter table segments      enable row level security;
alter table gap_overrides enable row level security;
alter table classes       enable row level security;
alter table students      enable row level security;
alter table assignments   enable row level security;
alter table attempts      enable row level security;
alter table asr_usage     enable row level security;

-- 강사: 자기 소유 행만. (USING = 읽기/수정/삭제, WITH CHECK = 삽입/수정 결과)
create policy teacher_all on items
  for all to authenticated
  using      (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy teacher_all on folders
  for all to authenticated
  using      (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy teacher_all on classes
  for all to authenticated
  using      (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 자식 테이블은 부모를 통해 소유권을 확인한다.
create policy teacher_all on segments
  for all to authenticated
  using      (exists (select 1 from items i where i.id = item_id and i.owner_id = auth.uid()))
  with check (exists (select 1 from items i where i.id = item_id and i.owner_id = auth.uid()));

create policy teacher_all on students
  for all to authenticated
  using      (exists (select 1 from classes c where c.id = class_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from classes c where c.id = class_id and c.owner_id = auth.uid()));

-- gap_overrides / assignments / attempts / asr_usage 도 같은 형태. 생략.

-- 학생용 접근은 정책이 아니라 함수로:
--   class_by_code(code)        → 반 정보 + 명단
--   assignments_for(code)      → 그 반의 과제 목록 + 아이템/세그먼트
--   submit_attempt(code, student_id, ...) → 제출
-- 전부 SECURITY DEFINER + code 검증. anon 은 이 함수들만 호출할 수 있다.
