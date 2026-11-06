import { describe, expect, it, vi } from 'vitest';
import { publishStudentView, studentLibrary, studentPlay } from './student';
import type { Env } from './index';

const A = 'teacher_A';
const B = 'teacher_B';
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const another = 'bbbbbbbb-aaaa-cccc-dddd-eeeeeeeeeeee';

function setup() {
  const files = new Map<string, unknown>();
  const env = {
    MEDIA_TOKEN_SECRET: 'test-signing-secret',
    MEDIA: {
      get: vi.fn(async (key: string) => files.has(key)
        ? { json: async () => files.get(key) } : null),
      put: vi.fn(async (key: string, data: string) => { files.set(key, JSON.parse(data)); }),
      head: vi.fn(async (key: string) => key === `${A}/clip.mp3` ? {} : null),
    },
  } as unknown as Env;
  return { env, files };
}

function req(owner = A, data: unknown = {
  items: [{
    id: ID, title: '2022 고2 1번', folderId: null, tags: [],
    mediaKey: `${owner}/clip.mp3`, mime: 'audio/mpeg', durationSec: 90,
    clipStartSec: 10, clipEndSec: 100, questionNo: '1', createdAt: '',
  }],
  folders: [{id:another, name:'모의고사', color:'#3355aa', sort:0}],
  segments: {
    [ID]: [{
      id:another, itemId:ID, idx:0,
      startSec:10, endSec:15, text:'Hello everyone.',
      words:[{w:'Hello',s:10,e:11},{w:'everyone.',s:11,e:12}],
    }],
  },
}) {
  return new Request('https://example.com/api/student/publish', {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify(data),
  });
}

describe('단일 강사 공개 학생용 보기', () => {
  it('로그인 학생 없이 공개 목록과 스크립트를 읽되 R2 키와 owner id는 노출하지 않는다', async () => {
    const {env} = setup();
    expect((await publishStudentView(req(),env,A)).status).toBe(200);
    const response = await studentLibrary(env);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json() as {
      items: Array<{mediaKey:string|null; ownerId:string; title:string}>,
      segments:Record<string, unknown[]>,
    };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('2022 고2 1번');
    expect(result.items[0]?.mediaKey).toBeNull();
    expect(result.items[0]?.ownerId).toBe('');
    expect(result.segments[ID]).toHaveLength(1);
  });

  it('공개된 문항만 재생할 수 있고 다른 문항은 거부한다', async () => {
    const {env} = setup();
    await publishStudentView(req(),env,A);
    const response = await studentPlay(env,new URL(`https://example.com/api/student/play?item=${ID}`));
    expect((response.status)).toBe(200);
    const body = await response.json() as {url:string};
    expect(body.url).toContain('/api/media/stream?');
    await expect(studentPlay(env,new URL(`https://example.com/api/student/play?item=${another}`)))
      .rejects.toThrow('게시된');
  });

  it('다른 계정이 이미 게시된 학생용 목록을 덮어쓸 수 없다', async () => {
    const {env} = setup();
    await publishStudentView(req(),env,A);
    await expect(publishStudentView(req(B),env,B)).rejects.toThrow('최초 게시');
    expect(((await studentLibrary(env)).status)).toBe(200);
  });

  it('다른 강사의 음원 키는 처음 게시할 때도 거절한다', async () => {
    const {env} = setup();
    await expect(publishStudentView(req(B),env,A)).rejects.toThrow('다른 계정');
  });

  it('모든 문항 삭제 후 빈 목록으로 다시 게시할 수 있다', async () => {
    const {env} = setup();
    await publishStudentView(req(),env,A);
    const cleared = await publishStudentView(req(A,{items:[],folders:[],segments:{}}),env,A);
    expect(cleared.status).toBe(200);
    const data = await (await studentLibrary(env)).json() as {items:unknown[]};
    expect(data.items).toHaveLength(0);
    await expect(studentPlay(env,new URL(`https://example.com/api/student/play?item=${ID}`)))
      .rejects.toThrow('게시된');
  });
});
