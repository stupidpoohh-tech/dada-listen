-- =====================================================================
-- 0001_init — 최초 스키마 (Neon Postgres)
--
-- 설계 전제는 docs/decisions.md 참조.
--   D-001  궁극 목표가 다중 강사 SaaS 이므로 처음부터 멀티테넌트로 짠다.
--   D-003  지문은 통짜 문자열이 아니라 세그먼트 + 타임스탬프.
--   D-004  빈칸은 토큰 인덱스가 아니라 원본 단어를 동반해 저장한다.
--   D-005  학생은 가입하지 않는다. 반 명단의 한 행일 뿐이다.
--   D-011  Neon + Data API. 신원은 pg_session_jwt 의 auth.user_id() 다.
--   D-012  미디어는 Cloudflare R2. 이 DB 에는 키(경로)만 둔다.
--
-- 신원:
--   auth.user_id() 는 JWT 의 sub 클레임을 text 로 돌려준다.
--   pg_session_jwt 는 Data API 를 켜면 자동 설치되므로 여기서 만들지 않는다.
--   owner_id 에 default 로 걸어두면 클라이언트가 소유자를 실어 보낼 필요가
--   없고, 남의 id 를 실어 보내도 WITH CHECK 이 막는다.
--
-- 역할:
--   authenticated — 로그인한 강사.
--   anonymous     — 로그인하지 않은 학생. 권한을 주지 않아 접근조차 못 한다.
--   둘 다 Data API 를 켜면 만들어진다.
--
-- 상태/난이도는 enum 이 아니라 text + check 로 둔다. enum 은 나중에 값을
-- 추가/제거하는 마이그레이션이 번거롭다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 공통 유틸
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 강사 (테넌트)
--
-- Neon Auth 는 사용자를 neon_auth 스키마에 둔다. 그건 관리형이라 외래키로
-- 묶지 않는다 — 내부 구조가 바뀌면 마이그레이션이 깨진다. 대신 JWT 의 sub 를
-- 그대로 식별자로 쓰고 표시용 이름만 여기 둔다. 첫 로그인 때 앱이 upsert 한다.
-- ---------------------------------------------------------------------
create table public.teachers (
  id          text primary key default auth.user_id(),
  name        text not null default '',
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 콘텐츠
-- ---------------------------------------------------------------------
create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id(),
  name        text not null,
  color       text not null default '#2f54eb',
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);
create index folders_owner_idx on public.folders (owner_id, sort, created_at);

create table public.items (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text not null default auth.user_id(),
  folder_id     uuid references public.folders(id) on delete set null,
  title         text not null,
  tags          text[] not null default '{}',

  -- R2 오브젝트 키. 재생은 서명 URL 로 한다 (D-012).
  -- 규약: {owner_id}/{item_id}.{ext}
  media_key     text,
  mime          text,
  duration_sec  real,

  -- 전사 파이프라인 상태. 업로드 직후 pending → 전사 워커가 갱신 (D-013).
  status        text not null default 'pending'
                  check (status in ('pending','processing','ready','failed')),
  status_error  text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index items_owner_idx  on public.items (owner_id, created_at desc);
create index items_folder_idx on public.items (folder_id);
create index items_tags_idx   on public.items using gin (tags);

create trigger items_touch before update on public.items
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 세그먼트 — 전사 산출물. 문장 하나가 한 행 (D-003).
--
-- Deepgram 의 utterance 가 그대로 한 행이 된다. words 는 그 안의 단어 배열:
--   [{"w":"climate","s":12.34,"e":12.81}, ...]
--   w = 표시용 원본 토큰(문장부호 포함), s/e = 초 단위.
--   단어 타임스탬프가 없으면 s/e 는 null — 문장 단위 기능은 그래도 된다.
-- ---------------------------------------------------------------------
create table public.segments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  idx        int  not null,
  start_sec  real not null,
  end_sec    real not null,
  text       text not null,
  words      jsonb not null default '[]' check (jsonb_typeof(words) = 'array'),
  unique (item_id, idx)
);
create index segments_item_idx on public.segments (item_id, idx);


-- ---------------------------------------------------------------------
-- 빈칸 override
-- 난이도별 빈칸은 결정론적으로 "생성"하므로 저장하지 않는다 (D-007).
-- 강사가 손으로 켜고 끈 것만 남는다.
-- word 를 함께 저장해야 지문 수정 시 드리프트를 감지할 수 있다 (D-004).
-- ---------------------------------------------------------------------
create table public.gap_overrides (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  segment_id  uuid not null references public.segments(id) on delete cascade,
  word_idx    int  not null,
  word        text not null,
  level       text not null check (level in ('easy','normal','hard')),
  enabled     bool not null,
  unique (segment_id, level, word_idx)
);
create index gap_overrides_item_idx on public.gap_overrides (item_id, level);


-- ---------------------------------------------------------------------
-- 반 / 학생 / 과제 (D-005)
-- ---------------------------------------------------------------------

-- 혼동되는 글자(0/O, 1/I/L)를 뺀 코드 생성기.
create or replace function public.gen_class_code(len int default 6)
returns text
language plpgsql
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
  i int;
begin
  for i in 1..len loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id(),
  name        text not null,
  -- 전역 유일. 다중 강사(④)가 되어도 반 링크가 충돌하지 않아야 한다.
  code        text not null unique default public.gen_class_code(),
  created_at  timestamptz not null default now()
);
create index classes_owner_idx on public.classes (owner_id, created_at);

create table public.students (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index students_class_idx on public.students (class_id, name);

create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  level       text not null default 'normal' check (level in ('easy','normal','hard')),
  due_at      timestamptz,
  created_at  timestamptz not null default now(),
  unique (class_id, item_id)
);
create index assignments_class_idx on public.assignments (class_id, created_at desc);

-- 제출. answers = 빈칸별 선택 기록.
-- listened_sec 는 실제 재생 구간 집계 — 학생이 아무것도 안 해도 남는다 (D-006).
create table public.attempts (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  answers       jsonb not null default '[]' check (jsonb_typeof(answers) = 'array'),
  score         real,
  listened_sec  real not null default 0,
  updated_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  unique (assignment_id, student_id)
);
create index attempts_assignment_idx on public.attempts (assignment_id);

create trigger attempts_touch before update on public.attempts
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 전사 사용량 — 나중의 할당량/요금제를 위해 강사별 집계 (D-013).
-- ---------------------------------------------------------------------
create table public.asr_usage (
  id          uuid primary key default gen_random_uuid(),
  owner_id    text not null default auth.user_id(),
  item_id     uuid references public.items(id) on delete set null,
  seconds     real not null,
  created_at  timestamptz not null default now()
);
create index asr_usage_owner_idx on public.asr_usage (owner_id, created_at desc);


-- =====================================================================
-- 권한
-- Data API 는 authenticated / anonymous 역할로 접속한다. RLS 는 그 위에서만
-- 의미가 있으므로 테이블 권한을 먼저 준다.
--
-- anonymous 에는 아무 권한도 주지 않는다. 학생 접근은 반 코드를 인자로 받는
-- SECURITY DEFINER 함수로만 열며, 반/과제 기능과 함께 별도 마이그레이션에서
-- 추가한다. 그래야 "링크를 아는 사람만"이 실제로 강제된다.
-- =====================================================================
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;


-- =====================================================================
-- RLS
--
-- 원칙: `using (true)` 같은 전역 공개 정책을 쓰지 않는다.
-- 소유권이 행에 있으면 직접, 없으면 부모를 통해 확인한다.
-- =====================================================================
alter table public.teachers      enable row level security;
alter table public.folders       enable row level security;
alter table public.items         enable row level security;
alter table public.segments      enable row level security;
alter table public.gap_overrides enable row level security;
alter table public.classes       enable row level security;
alter table public.students      enable row level security;
alter table public.assignments   enable row level security;
alter table public.attempts      enable row level security;
alter table public.asr_usage     enable row level security;

-- 강사 본인 프로필. 첫 로그인 때 앱이 upsert 하므로 insert 도 허용한다.
create policy teachers_self on public.teachers
  for all to authenticated
  using (id = auth.user_id()) with check (id = auth.user_id());

-- 소유권이 행에 직접 있는 테이블
create policy folders_owner on public.folders
  for all to authenticated
  using (owner_id = auth.user_id()) with check (owner_id = auth.user_id());

create policy items_owner on public.items
  for all to authenticated
  using (owner_id = auth.user_id()) with check (owner_id = auth.user_id());

create policy classes_owner on public.classes
  for all to authenticated
  using (owner_id = auth.user_id()) with check (owner_id = auth.user_id());

create policy asr_usage_owner on public.asr_usage
  for select to authenticated using (owner_id = auth.user_id());

-- 소유권을 부모를 통해 확인하는 테이블
create policy segments_owner on public.segments
  for all to authenticated
  using      (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.user_id()))
  with check (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.user_id()));

create policy gap_overrides_owner on public.gap_overrides
  for all to authenticated
  using      (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.user_id()))
  with check (exists (select 1 from public.items i where i.id = item_id and i.owner_id = auth.user_id()));

create policy students_owner on public.students
  for all to authenticated
  using      (exists (select 1 from public.classes c where c.id = class_id and c.owner_id = auth.user_id()))
  with check (exists (select 1 from public.classes c where c.id = class_id and c.owner_id = auth.user_id()));

create policy assignments_owner on public.assignments
  for all to authenticated
  using      (exists (select 1 from public.classes c where c.id = class_id and c.owner_id = auth.user_id()))
  with check (exists (select 1 from public.classes c where c.id = class_id and c.owner_id = auth.user_id()));

create policy attempts_owner on public.attempts
  for select to authenticated
  using (exists (
    select 1 from public.assignments a
    join public.classes c on c.id = a.class_id
    where a.id = assignment_id and c.owner_id = auth.user_id()
  ));
