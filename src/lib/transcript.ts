/* transcript.ts — 선택 대본의 문항 구분, ASR 시점과 공식 문장 정렬.
 *
 * 대본의 철자·문장부호를 우선하되, 시간은 오직 음원 ASR 에서 가져온다.
 * 서로 맞지 않는 대본으로 음원과 무관한 학습 자료를 만들지 않도록
 * 일치도가 낮으면 자동 전사를 그대로 사용한다. */
import type { Segment, Word } from './types';

export type ParsedTranscript = {
  sections: Record<string, string>;
  numbered: boolean;
  plain: string;
};

const HEADING = /^\s*(\d{1,2})(?:\s*[~\-–—]\s*(\d{1,2}))?\s*(?:번|[.)])\s*(.*)$/;
const WORDS = /[A-Za-z]+(?:['’\-][A-Za-z]+)*(?:[.,!?;:]+)?|\d+(?:[.,!?;:]+)?/g;
const WORDS_ONLY = /[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+/g;

function cleanLine(line: string): string {
  const spoken = line.replace(/^\s*(?:M|W)\s*:\s*/i, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .trim();
  // 정답·해설 PDF 의 설명/한국어 해석을 영어 스크립트로 섞지 않는다.
  if (/[가-힣]/.test(spoken) || !/[A-Za-z]/.test(spoken)) return '';
  return spoken;
}

/** 번호(1., 2번, 16~17.)가 있으면 문항별로, 없으면 단일 대본으로 읽는다. */
export function parseTranscript(text: string): ParsedTranscript {
  const raw = text.replace(/\r/g, '').replace(/\u00a0/g, ' ').trim();
  const lines = raw.split('\n');
  const bucket: Record<string, string[]> = {};
  let active: string | null = null;
  let found = false;
  const plain: string[] = [];
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 40 &&
        (!m[2] || (Number(m[2]) > Number(m[1]) && Number(m[2]) <= 40))) {
      active = m[2] ? m[1] + '~' + m[2] : m[1]!;
      if (!bucket[active]) bucket[active] = [];
      found = true;
      const trailing = (m[3] || '').trim();
      if (trailing && !trailing.startsWith('[출제의도]')) {
        const clean = cleanLine(trailing);
        if (clean) bucket[active]!.push(clean);
      }
      continue;
    }
    const cleaned = cleanLine(line);
    if (cleaned) {
      plain.push(cleaned);
      if (active) bucket[active]!.push(cleaned);
    }
  }
  if (!found) return { sections: {}, numbered: false, plain: plain.join(' ') };
  const sections: Record<string, string> = {};
  for (const [no, part] of Object.entries(bucket)) {
    const joined = part.join(' ').trim();
    if (joined) sections[no] = joined;
  }
  return { sections, numbered: true, plain: plain.join(' ') };
}

export function transcriptForQuestion(parsed: ParsedTranscript, no: string, total: number): string | null {
  if (!parsed.numbered) return total === 1 ? parsed.plain : null;
  if (parsed.sections[no]) return parsed.sections[no];
  const n = Number(no);
  if (!Number.isInteger(n)) return null;
  for (const [key, value] of Object.entries(parsed.sections)) {
    const m = /^(\d+)~(\d+)$/.exec(key);
    if (m && n >= Number(m[1]) && n <= Number(m[2])) return value;
  }
  return null;
}

type Token = { w: string; norm: string; seg: number; s: number | null; e: number | null };
function norm(w: string): string {
  const x = w.toLowerCase().replace(/[^a-z0-9]/g, '');
  return x === 'mister' ? 'mr' : x;
}
function tokensOf(text: string): string[] { return text.match(WORDS) ?? []; }

function asrTokens(segments: readonly Segment[]): Token[] {
  const out: Token[] = [];
  segments.forEach((seg, i) => {
    const source: Word[] = seg.words.length ? seg.words :
      (seg.text.match(WORDS_ONLY) ?? []).map(w => ({ w, s: null, e: null }));
    for (const word of source) {
      for (const chunk of word.w.match(WORDS_ONLY) ?? []) {
        const n = norm(chunk);
        if (n) out.push({ w: word.w, norm: n, seg: i, s: word.s, e: word.e });
      }
    }
  });
  return out;
}

export type Alignment = {
  applied: boolean;
  score: number;
  reason: string;
  segments: Segment[];
};

/**
 * LCS 로 원문 단어와 음성 인식 단어의 순서를 맞춘다. 문항 하나의 길이에만
 * 적용하므로 연산량이 작고, 잘못된 대본이면 원본을 보존한다.
 */
export function alignTranscript(segments: readonly Segment[], script: string): Alignment {
  const unchanged = [...segments];
  const official = tokensOf(script);
  const asr = asrTokens(segments);
  if (official.length < 5 || asr.length < 5) {
    return { applied: false, score: 0, reason: '대본 또는 전사 단어가 부족합니다', segments: unchanged };
  }
  // 무제한 붙여넣기에서 모바일 브라우저 메모리가 폭증하는 것을 막는다.
  if (official.length * asr.length > 4000000) {
    return { applied: false, score: 0, reason: '대본이 너무 길어 문항별 구분이 필요합니다', segments: unchanged };
  }

  const n = official.length;
  const m = asr.length;
  const keys = official.map(norm);
  const dp = new Uint16Array((n + 1) * (m + 1));
  const stride = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const offset = i * stride + j;
      dp[offset] = keys[i] && keys[i] === asr[j]!.norm
        ? 1 + dp[(i + 1) * stride + j + 1]!
        : Math.max(dp[(i + 1) * stride + j]!, dp[offset + 1]!);
    }
  }
  const pairs: Array<{ official: number; audio: number }> = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (keys[i] && keys[i] === asr[j]!.norm) {
      pairs.push({ official: i, audio: j });
      i++; j++;
    } else if (dp[(i + 1) * stride + j]! >= dp[i * stride + j + 1]!) {
      i++;
    } else {
      j++;
    }
  }
  const score = pairs.length / Math.max(n, m);
  if (score < 0.54 || pairs.length / n < 0.65) {
    return {
      applied: false, score,
      reason: '대본과 음성이 충분히 일치하지 않아 AI 전사를 유지했습니다',
      segments: unchanged,
    };
  }

  const matchByOfficial = new Map<number, number>(pairs.map(p => [p.official, p.audio]));
  const assigned: Array<Array<{ w: string; s: number | null; e: number | null }>> =
    segments.map(() => []);
  let nextPair = 0;
  for (let k = 0; k < n; k++) {
    while (nextPair < pairs.length && pairs[nextPair]!.official < k) nextPair++;
    const hit = matchByOfficial.get(k);
    const prev = pairs[nextPair - 1];
    const next = pairs[nextPair];
    let segIndex: number;
    if (hit !== undefined) segIndex = asr[hit]!.seg;
    else if (prev && next) {
      const frac = (k - prev.official) / (next.official - prev.official);
      const approx = prev.audio + frac * (next.audio - prev.audio);
      segIndex = asr[Math.max(0, Math.min(m - 1, Math.round(approx)))]!.seg;
    } else if (prev) segIndex = asr[prev.audio]!.seg;
    else if (next) segIndex = asr[next.audio]!.seg;
    else segIndex = 0;
    const timed = hit === undefined ? null : asr[hit]!;
    assigned[segIndex]!.push({ w: official[k]!, s: timed?.s ?? null, e: timed?.e ?? null });
  }

  // 공식 해설집은 11~14번 마지막 응답 등 일부 구절을 비워 둔다.
  // 공식 대본의 뒤에 실제 발화가 더 있으면, 그 부분은 ASR 단어로 보존한다.
  const last = pairs.at(-1);
  if (last && m - last.audio > 4) {
    for (const word of asr.slice(last.audio + 1)) {
      assigned[word.seg]!.push({ w: word.w, s: word.s, e: word.e });
    }
  }

  const corrected = segments.flatMap((seg, idx) => {
    const words = assigned[idx]!;
    if (words.length === 0) return [];
    return [{
      ...seg,
      idx: 0, // 재색인은 전부 구성한 다음
      text: words.map(w => w.w).join(' '),
      words,
    }];
  }).map((seg, idx) => ({ ...seg, idx }));

  return { applied: true, score, reason: '공식 대본으로 교정했습니다', segments: corrected };
}
