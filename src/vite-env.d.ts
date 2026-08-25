/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Neon Auth URL. Neon 콘솔 → Auth 에서 복사. */
  readonly VITE_NEON_AUTH_URL: string;
  /** Neon Data API URL (PostgREST 호환). Neon 콘솔 → Data API 에서 복사. */
  readonly VITE_NEON_DATA_API_URL: string;
  /** 미디어 서명 URL 을 발급하는 우리 API 의 베이스. 비면 같은 오리진의 /api. */
  readonly VITE_MEDIA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
