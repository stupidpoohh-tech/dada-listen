/* types.ts — 도메인 타입. DB 스키마(db/migrations)와 짝이 맞아야 한다.
 *
 * DB 는 snake_case, 앱은 camelCase 를 쓴다. 변환은 store.ts 안에서만 한다. */

import type { Level } from './gapfill';

export type Teacher = { id: string; name: string };

/** 인증 사용자. SDK 타입을 앱 전체로 새어나가게 하지 않으려고 여기서 좁힌다. */
export type AuthUser = { id: string; email: string | null };

export type Folder = {
  id: string;
  ownerId: string;
  name: string;
  color: string;
  sort: number;
  createdAt: string;
};

/** ASR 파이프라인 상태. items.status 와 같은 값이어야 한다. */
export type ItemStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type Item = {
  id: string;
  ownerId: string;
  folderId: string | null;
  title: string;
  tags: string[];
  /** R2 오브젝트 키. 재생 시 서명 URL 로 바꾼다 — 직접 쓰지 않는다 (D-012). */
  mediaKey: string | null;
  mime: string | null;
  durationSec: number | null;
  /**
   * 음원 안에서 이 문항이 차지하는 구간. null 이면 파일 전체다.
   * 20분짜리 회차를 문항별로 나눌 때, 오디오를 자르지 않고 구간만 가리킨다
   * (0006_item_clips.sql). 여러 아이템이 같은 mediaKey 를 공유한다.
   */
  clipStartSec: number | null;
  clipEndSec: number | null;
  /** 표시용 문항 번호. "12" 또는 "16~17". */
  questionNo: string | null;
  status: ItemStatus;
  statusError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** ASR 이 단어 타임스탬프를 못 주면 s/e 는 null. 문장 단위 기능은 그래도 된다. */
export type Word = { w: string; s: number | null; e: number | null };

export type Segment = {
  id: string;
  itemId: string;
  idx: number;
  startSec: number;
  endSec: number;
  text: string;
  words: Word[];
};

export type GapOverrideRow = {
  id: string;
  itemId: string;
  segmentId: string;
  wordIdx: number;
  word: string;
  level: Level;
  enabled: boolean;
};

export type NewItem = {
  title: string;
  folderId?: string | null;
  tags?: string[];
  /** 문항별로 나눠 만들 때. 셋은 함께 들어가거나 함께 빠진다. */
  mediaKey?: string | null;
  mime?: string | null;
  durationSec?: number | null;
  clipStartSec?: number | null;
  clipEndSec?: number | null;
  questionNo?: string | null;
};
