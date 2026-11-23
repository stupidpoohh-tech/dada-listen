/* 음원의 실제 3초 이상 무음으로 구간을 계산한다. ASR 타임스탬프와 독립. */
export type ClipRange = { no: number; startSec: number; endSec: number };
export type Silence = { startSec: number; endSec: number };
export const PEAK_THRESHOLD = Math.pow(10, -30 / 20);
export const SILENCE_SECONDS = 3;

export function detectLongSilences(
  peaks: ArrayLike<number>, frameSec: number,
  threshold = PEAK_THRESHOLD, minimumSec = SILENCE_SECONDS,
): Silence[] {
  if (frameSec <= 0) throw new Error('잘못된 샘플 간격입니다');
  const required = Math.ceil(minimumSec / frameSec);
  const out: Silence[] = [];
  let begin = -1;
  const close = (end: number) => {
    if (begin >= 0 && end - begin >= required) {
      out.push({ startSec: begin * frameSec, endSec: end * frameSec });
    }
    begin = -1;
  };
  for (let i = 0; i < peaks.length; i += 1) {
    if (peaks[i]! < threshold) {
      if (begin < 0) begin = i;
    } else if (begin >= 0) close(i);
  }
  if (begin >= 0) close(peaks.length);
  return out;
}

export function passagesFromSilence(
  allSilences: readonly Silence[], durationSec: number, expectedPassages = 16,
): ClipRange[] {
  const silences = allSilences.filter(s =>
    s.endSec - s.startSec >= SILENCE_SECONDS &&
    s.endSec - s.startSec <= 30
  );
  if (silences.length < expectedPassages) {
    throw new Error('문항 사이 긴 무음이 '+expectedPassages+'개 필요한데 '+silences.length+
      '개만 발견했습니다. 임의로 자르지 않으므로 CSV 구간표를 사용해 주세요.');
  }
  const blocks: ClipRange[] = [];
  for (let i = 0; i < expectedPassages; i += 1) {
    const start = i === 0 ? 0 : Math.max(0, silences[i - 1]!.endSec - 0.2);
    const end = Math.min(durationSec, silences[i]!.startSec + 0.65);
    if (end <= start || end - start < 5) throw new Error((i + 1) + '번 경계 검증에 실패했습니다');
    blocks.push({
      no: i + 1,
      startSec: Math.round(start * 100) / 100,
      endSec: Math.round(end * 100) / 100,
    });
  }
  if (expectedPassages === 16) blocks.push({ ...blocks[15]!, no: 17 });
  return blocks;
}

export function peaksFromAudioBuffer(audio: AudioBuffer): Float32Array {
  const step = Math.max(1, Math.round(audio.sampleRate / 10));
  const n = Math.ceil(audio.length / step);
  const peaks = new Float32Array(n);
  for (let channel = 0; channel < audio.numberOfChannels; channel += 1) {
    const samples = audio.getChannelData(channel);
    for (let frame = 0; frame < n; frame += 1) {
      const first = frame * step;
      let peak = peaks[frame]!;
      for (let k = first; k < Math.min(first + step, samples.length); k += 1) {
        const magnitude = Math.abs(samples[k]!);
        if (magnitude > peak) peak = magnitude;
      }
      peaks[frame] = peak;
    }
  }
  return peaks;
}

/** 선택한 음원만 브라우저에서 분석한다. 가벼운 8kHz 디코딩 시도. */
export async function analyzeRemoteAudio(url: string): Promise<ClipRange[]> {
  if (typeof AudioContext === 'undefined') {
    throw new Error('이 브라우저는 음원 분석을 지원하지 않습니다. CSV 구간표를 사용해 주세요.');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('원본 음원 다운로드에 실패했습니다 ('+response.status+')');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 80 * 1024 * 1024) {
    throw new Error('음원이 너무 큽니다. CSV 구간표를 사용해 주세요.');
  }
  const context = new AudioContext({ sampleRate: 8000 });
  try {
    const audio = await context.decodeAudioData(bytes);
    const peaks = peaksFromAudioBuffer(audio);
    const step = Math.max(1, Math.round(audio.sampleRate / 10)) / audio.sampleRate;
    const gaps = detectLongSilences(peaks, step);
    return passagesFromSilence(gaps, audio.duration, 16);
  } catch (e) {
    if (e instanceof Error && /무음|경계/.test(e.message)) throw e;
    throw new Error('음원을 분석하지 못했습니다. CSV 구간표를 사용할 수 있습니다.');
  } finally {
    await context.close().catch(() => {});
  }
}

/** 구간표: 번호, 시작 초, 종료 초. 16·17번은 같은 값을 사용해도 된다. */
export function parseClipCsv(raw: string): ClipRange[] {
  const result: ClipRange[] = [];
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const c = line.split(/[,;\t]/).map(x => x.trim());
    const no = Number(c[0]);
    if (!Number.isInteger(no) || no < 1 || no > 17) {
      if (result.length === 0 && /^(no|number|번호)$/i.test(c[0] ?? '')) continue;
      throw new Error('문항 번호를 읽을 수 없습니다: '+line);
    }
    const startSec = Number(c[1]);
    const endSec = Number(c[2]);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
      throw new Error(no+'번 시작·종료 시간이 올바르지 않습니다');
    }
    if (result.some(x => x.no === no)) throw new Error(no+'번 번호가 중복되었습니다');
    result.push({ no, startSec, endSec });
  }
  if (result.length !== 17 || Array.from({length:17},(_,i)=>i+1).some(n=>!result.some(x=>x.no===n))) {
    throw new Error('1~17번 구간이 모두 필요합니다 (현재 '+result.length+'개)');
  }
  return result.sort((a,b)=>a.no-b.no);
}
