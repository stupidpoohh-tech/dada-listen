/* student.ts — 공개 학생 링크용 R2 스냅샷.
 *
 * Neon RLS는 익명 학생에게 테이블 접근을 허용하지 않는다.
 * 강사가 로그인한 상태에서 승인한 목록만 본인 소유 R2 경로에 게시한다.
 * 비밀 토큰을 포함한 공유 링크를 가진 사람에게만 목록 및 재생 URL을 제공한다.
 * 별도 SQL 마이그레이션/공개 DB 권한이 필요하지 않다.
 */
import type { Env } from './index';
import { HttpError, json, readJson } from './http';
import { streamUrl } from './media';

type PublicItem = {
  id: string; title: string; folderId: string | null; tags: string[];
  mediaKey: string; mime: string | null; durationSec: number | null;
  clipStartSec: number | null; clipEndSec: number | null; questionNo: string | null;
  createdAt: string;
};
type PublicFolder = { id: string; name: string; color: string; sort: number };
type PublicSegment = { id: string; itemId: string; idx: number; startSec: number; endSec: number; text: string; words: Array<{w: string; s: number | null; e: number | null}> };
type Snapshot = {
  token: string; folders: PublicFolder[]; items: PublicItem[];
  segments: Record<string, PublicSegment[]>; updatedAt: string;
};

const SHARE_PATH = '/.student-share.json';
const ITEM_ID = /^[0-9a-f-]{36}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const OWNER_RE = /^[A-Za-z0-9_-]{4,128}$/;
const MAX_BYTES = 8_000_000;

function fileKey(owner: string): string { return `${owner}${SHARE_PATH}`; }
function shareParts(share: string): {owner: string; token: string} {
  const pos = share.lastIndexOf('.');
  const owner = share.slice(0, pos);
  const token = share.slice(pos + 1);
  if (pos < 0 || !OWNER_RE.test(owner) || !TOKEN_RE.test(token)) {
    throw new HttpError(400, '올바르지 않은 학생 공유 링크입니다');
  }
  return { owner, token };
}
function equalToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

async function readPublished(env: Env, owner: string): Promise<Snapshot | null> {
  const obj = await env.MEDIA.get(fileKey(owner));
  if (!obj) return null;
  try { return await obj.json() as Snapshot; }
  catch { return null; }
}

/** 이미 게시한 링크라면 같은 토큰을 재사용한다. 공유 URL이 바뀌지 않는다. */
export async function publishStudentView(request: Request, env: Env, owner: string): Promise<Response> {
  if (!OWNER_RE.test(owner)) throw new HttpError(400, '계정 식별자 형식이 잘못되었습니다');
  const raw = await request.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, '공유할 듣기 자료가 너무 큽니다');
  let body: {items?: PublicItem[]; folders?: PublicFolder[]; segments?: Record<string,PublicSegment[]>};
  try { body = JSON.parse(raw) as typeof body; }
  catch { throw new HttpError(400, '공유 자료 형식이 잘못되었습니다'); }
  if (!Array.isArray(body.items) || !Array.isArray(body.folders) || !body.segments ||
      typeof body.segments !== 'object' || body.items.length > 600) {
    throw new HttpError(400, '공유할 목록이 잘못되었습니다');
  }
  const items: PublicItem[] = [];
  const segments: Record<string, PublicSegment[]> = {};
  for (const x of body.items) {
    if (!x || !ITEM_ID.test(x.id) || typeof x.title !== 'string' ||
        typeof x.mediaKey !== 'string' || !x.mediaKey.startsWith(owner + '/') ||
        x.mediaKey.endsWith('.transcript.json') || x.mediaKey.endsWith(SHARE_PATH)) {
      throw new HttpError(400, '다른 계정의 음원 또는 잘못된 자료가 포함되어 있습니다');
    }
    const segs = body.segments[x.id];
    if (!Array.isArray(segs) || segs.length > 1000) {
      throw new HttpError(400, '문항별 대본의 형식이 잘못되었습니다');
    }
    // 서버가 읽기 화면에서 필요한 필드만 저장한다. RLS 권한은 건드리지 않는다.
    items.push({
      id:x.id, title:x.title.slice(0,500), folderId:x.folderId ?? null,
      tags:Array.isArray(x.tags) ? x.tags.filter(t => typeof t === 'string').slice(0,30) : [],
      mediaKey:x.mediaKey, mime:x.mime ?? null,
      durationSec:Number.isFinite(x.durationSec) ? x.durationSec : null,
      clipStartSec:Number.isFinite(x.clipStartSec) ? x.clipStartSec : null,
      clipEndSec:Number.isFinite(x.clipEndSec) ? x.clipEndSec : null,
      questionNo:x.questionNo ?? null, createdAt:x.createdAt ?? '',
    });
    segments[x.id] = segs.map((s, idx) => ({
      id: typeof s.id === 'string' ? s.id : `${x.id}-${idx}`,
      itemId: x.id, idx, text: String(s.text ?? '').slice(0,10000),
      startSec: Number(s.startSec) || 0, endSec: Number(s.endSec) || 0,
      words: Array.isArray(s.words) ? s.words : [],
    }));
  }
  const folders = body.folders.filter(x => x && typeof x.id === 'string' &&
    typeof x.name === 'string' && typeof x.color === 'string').slice(0,150);

  const existing = await readPublished(env, owner);
  const token = existing?.token && TOKEN_RE.test(existing.token) ? existing.token : newToken();
  const snapshot: Snapshot = { token, items, folders, segments, updatedAt: new Date().toISOString() };
  await env.MEDIA.put(fileKey(owner), JSON.stringify(snapshot), {
    httpMetadata:{contentType:'application/json'},
  });
  return json({ share: `${owner}.${token}`, count: items.length }, 200, privateHeaders);
}

async function requireShare(env: Env, encoded: string): Promise<Snapshot> {
  const {owner, token} = shareParts(encoded);
  const snapshot = await readPublished(env, owner);
  if (!snapshot?.token || !equalToken(snapshot.token, token)) {
    throw new HttpError(404, '학생 공유 링크가 없거나 만료되었습니다. 선생님에게 새 링크를 요청해 주세요.');
  }
  return snapshot;
}

/** 토큰이 없는 방문자에게 DB 데이터나 버킷 목록을 절대 반환하지 않는다. */
export async function studentLibrary(env: Env, url: URL): Promise<Response> {
  const snapshot = await requireShare(env, url.searchParams.get('share') ?? '');
  return json({
    items:snapshot.items.map(({mediaKey: _privateKey, ...rest}) => ({...rest, mediaKey:null, status:'ready', statusError:null})),
    folders:snapshot.folders,
    segments:snapshot.segments,
    updatedAt:snapshot.updatedAt,
  }, 200, privateHeaders);
}

export async function studentPlay(env: Env, url: URL): Promise<Response> {
  const snapshot = await requireShare(env, url.searchParams.get('share') ?? '');
  const item = snapshot.items.find(x => x.id === url.searchParams.get('item'));
  if (!item) throw new HttpError(404, '공유된 듣기 문항이 아닙니다');
  if (!await env.MEDIA.head(item.mediaKey)) throw new HttpError(404, '원본 음원이 삭제되었습니다');
  const playUrl = await streamUrl(env, url.origin, item.mediaKey, 60 * 60 * 2);
  return json({url:playUrl}, 200, privateHeaders);
}
