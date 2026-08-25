/* store.ts — 영속화 경계. 컴포넌트는 DB 클라이언트를 직접 부르지 않는다.
 *
 * 원본 window.LDB 의 시그니처를 따르지 않는다 (D-009). 특히 getBlobURL(path)
 * 은 "전체를 받아 Blob URL 을 만든다"는 잘못된 동작을 API 에 박아둔 것이라
 * 그대로 옮길 수 없다. 여기서는 getMediaUrl 이 서명 URL 을 돌려주고,
 * <audio src> 가 Range 요청으로 스트리밍한다 (D-012).
 *
 * DB 는 snake_case, 앱은 camelCase. 변환은 이 파일 안에서만 한다. */

import { db } from './db';
import { createPlaybackUrl, createUploadUrl, deleteObject } from './mediaApi';
import type { Level } from './gapfill';
import type {
  AuthUser,
  Folder,
  GapOverrideRow,
  Item,
  ItemStatus,
  NewItem,
  Segment,
  Teacher,
  Word,
} from './types';
import { resolveMime } from './media';

/* ------------------------------------------------------------------ *
 * 인증 — auth.users 의 모든 행은 강사다. 학생은 계정을 갖지 않는다 (D-005).
 * ------------------------------------------------------------------ */

type SessionUser = { id: string; email?: string | null } | null | undefined;

const toAuthUser = (u: SessionUser): AuthUser | null =>
  u ? { id: u.id, email: u.email ?? null } : null;

export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const { data } = db.auth.onAuthStateChange((_e, session) => {
    cb(toAuthUser(session?.user));
  });
  // 이미 저장된 세션이 있으면 즉시 알려준다 (원본의 setPersistence(LOCAL) 체감).
  // 실패해도 반드시 한 번은 콜백해야 한다. 안 그러면 호출부가 "인증 확인 중"에
  // 영영 갇혀서, 네트워크가 끊겼을 때 이유 없는 로딩 화면만 남는다.
  void db.auth
    .getSession()
    .then(({ data: d }) => cb(toAuthUser(d.session?.user)))
    .catch(() => cb(null));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  clearMediaUrlCache();
  const { error } = await db.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await db.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

/**
 * 강사 프로필. 첫 로그인이면 만들어 준다.
 * teachers.id 는 default auth.user_id() 라서 id 를 실어 보내지 않아도 된다.
 */
export async function ensureTeacher(name: string): Promise<Teacher> {
  const { data, error } = await db
    .from('teachers')
    .upsert({ name }, { onConflict: 'id', ignoreDuplicates: false })
    .select('id, name')
    .single();
  if (error) throw error;
  return { id: data.id as string, name: data.name as string };
}

export async function getTeacher(): Promise<Teacher | null> {
  const { data, error } = await db.from('teachers').select('id, name').maybeSingle();
  if (error) throw error;
  return data ? { id: data.id as string, name: data.name as string } : null;
}

/** 미디어 API 호출에 실을 액세스 토큰. 서버가 이걸로 소유자를 확인한다. */
async function requireToken(): Promise<string> {
  const { data, error } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new Error('로그인이 필요합니다');
  return token;
}

/* ------------------------------------------------------------------ *
 * 행 변환
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const toFolder = (r: Row): Folder => ({
  id: r.id as string,
  ownerId: r.owner_id as string,
  name: r.name as string,
  color: r.color as string,
  sort: r.sort as number,
  createdAt: r.created_at as string,
});

const toItem = (r: Row): Item => ({
  id: r.id as string,
  ownerId: r.owner_id as string,
  folderId: (r.folder_id as string | null) ?? null,
  title: r.title as string,
  tags: (r.tags as string[] | null) ?? [],
  mediaKey: (r.media_key as string | null) ?? null,
  mime: (r.mime as string | null) ?? null,
  durationSec: (r.duration_sec as number | null) ?? null,
  status: r.status as ItemStatus,
  statusError: (r.status_error as string | null) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toSegment = (r: Row): Segment => ({
  id: r.id as string,
  itemId: r.item_id as string,
  idx: r.idx as number,
  startSec: r.start_sec as number,
  endSec: r.end_sec as number,
  text: r.text as string,
  words: (r.words as Word[] | null) ?? [],
});

const toGapOverride = (r: Row): GapOverrideRow => ({
  id: r.id as string,
  itemId: r.item_id as string,
  segmentId: r.segment_id as string,
  wordIdx: r.word_idx as number,
  word: r.word as string,
  level: r.level as Level,
  enabled: r.enabled as boolean,
});

/* ------------------------------------------------------------------ *
 * 폴더
 * ------------------------------------------------------------------ */

export async function listFolders(): Promise<Folder[]> {
  const { data, error } = await db
    .from('folders')
    .select('*')
    .order('sort')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toFolder);
}

export async function createFolder(name: string, color: string): Promise<Folder> {
  // owner_id 는 DB 가 default auth.user_id() 로 채운다. 클라이언트가 주장하지 않는다.
  const { data, error } = await db
    .from('folders')
    .insert({ name, color })
    .select()
    .single();
  if (error) throw error;
  return toFolder(data);
}

export async function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, 'name' | 'color' | 'sort'>>,
): Promise<void> {
  const { error } = await db.from('folders').update(patch).eq('id', id);
  if (error) throw error;
}

/** 폴더만 지운다. 안의 아이템은 folder_id 가 null 이 될 뿐 살아남는다. */
export async function deleteFolder(id: string): Promise<void> {
  const { error } = await db.from('folders').delete().eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * 아이템
 * ------------------------------------------------------------------ */

export async function listItems(): Promise<Item[]> {
  const { data, error } = await db
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toItem);
}

export async function getItem(id: string): Promise<Item | null> {
  const { data, error } = await db.from('items').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toItem(data) : null;
}

export async function createItem(input: NewItem): Promise<Item> {
  const { data, error } = await db
    .from('items')
    .insert({
      title: input.title,
      folder_id: input.folderId ?? null,
      tags: input.tags ?? [],
    })
    .select()
    .single();
  if (error) throw error;
  return toItem(data);
}

export async function updateItem(
  id: string,
  patch: Partial<Pick<Item, 'title' | 'folderId' | 'tags' | 'durationSec' | 'status' | 'statusError'>>,
): Promise<void> {
  // undefined 인 키를 그대로 보내면 의도치 않게 컬럼을 건드린다. 있는 것만 싣는다.
  // (원본이 Firestore 의 undefined 거부를 deep-clean 으로 막던 것과 같은 방어.)
  const row: Row = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.folderId !== undefined) row.folder_id = patch.folderId;
  if (patch.tags !== undefined) row.tags = patch.tags;
  if (patch.durationSec !== undefined) row.duration_sec = patch.durationSec;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.statusError !== undefined) row.status_error = patch.statusError;
  if (Object.keys(row).length === 0) return;

  const { error } = await db.from('items').update(row).eq('id', id);
  if (error) throw error;
}

/** 아이템과 미디어를 함께 지운다. 세그먼트는 on delete cascade 로 따라간다. */
export async function deleteItem(id: string): Promise<void> {
  const item = await getItem(id);
  const { error } = await db.from('items').delete().eq('id', id);
  if (error) throw error;
  // 행이 사라진 뒤에 파일을 지운다. 반대로 하면 삭제가 실패했을 때 재생 불가인
  // 고아 행이 남는다.
  if (item?.mediaKey) await deleteMedia(item.mediaKey).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * 세그먼트
 * ------------------------------------------------------------------ */

export async function listSegments(itemId: string): Promise<Segment[]> {
  const { data, error } = await db
    .from('segments')
    .select('*')
    .eq('item_id', itemId)
    .order('idx');
  if (error) throw error;
  return (data ?? []).map(toSegment);
}

/** 아이템의 세그먼트를 통째로 교체한다. ASR 결과 저장과 강사 교정에 쓴다. */
export async function replaceSegments(
  itemId: string,
  segments: readonly Omit<Segment, 'id' | 'itemId'>[],
): Promise<Segment[]> {
  const { error: delErr } = await db.from('segments').delete().eq('item_id', itemId);
  if (delErr) throw delErr;
  if (segments.length === 0) return [];

  const { data, error } = await db
    .from('segments')
    .insert(
      segments.map((s) => ({
        item_id: itemId,
        idx: s.idx,
        start_sec: s.startSec,
        end_sec: s.endSec,
        text: s.text,
        words: s.words,
      })),
    )
    .select();
  if (error) throw error;
  return (data ?? []).map(toSegment).sort((a, b) => a.idx - b.idx);
}

/* ------------------------------------------------------------------ *
 * 빈칸 override — 강사가 손으로 켜고 끈 것만 저장한다 (D-007)
 * ------------------------------------------------------------------ */

export async function listGapOverrides(itemId: string, level: Level): Promise<GapOverrideRow[]> {
  const { data, error } = await db
    .from('gap_overrides')
    .select('*')
    .eq('item_id', itemId)
    .eq('level', level);
  if (error) throw error;
  return (data ?? []).map(toGapOverride);
}

export async function setGapOverride(
  itemId: string,
  segmentId: string,
  wordIdx: number,
  word: string,
  level: Level,
  enabled: boolean,
): Promise<void> {
  const { error } = await db.from('gap_overrides').upsert(
    { item_id: itemId, segment_id: segmentId, word_idx: wordIdx, word, level, enabled },
    { onConflict: 'segment_id,level,word_idx' },
  );
  if (error) throw error;
}

/** 자동 선정으로 되돌린다. */
export async function clearGapOverride(
  segmentId: string,
  wordIdx: number,
  level: Level,
): Promise<void> {
  const { error } = await db
    .from('gap_overrides')
    .delete()
    .eq('segment_id', segmentId)
    .eq('word_idx', wordIdx)
    .eq('level', level);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * 미디어 — Cloudflare R2 + 서명 URL (D-012)
 *
 * R2 자격증명은 서버에만 있다. 브라우저는 우리 API 에서 서명 URL 을 받아
 * 그것으로만 올리고 재생한다. 발급 엔드포인트는 mediaApi.ts 참조.
 * ------------------------------------------------------------------ */

/** 서명 URL 유효기간(초). 수업 한 타임보다 넉넉하되 영구는 아니게. */
const SIGNED_URL_TTL_SEC = 60 * 60 * 2;

/** 만료 직전에 미리 갱신할 여유. */
const REFRESH_MARGIN_MS = 60 * 1000;

const urlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * 파일을 R2 에 올리고 오브젝트 키를 돌려준다.
 * 키는 서버가 정한다 — 클라이언트가 경로를 정하면 남의 폴더에 쓸 수 있다.
 */
export async function uploadMedia(
  itemId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const token = await requireToken();
  const contentType = resolveMime(file);
  const { url, key } = await createUploadUrl(token, itemId, file.name, contentType);

  await putWithProgress(url, file, contentType, onProgress);

  const { error } = await db.from('items').update({ media_key: key, mime: contentType }).eq('id', itemId);
  if (error) throw error;

  urlCache.delete(key);
  return key;
}

/**
 * XHR 을 쓰는 이유는 진행률 때문이다. fetch 는 업로드 진행률을 주지 않는데,
 * 수백 MB 짜리 영상을 올리는 동안 아무 표시가 없으면 멈춘 것처럼 보인다.
 */
function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`업로드 실패 (${xhr.status})`));
    xhr.onerror = () => reject(new Error('업로드 중 네트워크 오류'));
    xhr.onabort = () => reject(new Error('업로드가 취소되었습니다'));
    xhr.send(file);
  });
}

/**
 * 재생용 URL. **서명 URL 을 그대로 <audio src> 에 넣는다.**
 * 전체를 받아 Blob 을 만들지 않는다 — 브라우저가 Range 요청으로 스트리밍한다.
 * 원본 앱이 청크를 전부 받아 이어붙이던 것이 메모리 누수의 원인이었다.
 */
export async function getMediaUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  // 예전 데이터나 외부 링크는 그대로 쓴다.
  if (/^https?:/.test(key)) return key;

  const hit = urlCache.get(key);
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit.url;

  const token = await requireToken();
  const { url, expiresIn } = await createPlaybackUrl(token, key);
  urlCache.set(key, { url, expiresAt: Date.now() + (expiresIn || SIGNED_URL_TTL_SEC) * 1000 });
  return url;
}

export async function deleteMedia(key: string): Promise<void> {
  if (!key || /^https?:/.test(key)) return;
  urlCache.delete(key);
  await deleteObject(await requireToken(), key);
}

/** 로그아웃 시 캐시를 비운다. 남의 세션에 이전 서명 URL 이 남지 않게. */
export function clearMediaUrlCache(): void {
  urlCache.clear();
}
