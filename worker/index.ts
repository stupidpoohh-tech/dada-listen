/* worker/index.ts — Cloudflare Worker.
 *
 * 지금 범위: 프론트엔드 서빙 + 바인딩 점검(/api/health).
 * 미디어 서명 URL 과 Deepgram 전사는 4단계에서 이 파일에 붙는다.
 *
 * R2 는 바인딩(env.MEDIA)으로 붙으므로 access key 가 필요 없다.
 * 비밀은 wrangler secret put 으로 넣고 env 에서 읽는다 — 코드에 적지 않는다. */

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') return health(env);

    // 4단계에서 구현: /api/media/upload-url, /api/media/play-url,
    // /api/media/delete, /api/transcribe, /api/transcribe/callback
    if (url.pathname.startsWith('/api/')) {
      return json(
        { error: '아직 구현되지 않았습니다', path: url.pathname, step: '4단계' },
        501,
      );
    }

    // 나머지는 빌드된 프론트엔드. SPA 라 없는 경로는 index.html 로 보낸다.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
