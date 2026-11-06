/* student.ts — 단일 강사용 학생 공개 목록.
 *
 * 학생은 로그인하지 않는다. Neon RLS를 해제하거나 익명 역할에 테이블 권한을
 * 주지 않고, 승인된 강사가 열람 가능한 음원과 스크립트만 R2 스냅샷으로 게시한다.
 * 이 서비스는 현재 강사 1명만 사용하므로 별도 공유 코드 없이 #/view에 표시한다.
 * 추후 다중 강사 운영 시 별도 공유 범위/코드 설계를 해야 한다.
 */
import type { Env } from './index';
import { HttpError, json } from './http';
import { streamUrl } from './media';

type PublicItem = {
  id: string; title: string; folderId: string | null; tags: string[];
  mediaKey: string; mime: string | null; durationSec: number | null;
  clipStartSec: number | null; clipEndSec: number | null; questionNo: string | null;
  createdAt: string;
};
type PublicFolder = { id: string; name: string; color: string; sort: number };
type PublicSegment = {
  id: string; itemId: string; idx: number; startSec: number; endSec: number;
  text: string; words: Array<{ w: string; s: number | null; e: number | null }>;
};
type Snapshot = {
  owner: string; folders: PublicFolder[]; items: PublicItem[];
  segments: Record<string, PublicSegment[]>; updatedAt: string;
};

const KEY = '__student-library-v1.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8_000_000;
const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

async function readPublished(env: Env): Promise<Snapshot | null> {
  const obj = await env.MEDIA.get(KEY);
  if (!obj) return null;
  try {
    const data = await obj.json<Snapshot>();
    return data && typeof data.owner === 'string' && Array.isArray(data.items) ? data : null;
  } catch {
    return null;
  }
}

/** 승인된 강사 한 명만 학생 화면의 목록을 게시한다. 데이터베이스/비밀키는 노출하지 않는다. */
export async function publishStudentView(request: Request, env: Env, owner: string): Promise<Response> {
  const bytes = Number(request.headers.get('content-length') || '0');
  if (bytes > MAX_BYTES) throw new HttpError(413, '공유할 듣기 자료가 너무 큽니다');

  const existing = await readPublished(env);
  if (existing && existing.owner !== owner) {
    throw new HttpError(403, '현재 학생용 화면은 최초 게시한 강사 계정에서만 관리할 수 있습니다');
  }

  const raw = await request.text();
  if (raw.length > MAX_BYTES) throw new HttpError(413, '공유할 듣기 자료가 너무 큽니다');
  let body: {items?: PublicItem[]; folders?: PublicFolder[]; segments?: Record<string,PublicSegment[]>};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    throw new HttpError(400, '공유 자료 형식이 잘못되었습니다');
  }
  if (!body || !Array.isArray(body.items) || !Array.isArray(body.folders) ||
      !body.segments || typeof body.segments !== 'object' ||
      Array.isArray(body.segments) || body.items.length > 600) {
    throw new HttpError(400, '공유할 목록이 잘못되었습니다');
  }
  const items: PublicItem[] = [];
  const segments: Record<string, PublicSegment[]> = {};
  for (const x of body.items) {
    if (!x || !UUID.test(x.id) || typeof x.title !== 'string' ||
        typeof x.mediaKey !== 'string' || !x.mediaKey.startsWith(owner + '/') ||
        x.mediaKey.endsWith('.transcript.json') ||
        x.clipStartSec !== null && x.clipStartSec !== undefined && !Number.isFinite(x.clipStartSec) ||
        x.clipEndSec !== null && x.clipEndSec !== undefined && !Number.isFinite(x.clipEndSec)) {
      throw new HttpError(400, '다른 계정의 음원 또는 잘못된 자료가 포함되어 있습니다');
    }
    const segs = body.segments[x.id];
    if (!Array.isArray(segs) || segs.length > 1000) {
      throw new HttpError(400, '문항별 대본의 형식이 잘못되었습니다');
    }
    items.push({
      id: x.id, title: x.title.slice(0, 500), folderId: x.folderId ?? null,
      tags: Array.isArray(x.tags) ? x.tags.filter(t => typeof t === 'string').slice(0,30) : [],
      mediaKey: x.mediaKey, mime: x.mime ?? null,
      durationSec: Number.isFinite(x.durationSec) ? x.durationSec : null,
      clipStartSec: Number.isFinite(x.clipStartSec) ? x.clipStartSec : null,
      clipEndSec: Number.isFinite(x.clipEndSec) ? x.clipEndSec : null,
      questionNo: x.questionNo ?? null, createdAt: x.createdAt ?? '',
    });
    segments[x.id] = segs.map((s, idx) => ({
      id: typeof s.id === 'string' ? s.id : `${x.id}-${idx}`,
      itemId: x.id, idx, text: String(s.text ?? '').slice(0, 10000),
      startSec: Number(s.startSec) || 0, endSec: Number(s.endSec) || 0,
      words: Array.isArray(s.words) ? s.words : [],
    }));
  }

  const folders = body.folders.filter(x => x && typeof x.id === 'string' &&
    typeof x.name === 'string' && typeof x.color === 'string').slice(0,150);
  const snapshot: Snapshot = {
    owner, items, folders, segments, updatedAt: new Date().toISOString(),
  };
  await env.MEDIA.put(KEY, JSON.stringify(snapshot), {
    httpMetadata: {contentType:'application/json'},
  });
  return json({ count:items.length }, 200, headers);
}

/** 학생용: 공개 설정된 스냅샷만 제공하고 R2 원본 경로와 소유자 ID는 숨긴다. */
export async function studentLibrary(env: Env): Promise<Response> {
  const snapshot = await readPublished(env);
  if (!snapshot) {
    throw new HttpError(404, '아직 학생용 자료가 게시되지 않았습니다. 관리자 화면을 한 번 열어 주세요.');
  }
  return json({
    items: snapshot.items.map(({mediaKey: _key, ...rest}) => ({
      ...rest, ownerId:'', mediaKey:null, status:'ready', statusError:null, updatedAt:'',
    })),
    folders: snapshot.folders.map(f => ({...f, ownerId:'', createdAt:''})),
    segments: snapshot.segments,
    updatedAt:snapshot.updatedAt,
  }, 200, headers);
}

/** 학생용 재생: 게시된 문항 ID에 대해서만 짧게 유효한 R2 서명 URL을 발급한다. */
export async function studentPlay(env: Env, url: URL): Promise<Response> {
  const snapshot = await readPublished(env);
  if (!snapshot) throw new HttpError(404, '학생용 자료가 게시되지 않았습니다');
  const item = snapshot.items.find(x => x.id === url.searchParams.get('item'));
  if (!item) throw new HttpError(404, '학생용으로 게시된 듣기 문항이 아닙니다');
  if (!await env.MEDIA.head(item.mediaKey)) throw new HttpError(404, '원본 음원이 삭제되었습니다');
  const playUrl = await streamUrl(env, url.origin, item.mediaKey, 60 * 60 * 2);
  return json({url:playUrl}, 200, headers);
}
