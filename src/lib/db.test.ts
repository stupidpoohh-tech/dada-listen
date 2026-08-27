import { describe, expect, it } from 'vitest';
import { __testing } from './db';

const { jwtExpMs } = __testing;

/** 테스트용 JWT 를 만든다. 서명은 검증하지 않으므로 아무 값이나 좋다. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
}

describe('jwtExpMs — Worker 에 보낼 토큰의 만료 판단', () => {
  it('exp 를 밀리초로 읽는다', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(jwtExpMs(makeJwt({ sub: 'u1', exp }))).toBe(exp * 1000);
  });

  it('base64url 의 - 와 _ 를 처리한다', () => {
    // '~~~' 는 표준 base64 에서 '+' 를 만든다. base64url 로 바뀌면 '-' 가 되므로
    // 치환을 되돌리지 않으면 atob 이 실패한다.
    const exp = 1893456000;
    const token = makeJwt({ sub: '~~~', exp });
    const payload = token.split('.')[1] ?? '';
    expect(payload).toMatch(/[-_]/);
    expect(jwtExpMs(token)).toBe(exp * 1000);
  });

  it('exp 가 없으면 곧 만료된 것으로 보아 자주 갱신하게 한다', () => {
    const v = jwtExpMs(makeJwt({ sub: 'u1' }));
    expect(v - Date.now()).toBeLessThanOrEqual(60_000);
    expect(v - Date.now()).toBeGreaterThan(0);
  });

  it('망가진 토큰에도 던지지 않는다', () => {
    // 토큰을 못 읽는다고 앱이 죽으면 안 된다. 짧게 잡고 다시 받아오면 된다.
    for (const bad of ['', 'not-a-jwt', 'a.b', 'a.!!!.c', 'a..c']) {
      const v = jwtExpMs(bad);
      expect(Number.isFinite(v)).toBe(true);
      expect(v - Date.now()).toBeLessThanOrEqual(60_000);
    }
  });

  it('이미 지난 exp 는 과거로 읽힌다 — 갱신을 유발해야 한다', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    expect(jwtExpMs(makeJwt({ sub: 'u1', exp: past }))).toBeLessThan(Date.now());
  });
});
