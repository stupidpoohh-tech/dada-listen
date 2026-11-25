/* soundLock.ts — 한 번에 하나만 소리를 낸다.
 *
 * **모든 문항이 같은 음원 파일을 가리킨다** (D-021: 오디오를 자르지 않고 구간만
 * 가리킨다). 그래서 두 카드가 동시에 울리면 한 녹음의 서로 다른 구간이 겹쳐
 * 들린다 — "다시 들으면 다른 구간이 재생된다"로 보이는 바로 그 증상이다.
 *
 * 새로 재생을 시작한 쪽이 먼저 울리던 쪽을 멈춘다. 재생기 자신은 자기만 알고
 * 남의 사정을 모르므로, 그 조정은 여기 한 곳에 둔다. */

/** 지금 소리를 내고 있는 재생기. 문서 전체에 하나뿐이다. */
let sounding: Pausable | null = null;

/** 멈출 수 있는 것. 테스트에서 가짜를 넣을 수 있게 좁게 잡는다. */
export type Pausable = { pause: () => void };

/** 이 재생기가 소리를 맡는다. 먼저 울리던 것이 있으면 멈춘다. */
export function claimSound(el: Pausable): void {
  if (sounding && sounding !== el) sounding.pause();
  sounding = el;
}

/** 이 재생기가 멈췄다. 자기가 맡고 있을 때만 내려놓는다. */
export function releaseSound(el: Pausable | null): void {
  if (el && sounding === el) sounding = null;
}

/** 테스트용. 모듈 전역 상태를 비운다. */
export function resetSoundLock(): void {
  sounding = null;
}
