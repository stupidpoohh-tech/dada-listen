/* auth.test.ts — 승인 판정과 그 캐시의 동작.
 *
 * 왜 단위 테스트인가: 캐시 TTL 은 60초라 종단 테스트로 확인하려면 1분을 기다려야
 * 한다. 가짜 타이머로 시간만 앞으로 감으면 결정론적으로, 즉시 확인할 수 있다.
 *
 * 여기서 확인하는 것은 **승인 취소가 언제 반영되는가**다. requireTeacher 는
 * 토큰별로 60초 캐시하므로, 관리자가 승인을 취소해도 그동안은 옛 판정이 쓰인다.
 * 그 창이 실제로 얼마인지 숫자로 못박아 둔다. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DATA_API = 'https://data.example.test/rest/v1';
const TOKEN = 'Bearer test.jwt.token';

/** whoami 응답을 흉내낸다. approved 를 바꿔 가며 관리자 승인/취소를 재현한다. */
function stubWhoami(state: { id: string; approved: boolean }) {
  const calls = { count: 0 };
  vi.stubGlobal('fetch', async () => {
    calls.count += 1;
    return new Response(JSON.stringify(state), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return calls;
}

const req = () => new Request('https://worker.test/api/media/create', {
  method: 'POST',
  headers: { authorization: TOKEN },
});

/** 모듈 수준 캐시를 비우려면 모듈을 새로 읽어야 한다. */
async function freshAuth() {
  vi.resetModules();
  return import('./auth');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('승인 판정', () => {
  it('미승인 강사는 돈 나가는 작업에서 막힌다', async () => {
    const { requireTeacher, requireApproved } = await freshAuth();
    stubWhoami({ id: 'teacher_x', approved: false });

    const teacher = await requireTeacher(req(), DATA_API);
    expect(teacher.approved).toBe(false);
    expect(() => requireApproved(teacher)).toThrowError(/승인되지 않은/);
  });

  it('승인된 강사는 통과한다', async () => {
    const { requireTeacher, requireApproved } = await freshAuth();
    stubWhoami({ id: 'teacher_x', approved: true });

    const teacher = await requireTeacher(req(), DATA_API);
    expect(() => requireApproved(teacher)).not.toThrow();
  });
});

describe('승인 취소의 반영 지연 (캐시)', () => {
  it('같은 토큰의 연속 요청은 whoami 를 한 번만 부른다', async () => {
    const { requireTeacher } = await freshAuth();
    const calls = stubWhoami({ id: 'teacher_x', approved: true });

    await requireTeacher(req(), DATA_API);
    await requireTeacher(req(), DATA_API);
    await requireTeacher(req(), DATA_API);

    expect(calls.count).toBe(1);
  });

  it('승인 취소 직후에도 캐시가 살아 있는 동안은 승인 상태로 보인다', async () => {
    const { requireTeacher } = await freshAuth();
    const state = { id: 'teacher_x', approved: true };
    stubWhoami(state);

    expect((await requireTeacher(req(), DATA_API)).approved).toBe(true);

    // 관리자가 승인을 취소한다
    state.approved = false;

    // 59초 뒤: 아직 캐시가 유효하다 → 옛 판정이 쓰인다
    vi.advanceTimersByTime(59_000);
    expect((await requireTeacher(req(), DATA_API)).approved).toBe(true);
  });

  it('60초가 지나면 승인 취소가 반영된다', async () => {
    const { requireTeacher } = await freshAuth();
    const state = { id: 'teacher_x', approved: true };
    stubWhoami(state);

    await requireTeacher(req(), DATA_API);
    state.approved = false;

    vi.advanceTimersByTime(60_001);
    expect((await requireTeacher(req(), DATA_API)).approved).toBe(false);
  });

  it('승인 부여도 같은 만큼 늦게 반영된다', async () => {
    const { requireTeacher } = await freshAuth();
    const state = { id: 'teacher_x', approved: false };
    stubWhoami(state);

    await requireTeacher(req(), DATA_API);
    state.approved = true;

    vi.advanceTimersByTime(59_000);
    expect((await requireTeacher(req(), DATA_API)).approved).toBe(false);

    vi.advanceTimersByTime(2_000);
    expect((await requireTeacher(req(), DATA_API)).approved).toBe(true);
  });
});
