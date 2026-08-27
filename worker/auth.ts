/* auth.ts — 요청자가 누구인지 확인한다.
 *
 * JWT 서명을 여기서 검증하지 않는다. 토큰을 그대로 Neon Data API 에 넘겨
 * public.whoami() 를 부르면, Neon 이 서명을 검증하고 Postgres 가
 * auth.user_id() 를 돌려준다. 위조가 불가능하고 Worker 에 암호 코드가
 * 들어가지 않는다. (db/migrations/0002_whoami.sql) */

import { HttpError } from './http';

export type Teacher = {
  id: string;
  /**
   * 업로드·전사를 허용할지. Neon Auth 가 공개 가입이라 낯선 사람이 가입할 수
   * 있는데, 그 사람이 전사를 돌리면 Deepgram 크레딧이 남의 손에 나간다.
   * 기본은 false 고 사람이 직접 켠다 (db/migrations/0003_approved_teacher.sql).
   */
  approved: boolean;
};

/** 같은 토큰을 짧게 캐시한다. 업로드 한 번에 여러 요청이 오므로. */
const cache = new Map<string, { teacher: Teacher; expiresAt: number }>();
const TTL_MS = 60_000;

export async function requireTeacher(request: Request, dataApiUrl: string): Promise<Teacher> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, '로그인이 필요합니다');
  }

  const hit = cache.get(header);
  if (hit && hit.expiresAt > Date.now()) return hit.teacher;

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

  // whoami() 는 {id, approved} jsonb 를 돌려준다.
  const body = (await res.json()) as { id?: unknown; approved?: unknown } | null;
  const id = body?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new HttpError(401, '로그인이 필요합니다');
  }
  const teacher: Teacher = { id, approved: body?.approved === true };

  // 캐시가 무한정 자라지 않게. 토큰 종류가 많지 않으므로 단순 상한이면 충분하다.
  if (cache.size > 100) cache.clear();
  cache.set(header, { teacher, expiresAt: Date.now() + TTL_MS });
  return teacher;
}

/**
 * 돈이 나가는 작업(업로드·전사) 앞에서 부른다.
 * 화면을 보는 것은 막지 않는다 — 승인 대기 중에도 로그인과 목록은 된다.
 */
export function requireApproved(teacher: Teacher): void {
  if (!teacher.approved) {
    throw new HttpError(
      403,
      '아직 승인되지 않은 계정입니다. 관리자에게 문의해 주세요.',
    );
  }
}
