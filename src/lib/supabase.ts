/* supabase.ts — 클라이언트 초기화. 이 파일과 store.ts 만 supabase-js 를 import 한다.
 *
 * anon key 는 공개되어도 되는 키다. 실제 권한은 RLS 가 담당한다.
 * service_role 키와 ASR API 키는 절대 여기 오지 않는다 — Edge Function 전용. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** 환경변수가 갖춰졌는지. 없으면 흰 화면 대신 안내를 띄운다 (main.tsx). */
export const isConfigured = Boolean(url && anonKey);

/**
 * 설정이 없으면 접근하는 순간 던진다. 모듈 로드 시점에 던지면 앱 전체가
 * 흰 화면이 되어 원인을 알 수 없다.
 */
export const supabase: SupabaseClient = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        // 강사 로그인은 이 브라우저에 유지된다 (원본의 setPersistence(LOCAL) 과 같은 동작).
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : (new Proxy({} as SupabaseClient, {
      get() {
        throw new Error('Supabase 환경변수가 설정되지 않았습니다');
      },
    }) as SupabaseClient);
