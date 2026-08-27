/* trim.ts — 업로드 전에 필요한 구간만 잘라낸다.
 *
 * 24분짜리 모의고사 음원에서 문제 하나씩 떼어 올리려는 용도다. 잘라서 올리면
 * 아이템 하나가 문제 하나가 되고, 전사도 그 구간만 돌아 결과가 깔끔하다.
 *
 * 왜 브라우저에서 자르나:
 *   서버에서 자르려면 ffmpeg 를 돌릴 자리가 필요하다. Worker 는 못 돌린다.
 *   반면 자르기 자체는 Web Audio 로 충분하고, 잘린 조각만 올리면 업로드 양도
 *   줄어든다 (24분 → 2분).
 *
 * 왜 WAV 로 내보내나:
 *   MP3 로 다시 인코딩하려면 인코더 라이브러리가 필요하다. WAV 는 표준 API 만으로
 *   만들 수 있고, 잘린 조각은 짧아서 크기도 감당된다. Deepgram 도 WAV 를 받는다.
 *   음질 손실이 없다는 것도 장점이다 — 디코드한 PCM 을 그대로 담는다.
 *
 * 모노로 합치는 이유: 말소리라 채널을 나눌 이유가 없고 파일이 절반이 된다.
 */

/** 브라우저가 이 파일을 디코드할 수 있는지. 못 하면 자르기를 권하지 않는다. */
export function canTrim(): boolean {
  return typeof AudioContext !== 'undefined' || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined';
}

type Ctor = new (...args: unknown[]) => AudioContext;

function audioContext(): AudioContext {
  const W = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  const C = W.AudioContext ?? W.webkitAudioContext;
  if (!C) throw new Error('이 브라우저에서는 자르기를 쓸 수 없어요');
  return new C();
}

/**
 * 파일을 디코드한다. 24분짜리면 몇 초 걸리고 메모리도 꽤 쓴다
 * (44.1kHz 스테레오 24분 ≈ 250MB float). 그래서 한 번만 하고 재사용한다.
 */
export async function decode(file: File): Promise<AudioBuffer> {
  const ctx = audioContext();
  try {
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error('이 파일은 브라우저에서 열 수 없어요. 자르지 않고 통째로 올려 주세요');
  } finally {
    void ctx.close();
  }
}

/** 구간을 모노 16비트 PCM WAV 로 만든다. */
export function sliceToWav(buffer: AudioBuffer, startSec: number, endSec: number): Blob {
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor(startSec * rate));
  const to = Math.min(buffer.length, Math.ceil(endSec * rate));
  const frames = Math.max(0, to - from);
  if (frames === 0) throw new Error('선택한 구간이 비어 있어요');

  // 채널을 평균내 모노로. 말소리는 채널을 나눌 이유가 없고 크기가 절반이 된다.
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) mono[i]! += (data[from + i] ?? 0) / channels;
  }

  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM 헤더 길이
  view.setUint16(20, 1, true); // 형식: PCM
  view.setUint16(22, 1, true); // 채널 수: 모노
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // 초당 바이트
  view.setUint16(32, 2, true); // 프레임당 바이트
  view.setUint16(34, 16, true); // 비트 깊이
  ascii(36, 'data');
  view.setUint32(40, frames * 2, true);

  for (let i = 0; i < frames; i++) {
    // 클리핑을 막고 16비트로 옮긴다.
    const v = Math.max(-1, Math.min(1, mono[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }

  return new Blob([bytes], { type: 'audio/wav' });
}

/** 잘린 결과를 업로드할 File 로. 이름에 구간을 남겨 나중에 알아보기 쉽게. */
export function toClipFile(original: string, blob: Blob, startSec: number, endSec: number): File {
  const stem = original.replace(/\.[^.]+$/, '');
  const mmss = (s: number) => `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  return new File([blob], `${stem}_${mmss(startSec)}-${mmss(endSec)}.wav`, { type: 'audio/wav' });
}

/** 잘랐을 때 나올 파일 크기(바이트). 모노 16비트라 초당 rate*2. */
export function estimateSize(buffer: AudioBuffer, startSec: number, endSec: number): number {
  return 44 + Math.max(0, Math.ceil((endSec - startSec) * buffer.sampleRate)) * 2;
}
