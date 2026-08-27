import { describe, expect, it } from 'vitest';
import { estimateSize, sliceToWav, toClipFile } from './trim';

/** AudioBuffer 스텁. sliceToWav 가 쓰는 부분만 갖춘다. */
function fakeBuffer(channels: number[][], sampleRate = 8000): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    length,
    numberOfChannels: channels.length,
    duration: length / sampleRate,
    getChannelData: (i: number) => Float32Array.from(channels[i] ?? []),
  } as unknown as AudioBuffer;
}

/** 만들어진 WAV 를 뜯어본다. */
async function parseWav(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer());
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
  const dataBytes = view.getUint32(40, true);
  const samples: number[] = [];
  for (let i = 0; i < dataBytes / 2; i++) samples.push(view.getInt16(44 + i * 2, true));
  return {
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    dataTag: ascii(36, 4),
    riffSize: view.getUint32(4, true),
    fmtSize: view.getUint32(16, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    dataBytes,
    samples,
    totalBytes: view.byteLength,
  };
}

describe('sliceToWav — WAV 헤더', () => {
  it('표준 헤더 필드가 맞다', async () => {
    const w = await parseWav(sliceToWav(fakeBuffer([new Array(8000).fill(0)]), 0, 1));
    expect(w.riff).toBe('RIFF');
    expect(w.wave).toBe('WAVE');
    expect(w.fmt).toBe('fmt ');
    expect(w.dataTag).toBe('data');
    expect(w.fmtSize).toBe(16);
    expect(w.format).toBe(1); // PCM
    expect(w.bits).toBe(16);
  });

  it('항상 모노로 나온다', async () => {
    const stereo = fakeBuffer([new Array(800).fill(1), new Array(800).fill(-1)]);
    const w = await parseWav(sliceToWav(stereo, 0, 0.1));
    expect(w.channels).toBe(1);
  });

  it('크기 필드들이 서로 맞는다', async () => {
    const w = await parseWav(sliceToWav(fakeBuffer([new Array(8000).fill(0)]), 0, 0.5));
    expect(w.riffSize).toBe(w.totalBytes - 8);
    expect(w.dataBytes).toBe(w.totalBytes - 44);
    expect(w.byteRate).toBe(w.sampleRate * w.blockAlign);
    expect(w.blockAlign).toBe(2); // 모노 16비트
  });

  it('원본 샘플레이트를 유지한다', async () => {
    const w = await parseWav(sliceToWav(fakeBuffer([new Array(4410).fill(0)], 44100), 0, 0.1));
    expect(w.sampleRate).toBe(44100);
  });
});

describe('sliceToWav — 구간 선택', () => {
  const ramp = Array.from({ length: 8000 }, (_, i) => i / 8000); // 1초, 0→1
  const buf = fakeBuffer([ramp]);

  it('요청한 구간만큼만 담는다', async () => {
    const w = await parseWav(sliceToWav(buf, 0.25, 0.75));
    expect(w.samples.length).toBe(4000); // 0.5초 × 8000Hz
  });

  it('구간의 값이 원본과 일치한다', async () => {
    const w = await parseWav(sliceToWav(buf, 0.5, 0.75));
    // 0.5초 지점의 값은 0.5 → 16비트로 약 0.5 * 32767
    expect(w.samples[0]).toBeCloseTo(0.5 * 0x7fff, -2);
    expect(w.samples.at(-1)).toBeCloseTo(0.75 * 0x7fff, -2);
  });

  it('끝을 넘겨 요청해도 버퍼 길이에서 멈춘다', async () => {
    const w = await parseWav(sliceToWav(buf, 0.9, 5));
    expect(w.samples.length).toBe(800); // 0.1초만 남는다
  });

  it('음수 시작은 0으로 본다', async () => {
    const w = await parseWav(sliceToWav(buf, -3, 0.1));
    expect(w.samples.length).toBe(800);
  });

  it('빈 구간은 거부한다 — 소리 없는 파일을 만들지 않는다', () => {
    expect(() => sliceToWav(buf, 0.5, 0.5)).toThrow();
    expect(() => sliceToWav(buf, 0.8, 0.2)).toThrow();
  });
});

describe('sliceToWav — 채널 합치기', () => {
  it('좌우를 평균낸다', async () => {
    const buf = fakeBuffer([new Array(800).fill(1), new Array(800).fill(0)]);
    const w = await parseWav(sliceToWav(buf, 0, 0.1));
    expect(w.samples[0]).toBeCloseTo(0.5 * 0x7fff, -2);
  });

  it('반대 위상이 상쇄된다 (평균이므로 0)', async () => {
    const buf = fakeBuffer([new Array(800).fill(1), new Array(800).fill(-1)]);
    const w = await parseWav(sliceToWav(buf, 0, 0.1));
    expect(w.samples[0]).toBe(0);
  });

  it('범위를 벗어난 값을 잘라낸다 — 뒤집힌 소리가 나지 않게', async () => {
    const buf = fakeBuffer([new Array(800).fill(3), new Array(800).fill(3)]);
    const w = await parseWav(sliceToWav(buf, 0, 0.1));
    expect(w.samples[0]).toBe(0x7fff);
  });
});

describe('estimateSize / toClipFile', () => {
  it('예상 크기가 실제와 맞는다', async () => {
    const buf = fakeBuffer([new Array(8000).fill(0)]);
    const blob = sliceToWav(buf, 0.2, 0.7);
    expect(estimateSize(buf, 0.2, 0.7)).toBe(blob.size);
  });

  it('파일 이름에 구간이 들어간다', () => {
    const f = toClipFile('2023 모의고사.mp3', new Blob(['x']), 65, 130);
    expect(f.name).toBe('2023 모의고사_1m05s-2m10s.wav');
    expect(f.type).toBe('audio/wav');
  });
});
