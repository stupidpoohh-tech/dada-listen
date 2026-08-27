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
| 스키마 적용 | ⬜ 아직 (0001·0002·0003) |
| Cloudflare 비밀 3개 | ⬜ 아직 |

**R2 access key 는 만들지 않습니다.** Worker 가 바인딩으로 붙으므로 필요 없습니다.

---

## 1. Neon 연결 문자열 받기

Neon 콘솔 → 프로젝트 → **Connect** → `postgresql://...` 복사.

`?sslmode=require` 가 붙은 **pooled 아닌** 연결을 쓰세요 (마이그레이션용).

> ⚠️ 이 값은 비밀입니다. 채팅에 붙여넣지 마세요.

## 2. 스키마 적용

**Neon 콘솔 → SQL Editor** (psql 없이 됩니다)

1. `db/migrations/0001_init.sql` 을 붙여넣고 **Run**
2. `db/migrations/0002_whoami.sql` 을 붙여넣고 **Run**
3. `db/migrations/0003_approved_teacher.sql` 을 붙여넣고 **Run**
4. `db/tests/rls_test.sql` 을 붙여넣고 **Run**

4번 결과가 표로 나옵니다. 마지막 요약 줄에 **FAIL 이 0** 이어야 합니다:

```
9 PASS / 0 FAIL / 1 SKIP   통과 — 다음 단계로 진행하세요
```

**SKIP 한 줄은 정상입니다.** 테스트는 두 단계로 나뉘어 있습니다.

| 단계 | 무엇을 보나 | 언제 도나 |
|---|---|---|
| **정적** | 권한과 정책이 의도대로 걸렸는지 카탈로그에서 확인 | 항상 |
| **동작** | 실제로 남의 데이터가 보이는지 시험 | `SET ROLE` 권한이 있을 때만 |

Neon 의 기본 접속 계정(`neondb_owner`)은 `authenticated` 역할로 전환할 권한이
없어서 동작 검사가 SKIP 됩니다. **정적 검사만으로도 충분히 잡힙니다** —
정책을 일부러 열어놓고 돌려보면 그 9개 안에서 걸립니다.

❌ 가 하나라도 있으면 **멈추고 알려주세요.** RLS 는 깨져도 화면이 멀쩡해서
이 테스트가 유일한 경보입니다. 테스트는 끝에서 롤백하므로 데이터를 남기지 않습니다.

**`psql` 이 있으면**

```bash
export NEON_DATABASE_URL='postgresql://...'      # 1번에서 복사한 값
psql "$NEON_DATABASE_URL" -f db/migrations/0001_init.sql
psql "$NEON_DATABASE_URL" -f db/tests/rls_test.sql
```

## 3. 강사 계정 만들기

**Neon 콘솔의 Create user 로는 로그인할 수 없습니다.** 이메일과 이름만 받고
비밀번호를 만들지 않기 때문입니다. 비밀번호는 앱의 가입 경로로만 생깁니다.

1. 콘솔에서 이미 만든 사용자가 있으면 **먼저 지웁니다** (사용자 행의 ⋮ → Delete).
   같은 이메일이 남아 있으면 가입이 충돌합니다.
2. 배포된 앱에서 우측 상단 **관리자** → **처음이신가요? 관리자 계정 만들기**
3. 이메일·비밀번호(8자 이상)·이름을 넣고 **계정 만들고 시작하기**

학생은 이 화면을 쓰지 않습니다. 반 코드로 들어옵니다 (D-005).

### ⚠️ 가입이 공개되어 있습니다

Neon Auth 콘솔에 이렇게 적혀 있습니다 — *"Anyone on the web can sign up for
your app. Support for restricted signups is coming soon."* 아직 막을 방법이
없습니다.

RLS 덕분에 낯선 사람이 가입해도 **남의 자료는 못 봅니다.** 다만 자기 공간에서
업로드하고 전사를 돌릴 수는 있고, 그러면 R2 용량과 Deepgram 크레딧이 남의 손에
나갑니다.

그래서 `teachers.approved` 를 뒀습니다. 기본값은 `false` 이고, 승인된 강사만
업로드·전사를 할 수 있습니다. 로그인과 목록 보기는 막지 않습니다.

**계정을 만든 뒤 자기 자신을 승인하세요** (SQL Editor):

```sql
-- 내 계정 확인
select id, name, approved from public.teachers;

-- 승인
update public.teachers set approved = true where id = '<위에서 본 id>';
```

나중에 동료 강사가 생기면 같은 방법으로 켜주면 됩니다.

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
→ GitHub 저장소 연결.

**빌드 설정을 아래 그대로 넣으세요.**

| 항목 | 값 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| **Root directory** | **`/`** (비워두거나 슬래시 하나) |
| Build variables | **없음** |

> ⚠️ **Root directory 를 `/dist` 로 두면 실패합니다.**
> `Failed: root directory not found` 가 그 증상입니다.
> `dist/` 는 저장소에 없습니다 — 빌드가 만들어내는 폴더라 `.gitignore` 에 있고,
> Cloudflare 는 클론 직후에 그 경로를 찾다가 멈춥니다.
> Root directory 는 **저장소 루트**를 가리켜야 합니다. 빌드 결과물이 `dist` 라는
> 것은 `wrangler.toml` 의 `[assets]` 가 이미 알고 있습니다.

> **Build variables 는 넣지 않아도 됩니다.** 프론트엔드가 빌드 때 필요로 하는
> Neon 주소는 저장소의 `.env` 에 커밋돼 있습니다. 대시보드에만 넣어두면
> 그걸 잊는 순간 설정 화면만 뜨는 앱이 배포되기 때문에, 파일에 두는 쪽을
> 택했습니다. (공개돼도 되는 값이고 권한은 RLS 가 막습니다.)

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
