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

function make() {
  return createClient({
    auth: { adapter: SupabaseAuthAdapter(), url: authUrl },
    dataApi: { url: dataApiUrl },
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
