# Handoff: dada-listening → 자동배포 가능한 레포로 이관

## Overview
`dada-listening`은 영어 듣기 연습 웹앱입니다. 관리자(강사)가 음원/영상을 올리고 스크립트를 붙이면, 학생은 로그인 없이 링크로 들어와 구간반복·배속·빈칸채우기(gap-fill)로 연습합니다.

현재 형태: **단일 HTML 파일 하나** (`dada-listening-deploy.html`, 약 8MB). React 18 + Babel standalone을 CDN에서 브라우저에서 트랜스파일하고, Firebase compat SDK를 전역 `firebase`로 씁니다. 빌드 스텝이 없어 정적 호스팅에 그냥 올라갑니다.

목표: 이걸 **GitHub 레포 + 빌드 스텝 + 자동배포** 구조로 옮기고, 이후 작업을 Claude Code에서 계속합니다.

## About the Design Files
이 번들의 HTML은 **동작하는 프로토타입이면서 동시에 디자인 레퍼런스**입니다. 그대로 배포해도 돌아가지만, 프로덕션 코드로 삼기엔 구조적 한계가 있습니다(아래 참조). 목표 코드베이스에서 **다시 구성**하되, 화면과 인터랙션은 이 파일이 정답지입니다. 색·타입·간격·문구는 이 파일에서 그대로 가져오세요.

## Fidelity
**High-fidelity.** 실제 배포되어 사용 중인 앱입니다. 색상, 타이포그래피, 간격, 인터랙션 모두 최종본으로 취급하세요. 이관 시 픽셀 단위로 유지하는 것이 목표입니다.

---

## 현재 아키텍처 (as-is)

단일 파일 안에 아래 모듈이 순서대로 인라인되어 있습니다. 원래는 별도 파일이었고, 주석으로 경계가 남아 있습니다.

| 인라인 마커 | 역할 |
|---|---|
| `<!-- js/firebase-config.js -->` | `firebase.initializeApp(firebaseConfig)` |
| `<!-- js/store.js -->` | 영속화 레이어 전체. `window.LDB`로만 노출 |
| `<!-- js/gapfill.js -->` | 결정론적 토크나이저 + 핵심어 빈칸 선택 |
| `<!-- js/extract.js -->` | 업로드 파일 전처리 (추출 없음, 원본 저장) |
| `app.jsx` (babel) | 앱 셸: 사이드바, 목록, 라우팅, 인증 게이트 |
| `player.jsx` (babel) | 플레이어: 구간반복, 배속, 스크립트 싱크 |
| `admin.jsx` (babel) | 관리자: 업로드, 스크립트 편집, 폴더/태그 |
| `util.jsx` (babel) | 공통 유틸 |

### 데이터 모델 (Firestore)
- `app/state` — 단일 문서. `{ folders, items }` 전체 상태를 통째로 담음. 텍스트·메타데이터만.
- `media/<safeId>` — 미디어 메타 문서 `{ mime, chunks }`
- `media/<safeId>/parts/<i>` — **base64 청크**, 각 700KB. Firestore 문서 1MiB 제한을 피하려고 쪼갠 것.

### 인증
Firebase Auth 이메일/비번, 단일 관리자 계정. 학생은 로그인 없이 read. `auth.setPersistence(LOCAL)`.

### 알려진 제약 / 이관 시 반드시 고칠 것

1. **미디어를 Firestore에 base64로 저장** — Storage를 안 쓰려고(Blaze 요금제 회피) 넣은 우회책입니다. base64가 원본의 약 1.37배로 부풀고, 재생할 때 모든 청크를 `Promise.all`로 전부 받아 문자열로 이어붙인 뒤 Blob URL을 만듭니다. 즉 **스트리밍이 아니라 전체 다운로드**입니다. 파일이 커지면 읽기 횟수와 메모리가 같이 터집니다. → **Supabase Storage 또는 Cloudflare R2로 옮기고, `<audio>`가 Range 요청으로 스트리밍하게 하세요.** 이관에서 가장 중요한 한 가지입니다.
2. **전역 상태 단일 문서** — `app/state` 하나에 모든 폴더·항목이 들어 있어, 동시 편집 시 마지막 저장이 이깁니다. 코드에 이미 `stateRef`로 stale snapshot을 막는 우회책이 있습니다. → 정규화된 테이블(`folders`, `items`)로 분리.
3. **Firestore는 `undefined`를 만나면 쓰기 전체를 거부** — 그래서 저장 전에 payload를 deep-clean합니다. 이관 후에도 같은 방어는 유지하세요(원인 필드: 종종 `folderId` 누락).
4. **iOS Safari 오디오 추출 불가** — `captureStream()` 미지원. 현재는 추출을 아예 포기하고 원본(mp4 등)을 그대로 저장, 재생은 오디오 트랙만 씁니다. 이 폴백은 유지하되, **서버 사이드 추출**(ffmpeg on Cloudflare Workers/Supabase Edge Function)로 올리는 게 정공법입니다.
5. **브라우저 Babel 트랜스파일** — 8MB를 매 로드마다 파싱합니다. 빌드 스텝으로 옮기면 초기 로드가 크게 개선됩니다.
6. **Firebase apiKey가 소스에 노출** — Firebase에선 정상이며 비밀이 아닙니다. 실제 보안은 **Security Rules**가 담당합니다. 현재 룰은 public read / auth write. Supabase로 가면 같은 역할을 **RLS 정책**이 합니다. anon key는 공개해도 되지만 **service_role key는 절대 클라이언트에 넣지 마세요.**

---

## 이관 계획 (to-be)

### 스택 결정
- **프레임워크**: Vite + React 18 + TypeScript. 지금이 이미 React이므로 컴포넌트를 거의 그대로 옮길 수 있고, Next.js의 서버 렌더링은 이 앱에 필요 없습니다.
- **백엔드**: **Supabase** 하나로 통일 권장. Postgres + Storage + Auth + RLS가 한 프로젝트에 있고, 지금 Firestore 구조의 문제(미디어 저장, 단일 문서)를 둘 다 해결합니다. Firebase를 유지하면 Storage를 켜야 하고(Blaze), 결국 두 스택을 다 관리하게 됩니다.
- **호스팅**: **Cloudflare Pages** 또는 **Vercel** 하나만. 둘 다 GitHub push → 자동 빌드/배포, PR 프리뷰 URL을 줍니다. Supabase를 쓸 거면 Vercel이 연동이 조금 더 매끈하지만 차이는 작습니다. **둘 중 하나만 고르세요** — 지금 여러 곳에 흩어지는 게 가장 흔한 실수입니다.

### 목표 레포 구조
```
dada-listening/
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
├─ .env.local              # gitignore. VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├─ .env.example            # 커밋. 키 없이 이름만
├─ CLAUDE.md               # Claude Code용 프로젝트 지침 (별도 파일 참조)
├─ supabase/
│  ├─ migrations/          # SQL 마이그레이션. 스키마의 단일 진실
│  └─ config.toml
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx              # 현재 app.jsx
│  ├─ lib/
│  │  ├─ supabase.ts       # 클라이언트 초기화
│  │  ├─ store.ts          # 현재 store.js. LDB와 같은 인터페이스 유지
│  │  ├─ gapfill.ts        # 현재 gapfill.js — 로직 변경 없이 그대로
│  │  └─ media.ts          # 현재 extract.js + 업로드
│  ├─ components/
│  │  ├─ Player.tsx        # 현재 player.jsx
│  │  ├─ Admin.tsx         # 현재 admin.jsx
│  │  └─ ...
│  └─ styles/
│     └─ tokens.css        # 아래 Design Tokens
└─ .github/workflows/      # (선택) CI. 배포는 Pages/Vercel이 담당
```

### Supabase 스키마 (초안)
```sql
create table folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort int default 0,
  created_at timestamptz default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references folders(id) on delete set null,
  title text not null,
  tags text[] default '{}',
  script jsonb,              -- 줄 단위 [{ t, text, note }]
  media_path text,           -- Storage 내 경로
  mime text,
  duration real,
  created_at timestamptz default now()
);

alter table folders enable row level security;
alter table items   enable row level security;

-- 학생: 로그인 없이 읽기
create policy "public read"  on items   for select using (true);
create policy "public read"  on folders for select using (true);
-- 관리자: 로그인 사용자만 쓰기
create policy "auth write"   on items   for all using (auth.role() = 'authenticated');
create policy "auth write"   on folders for all using (auth.role() = 'authenticated');
```
Storage 버킷 `media`: public read, authenticated write. 이걸로 base64 청크 로직 전체가 사라지고 `<audio src={publicUrl}>` 한 줄이 됩니다.

### 데이터 이관
기존 Firestore 데이터를 옮길 일회성 스크립트가 필요합니다:
1. `app/state` 문서를 읽어 `folders` / `items` 행으로 분해
2. 각 `media/<id>`의 `parts`를 순서대로 받아 base64 디코드 → 원본 Blob 복원 → Supabase Storage에 업로드
3. 반환된 경로를 `items.media_path`에 기록

`scripts/migrate-from-firestore.ts`로 두고, 한 번 돌린 뒤 레포에 남겨두세요(기록으로서 가치가 있습니다).

### 자동배포 설정 순서
1. GitHub에 레포 생성, 위 구조로 첫 커밋
2. Vercel(또는 Cloudflare Pages)에서 레포 연결. 빌드 커맨드 `npm run build`, 출력 디렉터리 `dist`
3. 대시보드에 환경변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 등록 (Production/Preview 양쪽)
4. `main` 브랜치 push → 프로덕션 배포. 다른 브랜치·PR → 프리뷰 URL 자동 생성
5. Supabase 마이그레이션은 로컬에서 `supabase db push`로 반영. 스키마 변경을 대시보드에서 손으로 하지 말고 **항상 `supabase/migrations/`의 SQL 파일로** 하세요 — 그게 Claude Code가 스키마를 읽을 수 있는 유일한 경로입니다.

---

## Claude Code로 넘어가는 방법

### 1. 이 번들을 레포에 넣기
```bash
git init dada-listening && cd dada-listening
mkdir -p _handoff
# 이 폴더의 파일들을 _handoff/ 에 복사
git add . && git commit -m "handoff: 기존 단일 파일 앱 + 이관 계획"
```
`_handoff/dada-listening-deploy.html`이 **디자인·동작의 정답지**로 레포 안에 남습니다. 이게 핵심입니다 — Claude Code는 대화 맥락을 못 받지만 파일은 읽습니다.

### 2. `CLAUDE.md`를 루트에 두기
이 폴더의 `CLAUDE.md`를 레포 루트로 복사하세요. Claude Code가 매 세션 자동으로 읽는 파일이며, 스택·제약·하지 말 것을 여기에 적어두면 매번 설명할 필요가 없습니다.

### 3. 첫 세션에서 시킬 것
큰 걸 한 번에 시키지 말고 순서대로:

1. `_handoff/` 읽고 계획 확인만 하게 (코드 X)
2. Vite + React + TS 스캐폴딩 + `supabase/migrations/0001_init.sql`
3. 단일 HTML에서 `gapfill.js` → `src/lib/gapfill.ts` 이식. 순수 함수라 가장 안전한 첫 이식입니다. **테스트를 같이 쓰게 하세요** — 빈칸 선택이 결정론적이어야 하므로 회귀 방지가 중요합니다.
4. `store.js` → `src/lib/store.ts`. **`LDB`와 동일한 함수 시그니처를 유지**하도록 지시. 그러면 UI 컴포넌트를 손대지 않고 백엔드만 갈아끼울 수 있습니다.
5. 컴포넌트 이식 (`util` → `player` → `admin` → `App` 순서, 의존성 역순)
6. 데이터 이관 스크립트
7. 배포 연결

각 단계마다 커밋하고 프리뷰에서 확인하세요. 한 세션에 2~3단계까지가 적당합니다.

### 4. Claude Code에 줄 첫 프롬프트 예시
```
_handoff/README.md 와 CLAUDE.md 를 먼저 읽어.
_handoff/dada-listening-deploy.html 은 현재 프로덕션에서 돌아가는 단일 파일 앱이고,
이걸 Vite + React + TS + Supabase 로 이관하는 게 목표야.

지금은 코드를 쓰지 말고, README의 이관 계획을 읽은 뒤
- 계획에서 빠졌거나 위험한 부분
- 이식 순서에 대한 이견
만 알려줘. 동의하면 1단계(스캐폴딩)부터 시작하자.
```

### 5. 세션 간 연속성 유지
- 결정 사항은 대화가 아니라 **파일에** 남기세요. `CLAUDE.md`, `docs/decisions.md`, 마이그레이션 SQL.
- 커밋 메시지를 성실히 쓰면 다음 세션의 Claude Code가 `git log`로 맥락을 복구합니다.
- 한 세션이 길어지면 `/compact`로 요약하되, 중요한 결정은 그 전에 파일로 옮기세요.

---

## Design Tokens
정확한 값은 `dada-listening-deploy.html`의 `<style>` 블록과 `styles.css`에서 그대로 가져오세요. 이관 시 `src/styles/tokens.css`로 옮기고 `var(--*)`로만 참조하도록 정리할 것을 권합니다.

- **폰트**: Pretendard Variable (`cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9`). 이관 시 npm 패키지 또는 self-host로 바꾸면 CDN 의존이 사라집니다.
- 색·간격·radius·shadow: 원본 파일의 `:root` 블록이 단일 진실.

## Assets
외부 의존만 있고 바이너리 에셋은 없습니다. 아이콘은 인라인 SVG(`Ic.*` 컴포넌트)입니다. 미디어 파일은 사용자가 올린 것이며 Firestore에 있습니다.

## Files
- `dada-listening-deploy.html` — 현재 프로덕션 단일 파일. 동작·디자인의 정답지.
- `CLAUDE.md` — 레포 루트에 둘 Claude Code 프로젝트 지침.
