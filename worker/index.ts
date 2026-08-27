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

import { requireTeacherId } from './auth';
import { errorResponse, json, HttpError } from './http';
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

  /** 비밀 (wrangler secret put). 없을 수 있으므로 optional 로 둔다. */
  DEEPGRAM_API_KEY?: string;
  NEON_DATABASE_URL?: string;
  MEDIA_TOKEN_SECRET?: string;
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

  const secrets = {
    DEEPGRAM_API_KEY: Boolean(env.DEEPGRAM_API_KEY),
    NEON_DATABASE_URL: Boolean(env.NEON_DATABASE_URL),
    MEDIA_TOKEN_SECRET: Boolean(env.MEDIA_TOKEN_SECRET),
  };
  const ready = r2 === 'ok' && Object.values(secrets).every(Boolean);

  return json({
    ready,
    r2,
    bucket: env.R2_BUCKET,
    vars: {
      NEON_AUTH_URL: Boolean(env.NEON_AUTH_URL),
      NEON_DATA_API_URL: Boolean(env.NEON_DATA_API_URL),
    },
    secrets,
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

  // 나머지 /api/media/* 는 전부 로그인한 강사만.
  if (path.startsWith('/api/media/')) {
    const ownerId = await requireTeacherId(request, env.NEON_DATA_API_URL);

    if (path === '/api/media/create' && method === 'POST') return createUpload(request, env, ownerId);
    if (path === '/api/media/part' && method === 'PUT') return uploadPart(request, env, ownerId, url);
    if (path === '/api/media/complete' && method === 'POST') return completeUpload(request, env, ownerId);
    if (path === '/api/media/abort' && method === 'POST') return abortUpload(request, env, ownerId);
    if (path === '/api/media/play-url' && method === 'POST') {
      return createPlaybackUrl(request, env, ownerId, url.origin);
    }
    if (path === '/api/media/delete' && method === 'POST') return deleteObject(request, env, ownerId);
  }

  // 5단계에서 구현: /api/transcribe, /api/transcribe/callback
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
