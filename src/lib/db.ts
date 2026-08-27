/* db.ts — Neon 클라이언트 초기화. 이 파일과 store.ts 만 SDK 를 import 한다.
 *
 * Neon Data API 는 PostgREST 호환이고, 브라우저가 JWT 를 들고 DB 를 직접 친다.
 * 권한은 전적으로 RLS 가 담당한다 (db/migrations/0001_init.sql).
 * SupabaseAuthAdapter 를 쓰는 이유는 취향이 아니라, 인증 API 표면이
 * 기존 코드와 같아 store.ts 의 인증부를 그대로 둘 수 있어서다.
 *
 * R2 자격증명과 Deepgram 키는 절대 여기 오지 않는다 — 서버 함수 전용. */

import { SupabaseAuthAdapter, createClient } from '@neondatabase/neon-js';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL;

/** 환경변수가 갖춰졌는지. 없으면 흰 화면 대신 안내를 띄운다 (main.tsx). */
export const isConfigured = Boolean(authUrl && dataApiUrl);

/* ------------------------------------------------------------------ *
 * Data API 토큰 가로채기
 *
 * 우리 Worker(미디어·전사)도 같은 신원을 확인해야 한다. 그런데 Data API 가
 * 받는 토큰은 **세션 토큰이 아니라 JWT** 이고, 그 JWT 를 만드는 getJWTToken 은
 * 클라이언트 표면에 노출돼 있지 않다. 세션의 access_token 을 대신 보내면
 * Data API 가 거절한다 (실제로 업로드가 "로그인이 만료되었습니다" 로 죽었다).
 *
 * SDK 내부를 뒤지는 대신, 공개 설정인 options.global.fetch 를 쓴다.
 * SDK 는 Authorization 헤더를 붙인 뒤 이 fetch 를 부르므로, 여기서 진짜 JWT 를
 * 그대로 집어낼 수 있다.
 * ------------------------------------------------------------------ */

let captured: { token: string; expMs: number } | null = null;

/** JWT 의 exp 를 읽는다. 못 읽으면 짧게 잡아 자주 갱신되게 한다. */
function jwtExpMs(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return Date.now() + 60_000;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp * 1000 : Date.now() + 60_000;
  } catch {
    return Date.now() + 60_000;
  }
}

const capturingFetch: typeof fetch = (input, init) => {
  const auth = new Headers(init?.headers).get('authorization');
  if (auth && /^bearer /i.test(auth)) {
    const token = auth.slice(7);
    captured = { token, expMs: jwtExpMs(token) };
  }
  return fetch(input, init);
};

function make() {
  return createClient({
    auth: { adapter: SupabaseAuthAdapter(), url: authUrl },
    dataApi: { url: dataApiUrl, options: { global: { fetch: capturingFetch } } },
  });
}

type Client = ReturnType<typeof make>;

/**
 * 설정이 없으면 접근하는 순간 던진다. 모듈 로드 시점에 던지면 앱 전체가
 * 흰 화면이 되어 원인을 알 수 없다.
 */
export const db: Client = isConfigured
  ? make()
  : (new Proxy({} as Client, {
      get() {
        throw new Error('Neon 환경변수가 설정되지 않았습니다');
      },
    }) as Client);

/** 만료까지 이만큼 남지 않았으면 새로 받아 온다. */
const REFRESH_MARGIN_MS = 60_000;

/**
 * 우리 Worker 에 실을 Data API JWT.
 *
 * 아직 가로챈 게 없거나 곧 만료되면 가벼운 Data API 요청을 한 번 보내
 * SDK 가 새 토큰을 붙이게 만든다. 응답 자체는 쓰지 않는다.
 */
export async function getDataApiToken(): Promise<string> {
  if (captured && captured.expMs - Date.now() > REFRESH_MARGIN_MS) return captured.token;

  await db.from('teachers').select('id').limit(1);

  if (!captured) throw new Error('로그인이 필요합니다');
  return captured.token;
}

/** 로그아웃 시 비운다. 남의 세션에 이전 토큰이 남지 않게. */
export function clearDataApiToken(): void {
  captured = null;
}

/** 테스트용. 가로채기 로직만 따로 확인한다. */
export const __testing = { jwtExpMs };
