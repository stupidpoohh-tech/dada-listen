/* sign.ts — 미디어 재생 URL 서명.
 *
 * R2 버킷은 비공개다. 재생할 때마다 로그인 토큰을 실을 수 없으므로
 * (<audio src> 에는 헤더를 붙일 수 없다) 유효기간이 있는 서명 URL 을 만든다.
 * Deepgram 이 파일을 받아갈 때도 같은 URL 을 쓴다. */

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function mac(secret: string, payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)));
}

/** 길이가 달라도 같은 시간이 걸리게 비교한다. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signKey(secret: string, objectKey: string, ttlSec: number): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return { exp, sig: await mac(secret, `${objectKey}:${exp}`) };
}

export async function verifyKey(
  secret: string,
  objectKey: string,
  exp: string | null,
  sig: string | null,
): Promise<boolean> {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) return false;
  return timingSafeEqual(sig, await mac(secret, `${objectKey}:${expNum}`));
}
