import { describe, expect, it, vi } from 'vitest';
import { deleteObject, purgeOwnMedia } from './media';
import type { Env } from './index';

describe('계정별 파일 삭제', () => {
  it('다른 강사의 R2 키를 삭제할 수 없다', async () => {
    const del = vi.fn();
    const env = { MEDIA: { delete: del } } as unknown as Env;
    const req = new Request('https://app.test/api/media/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'teacher_B/clip.mp3' }),
    });
    await expect(deleteObject(req, env, 'teacher_A')).rejects.toThrow('권한');
    expect(del).not.toHaveBeenCalled();
  });

  it('문항 마지막 삭제 시 원본과 임시 전사 JSON을 함께 제거한다', async () => {
    const del = vi.fn(async () => undefined);
    const env = { MEDIA: { delete: del } } as unknown as Env;
    const req = new Request('https://app.test/api/media/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'teacher_A/clip.mp3' }),
    });
    const response = await deleteObject(req, env, 'teacher_A');
    expect(response.status).toBe(200);
    expect(del).toHaveBeenCalledWith([
      'teacher_A/clip.mp3',
      'teacher_A/clip.mp3.transcript.json',
    ]);
  });

  it('전체 삭제는 해당 강사의 경로만 반복 조회해 지운다', async () => {
    const objects = new Set([
      'teacher_A/one.mp3',
      'teacher_A/one.mp3.transcript.json',
      'teacher_A/two.m4a',
      'teacher_B/keep.mp3',
    ]);
    const prefixes: string[] = [];
    const env = {
      MEDIA: {
        list: vi.fn(async ({ prefix }: { prefix: string }) => {
          prefixes.push(prefix);
          return { objects: [...objects].filter(k => k.startsWith(prefix)).map(key => ({ key })) };
        }),
        delete: vi.fn(async (batch: string[]) => {
          for (const key of batch) objects.delete(key);
        }),
      },
    } as unknown as Env;

    const response = await purgeOwnMedia(env, 'teacher_A');
    const data = await response.json() as { deleted: number; ok: boolean };
    expect(data).toEqual({ ok: true, deleted: 3 });
    expect(objects).toEqual(new Set(['teacher_B/keep.mp3']));
    expect(prefixes).toEqual(['teacher_A/', 'teacher_A/']);
  });
});
