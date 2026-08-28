/* ItemCard.tsx — 목록의 아이템 한 줄과, 펼쳤을 때의 플레이어·지문.
 *
 * 디자인은 원본 app.jsx 의 Card 를 그대로 옮겼다 (.player / .scrub / .track /
 * .player-tools / .passage-wrap). 바뀐 것은 동작이다:
 *
 *   - 손으로 A·B 를 맞추던 구간반복 → **문장을 눌러 그 문장만 반복** (D-003).
 *     세그먼트마다 타임스탬프가 있으니 사람이 지점을 찾을 이유가 없다.
 *   - 지문은 타이핑이 아니라 ASR 이 만든 세그먼트에서 온다 (D-002).
 *   - 빈칸은 토큰 인덱스가 아니라 단어와 함께 다룬다 (D-004, gapfill.ts).
 *
 * 미디어는 서명 URL 을 그대로 src 에 넣어 **Range 로 스트리밍**한다.
 * 전체를 받아 Blob URL 을 만들지 않는다 (원본의 실수이자 메모리 누수 원인, D-010). */

import { useEffect, useRef, useState } from 'react';
import { Ic, fmt } from './icons';
import { getMediaUrl, listSegments } from '../lib/store';
import { LEVELS, normalize, selectGaps, tokenize } from '../lib/gapfill';
import type { GapRef, Level } from '../lib/gapfill';
import type { Folder, Item, Segment } from '../lib/types';

const RATES = [
  { v: 0.75, label: '0.75x' },
  { v: 1, label: '1x' },
  { v: 1.25, label: '1.25x' },
  { v: 1.5, label: '1.5x' },
];

const LEVEL_LABEL: Record<Level, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };

/** 문장을 단어 배열로. ASR 단어가 있으면 그걸 쓰고, 없으면 표시 텍스트에서 뽑는다. */
function wordsOf(seg: Segment): string[] {
  if (seg.words.length > 0) return seg.words.map((w) => w.w);
  return tokenize(seg.text).filter((t) => t.t === 'w').map((t) => t.s);
}

type Props = {
  item: Item;
  folder: Folder | undefined;
  statusLabel: string;
};

export default function ItemCard({ item, folder, statusLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [loadError, setLoadError] = useState('');

  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(item.durationSec ?? 0);
  const [rate, setRate] = useState(1);

  /** 반복 중인 문장. null 이면 통째로 재생. */
  const [repeat, setRepeat] = useState<number | null>(null);

  /** 접힌 카드에서 ▶ 를 눌렀을 때. 소리가 준비되면 바로 재생한다. */
  const [autoplay, setAutoplay] = useState(false);

  const [version, setVersion] = useState<'gap' | 'full'>('gap');
  const [level, setLevel] = useState<Level>('normal');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const mediaRef = useRef<HTMLVideoElement | null>(null);

  // 펼칠 때 한 번만 불러온다. 접힌 카드까지 미리 받으면 목록이 무거워진다.
  useEffect(() => {
    if (!open || segments !== null) return;
    let alive = true;
    void (async () => {
      try {
        const [segs, u] = await Promise.all([
          listSegments(item.id),
          getMediaUrl(item.mediaKey),
        ]);
        if (!alive) return;
        setSegments(segs);
        setUrl(u);
      } catch (e) {
        if (!alive) return;
        setSegments([]);
        setLoadError(e instanceof Error ? e.message : '불러오지 못했어요');
      }
    })();
    return () => { alive = false; };
  }, [open, segments, item.id, item.mediaKey]);

  // 재생 속도는 엘리먼트 속성이라 상태만 바꿔서는 안 먹는다.
  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = rate;
  }, [rate, url]);

  const seg = segments && repeat !== null ? segments[repeat] : undefined;

  const toggle = () => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  /** 문장 하나를 반복 재생한다. 같은 문장을 다시 누르면 해제. */
  const playSegment = (idx: number) => {
    const el = mediaRef.current;
    const s = segments?.[idx];
    if (!el || !s) return;
    if (repeat === idx) {
      setRepeat(null);
      return;
    }
    setRepeat(idx);
    el.currentTime = s.startSec;
    void el.play();
  };

  const onTime = () => {
    const el = mediaRef.current;
    if (!el) return;
    // 반복 중이면 문장 끝에서 처음으로 되돌린다.
    if (seg && el.currentTime >= seg.endSec) {
      el.currentTime = seg.startSec;
    }
    setCur(el.currentTime);
  };

  const seekTo = (clientX: number, track: HTMLElement) => {
    const el = mediaRef.current;
    if (!el || !dur) return;
    const r = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    el.currentTime = ratio * dur;
    setCur(el.currentTime);
    setRepeat(null); // 손으로 옮겼으면 문장 반복은 푼다
  };

  const pct = (t: number) => (dur > 0 ? (t / dur) * 100 : 0);

  return (
    <div className={'card' + (open ? ' open' : '')}>
      <div className="card-head">
        <button
          className="play-btn"
          aria-label={playing ? '일시정지' : '재생'}
          onClick={() => {
            // 접혀 있으면 펼치면서 곧바로 재생까지 간다. 눌렀는데 펼쳐지기만
            // 하면 고장 난 것처럼 보인다.
            if (!open) { setOpen(true); setAutoplay(true); return; }
            toggle();
          }}
        >
          {playing ? <Ic.pause s={22} /> : <Ic.play s={22} />}
        </button>
        <div className="card-meta" onClick={() => setOpen((o) => !o)} style={{ cursor: 'pointer' }}>
          <div className="card-title">{item.title}</div>
          <div className="card-sub">
            {folder && <span className="pill" style={{ color: folder.color }}>{folder.name}</span>}
            <span>{fmt(item.durationSec ?? dur)}</span>
            {statusLabel && <span className="pill">{statusLabel}</span>}
            {item.tags.slice(0, 3).map((t) => (
              <span key={t} className="tg">#{t}</span>
            ))}
          </div>
        </div>
        <button
          className="icon-btn"
          style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
          aria-label={open ? '접기' : '펼치기'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="chev"><Ic.chev /></span>
        </button>
      </div>

      {open && (
        <div className="card-body">
          <div className="player">
            {/* mp4 도 올릴 수 있으므로 video 다. 화면에는 안 보이고 소리만 쓴다. */}
            <video
              ref={mediaRef}
              playsInline
              preload="metadata"
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
              src={url ?? undefined}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={onTime}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (Number.isFinite(el.duration)) setDur(el.duration);
                el.playbackRate = rate;
                if (autoplay) {
                  setAutoplay(false);
                  // 사용자가 방금 누른 흐름이라 브라우저가 막지 않는다. 그래도
                  // 정책은 브라우저마다 다르므로 거절돼도 조용히 넘어간다.
                  void el.play().catch(() => {});
                }
              }}
            />
            <div className="scrub">
              <span className="time">{fmt(cur)}</span>
              <div
                className="track"
                onClick={(e) => seekTo(e.clientX, e.currentTarget)}
                onMouseDown={(e) => {
                  const el = e.currentTarget;
                  const mv = (ev: MouseEvent) => seekTo(ev.clientX, el);
                  const up = () => {
                    document.removeEventListener('mousemove', mv);
                    document.removeEventListener('mouseup', up);
                  };
                  document.addEventListener('mousemove', mv);
                  document.addEventListener('mouseup', up);
                }}
              >
                {seg && dur > 0 && (
                  <div
                    className="ab"
                    style={{ left: pct(seg.startSec) + '%', width: pct(seg.endSec - seg.startSec) + '%' }}
                  />
                )}
                <div className="fill" style={{ width: pct(cur) + '%' }} />
                {seg && dur > 0 && <div className="marker" style={{ left: pct(seg.startSec) + '%' }} />}
                {seg && dur > 0 && <div className="marker" style={{ left: pct(seg.endSec) + '%' }} />}
                <div className="knob" style={{ left: pct(cur) + '%' }} />
              </div>
              <span className="time" style={{ textAlign: 'right' }}>{fmt(dur)}</span>
            </div>

            <div className="player-tools">
              <div className="seg">
                {RATES.map((r) => (
                  <button key={r.v} className={rate === r.v ? 'on' : ''} onClick={() => setRate(r.v)}>
                    {r.label}
                  </button>
                ))}
              </div>
              {repeat !== null && (
                <>
                  <button className="tool on">
                    <Ic.reset s={15} /> {repeat + 1}번째 문장 반복
                  </button>
                  <button className="btn ghost sm" onClick={() => setRepeat(null)}>해제</button>
                </>
              )}
            </div>
          </div>

          <div className="passage-wrap">
            <Passage
              segments={segments}
              loadError={loadError}
              status={item.status}
              version={version}
              level={level}
              repeat={repeat}
              revealed={revealed}
              onVersion={setVersion}
              onLevel={setLevel}
              onSentence={playSegment}
              onReveal={(k) => setRevealed((s) => new Set(s).add(k))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 지문
 * ------------------------------------------------------------------ */

type PassageProps = {
  segments: Segment[] | null;
  loadError: string;
  status: Item['status'];
  version: 'gap' | 'full';
  level: Level;
  repeat: number | null;
  revealed: Set<string>;
  onVersion: (v: 'gap' | 'full') => void;
  onLevel: (l: Level) => void;
  onSentence: (idx: number) => void;
  onReveal: (key: string) => void;
};

function Passage({
  segments, loadError, status, version, level, repeat, revealed,
  onVersion, onLevel, onSentence, onReveal,
}: PassageProps) {
  if (segments === null) {
    return <div style={{ padding: '18px 0', color: 'var(--ink-3)', fontSize: 13 }}>불러오는 중…</div>;
  }
  if (loadError) {
    return <div style={{ padding: '18px 0', color: '#c8392b', fontSize: 13 }}>{loadError}</div>;
  }
  if (segments.length === 0) {
    return (
      <div style={{ padding: '18px 0', color: 'var(--ink-3)', fontSize: 13 }}>
        {status === 'ready'
          ? '이 음원에서는 문장을 찾지 못했어요.'
          : '아직 전사가 끝나지 않았어요.'}
      </div>
    );
  }

  // 빈칸은 결정론적으로 뽑는다. 같은 입력이면 언제 열어도 같은 자리다.
  const segWords = segments.map(wordsOf);
  const gaps = version === 'gap' ? selectGaps(segWords, level) : [];
  const gapAt = new Map<string, GapRef>();
  for (const g of gaps) gapAt.set(`${g.segIdx}:${g.wordIdx}`, g);

  return (
    <>
      <div className="passage-bar">
        <div className="seg">
          <button className={version === 'gap' ? 'on' : ''} onClick={() => onVersion('gap')}>갭필</button>
          <button className={version === 'full' ? 'on' : ''} onClick={() => onVersion('full')}>풀 버전</button>
        </div>
        {version === 'gap' && (
          <div className="seg">
            {LEVELS.map((l) => (
              <button key={l} className={level === l ? 'on' : ''} onClick={() => onLevel(l)}>
                {LEVEL_LABEL[l]}
              </button>
            ))}
          </div>
        )}
        <span className="label">
          {version === 'gap' ? `빈칸 ${gaps.length}개 · 눌러서 확인` : '문장을 누르면 그 문장만 반복'}
        </span>
      </div>

      <div className="passage">
        {segments.map((s, si) => (
          <Sentence
            key={s.id}
            seg={s}
            segIdx={si}
            words={segWords[si] ?? []}
            gapAt={gapAt}
            active={repeat === si}
            revealed={revealed}
            onClick={() => onSentence(si)}
            onReveal={onReveal}
          />
        ))}
      </div>
    </>
  );
}

type SentenceProps = {
  seg: Segment;
  segIdx: number;
  words: string[];
  gapAt: Map<string, GapRef>;
  active: boolean;
  revealed: Set<string>;
  onClick: () => void;
  onReveal: (key: string) => void;
};

function Sentence({ seg, segIdx, words, gapAt, active, revealed, onClick, onReveal }: SentenceProps) {
  // 표시는 문장부호가 붙은 text 로, 빈칸 대조는 단어 순번으로 한다.
  const tokens = tokenize(seg.text);
  let wi = -1;

  return (
    <span
      onClick={onClick}
      title={`${fmt(seg.startSec)} — 눌러서 이 문장만 반복`}
      style={{
        display: 'block',
        cursor: 'pointer',
        borderRadius: 6,
        padding: '2px 6px',
        margin: '0 -6px',
        background: active ? 'var(--accent-tint)' : undefined,
      }}
    >
      {tokens.map((t, ti) => {
        if (t.t !== 'w') return <span key={ti}>{t.s}</span>;
        wi += 1;
        const key = `${segIdx}:${wi}`;
        const gap = gapAt.get(key);
        // 빈칸은 ASR 단어 순번으로 고르고, 화면에는 문장부호가 붙은 토큰을 그린다.
        // 둘이 어긋나면(전사를 고친 뒤 등) 엉뚱한 단어가 빈칸이 되므로 그때는
        // 빈칸을 만들지 않는다 — 인덱스만 믿다 조용히 밀렸던 원본의 버그다 (D-004).
        const asr = words[wi];
        const aligned = asr !== undefined && normalize(asr) === normalize(t.s);
        if (!gap || !aligned) return <span key={ti} className="w">{t.s}</span>;
        const shown = revealed.has(key);
        return (
          <span
            key={ti}
            className={'blank' + (shown ? ' revealed' : '')}
            data-len={shown ? '' : '·'.repeat(Math.min(t.s.length, 9))}
            onClick={(e) => { e.stopPropagation(); onReveal(key); }}
          >
            {shown ? t.s : '\u00A0'.repeat(Math.max(4, t.s.length))}
          </span>
        );
      })}
    </span>
  );
}
