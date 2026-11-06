/* split.ts — 한 음원을 문항별로 나눈다.
 *
 * 20분짜리 모의고사 듣기 한 회차에는 문항이 17개 들어 있다. 통째로 올리면
 * 학생이 매번 12번 문제를 찾아 스크럽해야 하고, 갭필도 회차 전체에 걸쳐
 * 뽑힌다. 그래서 올릴 때 문항 단위로 쪼갠다.
 *
 * **오디오를 자르지 않는다.** 원본 하나를 두고 구간(startSec~endSec)만
 * 기록한다. R2 가 Range 로 스트리밍하므로 재생에 문제가 없고, 저장공간이
 * 17배로 늘지 않으며, 경계가 틀려도 숫자만 고치면 된다. 다시 올릴 필요가 없다.
 *
 * **경계는 전사 결과만으로 찾는다.** Deepgram 이 이미 발화 단위 타임스탬프를
 * 주므로, 발화 사이의 긴 공백이 곧 문항 경계다. 오디오를 따로 분석하지 않는다.
 * 한국어 안내("12번. 다음을 듣고…")가 잡히면 그걸로 번호까지 확정한다.
 *
 * 결정론적이다. 같은 입력이면 같은 경계가 나온다. */

import type { Segment } from './types';

export type QuestionBlock = {
  /** 화면에 보일 문항 번호. "12" 또는 "16~17". */
  no: string;
  startSec: number;
  endSec: number;
  /** 이 구간에 속한 세그먼트 인덱스 (양끝 포함). */
  segFrom: number;
  segTo: number;
  /** 한국어 안내에서 번호를 읽어냈는지. false 면 공백만 보고 순서대로 매긴 것. */
  fromMarker: boolean;
};

export type SplitOptions = {
  /** 음원 덩어리 수. 수능/모의고사는 16~17번이 한 지문이라 보통 16. */
  expected: number;
  /** 마지막 덩어리에 문제가 두 개 붙는지 (16~17번). */
  mergeLastTwo: boolean;
  /** 이보다 짧은 공백은 문항 경계로 보지 않는다. 대화 중의 숨 쉬는 틈이다. */
  minGapSec?: number;
};

export const DEFAULT_MIN_GAP_SEC = 1.2;

/* ------------------------------------------------------------------ *
 * 한국어 안내에서 문항 번호 읽기
 * ------------------------------------------------------------------ */

/**
 * "16~17번", "[16-17]", "16번부터 17번까지" 같은 범위 표기.
 * 범위를 먼저 본다 — 단일 번호 규칙이 "16"만 집어가 버리기 때문이다.
 */
const RANGE_RE = /(\d{1,2})\s*(?:번)?\s*(?:[~\-–—]|부터)\s*(\d{1,2})\s*(?:번)?/;

/** "12번" 처럼 숫자 뒤에 '번'이 붙는 꼴. 영어 본문의 숫자와 헷갈리지 않는다. */
const SINGLE_RE = /(\d{1,2})\s*번/;

/**
 * 발화 하나에서 문항 번호를 읽는다. 못 읽으면 null.
 *
 * **앞부분만 본다.** 영어 대화 중간에 "Room 12번" 같은 게 섞여도 안내로
 * 오인하지 않게. 안내 음성은 발화 맨 앞에 번호가 온다.
 */
export function readQuestionNo(text: string): string | null {
  // 안내 음성은 번호로 시작한다. 뒤쪽까지 보면 본문 숫자를 안내로 오인한다.
  const head = text.trim().slice(0, 16);

  const range = RANGE_RE.exec(head);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (valid(a) && valid(b) && b > a) return `${a}~${b}`;
  }

  const single = SINGLE_RE.exec(head);
  if (single) {
    const n = Number(single[1]);
    if (valid(n)) return String(n);
  }
  return null;
}

const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 40;

/* ------------------------------------------------------------------ *
 * 경계 찾기
 * ------------------------------------------------------------------ */

/**
 * 세그먼트를 문항 덩어리로 나눈다.
 *
 * 1순위는 한국어 안내다. 번호까지 알 수 있어 가장 정확하다.
 * 안내를 못 찾거나 개수가 안 맞으면 공백 길이로 나눈다. 전사 품질과 무관하게
 * 항상 돌아가는 길이다.
 */
export function splitIntoQuestions(
  segments: readonly Segment[],
  opts: SplitOptions,
): QuestionBlock[] {
  if (segments.length === 0) return [];

  const expected = Math.max(1, Math.floor(opts.expected));
  if (expected === 1) return [block(segments, 0, segments.length - 1, '1', false)];

  const byMarker = splitByMarkers(segments, expected);
  if (byMarker) return byMarker;

  return splitByGaps(segments, expected, opts);
}

/** 한국어 안내가 시작하는 발화들을 경계로 삼는다. */
function splitByMarkers(
  segments: readonly Segment[],
  expected: number,
): QuestionBlock[] | null {
  const marks: { at: number; no: string }[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const no = readQuestionNo(segments[i]!.text);
    // 같은 번호가 연달아 나오면("12번…" / "12번 다시 들려드립니다") 첫 번만 센다.
    if (no && marks.at(-1)?.no !== no) marks.push({ at: i, no });
  }

  // 개수가 기대와 다르면 믿지 않는다. 일부만 잡힌 상태로 자르면 엉뚱하게 뭉친다.
  if (marks.length !== expected) return null;
  // 첫 안내 앞의 발화(도입부 안내 등)는 1번에 포함시킨다.
  return marks.map((m, k) =>
    block(
      segments,
      k === 0 ? 0 : m.at,
      k + 1 < marks.length ? marks[k + 1]!.at - 1 : segments.length - 1,
      m.no,
      true,
    ),
  );
}

/** 공백이 긴 순서대로 (expected - 1) 군데를 끊는다. */
function splitByGaps(
  segments: readonly Segment[],
  expected: number,
  opts: SplitOptions,
): QuestionBlock[] {
  const minGap = opts.minGapSec ?? DEFAULT_MIN_GAP_SEC;

  const gaps: { afterIdx: number; len: number }[] = [];
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const len = segments[i + 1]!.startSec - segments[i]!.endSec;
    if (len >= minGap) gaps.push({ afterIdx: i, len });
  }

  // 길이 내림차순. 같으면 앞선 것을 먼저 — 정렬이 흔들리면 결과도 흔들린다.
  gaps.sort((a, b) => (b.len - a.len) || (a.afterIdx - b.afterIdx));

  const cuts = gaps
    .slice(0, expected - 1)
    .map((g) => g.afterIdx)
    .sort((a, b) => a - b);

  const blocks: QuestionBlock[] = [];
  let from = 0;
  for (const cut of cuts) {
    blocks.push(block(segments, from, cut, String(blocks.length + 1), false));
    from = cut + 1;
  }
  blocks.push(block(segments, from, segments.length - 1, String(blocks.length + 1), false));

  return opts.mergeLastTwo ? labelLastAsPair(blocks) : blocks;
}

/** 마지막 덩어리에 문제 두 개가 붙는 경우(16~17번) 이름만 바꾼다. */
function labelLastAsPair(blocks: QuestionBlock[]): QuestionBlock[] {
  if (blocks.length < 2) return blocks;
  const last = blocks.at(-1)!;
  const n = Number(last.no);
  if (!Number.isInteger(n)) return blocks;
  return [...blocks.slice(0, -1), { ...last, no: `${n}~${n + 1}` }];
}

function block(
  segments: readonly Segment[],
  segFrom: number,
  segTo: number,
  no: string,
  fromMarker: boolean,
): QuestionBlock {
  return {
    no,
    startSec: segments[segFrom]!.startSec,
    endSec: segments[segTo]!.endSec,
    segFrom,
    segTo,
    fromMarker,
  };
}
