# 배포 준비 — 사장님이 하실 일

한 번만 하면 됩니다. 전부 무료 범위입니다.

---

## 0. 지금 상태

| | 상태 |
|---|---|
| Neon 프로젝트 | ✅ 생성됨 (ap-southeast-1) |
| Neon Data API · Auth | ✅ 켜짐 (URL 발급됨) |
| R2 버킷 `dada-media` | ✅ 생성됨, Public Access 꺼짐 |
| Deepgram 키 | ✅ 발급·등록됨 (실제 전사 성공 확인) |
| 앱 주소 Neon Auth 등록 | ✅ 등록됨 (2-b) |
| 스키마 적용 | ✅ 0001~0005 적용됨 |
| 승인 보호 (P0) | ✅ 0005 적용, `p0_verify.sql` 전부 PASS |
| Cloudflare 비밀 3개 | ✅ 등록됨 (업로드·전사 동작) |
| 배포 | ✅ Cloudflare Workers |

**R2 access key 는 만들지 않습니다.** Worker 가 바인딩으로 붙으므로 필요 없습니다.

아래 1~7 은 **처음 설치하거나 새 환경을 만들 때** 보는 절차입니다. 지금 돌아가는
환경은 이미 다 되어 있습니다. 점검만 하려면 `db/checks/p0_verify.sql` 을 보세요.

---

## 1. Neon 연결 문자열 받기

Neon 콘솔 → 프로젝트 → **Connect** → `postgresql://...` 복사.

`?sslmode=require` 가 붙은 **pooled 아닌** 연결을 쓰세요 (마이그레이션용).

> ⚠️ 이 값은 비밀입니다. 채팅에 붙여넣지 마세요.

## 2. 스키마 적용

**Neon 콘솔 → SQL Editor** (psql 없이 됩니다)

**번호 순서대로** 하나씩 붙여넣고 **Run** 합니다. 중간에서 멈추면 화면은
멀쩡한데 업로드만 막히는 상태가 됩니다.

1. `db/migrations/0001_init.sql`
2. `db/migrations/0002_whoami.sql`
3. `db/migrations/0003_approved_teacher.sql`
4. `db/migrations/0004_whoami_definer.sql`
5. `db/migrations/0005_teachers_approval_privileges.sql`
6. `db/tests/rls_test.sql` — 확인용

6번 결과가 표로 나옵니다. 마지막 요약 줄에 **FAIL 이 0** 이어야 합니다:

```
34 PASS / 0 FAIL / 0 SKIP   통과 — 다음 단계로 진행하세요
```

> ⚠️ **이미 돌아가는 DB 에는 새 파일만 돌립니다.** 위 순서는 처음 설치할 때
> 얘기입니다. 0001 은 `create table` 이라 다시 돌리면 실패하고, 0003 을 다시
> 돌리면 `whoami` 정의가 예전 방식으로 되돌아갑니다.
>
> ⚠️ **`db/tests/rls_test.sql` 은 운영에 쓰는 브랜치에서는 돌리지 마세요.**
> 확인용이지만 `teachers` · `items` 에 실제로 쓰고 지웁니다(롤백은 됩니다).
> 운영 브랜치에서는 `db/checks/p0_verify.sql` 을 쓰세요 — 읽기만 합니다.

SKIP 이 나오면 그건 통과가 아닙니다. 테스트는 두 단계로 나뉘어 있습니다.

| 단계 | 무엇을 보나 | 언제 도나 |
|---|---|---|
| **정적** | 권한과 정책이 의도대로 걸렸는지 카탈로그에서 확인 | 항상 |
| **동작** | 실제로 남의 데이터가 보이는지 시험 | `SET ROLE` 권한이 있을 때만 |

`SET ROLE` 이 안 되는 접속으로 돌리면 동작 검사가 SKIP 됩니다. Neon 의 기본
접속 계정에서는 보통 둘 다 돌아 34개가 전부 나옵니다.

❌ 가 하나라도 있으면 **멈추고 알려주세요.** RLS 는 깨져도 화면이 멀쩡해서
이 테스트가 유일한 경보입니다. 테스트는 끝에서 롤백하므로 데이터를 남기지 않습니다.

## 2-b. 앱 주소를 Neon Auth 에 등록 (안 하면 로그인이 안 됩니다)

Neon Auth 는 **어느 주소에서 온 요청인지**를 보고 모르는 주소면 거절합니다.
등록하지 않으면 로그인·가입이 이렇게 실패합니다:

```
로그인에 실패했어요 — Invalid origin
```

브라우저 개발자도구 콘솔에는 `AuthApiError: Invalid origin` 과 403 이 뜹니다.
**비밀번호나 계정 문제가 아니고, DB 나 권한 문제도 아닙니다.** 주소 등록 문제입니다.

등록 경로:

1. Neon 콘솔 → 좌측 **Auth**
2. **Configuration** (또는 **Settings**) 탭
3. **Domains** / **Allowed origins** 항목의 **Add domain**
4. 브라우저 주소창에 실제로 보이는 주소를 그대로 넣고 **Save**

**주소를 쓰는 앱마다 전부 등록해야 합니다.** 흔히 빠뜨리는 것들:

- `https://dada-listening.<계정>.workers.dev` (Cloudflare 기본 주소)
- 직접 연결한 도메인 (`https://내도메인.com`)
- `www.` 가 붙는 주소와 안 붙는 주소는 **서로 다른 주소**입니다
- 개발용 `http://localhost:5173`

주소가 하나라도 바뀌면(도메인 연결, 서브도메인 변경) 다시 등록해야 합니다.


## 3. 강사 계정 만들기

**Neon 콘솔의 Create user 로는 로그인할 수 없습니다.** 이메일과 이름만 받고
비밀번호를 만들지 않기 때문입니다. 비밀번호는 앱의 가입 경로로만 생깁니다.

1. 콘솔에 이미 만든 사용자가 있으면 **먼저 지웁니다** (사용자 행의 ⋮ → Delete).
   같은 이메일이 남아 있으면 가입이 충돌합니다.
2. 배포된 앱 → 우측 상단 **관리자** → **처음이신가요? 관리자 계정 만들기**
3. 이메일 · 비밀번호(8자 이상) · 이름을 넣고 **계정 만들고 시작하기**
4. 로그인되면 화면이 뜹니다. 이때 `teachers` 행이 자동으로 만들어집니다.

학생은 이 화면을 쓰지 않습니다. 반 코드로 들어옵니다 (D-005).

### 로그인한 뒤 자기 자신을 승인

가입은 되지만 **업로드와 전사는 아직 막혀 있습니다.** 아래 이유 때문입니다.

SQL Editor 에서 **자기 id 를 찾아** 승인합니다.

```sql
select id, name, approved from public.teachers;
```

거기서 본인 id 를 복사해 넣습니다.

```sql
select public.admin_set_teacher_approval('여기에_본인_id', true);
```

> ⚠️ **`update public.teachers set approved = true` 를 치지 마세요.**
> WHERE 를 빠뜨리면 그 순간 **가입한 사람 전원이 승인됩니다.** 공개 가입이라
> 낯선 사람도 계정을 만들 수 있어서, 그대로 R2 용량과 Deepgram 크레딧이
> 나갑니다. 위 함수는 id 를 반드시 받아서 그 사고를 막습니다 (D-020).
>
> 일반 사용자는 `approved` 를 직접 못 바꿉니다. 이 함수도 관리자(Neon 콘솔
> 소유자 접속)로만 실행됩니다.

> **순서가 중요합니다.** 로그인을 한 번 해야 `teachers` 행이 생깁니다.
> 로그인 전에 이 UPDATE 를 돌리면 고칠 행이 없어 아무 일도 일어나지 않습니다
> (에러도 안 납니다). 그럴 땐 로그인한 뒤 다시 돌리면 됩니다.

### ⚠️ 왜 승인이 필요한가

Neon Auth 콘솔에 이렇게 적혀 있습니다 — *"Anyone on the web can sign up for
your app. Support for restricted signups is coming soon."* 아직 막을 방법이 없습니다.

RLS 덕분에 낯선 사람이 가입해도 **남의 자료는 못 봅니다.** 다만 자기 공간에서
업로드하고 전사를 돌릴 수는 있고, 그러면 R2 용량과 Deepgram 크레딧이 남의 손에
나갑니다.

그래서 `teachers.approved` 기본값을 `false` 로 두고, 승인된 강사만 업로드·전사를
할 수 있게 했습니다. 로그인과 목록 보기는 막지 않습니다.

나중에 동료 강사가 생기면 그때는 id 를 지정해서 켜면 됩니다:

```sql
update public.teachers set approved = true where id = '<그 강사 id>';
```

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
