/* TrimPanel.tsx — 올리기 전에 구간 잘라내기.
 *
 * 24분짜리 모의고사에서 문제 하나씩 떼어 올리려는 용도다.
 * 트랙과 A·B 표시는 원본 플레이어의 시각 언어를 그대로 쓴다. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Ic } from './icons';
import { decode, estimateSize, sliceToWav, toClipFile } from '../lib/trim';

const fmt = (s: number) => {
  const v = Math.max(0, s);
  return `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

type Props = {
  file: File;
  /** 잘라낸 파일로 바꾼다. 취소하면 null. */
  onTrimmed: (clip: File | null) => void;
  disabled?: boolean;
};

export default function TrimPanel({ file, onTrimmed, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // 미리듣기는 원본 파일을 그대로 쓴다. 자른 결과를 따로 만들 필요가 없다.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    return () => {
      URL.revokeObjectURL(url);
      objectUrl.current = null;
    };
  }, [file]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const buf = await decode(file);
      if (!alive.current) return;
      setBuffer(buf);
      setStart(0);
      setEnd(buf.duration);
      setOpen(true);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : '파일을 열지 못했어요');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [file]);

  // 구간 밖으로 나가면 되돌린다. A-B 반복과 같은 동작.
  const onTime = () => {
    const a = audioRef.current;
    if (!a) return;
    setCursor(a.currentTime);
    if (a.currentTime >= end || a.currentTime < start - 0.3) {
      a.currentTime = start;
      if (a.currentTime >= end) a.pause();
    }
  };

  const preview = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.currentTime = start;
      void a.play();
    } else {
      a.pause();
    }
  };

  const apply = () => {
    if (!buffer) return;
    try {
      const clip = toClipFile(file.name, sliceToWav(buffer, start, end), start, end);
      onTrimmed(clip);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '자르지 못했어요');
    }
  };

  const duration = buffer?.duration ?? 0;
  const clipLen = Math.max(0, end - start);
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  if (!open) {
    return (
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn sm"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          <Ic.reset s={15} /> {loading ? '파일 여는 중…' : '구간 잘라내기'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--ink-3)', marginLeft: 10 }}>
          긴 음원에서 문제 하나만 떼어 올릴 수 있어요
        </span>
        {error && (
          <div style={{ color: '#c8392b', fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>{error}</div>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid var(--line)',
        borderRadius: 'var(--r)',
        background: 'var(--bg-soft)',
        padding: 14,
      }}
    >
      <audio
        ref={audioRef}
        src={objectUrl.current ?? undefined}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={onTime}
        style={{ display: 'none' }}
      />

      <div className="scrub" style={{ marginBottom: 12 }}>
        <span className="time">{fmt(cursor)}</span>
        <div className="track" style={{ cursor: 'default' }}>
          <div
            className="ab"
            style={{ left: `${pct(start)}%`, width: `${pct(clipLen)}%` }}
          />
          <div className="marker" style={{ left: `${pct(start)}%` }} />
          <div className="marker" style={{ left: `${pct(end)}%` }} />
          {playing && <div className="knob" style={{ left: `${pct(cursor)}%` }} />}
        </div>
        <span className="time" style={{ textAlign: 'right' }}>{fmt(duration)}</span>
      </div>

      <Slider label="시작" value={start} max={duration}
        onChange={(v) => setStart(Math.min(v, end - 0.5))} />
      <Slider label="끝" value={end} max={duration}
        onChange={(v) => setEnd(Math.max(v, start + 0.5))} />

      <div className="player-tools" style={{ marginTop: 12 }}>
        <button type="button" className={'tool' + (playing ? ' on' : '')} onClick={preview}>
          {playing ? <Ic.pause s={15} /> : <Ic.play s={15} />} 구간 미리듣기
        </button>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {fmt(clipLen)} · 약 {mb(buffer ? estimateSize(buffer, start, end) : 0)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => { setOpen(false); onTrimmed(null); }}
        >
          취소
        </button>
        <button type="button" className="btn primary sm" onClick={apply} disabled={clipLen < 0.5}>
          <Ic.check s={15} /> 이 구간만 쓰기
        </button>
      </div>

      {error && (
        <div style={{ color: '#c8392b', fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>{error}</div>
      )}
    </div>
  );
}

/** 초 단위 슬라이더. 긴 음원에서도 초 단위로 맞출 수 있게 0.1초 간격. */
function Slider({
  label, value, max, onChange,
}: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', minWidth: 26 }}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={Math.max(0.5, max)}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--accent)' }}
        aria-label={`${label} 위치`}
      />
      <span
        className="time"
        style={{ minWidth: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {fmt(value)}
      </span>
    </div>
  );
}
