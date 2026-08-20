/* store.ts — 영속화 경계. 컴포넌트는 supabase 클라이언트를 직접 부르지 않는다.
 *
 * 원본 window.LDB 의 시그니처를 따르지 않는다 (D-009). 특히 getBlobURL(path)
 * 은 "전체를 받아 Blob URL 을 만든다"는 잘못된 동작을 API 에 박아둔 것이라
 * 그대로 옮길 수 없다. 여기서는 getMediaUrl 이 서명 URL 을 돌려주고,
 * <audio src> 가 Range 요청으로 스트리밍한다 (D-010).
 *
 * DB 는 snake_case, 앱은 camelCase. 변환은 이 파일 안에서만 한다. */

import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Level } from './gapfill';
import type {
  Folder,
  GapOverrideRow,
  Item,
  ItemStatus,
  NewItem,
  Segment,
  Teacher,
  Word,
} from './types';
import { extOf, resolveMime } from './media';

/* ------------------------------------------------------------------ *
 * 인증 — auth.users 의 모든 행은 강사다. 학생은 계정을 갖지 않는다 (D-005).
 * ------------------------------------------------------------------ */

export function onAuthChange(cb: (user: User | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_e, session: Session | null) => {
    cb(session?.user ?? null);
  });
  // 이미 저장된 세션이 있으면 즉시 알려준다 (원본의 setPersistence(LOCAL) 체감).
  void supabase.auth.getSession().then(({ data: d }) => cb(d.session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

export async function getTeacher(): Promise<Teacher | null> {
  const { data, error } = await supabase.from('teachers').select('id, name').maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, name: data.name } : null;
}

/** 현재 로그인한 강사의 id. 없으면 던진다 — owner_id 를 채워야 하는 곳에서 쓴다. */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error('로그인이 필요합니다');
  return data.user.id;
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
  mediaPath: (r.media_path as string | null) ?? null,
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
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .order('sort')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map(toFolder);
}

export async function createFolder(name: string, color: string): Promise<Folder> {
  const ownerId = await requireUserId();
  const { data, error } = await supabase
    .from('folders')
    .insert({ owner_id: ownerId, name, color })
    .select()
    .single();
  if (error) throw error;
  return toFolder(data);
}

export async function updateFolder(
  id: string,
  patch: Partial<Pick<Folder, 'name' | 'color' | 'sort'>>,
): Promise<void> {
  const { error } = await supabase.from('folders').update(patch).eq('id', id);
  if (error) throw error;
}

/** 폴더만 지운다. 안의 아이템은 folder_id 가 null 이 될 뿐 살아남는다. */
export async function deleteFolder(id: string): Promise<void> {
  const { error } = await supabase.from('folders').delete().eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * 아이템
 * ------------------------------------------------------------------ */

export async function listItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toItem);
}

export async function getItem(id: string): Promise<Item | null> {
  const { data, error } = await supabase.from('items').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toItem(data) : null;
}

export async function createItem(input: NewItem): Promise<Item> {
  const ownerId = await requireUserId();
  const { data, error } = await supabase
    .from('items')
    .insert({
      owner_id: ownerId,
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

  const { error } = await supabase.from('items').update(row).eq('id', id);
  if (error) throw error;
}

/** 아이템과 미디어를 함께 지운다. 세그먼트는 on delete cascade 로 따라간다. */
export async function deleteItem(id: string): Promise<void> {
  const item = await getItem(id);
  const { error } = await supabase.from('items').delete().eq('id', id);
  if (error) throw error;
  // 행이 사라진 뒤에 파일을 지운다. 반대로 하면 삭제가 실패했을 때 재생 불가인
  // 고아 행이 남는다.
  if (item?.mediaPath) await deleteMedia(item.mediaPath).catch(() => {});
}

/* ------------------------------------------------------------------ *
 * 세그먼트
 * ------------------------------------------------------------------ */

export async function listSegments(itemId: string): Promise<Segment[]> {
  const { data, error } = await supabase
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
  const { error: delErr } = await supabase.from('segments').delete().eq('item_id', itemId);
  if (delErr) throw delErr;
  if (segments.length === 0) return [];

  const { data, error } = await supabase
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
  const { data, error } = await supabase
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
  const { error } = await supabase.from('gap_overrides').upsert(
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
  const { error } = await supabase
    .from('gap_overrides')
    .delete()
    .eq('segment_id', segmentId)
    .eq('word_idx', wordIdx)
    .eq('level', level);
  if (error) throw error;
}

/* ------------------------------------------------------------------ *
 * 미디어 — private 버킷 + 서명 URL (D-010)
 * ------------------------------------------------------------------ */

const BUCKET = 'media';

/** 서명 URL 유효기간. 수업 한 타임보다 넉넉하되 영구는 아니게. */
const SIGNED_URL_TTL_SEC = 60 * 60 * 2;

/** 만료 직전에 미리 갱신할 여유. */
const REFRESH_MARGIN_MS = 60 * 1000;

const urlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * 파일을 올리고 Storage 경로를 돌려준다.
 * 경로 규약 {owner_id}/{item_id}.{ext} — Storage RLS 가 첫 세그먼트로 격리한다.
 */
export async function uploadMedia(itemId: string, file: File): Promise<string> {
  const ownerId = await requireUserId();
  const ext = extOf(file.name);
  const path = `${ownerId}/${itemId}${ext ? '.' + ext : ''}`;
  const mime = resolveMime(file);

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw error;

  const { error: updErr } = await supabase
    .from('items')
    .update({ media_path: path, mime })
    .eq('id', itemId);
  if (updErr) throw updErr;

  urlCache.delete(path);
  return path;
}

/**
 * 재생용 URL. **서명 URL 을 그대로 <audio src> 에 넣는다.**
 * 전체를 받아 Blob 을 만들지 않는다 — 브라우저가 Range 요청으로 스트리밍한다.
 * 원본 앱이 청크를 전부 받아 이어붙이던 것이 메모리 누수의 원인이었다.
 */
export async function getMediaUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  // 예전 데이터나 외부 링크는 그대로 쓴다.
  if (/^https?:/.test(path)) return path;

  const hit = urlCache.get(path);
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit.url;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC);
  if (error) throw error;

  const url = data.signedUrl;
  urlCache.set(path, { url, expiresAt: Date.now() + SIGNED_URL_TTL_SEC * 1000 });
  return url;
}

export async function deleteMedia(path: string): Promise<void> {
  if (!path || /^https?:/.test(path)) return;
  urlCache.delete(path);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/** 테스트와 로그아웃 시 캐시를 비운다. */
export function clearMediaUrlCache(): void {
  urlCache.clear();
}
