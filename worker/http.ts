/* http.ts — 응답 헬퍼와 오류 타입. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/** 오류를 사용자에게 보여줄 수 있는 형태로. 내부 사정은 흘리지 않는다. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  console.error('[worker]', e);
  return json({ error: '서버 오류가 발생했습니다' }, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, '잘못된 요청 형식입니다');
  }
}
