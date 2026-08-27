/* media.ts — R2 업로드와 재생.
 *
 * R2 는 바인딩(env.MEDIA)으로 붙는다 — access key 가 없다 (D-012).
 * 그래서 S3 서명 URL 을 만들 수 없고, 업로드와 재생 모두 Worker 를 지나간다.
 * R2→Worker 와 Worker→사용자 모두 egress 가 0원이라 비용 문제는 없다.
 *
 * 업로드는 항상 멀티파트로 한다. 강사가 올리는 건 200MB 짜리 영상일 수 있는데
 * Worker 의 요청 본문 한도를 넘기 때문이다. 파트를 나누면 크기 제한이 사라지고,
 * 코드 경로도 하나로 유지된다 (마지막 파트는 5MB 미만이어도 된다).
 */

import type { Env } from './index';
import { HttpError, json, readJson } from './http';
import { signKey, verifyKey } from './sign';

/** 재생 URL 유효기간. 수업 한 타임보다 넉넉하되 영구는 아니게. */
const PLAY_TTL_SEC = 60 * 60 * 2;

/** Deepgram 이 받아갈 때 쓰는 유효기간. 전사가 끝날 시간을 넉넉히 준다. */
export const FETCH_TTL_SEC = 60 * 60;

const ALLOWED_EXT = /^[a-z0-9]{1,5}$/i;

/**
 * 오브젝트 키는 **서버가 정한다.** 클라이언트가 경로를 정하면 남의 폴더에 쓸 수 있다.
 * 규약: {owner_id}/{item_id}.{ext}
 */
function buildKey(ownerId: string, itemId: string, filename: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new HttpError(400, '잘못된 아이템 id 입니다');
  const ext = filename.match(/\.([a-z0-9]+)$/i)?.[1] ?? '';
  return `${ownerId}/${itemId}${ext && ALLOWED_EXT.test(ext) ? '.' + ext.toLowerCase() : ''}`;
}

/** 이 키가 이 강사 것인지. 경로 첫 조각이 소유자다. */
function assertOwns(ownerId: string, key: string): void {
  if (!key || key.split('/')[0] !== ownerId) {
    throw new HttpError(403, '이 파일에 접근할 권한이 없습니다');
  }
}

/* ------------------------------------------------------------------ *
 * 업로드 (멀티파트)
 * ------------------------------------------------------------------ */

export async function createUpload(request: Request, env: Env, ownerId: string): Promise<Response> {
  const body = await readJson<{ itemId?: string; filename?: string; contentType?: string }>(request);
  if (!body.itemId || !body.filename) throw new HttpError(400, 'itemId 와 filename 이 필요합니다');

  const key = buildKey(ownerId, body.itemId, body.filename);
  const upload = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType: body.contentType || 'application/octet-stream' },
  });
  return json({ key, uploadId: upload.uploadId });
}

export async function uploadPart(request: Request, env: Env, ownerId: string, url: URL): Promise<Response> {
  const key = url.searchParams.get('key') ?? '';
  const uploadId = url.searchParams.get('uploadId') ?? '';
  const partNumber = Number(url.searchParams.get('partNumber'));
  assertOwns(ownerId, key);
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    throw new HttpError(400, '잘못된 파트 요청입니다');
  }
  if (!request.body) throw new HttpError(400, '파트 본문이 비어 있습니다');

  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);
  const part = await upload.uploadPart(partNumber, request.body);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

export async function completeUpload(request: Request, env: Env, ownerId: string): Promise<Response> {
  const body = await readJson<{
    key?: string;
    uploadId?: string;
    parts?: { partNumber: number; etag: string }[];
  }>(request);
  if (!body.key || !body.uploadId || !Array.isArray(body.parts) || body.parts.length === 0) {
    throw new HttpError(400, 'key, uploadId, parts 가 필요합니다');
  }
  assertOwns(ownerId, body.key);

  const upload = env.MEDIA.resumeMultipartUpload(body.key, body.uploadId);
  // 파트 순서가 어긋나면 R2 가 거부한다. 클라이언트가 병렬로 올려도 되게 정렬한다.
  const parts = [...body.parts].sort((a, b) => a.partNumber - b.partNumber);
  const object = await upload.complete(parts);
  return json({ key: body.key, size: object.size, etag: object.httpEtag });
}

export async function abortUpload(request: Request, env: Env, ownerId: string): Promise<Response> {
  const body = await readJson<{ key?: string; uploadId?: string }>(request);
  if (!body.key || !body.uploadId) throw new HttpError(400, 'key 와 uploadId 가 필요합니다');
  assertOwns(ownerId, body.key);
  await env.MEDIA.resumeMultipartUpload(body.key, body.uploadId).abort();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ *
 * 재생
 * ------------------------------------------------------------------ */

/** 서명된 스트리밍 URL 을 만든다. <audio src> 에 그대로 넣는다. */
export async function createPlaybackUrl(
  request: Request,
  env: Env,
  ownerId: string,
  origin: string,
  ttlSec = PLAY_TTL_SEC,
): Promise<Response> {
  const body = await readJson<{ key?: string }>(request);
  if (!body.key) throw new HttpError(400, 'key 가 필요합니다');
  assertOwns(ownerId, body.key);
  return json({ url: await streamUrl(env, origin, body.key, ttlSec), expiresIn: ttlSec });
}

export async function streamUrl(env: Env, origin: string, key: string, ttlSec: number): Promise<string> {
  const secret = env.MEDIA_TOKEN_SECRET;
  if (!secret) throw new HttpError(500, 'MEDIA_TOKEN_SECRET 이 설정되지 않았습니다');
  const { exp, sig } = await signKey(secret, key, ttlSec);
  const u = new URL('/api/media/stream', origin);
  u.searchParams.set('key', key);
  u.searchParams.set('exp', String(exp));
  u.searchParams.set('sig', sig);
  return u.toString();
}

/**
 * 서명을 확인하고 R2 에서 스트리밍한다.
 * **Range 요청을 그대로 넘긴다** — 브라우저가 필요한 구간만 받아가고,
 * 전체를 받아 Blob 을 만들지 않는다 (원본 앱의 실수).
 */
export async function stream(request: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get('key') ?? '';
  const secret = env.MEDIA_TOKEN_SECRET;
  if (!secret) throw new HttpError(500, 'MEDIA_TOKEN_SECRET 이 설정되지 않았습니다');

  const ok = await verifyKey(secret, key, url.searchParams.get('exp'), url.searchParams.get('sig'));
  if (!ok) throw new HttpError(403, '링크가 만료되었거나 올바르지 않습니다');

  const rangeHeader = request.headers.get('range');
  const object = await env.MEDIA.get(key, rangeHeader ? { range: request.headers } : undefined);
  if (!object) throw new HttpError(404, '파일을 찾을 수 없습니다');

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // 서명 URL 자체가 만료되므로 공유 캐시에 남기지 않는다.
  headers.set('cache-control', 'private, max-age=3600');

  const body = 'body' in object ? object.body : null;
  const range = object.range;

  if (rangeHeader && range && 'offset' in range && typeof range.length === 'number') {
    const start = range.offset ?? 0;
    const end = start + range.length - 1;
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(range.length));
    return new Response(body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(body, { status: 200, headers });
}

/* ------------------------------------------------------------------ *
 * 삭제
 * ------------------------------------------------------------------ */

export async function deleteObject(request: Request, env: Env, ownerId: string): Promise<Response> {
  const body = await readJson<{ key?: string }>(request);
  if (!body.key) throw new HttpError(400, 'key 가 필요합니다');
  assertOwns(ownerId, body.key);
  await env.MEDIA.delete(body.key);
  return json({ ok: true });
}
