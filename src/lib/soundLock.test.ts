/* 문항 카드 두 개가 동시에 울리면 한 녹음의 서로 다른 구간이 겹쳐 들린다.
 * 실제로 신고된 증상이라 여기서 막아 둔다. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimSound, releaseSound, resetSoundLock } from './soundLock';

const player = () => ({ pause: vi.fn() });

beforeEach(resetSoundLock);

describe('한 번에 하나만 울린다', () => {
  it('새로 재생하면 먼저 울리던 것을 멈춘다', () => {
    const a = player();
    const b = player();
    claimSound(a);
    claimSound(b);
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
  });

  it('같은 것을 다시 맡아도 자기를 멈추지 않는다', () => {
    const a = player();
    claimSound(a);
    claimSound(a);
    expect(a.pause).not.toHaveBeenCalled();
  });

  it('셋이 이어 재생되면 앞의 둘이 차례로 멈춘다', () => {
    const [a, b, c] = [player(), player(), player()];
    claimSound(a);
    claimSound(b);
    claimSound(c);
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).toHaveBeenCalledTimes(1);
    expect(c.pause).not.toHaveBeenCalled();
  });

  it('내려놓은 뒤에는 아무도 멈추지 않는다', () => {
    const a = player();
    const b = player();
    claimSound(a);
    releaseSound(a);
    claimSound(b);
    expect(a.pause).toHaveBeenCalledTimes(0);
  });

  it('맡고 있지 않은 것이 내려놔도 현재 재생을 건드리지 않는다', () => {
    const a = player();
    const b = player();
    claimSound(a);
    releaseSound(b); // b 는 애초에 맡은 적이 없다
    const c = player();
    claimSound(c);
    expect(a.pause).toHaveBeenCalledTimes(1); // a 는 여전히 맡고 있었다
  });

  it('null 을 내려놔도 터지지 않는다', () => {
    const a = player();
    claimSound(a);
    expect(() => releaseSound(null)).not.toThrow();
  });
});
