import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_GAP_SEC, readQuestionNo, splitIntoQuestions } from './split';
import type { Segment } from './types';

let autoId = 0;
const seg = (startSec: number, endSec: number, text: string): Segment => ({
  id: `s${(autoId += 1)}`,
  itemId: 'item',
  idx: 0,
  startSec,
  endSec,
  text,
  words: text.split(/\s+/).map((w) => ({ w, s: null, e: null })),
});

/** 수능 듣기 한 회차를 흉내낸다: [안내][영어 본문] 뒤에 긴 공백. */
function mockExam(opts: { markers: boolean; count: number; gapSec?: number }): Segment[] {
  const gap = opts.gapSec ?? 3;
  const out: Segment[] = [];
  let t = 0;
  for (let q = 1; q <= opts.count; q += 1) {
    const no = q === opts.count ? `${q}~${q + 1}번` : `${q}번`;
    if (opts.markers) {
      out.push(seg(t, t + 4, `${no} 다음을 듣고 물음에 답하시오.`));
      t += 4.5;
    }
    // 본문 두 문장. 사이 간격은 짧다 (숨 쉬는 틈).
    out.push(seg(t, t + 5, 'Good morning everyone and welcome.'));
    t += 5.4;
    out.push(seg(t, t + 5, 'We have an announcement to make today.'));
    t += 5 + gap; // 문항 사이 공백
  }
  return out.map((s, i) => ({ ...s, idx: i }));
}

describe('문항 번호 읽기', () => {
  it('단일 번호', () => {
    expect(readQuestionNo('1번. 다음을 듣고, 남자가 하는 말의 목적을 고르시오.')).toBe('1');
    expect(readQuestionNo('12번 다음을 듣고')).toBe('12');
  });

  it('두 문제가 붙은 범위 표기', () => {
    expect(readQuestionNo('16~17번 다음을 듣고 물음에 답하시오.')).toBe('16~17');
    expect(readQuestionNo('[16-17] 다음을 듣고')).toBe('16~17');
    expect(readQuestionNo('16번부터 17번까지 두 문제입니다')).toBe('16~17');
  });

  it('범위를 단일 번호로 잘못 읽지 않는다', () => {
    // 단일 규칙이 먼저 걸리면 "16" 만 집어가 17번이 사라진다
    expect(readQuestionNo('16~17번 다음을 듣고')).not.toBe('16');
  });

  it('영어 본문은 안내가 아니다', () => {
    expect(readQuestionNo('I will meet you at three.')).toBeNull();
    expect(readQuestionNo('Flight 815 departs at noon.')).toBeNull();
  });

  it('문장 뒤쪽의 번호는 안내로 보지 않는다', () => {
    expect(readQuestionNo('자 그러면 이제 문제를 풀어 봅시다 12번')).toBeNull();
  });

  it('말이 안 되는 번호는 버린다', () => {
    expect(readQuestionNo('0번')).toBeNull();
    expect(readQuestionNo('99번')).toBeNull();
  });
});

describe('문항 나누기 — 한국어 안내가 있을 때', () => {
  const segments = mockExam({ markers: true, count: 16 });
  const blocks = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: true });

  it('16덩어리가 나온다', () => {
    expect(blocks).toHaveLength(16);
  });

  it('번호를 안내에서 읽는다', () => {
    expect(blocks.map((b) => b.no)).toEqual([
      '1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16~17',
    ]);
    expect(blocks.every((b) => b.fromMarker)).toBe(true);
  });

  it('구간이 겹치지도 비지도 않는다', () => {
    for (let i = 0; i + 1 < blocks.length; i += 1) {
      expect(blocks[i]!.segTo + 1).toBe(blocks[i + 1]!.segFrom);
      expect(blocks[i]!.endSec).toBeLessThan(blocks[i + 1]!.startSec);
    }
    expect(blocks[0]!.segFrom).toBe(0);
    expect(blocks.at(-1)!.segTo).toBe(segments.length - 1);
  });

  it('각 덩어리가 안내 발화로 시작한다', () => {
    for (const b of blocks) {
      expect(segments[b.segFrom]!.text).toMatch(/번/);
    }
  });
});

describe('문항 나누기 — 공백만으로', () => {
  const segments = mockExam({ markers: false, count: 16 });
  const blocks = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: true });

  it('16덩어리가 나온다', () => {
    expect(blocks).toHaveLength(16);
    expect(blocks.every((b) => !b.fromMarker)).toBe(true);
  });

  it('마지막만 두 문제로 이름 붙는다', () => {
    expect(blocks.at(-1)!.no).toBe('16~17');
    expect(blocks.slice(0, -1).map((b) => b.no)).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 1)),
    );
  });

  it('본문 안의 짧은 틈에서는 자르지 않는다', () => {
    // 각 덩어리는 본문 두 문장을 그대로 품고 있어야 한다
    for (const b of blocks) expect(b.segTo - b.segFrom).toBe(1);
  });

  it('mergeLastTwo 가 꺼지면 17덩어리 이름이 그대로다', () => {
    const b17 = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: false });
    expect(b17.at(-1)!.no).toBe('16');
  });
});

describe('안내를 못 믿을 때는 공백으로 넘어간다', () => {
  it('안내가 일부만 잡히면 안내를 쓰지 않는다', () => {
    const segments = mockExam({ markers: true, count: 16 });
    // 안내 세 개가 전사되다 말았다고 치자
    const damaged = segments.map((s) =>
      /^(3번|7번|11번)/.test(s.text) ? { ...s, text: 'Unintelligible speech here.' } : s,
    );
    const blocks = splitIntoQuestions(damaged, { expected: 16, mergeLastTwo: true });
    expect(blocks).toHaveLength(16);
    expect(blocks.every((b) => !b.fromMarker)).toBe(true);
  });
});

describe('가장자리', () => {
  it('세그먼트가 없으면 빈 배열', () => {
    expect(splitIntoQuestions([], { expected: 16, mergeLastTwo: true })).toEqual([]);
  });

  it('1개로 나누라면 통째로 하나', () => {
    const segments = mockExam({ markers: false, count: 4 });
    const blocks = splitIntoQuestions(segments, { expected: 1, mergeLastTwo: false });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.segFrom).toBe(0);
    expect(blocks[0]!.segTo).toBe(segments.length - 1);
  });

  it('쪼갤 공백이 모자라면 있는 만큼만 나온다', () => {
    // 공백이 전부 짧아서 경계로 쓸 수 없는 음원
    const segments = mockExam({ markers: false, count: 16, gapSec: 0.1 });
    const blocks = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: false });
    expect(blocks.length).toBeLessThan(16);
    expect(blocks).toHaveLength(1);
  });

  it('같은 입력이면 같은 결과다', () => {
    const segments = mockExam({ markers: false, count: 16 });
    const a = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: true });
    const b = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: true });
    expect(a).toEqual(b);
  });

  it('최소 공백 기준이 실제로 쓰인다', () => {
    expect(DEFAULT_MIN_GAP_SEC).toBeGreaterThan(0);
    const segments = mockExam({ markers: false, count: 3, gapSec: 2 });
    expect(splitIntoQuestions(segments, { expected: 3, mergeLastTwo: false, minGapSec: 5 }))
      .toHaveLength(1);
    expect(splitIntoQuestions(segments, { expected: 3, mergeLastTwo: false, minGapSec: 1 }))
      .toHaveLength(3);
  });
});

/* ------------------------------------------------------------------ *
 * 실제 모의고사 음원으로 확인한 구조
 *
 * 2022학년도 9월 고2 영어 듣기(23분 48초)를 ffmpeg 로 재서 얻은 실제 값이다.
 * 문항 사이 공백은 18군데, 전부 9.2~9.4초. 대화 중의 틈은 최대 1.82초로
 * 둘 사이에 겹치는 구간이 아예 없었다.
 *
 * 여기서 "가장 긴 N-1개를 고르는" 옛 방식이 깨졌다. 공백이 사실상 동점이라
 * 어느 것이 뽑히는지가 소수점에 좌우됐고, 16~17번 세트와 뒤쪽 안내 방송이
 * 한 덩어리로 뭉쳤다. 그 회귀를 여기서 막는다.
 * ------------------------------------------------------------------ */

/** ffmpeg silencedetect 로 측정한 음성 덩어리 18개 (초). */
const REAL_SPANS: [number, number][] = [
  [0, 55.03], [64.35, 120.52], [129.87, 207.86], [217.19, 290.54],
  [299.9, 379.69], [389.03, 474.6], [483.95, 547.82], [557.15, 636.28],
  [645.63, 729.4], [738.75, 826.6], [835.93, 863.06], [872.4, 906.2],
  [915.55, 984.43], [993.79, 1075.75], [1085.11, 1151.53],
  [1160.87, 1324.34],  // 16~17번 세트 (긴 지문, 2분 43초)
  [1333.61, 1342.71],  // 안내 방송
  [1351.9, 1353.13],   // 짧은 꼬리
];

/** 각 덩어리를 발화 몇 개로 쪼갠다. 발화 사이 틈은 실측 최대치인 1.8초 이내. */
function realExamSegments(): Segment[] {
  const out: Segment[] = [];
  for (const [s, e] of REAL_SPANS) {
    const span = e - s;
    const n = span > 20 ? 3 : 1;
    const each = (span - 1.4 * (n - 1)) / n;
    for (let k = 0; k < n; k += 1) {
      const a = s + k * (each + 1.4);
      out.push(seg(a, a + each, `utterance ${out.length}`));
    }
  }
  return out.map((x, i) => ({ ...x, idx: i }));
}

describe('실제 모의고사 음원 구조', () => {
  const segments = realExamSegments();
  const blocks = splitIntoQuestions(segments, { expected: 16, mergeLastTwo: true });

  it('16덩어리로 나뉜다', () => {
    expect(blocks).toHaveLength(16);
  });

  it('1~15번 경계가 실측값과 같다', () => {
    for (let i = 0; i < 15; i += 1) {
      expect(blocks[i]!.startSec).toBeCloseTo(REAL_SPANS[i]![0], 1);
      expect(blocks[i]!.endSec).toBeCloseTo(REAL_SPANS[i]![1], 1);
    }
  });

  it('마지막은 16~17번 세트이고, 뒤 안내 방송까지 흡수한다', () => {
    const last = blocks[15]!;
    expect(last.no).toBe('16~17');
    expect(last.startSec).toBeCloseTo(1160.87, 1); // 세트 지문 시작
    expect(last.endSec).toBeCloseTo(1353.13, 1);   // 꼬리까지
  });

  it('16~17번 세트가 15번에 뭉개지지 않는다', () => {
    // 옛 방식이 실제로 저질렀던 실수. 15번이 3분짜리가 돼 버렸다.
    expect(blocks[14]!.endSec).toBeLessThan(1160);
    expect(blocks[14]!.endSec - blocks[14]!.startSec).toBeLessThan(120);
  });

  it('짧은 문항(11·12번, 27초와 34초)도 살아남는다', () => {
    expect(blocks[10]!.endSec - blocks[10]!.startSec).toBeCloseTo(27.13, 0);
    expect(blocks[11]!.endSec - blocks[11]!.startSec).toBeCloseTo(33.8, 0);
  });

  it('덩어리가 겹치지도 비지도 않는다', () => {
    for (let i = 0; i + 1 < blocks.length; i += 1) {
      expect(blocks[i]!.segTo + 1).toBe(blocks[i + 1]!.segFrom);
    }
    expect(blocks[0]!.segFrom).toBe(0);
    expect(blocks.at(-1)!.segTo).toBe(segments.length - 1);
  });

  it('17개로 달라고 하면 안내 방송이 떨어져 나온다', () => {
    const b17 = splitIntoQuestions(segments, { expected: 17, mergeLastTwo: false });
    expect(b17).toHaveLength(17);
    expect(b17[15]!.startSec).toBeCloseTo(1160.87, 1);
  });
});


describe('16~17번 공동 지문을 17개 독립 문항으로 등록', () => {
  for (const markers of [true, false]) {
    it(`${markers ? '번호 안내' : '무음 구간'} 기준에서도 마지막을 두 문항으로 복제한다`, () => {
      const segments = mockExam({ markers, count: 16 });
      const blocks = splitIntoQuestions(segments, {
        expected: 16, mergeLastTwo: true, separateLastPair: true,
      });
      expect(blocks).toHaveLength(17);
      expect(blocks.map((b) => b.no)).toEqual(
        Array.from({ length: 17 }, (_, i) => String(i + 1)),
      );
      expect(blocks[15]!.startSec).toBe(blocks[16]!.startSec);
      expect(blocks[15]!.endSec).toBe(blocks[16]!.endSec);
      expect(blocks[15]!.segFrom).toBe(blocks[16]!.segFrom);
      expect(blocks[15]!.segTo).toBe(blocks[16]!.segTo);
    });
  }

  it('마지막이 공동 지문이 아니면 문항을 임의로 복제하지 않는다', () => {
    const segments = mockExam({ markers: false, count: 16 });
    const blocks = splitIntoQuestions(segments, {
      expected: 16, mergeLastTwo: false, separateLastPair: true,
    });
    expect(blocks).toHaveLength(16);
    expect(blocks.at(-1)!.no).toBe('16');
  });
});
