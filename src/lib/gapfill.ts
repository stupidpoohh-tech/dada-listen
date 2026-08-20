/* gapfill.ts — 결정론적 빈칸 선정.
 *
 * 계약: 같은 입력 → 같은 출력. 난수를 쓰지 않는다. 동점은 항상 위치 순으로
 * 깨뜨린다. 이 파일을 고치면 gapfill.test.ts 를 함께 갱신한다. (CLAUDE.md)
 *
 * 원본(js/gapfill.js) 대비 바뀐 것 (D-008):
 *  1. 입력이 통짜 문자열이 아니라 세그먼트 배열이다. 빈칸이 단어 위치를
 *     가리키므로 타임스탬프와 곧장 이어진다 — "이 빈칸 구간만 듣기"가 가능.
 *  2. 전체를 점수순으로 탐욕 선택하지 않는다. 원본은 그래서 긴 단어가 몰린
 *     문단에 빈칸이 쏠렸다. 세그먼트별로 최대잉여법 배분 후 각자 채운다.
 *  3. 고빈도 내용어에 페널티 (wordlists.ts). 원본은 사실상 글자 수가 전부라
 *     government 같은 흔한 장단어를 어려운 단어로 취급했다.
 *  4. 문장 중간의 대문자 시작 단어(고유명사)를 제외한다.
 *  5. 같은 어간을 두 번 뚫지 않는다.
 */

import { COMMON, RICH_SUFFIX, STOP } from './wordlists';

export type Level = 'easy' | 'normal' | 'hard';

/** 난이도별 빈칸 비율. 저장하지 않고 뷰에서 생성한다 (D-007). */
export const LEVEL_RATIO: Readonly<Record<Level, number>> = {
  easy: 0.1,
  normal: 0.18,
  hard: 0.3,
};

export const LEVELS: readonly Level[] = ['easy', 'normal', 'hard'];

/** 빈칸 하나. segIdx/wordIdx 는 세그먼트 배열 기준 위치. */
export type GapRef = {
  segIdx: number;
  wordIdx: number;
  /** 선정 당시의 원본 단어. 지문이 수정되면 드리프트 감지에 쓴다 (D-004). */
  word: string;
};

/** 최소 길이. 이보다 짧으면 들어도 시험 가치가 낮다. */
const MIN_LEN = 5;

/** 표시용 토큰에서 앞뒤 문장부호를 떼고 소문자로. 내부 ' 와 - 는 남긴다. */
export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^a-z0-9']+/, '')
    .replace(/[^a-z0-9']+$/, '');
}

/** 앞뒤 문장부호만 뗀 원형 (대소문자 유지). 고유명사 판정에 쓴다. */
function stripPunct(raw: string): string {
  return raw.replace(/^[^A-Za-z0-9']+/, '').replace(/[^A-Za-z0-9']+$/, '');
}

/** 거친 어간. 정확할 필요는 없고 같은 단어의 변화형만 묶으면 된다. */
export function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith('ies')) return s.slice(0, -3) + 'y';
  for (const suf of ['ing', 'ed', 'es', 'ly', 's']) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  return s;
}

/**
 * 단어의 시험 가치. 높을수록 빈칸으로 좋다.
 * 0 이하면 후보에서 제외. COMMON 은 최하위 고정값으로 남겨,
 * 지문이 짧아 후보가 모자랄 때만 쓰인다.
 */
export function scoreWord(raw: string, isSegmentStart: boolean): number {
  const w = normalize(raw);
  if (w.length < MIN_LEN) return 0;
  if (STOP.has(w)) return 0;
  if (/\d/.test(w)) return 0; // 숫자는 받아쓰기지 어휘가 아니다

  // 문장 중간의 대문자 = 고유명사. 사람·지명을 맞히게 하는 건 듣기 훈련이 아니다.
  if (!isSegmentStart && /^[A-Z]/.test(stripPunct(raw))) return 0;

  if (COMMON.has(w)) return 0.5;

  let s = w.length;
  if (RICH_SUFFIX.test(w)) s += 3;
  if (w.length >= 8) s += 2;
  return s;
}

type Candidate = { wordIdx: number; word: string; score: number; stem: string };

/** 세그먼트 하나에서 후보를 뽑는다. 점수 내림차순, 동점은 위치 오름차순. */
function candidatesOf(words: readonly string[]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < words.length; i++) {
    const raw = words[i] ?? '';
    const score = scoreWord(raw, i === 0);
    if (score <= 0) continue;
    out.push({ wordIdx: i, word: raw, score, stem: stem(normalize(raw)) });
  }
  out.sort((a, b) => b.score - a.score || a.wordIdx - b.wordIdx);
  return out;
}

/**
 * 최대잉여법(largest remainder). 세그먼트 길이에 비례해 target 을 나눈다.
 * 소수부가 같으면 앞 세그먼트가 가져간다 — 결정론 유지.
 */
function allocate(weights: readonly number[], target: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (w / total) * target);
  const base = exact.map((x) => Math.floor(x));
  let left = target - base.reduce((a, b) => a + b, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < order.length; k++, left--) {
    base[order[k]!.i]! += 1;
  }
  return base;
}

/**
 * 세그먼트 하나를 채운다. 인접한 두 단어를 동시에 뚫지 않고,
 * 이미 쓴 어간은 건너뛴다.
 */
function fillSegment(
  cands: readonly Candidate[],
  quota: number,
  taken: Set<number>,
  usedStems: Set<string>,
): Candidate[] {
  const picked: Candidate[] = [];
  for (const c of cands) {
    if (picked.length >= quota) break;
    if (taken.has(c.wordIdx)) continue;
    if (taken.has(c.wordIdx - 1) || taken.has(c.wordIdx + 1)) continue;
    if (usedStems.has(c.stem)) continue;
    taken.add(c.wordIdx);
    usedStems.add(c.stem);
    picked.push(c);
  }
  return picked;
}

/**
 * 아이템 전체의 빈칸을 고른다.
 *
 * @param segmentWords 세그먼트별 표시용 단어 배열. ASR 의 words[].w 를 그대로.
 * @param level        난이도.
 * @returns 세그먼트 순 → 단어 순으로 정렬된 빈칸 목록.
 */
export function selectGaps(
  segmentWords: readonly (readonly string[])[],
  level: Level = 'normal',
): GapRef[] {
  const ratio = LEVEL_RATIO[level];
  const totalWords = segmentWords.reduce((n, s) => n + s.length, 0);
  if (totalWords === 0) return [];

  const target = Math.max(1, Math.round(totalWords * ratio));
  const cands = segmentWords.map(candidatesOf);
  const quotas = allocate(
    segmentWords.map((s) => s.length),
    target,
  );

  const takenPerSeg = segmentWords.map(() => new Set<number>());
  const usedStems = new Set<string>();
  const picked: Candidate[][] = segmentWords.map(() => []);

  // 1차: 배정량만큼 채운다.
  for (let i = 0; i < segmentWords.length; i++) {
    picked[i] = fillSegment(cands[i]!, quotas[i]!, takenPerSeg[i]!, usedStems);
  }

  // 2차: 후보가 모자라 남은 몫을 앞 세그먼트부터 재분배한다.
  // 한 바퀴 돌아 아무도 못 채우면 그 지문에는 더 뚫을 자리가 없는 것이다.
  let remaining = target - picked.reduce((n, p) => n + p.length, 0);
  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < segmentWords.length && remaining > 0; i++) {
      const extra = fillSegment(cands[i]!, 1, takenPerSeg[i]!, usedStems);
      if (extra.length === 0) continue;
      picked[i]!.push(...extra);
      remaining -= extra.length;
      progressed = true;
    }
    if (!progressed) break;
  }

  const gaps: GapRef[] = [];
  for (let i = 0; i < picked.length; i++) {
    for (const c of picked[i]!.sort((a, b) => a.wordIdx - b.wordIdx)) {
      gaps.push({ segIdx: i, wordIdx: c.wordIdx, word: c.word });
    }
  }
  return gaps;
}

/* ------------------------------------------------------------------ *
 * 강사 수동 편집 반영
 * ------------------------------------------------------------------ */

export type GapOverride = {
  segIdx: number;
  wordIdx: number;
  word: string;
  enabled: boolean;
};

export type AppliedGaps = {
  gaps: GapRef[];
  /** 저장된 word 와 현재 지문의 단어가 어긋난 override. 지문이 수정된 흔적. */
  drifted: GapOverride[];
};

/**
 * 자동 선정 결과에 강사의 수동 켬/끔을 얹는다.
 *
 * 원본 앱은 빈칸을 토큰 인덱스 배열로만 저장해서, 지문을 한 글자만 고쳐도
 * 모든 인덱스가 밀려 엉뚱한 단어에 빈칸이 붙었고 경고도 없었다 (D-004).
 * 여기서는 저장된 word 와 현재 단어를 대조해 어긋난 것을 걸러내고 함께 돌려준다.
 */
export function applyOverrides(
  segmentWords: readonly (readonly string[])[],
  auto: readonly GapRef[],
  overrides: readonly GapOverride[],
): AppliedGaps {
  const key = (s: number, w: number) => `${s}:${w}`;
  const map = new Map(auto.map((g) => [key(g.segIdx, g.wordIdx), g]));
  const drifted: GapOverride[] = [];

  for (const o of overrides) {
    const current = segmentWords[o.segIdx]?.[o.wordIdx];
    if (current === undefined || normalize(current) !== normalize(o.word)) {
      drifted.push(o);
      continue;
    }
    if (o.enabled) {
      map.set(key(o.segIdx, o.wordIdx), {
        segIdx: o.segIdx,
        wordIdx: o.wordIdx,
        word: current,
      });
    } else {
      map.delete(key(o.segIdx, o.wordIdx));
    }
  }

  const gaps = [...map.values()].sort(
    (a, b) => a.segIdx - b.segIdx || a.wordIdx - b.wordIdx,
  );
  return { gaps, drifted };
}

/* ------------------------------------------------------------------ *
 * 객관식 보기 (D-006)
 * ------------------------------------------------------------------ */

/** FNV-1a. 보기 순서를 단어마다 다르게, 그러나 결정론적으로 섞기 위한 씨앗. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 씨앗 기반 셔플. Math.random 을 쓰지 않는다. */
function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = [...arr];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * 빈칸 하나의 객관식 보기를 만든다.
 *
 * 오답은 **같은 지문 안의 다른 단어**에서 뽑는다. 학생이 실제로 들은 단어들이라
 * 그럴듯하고, 외부 API 를 부르지 않으므로 추가 비용이 0이다.
 * 정답과 첫 글자가 같거나 길이가 비슷한 단어를 먼저 고른다.
 *
 * @returns 정답을 포함해 최대 count 개. 후보가 모자라면 그만큼만 돌려준다.
 */
export function makeChoices(
  answer: string,
  pool: readonly string[],
  count = 4,
): string[] {
  const a = normalize(answer);
  const aStem = stem(a);

  const seen = new Set<string>([a]);
  const distractors: string[] = [];
  for (const raw of pool) {
    const w = normalize(raw);
    if (w.length < MIN_LEN || seen.has(w) || stem(w) === aStem) continue;
    if (STOP.has(w)) continue;
    seen.add(w);
    distractors.push(w);
  }

  distractors.sort((x, y) => {
    const fx = Number(x[0] === a[0]);
    const fy = Number(y[0] === a[0]);
    if (fx !== fy) return fy - fx;
    const dx = Math.abs(x.length - a.length);
    const dy = Math.abs(y.length - a.length);
    if (dx !== dy) return dx - dy;
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const picked = distractors.slice(0, Math.max(0, count - 1));
  return seededShuffle([a, ...picked], hash(a));
}

/** 채점용 비교. 대소문자와 앞뒤 문장부호를 무시한다. */
export function isCorrect(given: string, answer: string): boolean {
  return normalize(given) === normalize(answer);
}

/* ------------------------------------------------------------------ *
 * 타임스탬프 없는 지문용 (수동 입력 / 기존 데이터)
 * ------------------------------------------------------------------ */

export type Token = { t: 'w' | 'x'; s: string };

/** 원본 tokenize 와 같은 규칙. 단어/비단어 런을 손실 없이 보존한다. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /([A-Za-z]+(?:['’-][A-Za-z]+)*)|([^A-Za-z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) tokens.push({ t: 'w', s: m[1] });
    else tokens.push({ t: 'x', s: m[2]! });
  }
  return tokens;
}

/**
 * 평문을 세그먼트 단어 배열로 쪼갠다. 문장 끝 부호 기준.
 * ASR 이 없는 경로(수동 입력, 기존 데이터 이관)에서 selectGaps 에 먹이기 위한 것.
 */
export function splitIntoSegmentWords(text: string): string[][] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const source = sentences.length > 0 ? sentences : [text.trim()].filter(Boolean);
  return source
    .map((s) => s.split(/\s+/).filter(Boolean))
    .filter((words) => words.length > 0);
}
