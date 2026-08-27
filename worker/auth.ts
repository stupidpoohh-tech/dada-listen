/* auth.ts — 요청자가 누구인지 확인한다.
 *
 * JWT 서명을 여기서 검증하지 않는다. 토큰을 그대로 Neon Data API 에 넘겨
 * public.whoami() 를 부르면, Neon 이 서명을 검증하고 Postgres 가
 * auth.user_id() 를 돌려준다. 위조가 불가능하고 Worker 에 암호 코드가
 * 들어가지 않는다. (db/migrations/0002_whoami.sql) */

import { HttpError } from './http';

/** 같은 토큰을 짧게 캐시한다. 업로드 한 번에 여러 요청이 오므로. */
const cache = new Map<string, { id: string; expiresAt: number }>();
const TTL_MS = 60_000;

export async function requireTeacherId(request: Request, dataApiUrl: string): Promise<string> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, '로그인이 필요합니다');
  }

  const hit = cache.get(header);
  if (hit && hit.expiresAt > Date.now()) return hit.id;

  let res: Response;
  try {
    res = await fetch(`${dataApiUrl.replace(/\/$/, '')}/rpc/whoami`, {
      method: 'POST',
      headers: {
        authorization: header,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: '{}',
    });
  } catch {
    throw new HttpError(503, '인증 서버에 연결할 수 없습니다');
  }

  if (!res.ok) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요');

  // whoami() 는 text 를 돌려주므로 PostgREST 가 JSON 문자열로 준다.
  const id = (await res.json()) as unknown;
  if (typeof id !== 'string' || id.length === 0) {
    throw new HttpError(401, '로그인이 필요합니다');
  }

  // 캐시가 무한정 자라지 않게. 토큰 종류가 많지 않으므로 단순 상한이면 충분하다.
  if (cache.size > 100) cache.clear();
  cache.set(header, { id, expiresAt: Date.now() + TTL_MS });
  return id;
}
