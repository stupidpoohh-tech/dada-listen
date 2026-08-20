/* media.ts — 업로드 파일 전처리.
 *
 * 원본 js/extract.js 를 옮겼다. 브라우저에서 오디오를 추출하지 않는 방침은
 * 그대로 유지한다 — iOS Safari 가 captureStream() 을 지원하지 않는다.
 * 다만 원본과 달리 **서버(Edge Function)에서 ASR 과 함께 오디오를 추출**하므로,
 * 여기서는 원본을 그대로 올리기만 하면 된다 (D-002). 4단계에서 붙는다. */

const EXT_MIME: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  weba: 'audio/webm', wma: 'audio/x-ms-wma',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp', ogv: 'video/ogg',
};

const AUDIO_EXTS = new Set([
  'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'wma',
]);

export function extOf(name: string): string {
  return (name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

/**
 * 파일의 MIME 을 정한다.
 *
 * 브라우저가 file.type 을 빈 문자열로 주는 경우가 흔하다 (윈도우의 .mp3/.m4a,
 * 일부 드래그앤드롭). file.type 만 믿으면 MP3 가 "영상"으로 분류돼 MIME 없이
 * 저장되고 재생이 안 된다. 확장자로 보정한다.
 */
export function resolveMime(file: File): string {
  return file.type || EXT_MIME[extOf(file.name)] || 'application/octet-stream';
}

export function isAudioFile(file: File): boolean {
  const mime = resolveMime(file);
  return mime.startsWith('audio/') || AUDIO_EXTS.has(extOf(file.name));
}

/**
 * 미디어 길이를 초 단위로 읽는다. 실패하면 0.
 * 서버가 정확한 값을 다시 채우므로 여기서는 업로드 직후 표시용이다.
 */
export function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement(isAudioFile(file) ? 'audio' : 'video');
    let url: string | null = null;
    let settled = false;

    const done = (v: number) => {
      if (settled) return;
      settled = true;
      if (url) URL.revokeObjectURL(url);
      resolve(Number.isFinite(v) && v > 0 ? v : 0);
    };

    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      // Chrome 은 duration 헤더가 없는 MP3 에 Infinity 를 준다.
      // 끝으로 seek 하면 실제 길이를 계산한다.
      if (el.duration === Infinity || Number.isNaN(el.duration)) {
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          const d = el.duration;
          el.currentTime = 0;
          done(d);
        };
        try {
          el.currentTime = 1e101;
        } catch {
          done(0);
        }
      } else {
        done(el.duration);
      }
    };
    el.onerror = () => done(0);
    setTimeout(() => done(el.duration), 5000); // 안전망: 절대 멈춰 있지 않게

    try {
      url = URL.createObjectURL(file);
      el.src = url;
    } catch {
      done(0);
    }
  });
}

/** 업로드 입력의 accept 속성. 원본과 같은 목록. */
export const ACCEPT_MEDIA =
  'audio/*,video/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.wma,.mp4,.m4v,.mov,.webm,.mkv,.3gp';
