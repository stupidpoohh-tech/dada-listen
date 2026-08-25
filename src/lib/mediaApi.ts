/* mediaApi.ts — R2 서명 URL 발급 (D-012).
 *
 * R2 자격증명으로 서명하려면 서버가 필요하다. 브라우저에 키를 둘 수 없으므로
 * 우리 API 에 물어보고 받은 URL 로만 올리고 재생한다.
 *
 * 엔드포인트 구현은 4단계에서 Deepgram 워커와 같은 자리에 붙인다.
 * 여기서는 계약만 정의한다 — store.ts 가 R2 를 어떻게 부르는지 몰라도 되게. */

const BASE = import.meta.env.VITE_MEDIA_API_URL || '/api';

async function post<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // 서버가 이 토큰을 검증해 소유자를 확인한다. 클라이언트가 주장하는
      // owner_id 를 믿으면 남의 경로에 쓸 수 있다.
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`미디어 API 오류 ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return (await res.json()) as T;
}

/** 업로드용 서명 PUT URL. key 는 서버가 정해서 돌려준다. */
export function createUploadUrl(
  token: string,
  itemId: string,
  filename: string,
  contentType: string,
): Promise<{ url: string; key: string }> {
  return post('/media/upload-url', { itemId, filename, contentType }, token);
}

/**
 * 재생용 서명 GET URL.
 * 이 URL 을 그대로 <audio src> 에 넣는다 — 브라우저가 Range 로 스트리밍한다.
 * 전체를 받아 Blob 을 만들지 않는다 (원본 앱의 실수).
 */
export function createPlaybackUrl(
  token: string,
  key: string,
): Promise<{ url: string; expiresIn: number }> {
  return post('/media/play-url', { key }, token);
}

export function deleteObject(token: string, key: string): Promise<void> {
  return post('/media/delete', { key }, token).then(() => undefined);
}
