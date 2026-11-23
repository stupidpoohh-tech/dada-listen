/* 사장님이 실제로 붙여넣는 표가 그대로 먹히는지 확인한다.
 * 경계를 이미 아는 경우가 자동 검출보다 정확하므로, 이 경로가 깨지면 안 된다. */

import { describe, expect, it } from 'vitest';
import { parseClipCsv } from './audioSilence';
import { blocksFromRanges } from './split';
import type { Segment } from './types';

/** 엑셀에서 복사해 붙여넣은 그대로. 머리글 한 줄 + 탭 구분 + 16·17 같은 구간. */
const PASTED = `번호	시작	끝
1	0	55.51
2	64.15	121.01
3	129.67	208.34
4	216.99	291.03
5	299.7	380.18
6	388.83	475.09
7	483.76	548.3
8	556.95	636.77
9	645.43	729.88
10	738.55	827.08
11	835.73	863.55
12	872.2	906.69
13	915.35	984.92
14	993.59	1076.24
15	1084.91	1152.01
16	1160.67	1324.82
17	1160.67	1324.82`;

let n = 0;
const seg = (startSec: number, endSec: number, text = 'utterance'): Segment => ({
  id: `s${(n += 1)}`, itemId: 'i', idx: 0, startSec, endSec, text,
  words: [{ w: text, s: startSec, e: endSec }],
});

describe('붙여넣은 구간 표', () => {
  it('엑셀에서 복사한 탭 구분 표를 그대로 읽는다', () => {
    const ranges = parseClipCsv(PASTED);
    expect(ranges).toHaveLength(17);
    expect(ranges[0]).toEqual({ no: 1, startSec: 0, endSec: 55.51 });
    expect(ranges[16]).toEqual({ no: 17, startSec: 1160.67, endSec: 1324.82 });
  });

  it('16번과 17번이 같은 구간을 공유해도 받는다', () => {
    const ranges = parseClipCsv(PASTED);
    expect(ranges[15]!.startSec).toBe(ranges[16]!.startSec);
    expect(ranges[15]!.endSec).toBe(ranges[16]!.endSec);
  });

  it('쉼표로 구분해도 읽는다', () => {
    expect(parseClipCsv(PASTED.replace(/\t/g, ','))).toHaveLength(17);
  });

  it('번호가 빠지면 거부한다 — 조용히 16개만 만들지 않는다', () => {
    const missing = PASTED.split('\n').filter((l) => !l.startsWith('7\t')).join('\n');
    expect(() => parseClipCsv(missing)).toThrow();
  });
});

describe('구간 → 문항 덩어리', () => {
  const ranges = parseClipCsv(PASTED);
  // 구간마다 발화 두 개씩. 구간 사이의 공백(답 고르는 시간)에도 하나 끼워
  // 넣어, 그게 어느 문항에도 딸려가지 않는지 본다.
  const segments: Segment[] = [];
  for (const r of ranges.slice(0, 16)) {
    segments.push(seg(r.startSec + 1, r.startSec + 10));
    segments.push(seg(r.endSec - 8, r.endSec - 1));
  }
  segments.push(seg(1330, 1340, '이제 듣기 문제가 끝났습니다'));
  segments.sort((a, b) => a.startSec - b.startSec);
  const indexed = segments.map((s, i) => ({ ...s, idx: i }));
  const blocks = blocksFromRanges(ranges, indexed);

  it('표의 줄 수만큼 문항이 나온다', () => {
    expect(blocks).toHaveLength(17);
    expect(blocks.map((b) => b.no)).toEqual(
      Array.from({ length: 17 }, (_, i) => String(i + 1)),
    );
  });

  it('구간이 표와 한 치도 다르지 않다', () => {
    blocks.forEach((b, i) => {
      expect(b.startSec).toBe(ranges[i]!.startSec);
      expect(b.endSec).toBe(ranges[i]!.endSec);
    });
  });

  it('16번과 17번이 같은 음원 구간과 같은 스크립트를 가리킨다', () => {
    expect(blocks[15]!.startSec).toBe(blocks[16]!.startSec);
    expect(blocks[15]!.endSec).toBe(blocks[16]!.endSec);
    expect(blocks[15]!.segFrom).toBe(blocks[16]!.segFrom);
    expect(blocks[15]!.segTo).toBe(blocks[16]!.segTo);
  });

  it('세그먼트를 순번이 아니라 시각으로 배정한다', () => {
    for (const b of blocks.slice(0, 16)) {
      for (let i = b.segFrom; i <= b.segTo; i += 1) {
        const c = (indexed[i]!.startSec + indexed[i]!.endSec) / 2;
        expect(c).toBeGreaterThanOrEqual(b.startSec);
        expect(c).toBeLessThanOrEqual(b.endSec);
      }
    }
  });

  it('구간 밖의 안내 방송은 어느 문항에도 딸려가지 않는다', () => {
    const tail = indexed.findIndex((s) => s.text.includes('끝났습니다'));
    expect(tail).toBeGreaterThan(-1);
    for (const b of blocks) {
      expect(tail >= b.segFrom && tail <= b.segTo).toBe(false);
    }
  });

  it('전사가 하나도 없는 구간은 빈 범위가 된다 (음원만 있는 카드)', () => {
    const empty = blocksFromRanges([{ no: 1, startSec: 500, endSec: 510 }], indexed);
    expect(empty[0]!.segFrom).toBeGreaterThan(empty[0]!.segTo);
    expect(indexed.slice(empty[0]!.segFrom, empty[0]!.segTo + 1)).toEqual([]);
  });

  it('말끝이 잘리지 않는다 — 표의 끝을 그대로 쓴다', () => {
    // 전사 마지막 발화는 구간 끝보다 앞이지만, 구간은 표가 정한 자리까지 간다.
    const b = blocks[0]!;
    expect(indexed[b.segTo]!.endSec).toBeLessThan(b.endSec);
    expect(b.endSec).toBe(55.51);
  });
});
