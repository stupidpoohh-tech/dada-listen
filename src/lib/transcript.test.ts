import { describe, expect, it } from 'vitest';
import { alignTranscript, parseTranscript, transcriptForQuestion } from './transcript';
import type { Segment } from './types';

const seg = (idx: number, text: string): Segment => ({
  id: String(idx), itemId: 'x', idx, text, startSec: idx * 6, endSec: idx * 6 + 5,
  words: text.split(' ').map(w => ({ w, s: null, e: null })),
});
describe('공식 대본 입력과 문항별 분리', () => {
  it('1~17번과 16~17 공동 지문을 구분한다', () => {
    const parsed = parseTranscript('1. W: Hello, everyone.\n2번 M: Good morning.\n16~17. [출제의도] 담화의 주제\nM: These days, people become vegetarians.');
    expect(parsed.numbered).toBe(true);
    expect(transcriptForQuestion(parsed, '1', 17)).toContain('Hello');
    expect(transcriptForQuestion(parsed, '2', 17)).toContain('Good');
    expect(transcriptForQuestion(parsed, '16', 17)).toContain('vegetarians');
    expect(transcriptForQuestion(parsed, '17', 17)).toContain('vegetarians');
  });
  it('번호 없는 대본은 단일 음원에서만 적용한다', () => {
    const parsed = parseTranscript("W: Hello, students.\nM: Let's begin.");
    expect(transcriptForQuestion(parsed, '1', 1)).toContain('students');
    expect(transcriptForQuestion(parsed, '2', 17)).toBeNull();
  });
  it('일치하는 원문 철자와 누락 단어를 복구한다', () => {
    const asr = [seg(0, 'Hello mister Baker thank you for doing this interview'),
                 seg(1, 'My pleasure I really like reading your articles')];
    const aligned = alignTranscript(asr, 'W: Hello, Mr. Baker. Thank you for doing this interview.\nM: My pleasure. I really like reading your articles.');
    expect(aligned.applied).toBe(true);
    expect(aligned.segments.map(x => x.text).join(' ')).toContain('Mr.');
    expect(aligned.segments.map(x => x.text).join(' ')).not.toContain('mister');
  });
  it('다른 문항 대본은 잘못 덮어쓰지 않는다', () => {
    const asr = [seg(0, 'Hello mr Baker thank you for doing this interview')];
    const aligned = alignTranscript(asr, 'The weather forecast says it will rain all day tomorrow so bring an umbrella');
    expect(aligned.applied).toBe(false);
    expect(aligned.segments[0]!.text).toBe(asr[0]!.text);
  });
  it('공식 대본 마지막 응답이 빠졌으면 AI 음성 단어를 보존한다', () => {
    const asr = [seg(0, 'That was a great movie what did you think'),
                 seg(1, 'The movie was okay but I could not concentrate on it at all'),
                 seg(2, 'Why not what happened I felt sick all night')];
    const aligned = alignTranscript(asr, 'That was a great movie what did you think The movie was okay but I could not concentrate on it at all Why not what happened');
    expect(aligned.applied).toBe(true);
    expect(aligned.segments.map(x => x.text).join(' ')).toContain('felt sick all night');
  });
});
