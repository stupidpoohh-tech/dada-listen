# dada-listening

강사가 음원을 올리면 자동으로 스크립트와 갭필이 생성되고, 반 단위로 듣기 과제를
내고 누가 했는지 확인하는 웹앱.

**스택.** Vite + React 18 + TS · Neon(Postgres + Data API + Auth) ·
Cloudflare R2(미디어) · Deepgram(전사).

- 서비스 정의와 결정 근거: [`docs/decisions.md`](docs/decisions.md)
- 작업 지침: [`CLAUDE.md`](CLAUDE.md)
- 스키마: [`db/migrations/`](db/migrations/)
- **배포 준비 절차: [`docs/setup.md`](docs/setup.md)**
- 원본 앱(디자인 정답지): [`_handoff/dada-listening-deploy.html`](_handoff/)

## 개발

```bash
npm install
cp .env.example .env.local     # Neon 콘솔 → Auth / Data API 에서 값 복사
npm run dev
```

환경변수가 없으면 흰 화면 대신 설정 안내 화면이 뜬다.

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 체크 + 프로덕션 빌드 (`dist/`) |
| `npm test` | 단위 테스트 |
| `npm run typecheck` | 타입 체크만 |
| `npm run worker:dev` | Worker + 프론트엔드를 한 번에 로컬 실행 |
| `npm run deploy` | Cloudflare Workers 배포 |

배포 후 `/api/health` 를 열면 R2 바인딩과 비밀 설정 여부를 확인할 수 있습니다
(값은 표시되지 않고 설정됐는지만 보여줍니다).

> **주의.** Vite 는 `VITE_*` 값을 **빌드 시점에** 번들에 인라인한다. 배포
> 대시보드의 환경변수는 런타임이 아니라 빌드에 필요하므로, 값을 바꾸면
> 재배포해야 반영된다.

## 데이터베이스

스키마의 단일 진실은 `db/migrations/` 안의 SQL 파일이다. 콘솔에서 직접 고치지 않는다.

Neon 프로젝트에서 **Data API 와 Auth 를 먼저 켜야 한다.** 그래야 `pg_session_jwt`
확장과 `authenticated` / `anonymous` 역할이 생기고, 마이그레이션의
`auth.user_id()` 가 존재한다.

```bash
psql "$NEON_DATABASE_URL" -f db/migrations/0001_init.sql
```

### RLS 테스트

RLS 는 깨져도 조용하다 — 화면은 멀쩡한데 남의 데이터가 보인다. 그래서 테스트한다.

```bash
# 실제 Neon 브랜치에 대고
psql "$NEON_DATABASE_URL" -f db/tests/rls_test.sql

# Neon 없이 맨 Postgres 에서 (스텁 사용)
psql ... -f db/tests/_neon_stubs.sql
psql ... -f db/migrations/0001_init.sql
psql ... -f db/tests/rls_test.sql
```

FAIL 이 0 이어야 한다. 테스트는 두 단계다 — **정적**(권한·정책을 카탈로그에서
확인, 항상 실행) 과 **동작**(실제 역할로 전환해 시험, `SET ROLE` 권한이 있을 때만).
Neon 기본 계정에서는 동작 단계가 SKIP 되지만 정적 9개만으로도 파손은 잡힌다.

## 구조

```
src/
  lib/
    gapfill.ts      결정론적 빈칸 선정 + 객관식 보기. 순수 함수.
    gapfill.test.ts 회귀 테스트. 알고리즘을 고치면 함께 갱신한다.
    wordlists.ts    STOP / COMMON 단어 목록 (데이터)
    store.ts        영속화 경계. 컴포넌트는 DB 클라이언트를 직접 부르지 않는다.
    db.ts           Neon 클라이언트 초기화. SDK 는 여기서만 import 한다.
    mediaApi.ts     R2 서명 URL 발급 API 계약
    media.ts        업로드 파일 전처리 (MIME 보정, 길이 읽기)
    types.ts        도메인 타입. DB 스키마와 짝이 맞아야 한다.
  components/       원본 HTML 에서 이식한 UI
  styles/
    tokens.css      디자인 토큰의 단일 진실 (원본 :root 그대로)
    app.css         나머지 스타일 (원본 그대로)
worker/
  index.ts          Cloudflare Worker — 프론트 서빙 · 미디어 · 전사
db/
  migrations/       스키마의 단일 진실
  tests/            RLS 회귀 테스트 (+ Neon 없이 돌리기 위한 스텁)
```

## 진행 상황

- [x] 1단계 — 스캐폴딩 + 스키마 + RLS 테스트
- [x] 2단계 — gapfill 이식 + 알고리즘 개선 + 테스트
- [x] 3단계 — store + R2 스트리밍 + 강사 인증
- [ ] 4단계 — Cloudflare Worker: R2 서명 URL + Deepgram 전사 → 세그먼트
- [ ] 5단계 — 업로드/스크립트 교정 UI
- [ ] 6단계 — 플레이어 + 타임스탬프 기능
- [ ] 7단계 — 갭필 학습 UI (난이도, 객관식) ← 1차 배포 지점
- [ ] 8단계 — 반 · 학생 · 과제 · 제출 현황
- [ ] 9단계 — 기존 Firestore 데이터 이관
- [ ] 10단계 — 배포 연결 (`docs/setup.md`)
