import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  isCorrect,
  LEVELS,
  LEVEL_RATIO,
  makeChoices,
  normalize,
  scoreWord,
  selectGaps,
  splitIntoSegmentWords,
  stem,
  tokenize,
  type GapOverride,
  type Level,
} from './gapfill';

/** 실제 듣기 지문에 가까운 표본. 회귀의 기준점이므로 함부로 바꾸지 않는다. */
const PASSAGE =
  'Climate change is transforming the environment faster than scientists predicted. ' +
  'Rising temperatures affect agriculture and threaten biodiversity across every continent. ' +
  'Researchers in Norway published a comprehensive assessment last November. ' +
  'The consequences require immediate international cooperation and sustainable development.';

const SEGS = splitIntoSegmentWords(PASSAGE);
const flat = (segs: readonly (readonly string[])[]) => segs.flatMap((s) => s);

describe('normalize / stem', () => {
  it('앞뒤 문장부호를 떼고 소문자로 만든다', () => {
    expect(normalize('"Climate,')).toBe('climate');
    expect(normalize('predicted.')).toBe('predicted');
    expect(normalize('(well-known)')).toBe('well-known');
  });

  it("내부의 어퍼스트로피는 남긴다", () => {
    expect(normalize("don't,")).toBe("don't");
  });

  it('같은 단어의 변화형을 하나로 묶는다', () => {
    expect(stem('threatens')).toBe('threaten');
    expect(stem('threatened')).toBe('threaten');
    expect(stem('studies')).toBe('study');
  });

  it('짧은 단어를 과하게 깎지 않는다', () => {
    expect(stem('was')).toBe('was');
    expect(stem('this')).toBe('this');
  });
});

describe('scoreWord', () => {
  it('기능어는 후보가 아니다', () => {
    for (const w of ['the', 'because', 'their', 'would', "doesn't"]) {
      expect(scoreWord(w, false), w).toBe(0);
    }
  });

  it('너무 짧은 단어는 후보가 아니다', () => {
    expect(scoreWord('fast', false)).toBe(0);
  });

  it('숫자는 후보가 아니다', () => {
    expect(scoreWord('2024', false)).toBe(0);
    expect(scoreWord('19th', false)).toBe(0);
  });

  it('문장 중간의 고유명사를 제외한다 — 문장 첫 단어는 제외하지 않는다', () => {
    expect(scoreWord('Norway', false)).toBe(0);
    expect(scoreWord('Researchers', true)).toBeGreaterThan(1);
  });

  it('고빈도 내용어를 최하위로 민다', () => {
    // 원본은 글자 수가 사실상 전부라 흔한 장단어를 어려운 단어로 봤다.
    expect(scoreWord('important', false)).toBe(0.5);
    expect(scoreWord('biodiversity', false)).toBeGreaterThan(5);
  });

  it('형태론적으로 무게 있는 단어에 가산한다', () => {
    expect(scoreWord('cooperation', false)).toBeGreaterThan(scoreWord('mountains', false));
  });
});

describe('selectGaps — 결정론 (CLAUDE.md 계약)', () => {
  it('같은 입력이면 항상 같은 출력', () => {
    for (const level of LEVELS) {
      const first = selectGaps(SEGS, level);
      for (let i = 0; i < 20; i++) {
        expect(selectGaps(SEGS, level)).toEqual(first);
      }
    }
  });

  it('입력 배열을 변형하지 않는다', () => {
    const copy = SEGS.map((s) => [...s]);
    selectGaps(SEGS, 'hard');
    expect(SEGS).toEqual(copy);
  });

  it('세그먼트 순 → 단어 순으로 정렬돼 나온다', () => {
    const gaps = selectGaps(SEGS, 'hard');
    for (let i = 1; i < gaps.length; i++) {
      const a = gaps[i - 1]!;
      const b = gaps[i]!;
      expect(a.segIdx < b.segIdx || (a.segIdx === b.segIdx && a.wordIdx < b.wordIdx)).toBe(true);
    }
  });
});

describe('selectGaps — 불변식', () => {
  it('가리키는 단어가 실제 그 자리의 단어와 일치한다', () => {
    for (const level of LEVELS) {
      for (const g of selectGaps(SEGS, level)) {
        expect(SEGS[g.segIdx]![g.wordIdx]).toBe(g.word);
      }
    }
  });

  it('인접한 두 단어를 동시에 뚫지 않는다', () => {
    for (const level of LEVELS) {
      const gaps = selectGaps(SEGS, level);
      for (let i = 1; i < gaps.length; i++) {
        const a = gaps[i - 1]!;
        const b = gaps[i]!;
        if (a.segIdx === b.segIdx) expect(b.wordIdx - a.wordIdx).toBeGreaterThan(1);
      }
    }
  });

  it('기능어와 고유명사를 뚫지 않는다', () => {
    for (const level of LEVELS) {
      for (const g of selectGaps(SEGS, level)) {
        expect(scoreWord(g.word, g.wordIdx === 0), g.word).toBeGreaterThan(0);
      }
    }
  });

  it('같은 어간을 두 번 뚫지 않는다', () => {
    const words = ['Researchers research the researched research topic thoroughly overall'];
    const segs = splitIntoSegmentWords(words[0]!);
    const stems = selectGaps(segs, 'hard').map((g) => stem(normalize(g.word)));
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('난이도가 높을수록 빈칸이 늘어난다', () => {
    const counts = LEVELS.map((l) => selectGaps(SEGS, l).length);
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
  });

  it('목표 개수를 넘지 않는다', () => {
    const total = flat(SEGS).length;
    for (const level of LEVELS) {
      const target = Math.max(1, Math.round(total * LEVEL_RATIO[level]));
      expect(selectGaps(SEGS, level).length).toBeLessThanOrEqual(target);
    }
  });
});

describe('selectGaps — 세그먼트별 균등 분배 (원본의 쏠림 회귀)', () => {
  it('빈칸이 한 세그먼트에 몰리지 않는다', () => {
    // 원본은 전체를 점수순 탐욕 선택해서, 긴 단어가 몰린 문단이 빈칸을 독식했다.
    // 앞 문장에만 장단어를 몰아넣고 뒤 문장들이 굶지 않는지 본다.
    const heavy =
      'Extraordinary transformations demonstrated unprecedented environmental consequences globally. ' +
      'Farmers planted seeds during spring. ' +
      'Rivers carried sediment downstream slowly. ' +
      'Villagers gathered timber before winter.';
    const segs = splitIntoSegmentWords(heavy);
    const gaps = selectGaps(segs, 'hard');
    const bySeg = new Map<number, number>();
    for (const g of gaps) bySeg.set(g.segIdx, (bySeg.get(g.segIdx) ?? 0) + 1);

    expect(gaps.length).toBeGreaterThan(3);
    // 첫 문장이 전부를 가져가지 않는다
    expect(bySeg.get(0) ?? 0).toBeLessThan(gaps.length);
    // 두 개 이상의 세그먼트가 빈칸을 갖는다
    expect(bySeg.size).toBeGreaterThan(1);
  });

  it('후보가 없는 세그먼트가 있어도 전체 목표를 최대한 채운다', () => {
    const segs = [
      ['The', 'cat', 'sat', 'on', 'it.'],
      ['Environmental', 'degradation', 'accelerated', 'dramatically', 'worldwide', 'thereafter.'],
    ];
    const gaps = selectGaps(segs, 'hard');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.segIdx === 1)).toBe(true);
  });
});

describe('selectGaps — 경계 조건', () => {
  it('빈 입력은 빈 배열', () => {
    expect(selectGaps([], 'normal')).toEqual([]);
    expect(selectGaps([[]], 'normal')).toEqual([]);
  });

  it('뚫을 단어가 하나도 없으면 빈 배열 (무한 루프 없음)', () => {
    expect(selectGaps([['The', 'cat', 'is', 'on', 'it.']], 'hard')).toEqual([]);
  });

  it('아주 짧은 지문에서도 최소 하나는 시도한다', () => {
    expect(selectGaps([['Biodiversity']], 'easy').length).toBe(1);
  });
});

describe('applyOverrides — 드리프트 감지 (D-004)', () => {
  const segs = [['Climate', 'change', 'transforms', 'ecosystems', 'permanently.']];
  const auto = selectGaps(segs, 'normal');

  it('강사가 켠 빈칸을 추가한다', () => {
    const ov: GapOverride[] = [{ segIdx: 0, wordIdx: 1, word: 'change', enabled: true }];
    const { gaps, drifted } = applyOverrides(segs, auto, ov);
    expect(drifted).toEqual([]);
    expect(gaps.some((g) => g.wordIdx === 1)).toBe(true);
  });

  it('강사가 끈 빈칸을 제거한다', () => {
    const target = auto[0]!;
    const ov: GapOverride[] = [{ ...target, enabled: false }];
    const { gaps } = applyOverrides(segs, auto, ov);
    expect(gaps.some((g) => g.wordIdx === target.wordIdx)).toBe(false);
  });

  it('지문이 바뀌어 단어가 어긋나면 조용히 적용하지 않고 보고한다', () => {
    // 원본 앱의 버그: 토큰 인덱스만 저장해서 지문 수정 시 빈칸이 엉뚱한 단어에 붙었다.
    const edited = [['Climate', 'shift', 'transforms', 'ecosystems', 'permanently.']];
    const ov: GapOverride[] = [{ segIdx: 0, wordIdx: 1, word: 'change', enabled: true }];
    const { gaps, drifted } = applyOverrides(edited, selectGaps(edited, 'normal'), ov);
    expect(drifted).toEqual(ov);
    expect(gaps.some((g) => g.wordIdx === 1 && g.word === 'shift')).toBe(false);
  });

  it('범위를 벗어난 위치도 드리프트로 잡는다', () => {
    const ov: GapOverride[] = [{ segIdx: 9, wordIdx: 9, word: 'gone', enabled: true }];
    expect(applyOverrides(segs, auto, ov).drifted).toEqual(ov);
  });

  it('결과는 항상 정렬돼 있다', () => {
    const ov: GapOverride[] = [
      { segIdx: 0, wordIdx: 4, word: 'permanently.', enabled: true },
      { segIdx: 0, wordIdx: 1, word: 'change', enabled: true },
    ];
    const { gaps } = applyOverrides(segs, auto, ov);
    const idx = gaps.map((g) => g.wordIdx);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
});

describe('makeChoices — 객관식 (D-006)', () => {
  const pool = flat(SEGS);

  it('결정론적이다', () => {
    const first = makeChoices('biodiversity', pool);
    for (let i = 0; i < 20; i++) expect(makeChoices('biodiversity', pool)).toEqual(first);
  });

  it('정답이 반드시 들어 있다', () => {
    for (const g of selectGaps(SEGS, 'hard')) {
      expect(makeChoices(g.word, pool)).toContain(normalize(g.word));
    }
  });

  it('보기가 중복되지 않는다', () => {
    for (const g of selectGaps(SEGS, 'hard')) {
      const c = makeChoices(g.word, pool);
      expect(new Set(c).size).toBe(c.length);
    }
  });

  it('요청한 개수를 넘지 않는다', () => {
    expect(makeChoices('biodiversity', pool, 4).length).toBeLessThanOrEqual(4);
    expect(makeChoices('biodiversity', pool, 3).length).toBeLessThanOrEqual(3);
  });

  it('정답과 같은 어간의 단어를 오답으로 쓰지 않는다', () => {
    const p = ['threatens', 'threatened', 'agriculture', 'continent', 'assessment'];
    const c = makeChoices('threaten', p);
    expect(c.filter((w) => stem(w) === stem('threaten')).length).toBe(1);
  });

  it('후보가 부족하면 있는 만큼만 준다 — 채우려고 지어내지 않는다', () => {
    expect(makeChoices('biodiversity', ['the', 'a', 'is']).length).toBe(1);
  });

  it('정답 위치가 늘 같지 않다 (씨앗으로 섞임)', () => {
    const positions = new Set(
      ['biodiversity', 'agriculture', 'continent', 'assessment', 'cooperation'].map((w) =>
        makeChoices(w, pool).indexOf(w),
      ),
    );
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe('isCorrect', () => {
  it('대소문자와 앞뒤 문장부호를 무시한다', () => {
    expect(isCorrect('Climate', 'climate,')).toBe(true);
    expect(isCorrect(' predicted. ', 'Predicted')).toBe(true);
  });

  it('다른 단어는 틀린 것으로 본다', () => {
    expect(isCorrect('climates', 'climate')).toBe(false);
  });
});

describe('tokenize — 원본 규칙 유지', () => {
  it('원문을 손실 없이 복원할 수 있다', () => {
    expect(tokenize(PASSAGE).map((t) => t.s).join('')).toBe(PASSAGE);
  });

  it('단어와 비단어를 구분한다', () => {
    const t = tokenize("It's well-known.");
    expect(t.filter((x) => x.t === 'w').map((x) => x.s)).toEqual(["It's", 'well-known']);
  });
});

describe('splitIntoSegmentWords', () => {
  it('문장 끝 부호로 나눈다', () => {
    expect(splitIntoSegmentWords('One two. Three four! Five?')).toEqual([
      ['One', 'two.'],
      ['Three', 'four!'],
      ['Five?'],
    ]);
  });

  it('문장부호가 없으면 통째로 한 세그먼트', () => {
    expect(splitIntoSegmentWords('no ending punctuation here')).toEqual([
      ['no', 'ending', 'punctuation', 'here'],
    ]);
  });

  it('빈 문자열은 빈 배열', () => {
    expect(splitIntoSegmentWords('')).toEqual([]);
    expect(splitIntoSegmentWords('   ')).toEqual([]);
  });
});

describe('스냅샷 — 알고리즘을 고치면 여기가 깨진다', () => {
  it('표본 지문의 난이도별 빈칸', () => {
    const snap = Object.fromEntries(
      LEVELS.map((l: Level) => [l, selectGaps(SEGS, l).map((g) => normalize(g.word))]),
    );
    expect(snap).toMatchInlineSnapshot(`
      {
        "easy": [
          "environment",
          "biodiversity",
          "comprehensive",
          "cooperation",
        ],
        "hard": [
          "transforming",
          "environment",
          "scientists",
          "temperatures",
          "agriculture",
          "biodiversity",
          "researchers",
          "published",
          "comprehensive",
          "cooperation",
          "sustainable",
        ],
        "normal": [
          "transforming",
          "environment",
          "temperatures",
          "biodiversity",
          "researchers",
          "comprehensive",
          "cooperation",
        ],
      }
    `);
  });
});
