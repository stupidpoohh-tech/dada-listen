# 배포 준비 — 사장님이 하실 일

한 번만 하면 됩니다. 전부 무료 범위입니다.

---

## 0. 지금 상태

| | 상태 |
|---|---|
| Neon 프로젝트 | ✅ 생성됨 (ap-southeast-1) |
| Neon Data API · Auth | ✅ 켜짐 (URL 발급됨) |
| R2 버킷 `dada-media` | ✅ 생성됨, Public Access 꺼짐 |
| Deepgram 키 | ⬜ 아직 |
| Neon 연결 문자열 | ⬜ 아직 |
| 스키마 적용 | ⬜ 아직 |
| Cloudflare 비밀 3개 | ⬜ 아직 |

**R2 access key 는 만들지 않습니다.** Worker 가 바인딩으로 붙으므로 필요 없습니다.

---

## 1. Neon 연결 문자열 받기

Neon 콘솔 → 프로젝트 → **Connect** → `postgresql://...` 복사.

`?sslmode=require` 가 붙은 **pooled 아닌** 연결을 쓰세요 (마이그레이션용).

> ⚠️ 이 값은 비밀입니다. 채팅에 붙여넣지 마세요.

## 2. 스키마 적용

```bash
export NEON_DATABASE_URL='postgresql://...'      # 1번에서 복사한 값
psql "$NEON_DATABASE_URL" -f db/migrations/0001_init.sql
```

바로 이어서 RLS 가 제대로 걸렸는지 확인합니다. **16줄이 전부 PASS 여야 합니다.**

```bash
psql "$NEON_DATABASE_URL" -f db/tests/rls_test.sql
```

한 줄이라도 FAIL 이면 멈추고 알려주세요. RLS 는 깨져도 화면은 멀쩡해서,
이 테스트가 유일한 경보입니다.

> `psql` 이 없으면 Neon 콘솔의 **SQL Editor** 에 파일 내용을 붙여넣어도 됩니다.

## 3. 강사 계정 만들기

Neon 콘솔 → **Auth** → 사용자 추가. 사장님 이메일과 비밀번호로 하나만 만드시면 됩니다.
학생은 계정을 만들지 않습니다 (반 코드로 들어옵니다).

## 4. Deepgram 키 발급

1. deepgram.com 가입 — **$200 크레딧이 자동으로 붙습니다** (카드 불필요)
2. **API Keys** → Create a New API Key
3. 권한은 기본값(Member)이면 충분합니다

> ⚠️ 이 값도 비밀입니다.

## 5. Cloudflare 에 비밀 3개 넣기

```bash
npm install -g wrangler
wrangler login          # 브라우저가 열리고 Cloudflare 계정 인증

wrangler secret put DEEPGRAM_API_KEY
# → 4번에서 발급한 키를 붙여넣고 엔터

wrangler secret put NEON_DATABASE_URL
# → 1번의 연결 문자열을 붙여넣고 엔터

wrangler secret put MEDIA_TOKEN_SECRET
# → 아무 긴 임의 문자열. 직접 만드시려면:
#   openssl rand -base64 32
```

암호화 비밀은 **배포해도 지워지지 않습니다.** 한 번만 넣으면 됩니다.

**대시보드에서 넣지 마세요.** GitHub 연동 배포에서 대시보드에 넣은 값이
배포할 때마다 지워지는 문제가 보고돼 있습니다. `wrangler secret put` 은 안전합니다.

## 6. 자동 배포 연결

Cloudflare 대시보드 → **Workers & Pages** → 이 Worker → **Settings** → **Builds**
→ GitHub 저장소 연결, 브랜치는 `main`.

빌드 명령은 `npm run build`, 출력은 `dist` 입니다 (`wrangler.toml` 이 나머지를 압니다).

## 7. 제대로 됐는지 확인

배포된 주소 뒤에 `/api/health` 를 붙여 여세요.

```
https://dada-listening.<계정>.workers.dev/api/health
```

이렇게 나오면 끝입니다:

```json
{ "ready": true, "r2": "ok", "secrets": { ... 전부 true } }
```

`ready: false` 면 `secrets` 에서 `false` 인 항목이 아직 안 들어간 것입니다.
**값은 절대 표시되지 않고 들어갔는지 여부만 보여줍니다.**

먼저 배포부터 하고 비밀을 나중에 넣으셔도 됩니다. 그 상태에서도 로그인 화면까지는
뜨므로, Neon 연결이 되는지 먼저 확인할 수 있습니다.

---

## GitHub Secrets 는 언제 쓰나

**지금 방식(Cloudflare Workers Builds)에서는 필요 없습니다.** Cloudflare 가
저장소를 직접 보고 빌드하므로 비밀도 Cloudflare 에 있습니다.

GitHub Actions 로 배포를 옮기면 그때 딱 하나가 필요해집니다 —
Cloudflare 에 배포할 권한 토큰입니다.

등록 방법:

1. 저장소 → **Settings** 탭
2. 왼쪽 **Secrets and variables** → **Actions**
3. **New repository secret**
4. Name 에 `CLOUDFLARE_API_TOKEN`, Secret 에 값 붙여넣기 → **Add secret**

한 번 저장하면 다시 볼 수 없고 덮어쓰기만 됩니다. 워크플로에서는
`${{ secrets.CLOUDFLARE_API_TOKEN }}` 으로 씁니다.

토큰은 Cloudflare → 우측 상단 프로필 → **API Tokens** → *Edit Cloudflare Workers*
템플릿으로 발급합니다.

---

## 비밀을 다루는 원칙

- 비밀은 **채팅에 붙여넣지 않습니다.** 대화 기록에 남습니다.
- 공개돼도 되는 값(`NEON_AUTH_URL`, `NEON_DATA_API_URL`, Account ID, 버킷 이름)은
  `wrangler.toml` 에 그대로 커밋합니다. 어차피 브라우저 번들에 들어가고,
  실제 권한은 RLS 가 막습니다.
- 비밀이 유출된 것 같으면 **바로 재발급**하세요. Deepgram·Neon 둘 다 콘솔에서
  즉시 회전할 수 있습니다.
