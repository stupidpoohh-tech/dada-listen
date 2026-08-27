/* transcribe.ts — Deepgram 전사 (D-013).
 *
 * 흐름:
 *   1. 클라이언트가 /api/transcribe 를 부른다 (로그인 필요).
 *   2. Worker 가 미디어에 짧은 서명 URL 을 붙여 Deepgram 에 넘기고 즉시 응답한다.
 *      Deepgram 이 파일을 직접 받아가므로 큰 영상도 업로드할 필요가 없고,
 *      영상에서 오디오를 뽑는 것도 그쪽이 한다 — ffmpeg 서버가 필요 없다.
 *   3. 전사가 끝나면 Deepgram 이 /api/transcribe/callback 으로 결과를 보낸다.
 *      Worker 는 이걸 정규화해서 **R2 에** 저장한다.
 *   4. 클라이언트가 /api/transcribe/result 를 폴링해 가져가고, 자기 세션으로
 *      DB 에 쓴다.
 *
 * 3번에서 DB 에 직접 쓰지 않는 이유: 콜백에는 사용자 세션이 없다. DB 자격증명을
 * Worker 에 두면 RLS 를 우회하는 경로가 하나 생긴다. 결과를 R2 에 잠깐 두고
 * 클라이언트가 자기 권한으로 쓰게 하면 그 경로가 아예 없어진다. */

import type { Env } from './index';
import { HttpError, json, readJson } from './http';
import { signKey, verifyKey } from './sign';
import { FETCH_TTL_SEC, streamUrl } from './media';

/** 전사 결과를 잠깐 두는 자리. 클라이언트가 가져가면 지운다. */
const resultKey = (mediaKey: string) => `${mediaKey}.transcript.json`;

/** 콜백 토큰 유효기간. 긴 파일도 넉넉히 끝날 시간. */
const CALLBACK_TTL_SEC = 6 * 60 * 60;

export type Word = { w: string; s: number | null; e: number | null };
export type Segment = { idx: number; startSec: number; endSec: number; text: string; words: Word[] };

/* ------------------------------------------------------------------ *
 * Deepgram 응답 정규화
 * ------------------------------------------------------------------ */

type DgWord = { word?: string; punctuated_word?: string; start?: number; end?: number };
type DgUtterance = { start?: number; end?: number; transcript?: string; words?: DgWord[] };

/**
 * Deepgram 의 발화(utterance) 하나가 segments 테이블의 한 행이 된다.
 * punctuated_word 를 쓰는 이유: 화면에 그대로 보여줄 토큰이어야 하고,
 * 갭필도 그 문자열을 기준으로 빈칸을 잡기 때문이다.
 */
export function toSegments(payload: unknown): Segment[] {
  const results = (payload as { results?: { utterances?: DgUtterance[] } })?.results;
  const utterances = results?.utterances;
  if (!Array.isArray(utterances) || utterances.length === 0) return [];

  const segments: Segment[] = [];
  for (const u of utterances) {
    const text = (u.transcript ?? '').trim();
    if (!text) continue; // 빈 발화는 버린다 — 화면에 빈 줄만 생긴다
    const words: Word[] = (u.words ?? []).map((w) => ({
      w: w.punctuated_word ?? w.word ?? '',
      s: typeof w.start === 'number' ? w.start : null,
      e: typeof w.end === 'number' ? w.end : null,
    })).filter((w) => w.w.length > 0);

    segments.push({
      idx: segments.length,
      startSec: u.start ?? 0,
      endSec: u.end ?? u.start ?? 0,
      text,
      // 단어가 안 왔으면 텍스트를 쪼개 타임스탬프 없이라도 채운다.
      // 문장 단위 기능(문장 클릭 반복)은 그래도 동작한다.
      words: words.length > 0 ? words : text.split(/\s+/).map((w) => ({ w, s: null, e: null })),
    });
  }
  return segments;
}

/* ------------------------------------------------------------------ *
 * 1) 전사 시작
 * ------------------------------------------------------------------ */

export async function startTranscription(
  request: Request,
  env: Env,
  ownerId: string,
  origin: string,
): Promise<Response> {
  // 권한을 설정보다 먼저 본다. 순서를 뒤집으면 설정이 빠졌을 때 권한 없는
  // 요청까지 500 으로 거절되어, 거절된 진짜 이유를 알 수 없게 된다.
  // (실제로 테스트가 이 때문에 엉뚱한 이유로 통과한 적이 있다.)
  const body = await readJson<{ key?: string }>(request);
  const mediaKey = body.key ?? '';
  if (mediaKey.split('/')[0] !== ownerId) throw new HttpError(403, '이 파일에 접근할 권한이 없습니다');

  const head = await env.MEDIA.head(mediaKey);
  if (!head) throw new HttpError(404, '음원을 찾을 수 없습니다');

  if (!env.DEEPGRAM_API_KEY) throw new HttpError(500, 'DEEPGRAM_API_KEY 가 설정되지 않았습니다');
  const secret = env.MEDIA_TOKEN_SECRET;
  if (!secret) throw new HttpError(500, 'MEDIA_TOKEN_SECRET 이 설정되지 않았습니다');

  // 이전 결과가 남아 있으면 지운다. 재전사 시 옛 결과를 가져가는 걸 막는다.
  await env.MEDIA.delete(resultKey(mediaKey)).catch(() => {});

  // Deepgram 이 받아갈 URL. 버킷은 계속 비공개다.
  const fetchUrl = await streamUrl(env, origin, mediaKey, FETCH_TTL_SEC);

  // 콜백이 이 요청의 것인지 확인할 토큰.
  const { exp, sig } = await signKey(secret, `cb:${mediaKey}`, CALLBACK_TTL_SEC);
  const callback = new URL('/api/transcribe/callback', origin);
  callback.searchParams.set('key', mediaKey);
  callback.searchParams.set('exp', String(exp));
  callback.searchParams.set('sig', sig);

  // 기본은 Deepgram. 테스트에서만 스텁으로 바꾼다 (worker/tests).
  const dg = new URL(env.DEEPGRAM_URL || 'https://api.deepgram.com/v1/listen');
  dg.searchParams.set('model', 'nova-3');
  dg.searchParams.set('smart_format', 'true'); // 문장부호·대소문자·문단
  dg.searchParams.set('utterances', 'true');   // 발화 단위 = 우리 세그먼트
  dg.searchParams.set('punctuate', 'true');
  dg.searchParams.set('language', 'en');
  dg.searchParams.set('callback', callback.toString());
  dg.searchParams.set('callback_method', 'post');

  const res = await fetch(dg.toString(), {
    method: 'POST',
    headers: {
      authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: fetchUrl }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 키가 새지 않게 응답 본문은 로그로만 남기고 사용자에게는 상태만 알린다.
    console.error('[deepgram] start failed', res.status, detail);
    throw new HttpError(502, `전사 요청이 거부되었습니다 (${res.status})`);
  }

  const started = (await res.json().catch(() => ({}))) as { request_id?: string };
  return json({ ok: true, requestId: started.request_id ?? null }, 202);
}

/* ------------------------------------------------------------------ *
 * 2) Deepgram 콜백
 * ------------------------------------------------------------------ */

export async function transcriptionCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const secret = env.MEDIA_TOKEN_SECRET;
  if (!secret) throw new HttpError(500, 'MEDIA_TOKEN_SECRET 이 설정되지 않았습니다');

  const mediaKey = url.searchParams.get('key') ?? '';
  const ok = await verifyKey(
    secret,
    `cb:${mediaKey}`,
    url.searchParams.get('exp'),
    url.searchParams.get('sig'),
  );
  // 콜백 주소는 공개돼 있다. 서명이 없으면 아무나 가짜 전사 결과를 밀어넣을 수 있다.
  if (!ok) throw new HttpError(403, '유효하지 않은 콜백입니다');

  const payload = await request.json().catch(() => null);
  const segments = toSegments(payload);

  await env.MEDIA.put(
    resultKey(mediaKey),
    JSON.stringify({
      segments,
      // 세그먼트가 0개면 실패로 본다. 무음이거나 인식이 안 된 경우다.
      error: segments.length === 0 ? '전사 결과가 비어 있습니다. 음성이 들어 있는지 확인해 주세요.' : null,
      at: new Date().toISOString(),
    }),
    { httpMetadata: { contentType: 'application/json' } },
  );

  // Deepgram 은 2xx 가 아니면 재시도한다. 우리는 저장에 성공했으므로 200.
  return json({ ok: true });
}

/* ------------------------------------------------------------------ *
 * 3) 결과 가져가기
 * ------------------------------------------------------------------ */

export async function transcriptionResult(
  request: Request,
  env: Env,
  ownerId: string,
  url: URL,
): Promise<Response> {
  const mediaKey = url.searchParams.get('key') ?? '';
  if (mediaKey.split('/')[0] !== ownerId) throw new HttpError(403, '이 파일에 접근할 권한이 없습니다');

  const object = await env.MEDIA.get(resultKey(mediaKey));
  if (!object) return json({ status: 'processing' }, 202);

  const body = (await object.json()) as { segments?: Segment[]; error?: string | null };

  // 한 번 가져가면 지운다. 임시 보관이지 저장소가 아니다.
  if (request.method === 'DELETE' || url.searchParams.get('consume') === '1') {
    await env.MEDIA.delete(resultKey(mediaKey)).catch(() => {});
  }

  if (body.error) return json({ status: 'failed', error: body.error });
  return json({ status: 'ready', segments: body.segments ?? [] });
}
