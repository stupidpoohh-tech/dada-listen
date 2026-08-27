/* mediaApi.ts — 미디어 API 계약 (D-012).
 *
 * R2 는 Worker 에 바인딩으로 붙어 있어서 S3 서명 URL 을 만들 수 없다.
 * 그래서 업로드와 재생 모두 우리 Worker 를 지난다. 이 파일이 그 경계다 —
 * store.ts 는 R2 도 Worker 도 모르고 아래 함수들만 안다. */

const BASE = import.meta.env.VITE_MEDIA_API_URL || '/api';

/** 업로드 파트 크기. Worker 요청 본문 한도 아래로 넉넉히 잡는다. */
export const PART_SIZE = 20 * 1024 * 1024;

export type UploadedPart = { partNumber: number; etag: string };

async function call<T>(path: string, token: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      // 서버가 이 토큰으로 소유자를 확인한다. 클라이언트가 주장하는 id 는 믿지 않는다.
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => '');
    throw new Error(detail || `미디어 API 오류 (${res.status})`);
  }
  return (await res.json()) as T;
}

/** 멀티파트 업로드를 연다. key 는 서버가 정해서 돌려준다. */
export function createUpload(
  token: string,
  itemId: string,
  filename: string,
  contentType: string,
): Promise<{ key: string; uploadId: string }> {
  return call('/media/create', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itemId, filename, contentType }),
  });
}

export function completeUpload(
  token: string,
  key: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<{ key: string; size: number }> {
  return call('/media/complete', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, uploadId, parts }),
  });
}

export function abortUpload(token: string, key: string, uploadId: string): Promise<void> {
  return call<{ ok: true }>('/media/abort', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, uploadId }),
  }).then(() => undefined);
}

/**
 * 재생용 서명 URL.
 * 이 URL 을 그대로 <audio src> 에 넣는다 — 브라우저가 Range 로 스트리밍한다.
 * 전체를 받아 Blob 을 만들지 않는다 (원본 앱의 실수).
 */
export function createPlaybackUrl(
  token: string,
  key: string,
): Promise<{ url: string; expiresIn: number }> {
  return call('/media/play-url', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

export function deleteObject(token: string, key: string): Promise<void> {
  return call<{ ok: true }>('/media/delete', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  }).then(() => undefined);
}

/** 파트 하나를 올린다. 진행률 때문에 fetch 가 아니라 XHR 을 쓴다. */
export function uploadPart(
  token: string,
  key: string,
  uploadId: string,
  partNumber: number,
  blob: Blob,
  onProgress?: (loadedBytes: number) => void,
): Promise<UploadedPart> {
  const q = new URLSearchParams({ key, uploadId, partNumber: String(partNumber) });
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${BASE}/media/part?${q}`);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedPart);
        } catch {
          reject(new Error('업로드 응답을 읽지 못했습니다'));
        }
      } else {
        reject(new Error(`파트 ${partNumber} 업로드 실패 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('업로드 중 네트워크 오류'));
    xhr.onabort = () => reject(new Error('업로드가 취소되었습니다'));
    xhr.send(blob);
  });
}
