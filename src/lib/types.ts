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
};
