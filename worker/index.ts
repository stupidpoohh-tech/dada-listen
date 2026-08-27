/* worker/index.ts — Cloudflare Worker.
 *
 * 이 Worker 하나가 세 가지를 한다:
 *   1. 빌드된 프론트엔드 서빙 (env.ASSETS)
 *   2. 미디어 업로드·재생 — R2 에 바인딩으로 붙는다 (media.ts)
 *   3. Deepgram 전사 — 아직 미구현
 *
 * /api/* 는 wrangler.toml 의 run_worker_first 덕분에 정적 자산보다 먼저 온다.
 * 그게 없으면 not_found_handling=single-page-application 이 모든 경로를
 * index.html 로 삼켜서 이 코드가 실행되지 않는다.
 *
 * 비밀은 wrangler secret put 으로 넣고 env 에서 읽는다 — 코드에 적지 않는다. */

import { requireApproved, requireTeacher } from './auth';
import { errorResponse, json, HttpError } from './http';
import {
  startTranscription,
  transcriptionCallback,
  transcriptionResult,
} from './transcribe';
import {
  abortUpload,
  completeUpload,
  createPlaybackUrl,
  createUpload,
  deleteObject,
  stream,
  uploadPart,
} from './media';

export interface Env {
  ASSETS: Fetcher;
  MEDIA: R2Bucket;

  /** 공개 값 (wrangler.toml [vars]) */
  NEON_AUTH_URL: string;
  NEON_DATA_API_URL: string;
  R2_BUCKET: string;

  /** 전사 엔드포인트 재정의. 테스트 전용 — 평소엔 비워 둔다. */
  DEEPGRAM_URL?: string;

  /** 비밀 (wrangler secret put). 없을 수 있으므로 optional 로 둔다. */
  DEEPGRAM_API_KEY?: string;
  MEDIA_TOKEN_SECRET?: string;
  /**
   * 마이그레이션 적용용. Worker 는 쓰지 않는다 — 전사 결과도 클라이언트가
   * 자기 세션으로 DB 에 쓴다. DB 자격증명을 Worker 에 두면 RLS 를 우회하는
   * 경로가 생기므로 일부러 피했다 (transcribe.ts 상단 주석).
   */
  NEON_DATABASE_URL?: string;
}

/**
 * 배포가 제대로 됐는지 한눈에 보는 곳.
 * 비밀은 **값을 절대 돌려주지 않고** 설정 여부만 알린다.
 */
async function health(env: Env): Promise<Response> {
  let r2: string;
  try {
    await env.MEDIA.head('__healthcheck__'); // 없어도 된다. 접근 자체를 확인한다.
    r2 = 'ok';
  } catch (e) {
    r2 = 'error: ' + (e instanceof Error ? e.message : String(e));
  }

  // whoami() 에 실제로 닿는지 본다. 토큰 없이 부르므로 인증은 당연히 거절되는데,
  // 그 **거절의 종류**가 답이다. 404(PGRST202)면 함수가 없거나 Data API 의
  // 스키마 캐시가 옛것이라는 뜻이고, 401/403 이면 함수는 제자리에 있다는 뜻이다.
  // 업로드가 죽었을 때 로그인 없이 확인할 수 있는 유일한 자리라 여기 둔다.
  let whoami: string;
  try {
    const r = await fetch(`${(env.NEON_DATA_API_URL ?? '').replace(/\/$/, '')}/rpc/whoami`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    });
    whoami =
      r.status === 404
        ? '404 — 함수를 찾을 수 없습니다. 0002·0003 마이그레이션을 돌렸는지, ' +
          "그리고 Data API 스키마 캐시가 갱신됐는지 확인하세요 (notify pgrst, 'reload schema')."
        : `${r.status} — 함수는 있습니다 (토큰이 없어 거절된 것은 정상)`;
  } catch (e) {
    whoami = 'error: ' + (e instanceof Error ? e.message : String(e));
  }

  // Worker 가 실제로 쓰는 비밀만 ready 판정에 넣는다.
  const secrets = {
    DEEPGRAM_API_KEY: Boolean(env.DEEPGRAM_API_KEY),
    MEDIA_TOKEN_SECRET: Boolean(env.MEDIA_TOKEN_SECRET),
  };
  const ready = r2 === 'ok' && Object.values(secrets).every(Boolean);

  return json({
    ready,
    r2,
    whoami,
    bucket: env.R2_BUCKET,
    vars: {
      NEON_AUTH_URL: Boolean(env.NEON_AUTH_URL),
      NEON_DATA_API_URL: Boolean(env.NEON_DATA_API_URL),
    },
    secrets,
    // Worker 런타임에는 필요 없다. 마이그레이션을 돌릴 때만 쓴다.
    optional: { NEON_DATABASE_URL: Boolean(env.NEON_DATABASE_URL) },
    note: ready
      ? '설정이 모두 갖춰졌습니다.'
      : '빠진 항목은 docs/setup.md 를 보세요. false 인 비밀은 wrangler secret put 으로 넣습니다.',
  });
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/health') return health(env);

  // 재생만 서명 URL 로 연다. 로그인 토큰을 <audio src> 에 실을 수 없기 때문이다.
  if (path === '/api/media/stream' && method === 'GET') return stream(request, env, url);

  // Deepgram 콜백. 사용자 세션이 없으므로 서명으로만 검증한다.
  if (path === '/api/transcribe/callback' && method === 'POST') {
    return transcriptionCallback(request, env, url);
  }

  // 나머지 /api/media/* 는 전부 로그인한 강사만.
  if (path.startsWith('/api/media/')) {
    const teacher = await requireTeacher(request, env.NEON_DATA_API_URL);
    const ownerId = teacher.id;

    // 새 파일을 올리는 것만 승인이 필요하다. 이미 올린 것을 듣고 지우는 건 된다.
    if (path === '/api/media/create' && method === 'POST') {
      requireApproved(teacher);
      return createUpload(request, env, ownerId);
    }
    if (path === '/api/media/part' && method === 'PUT') {
      requireApproved(teacher);
      return uploadPart(request, env, ownerId, url);
    }
    if (path === '/api/media/complete' && method === 'POST') return completeUpload(request, env, ownerId);
    if (path === '/api/media/abort' && method === 'POST') return abortUpload(request, env, ownerId);
    if (path === '/api/media/play-url' && method === 'POST') {
      return createPlaybackUrl(request, env, ownerId, url.origin);
    }
    if (path === '/api/media/delete' && method === 'POST') return deleteObject(request, env, ownerId);
  }

  if (path.startsWith('/api/transcribe')) {
    const teacher = await requireTeacher(request, env.NEON_DATA_API_URL);
    if (path === '/api/transcribe' && method === 'POST') {
      // 여기가 돈이 나가는 지점이다. 공개 가입이라 승인 확인이 꼭 필요하다.
      requireApproved(teacher);
      return startTranscription(request, env, teacher.id, url.origin);
    }
    if (path === '/api/transcribe/result') {
      return transcriptionResult(request, env, teacher.id, url);
    }
  }

  if (path.startsWith('/api/')) {
    throw new HttpError(501, `아직 구현되지 않았습니다 (${path})`);
  }

  // 나머지는 빌드된 프론트엔드. SPA 라 없는 경로는 index.html 로 간다.
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env, new URL(request.url));
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies ExportedHandler<Env>;
