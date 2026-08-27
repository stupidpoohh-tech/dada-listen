/* UploadModal.tsx — 새 음성 추가.
 *
 * 원본 admin.jsx 의 UploadModal 을 옮기되, 스크립트를 손으로 붙여넣던 자리가
 * 자동 전사로 바뀌었다 (D-002). 강사는 파일만 고르면 된다.
 *
 * 흐름: 아이템 생성 → R2 업로드 → 전사 요청 → 결과 폴링 → 세그먼트 저장.
 * 모달을 닫아도 목록 화면이 이어서 폴링하므로 중간에 닫아도 된다. */

import { useEffect, useRef, useState } from 'react';
import { Ic } from './icons';
import { ACCEPT_MEDIA, isAudioFile, readDuration } from '../lib/media';
import {
  collectTranscription,
  createItem,
  deleteItem,
  requestTranscription,
  updateItem,
  uploadMedia,
} from '../lib/store';
import type { Folder, Segment } from '../lib/types';

/** 화면에 보여줄 진행 단계. 원본의 진행 문구 자리를 그대로 쓴다. */
type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'uploading'; fraction: number }
  | { kind: 'transcribing' }
  | { kind: 'done'; segments: Segment[] }
  | { kind: 'failed'; message: string };

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type Props = {
  folders: Folder[];
  onClose: () => void;
  /** 목록을 새로 읽게 한다. 아이템이 생기거나 상태가 바뀔 때마다 부른다. */
  onChanged: () => void;
  toast: (m: string) => void;
};

export default function UploadModal({ folders, onClose, onChanged, toast }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string>(folders[0]?.id ?? '');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [durationSec, setDurationSec] = useState(0);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  // 언마운트 뒤 setState 를 막는다. 전사 폴링이 모달보다 오래 살 수 있다.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const busy =
    phase.kind === 'reading' || phase.kind === 'uploading' || phase.kind === 'transcribing';

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPhase({ kind: 'reading' });
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    const d = await readDuration(f);
    if (!alive.current) return;
    setDurationSec(d);
    setPhase({ kind: 'idle' });
    toast(isAudioFile(f) ? '음성을 불러왔어요' : '영상을 불러왔어요 (오디오만 재생됩니다)');
  };

  const addTag = (raw: string) => {
    const t = raw.trim().replace(/^#/, '');
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  };

  const save = async () => {
    if (!file || !title.trim()) return;
    let itemId = '';
    try {
      const item = await createItem({
        title: title.trim(),
        folderId: folderId || null,
        tags,
      });
      itemId = item.id;
      onChanged();

      setPhase({ kind: 'uploading', fraction: 0 });
      const mediaKey = await uploadMedia(itemId, file, (fraction) => {
        if (alive.current) setPhase({ kind: 'uploading', fraction });
      });
      if (durationSec > 0) await updateItem(itemId, { durationSec });

      setPhase({ kind: 'transcribing' });
      await requestTranscription(itemId, mediaKey);
      onChanged();

      // 전사가 끝날 때까지 확인한다. 모달을 닫아도 목록 화면이 이어받는다.
      for (let i = 0; i < 240 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        if (!alive.current) return;
        const finished = await collectTranscription(itemId, mediaKey);
        if (finished) {
          onChanged();
          const { listSegments } = await import('../lib/store');
          const segments = await listSegments(itemId);
          if (!alive.current) return;
          if (segments.length === 0) {
            setPhase({ kind: 'failed', message: '전사 결과가 비어 있어요. 음성이 들어 있는지 확인해 주세요.' });
          } else {
            setPhase({ kind: 'done', segments });
            toast('스크립트가 만들어졌어요');
          }
          return;
        }
      }
      if (alive.current) {
        setPhase({ kind: 'transcribing' });
        toast('전사가 오래 걸리고 있어요. 목록에서 계속 확인됩니다');
      }
    } catch (e) {
      console.error('[upload]', e);
      const message = e instanceof Error ? e.message : '알 수 없는 오류';
      if (alive.current) setPhase({ kind: 'failed', message });
      // 업로드도 못 한 빈 아이템은 목록에 남겨두지 않는다.
      if (itemId) {
        await deleteItem(itemId).catch(() => {});
        onChanged();
      }
    }
  };

  const canSave = Boolean(file) && title.trim().length > 0 && !busy && phase.kind !== 'done';

  return (
    <div className="overlay" onMouseDown={(e) => {
      if ((e.target as HTMLElement).classList.contains('overlay') && !busy) onClose();
    }}>
      <div className="modal">
        <div className="modal-head">
          <h2>{phase.kind === 'done' ? '스크립트가 만들어졌어요' : '새 음성 추가'}</h2>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose} aria-label="닫기"><Ic.x /></button>
        </div>

        <div className="modal-body">
          {phase.kind !== 'done' && (
            <>
              <div className="field">
                <label>
                  영상 또는 음성 파일{' '}
                  <span className="hint">· 영상도 올릴 수 있어요 (오디오만 재생됩니다)</span>
                </label>
                <button
                  type="button"
                  className={'dropzone' + (drag ? ' drag' : '')}
                  style={{ width: '100%' }}
                  disabled={busy}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); void pickFile(e.dataTransfer.files[0]); }}
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="ic"><Ic.film /></div>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {file ? file.name : '파일을 끌어다 놓거나 클릭'}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    {file && durationSec > 0 ? fmtDur(durationSec) : 'mp4 · mov · mp3 · m4a · wav'}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT_MEDIA}
                    style={{ display: 'none' }}
                    onChange={(e) => void pickFile(e.target.files?.[0])}
                  />
                </button>
                <ProgressLine phase={phase} />
              </div>

              <div className="field">
                <label>제목</label>
                <input
                  className="input"
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="예: 2024 수능특강 Unit 5 - Climate"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="field">
                  <label>폴더</label>
                  <select
                    className="input"
                    value={folderId}
                    disabled={busy}
                    onChange={(e) => setFolderId(e.target.value)}
                  >
                    <option value="">폴더 없음</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>태그 <span className="hint">· Enter로 추가</span></label>
                  <div className="chips-input">
                    {tags.map((t) => (
                      <span key={t} className="mini-chip">
                        #{t}
                        <button onClick={() => setTags(tags.filter((x) => x !== t))} aria-label="태그 삭제">×</button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      disabled={busy}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); }
                        if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
                      }}
                      placeholder={tags.length ? '' : '환경, 고난도…'}
                    />
                  </div>
                </div>
              </div>

              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  스크립트 <span className="hint">· 올리면 자동으로 만들어집니다. 타이핑할 필요 없어요</span>
                </label>
                <div
                  style={{
                    border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 16,
                    background: 'var(--bg-soft)', minHeight: 96, display: 'grid',
                    placeItems: 'center', color: 'var(--ink-3)', fontSize: 13,
                    textAlign: 'center', lineHeight: 1.7,
                  }}
                >
                  {phase.kind === 'transcribing'
                    ? '전사 중…  파일 길이에 따라 몇십 초 걸릴 수 있어요'
                    : '파일을 올리면 자동으로 전사됩니다.'}
                </div>
              </div>
            </>
          )}

          {phase.kind === 'done' && <TranscriptPreview segments={phase.segments} />}

          {phase.kind === 'failed' && (
            <div
              style={{
                marginTop: 16, padding: '12px 14px', borderRadius: 'var(--r)',
                background: '#fdecea', border: '1px solid #f3c6c0', color: '#c8392b',
                fontSize: 12.5, lineHeight: 1.6, wordBreak: 'break-word',
              }}
            >
              {phase.message}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {busy && (
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)', marginRight: 'auto' }}>
              {phase.kind === 'uploading'
                ? `업로드 중 ${Math.round(phase.fraction * 100)}%`
                : phase.kind === 'transcribing'
                  ? '전사 중… 닫아도 계속됩니다'
                  : '준비 중…'}
            </span>
          )}
          <button className="btn ghost" onClick={onClose} disabled={phase.kind === 'uploading'}>
            {phase.kind === 'done' ? '닫기' : '취소'}
          </button>
          {phase.kind !== 'done' && (
            <button className="btn primary" disabled={!canSave} onClick={() => void save()}>
              <Ic.check /> {busy ? '진행 중…' : '추가하기'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressLine({ phase }: { phase: Phase }) {
  if (phase.kind === 'idle' || phase.kind === 'done') return null;
  const pct =
    phase.kind === 'reading' ? 8 : phase.kind === 'uploading' ? 10 + phase.fraction * 80 : 95;
  const label =
    phase.kind === 'reading' ? '파일 확인 중…'
      : phase.kind === 'uploading' ? '업로드 중…'
        : phase.kind === 'transcribing' ? '전사 중…'
          : '';
  return (
    <>
      {phase.kind !== 'failed' && (
        <div className="progress"><div className="bar" style={{ width: `${pct}%` }} /></div>
      )}
      {label && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 8 }}>{label}</div>
      )}
    </>
  );
}

/** 전사 결과 미리보기. 문장마다 시간이 붙는다 (D-003). */
function TranscriptPreview({ segments }: { segments: Segment[] }) {
  const total = segments.at(-1)?.endSec ?? 0;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12 }}>
        {segments.length}개 문장 · {fmtDur(total)} · 목록에서 빈칸을 다듬을 수 있어요
      </div>
      <div
        style={{
          border: '1px solid var(--line)', borderRadius: 'var(--r)',
          background: 'var(--bg-soft)', padding: 16, maxHeight: 320, overflowY: 'auto',
        }}
      >
        {segments.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: 12, padding: '5px 0' }}>
            <span
              style={{
                fontSize: 11.5, color: 'var(--ink-4)', minWidth: 40, flex: 'none',
                paddingTop: 5, fontVariantNumeric: 'tabular-nums',
              }}
            >
              {fmtDur(s.startSec)}
            </span>
            <span style={{ fontFamily: 'var(--serif)', fontSize: 17, lineHeight: 1.85 }}>
              {s.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
