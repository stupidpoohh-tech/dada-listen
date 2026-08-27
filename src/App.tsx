/* App.tsx — 앱 셸. 원본 app.jsx 의 구조(사이드바 + 목록 + 인증 게이트)를 따른다.
 *
 * 3단계 범위: 인증 게이트와 목록 읽기까지. 업로드·플레이어·갭필 화면은
 * 4~7단계에서 붙는다. 화면은 원본의 토큰과 클래스로만 조립한다 (CLAUDE.md). */

import { useCallback, useEffect, useRef, useState } from 'react';
import Login from './components/Login';
import { Ic, fmt } from './components/icons';
import { ensureTeacher, listFolders, listItems, onAuthChange, signOut } from './lib/store';
import type { AuthUser, Folder, Item } from './lib/types';

/** 상태 배지 문구. ASR 파이프라인이 붙으면 실제로 움직인다 (D-002). */
const STATUS_LABEL: Record<Item['status'], string> = {
  pending: '전사 대기 중',
  processing: '전사 중…',
  ready: '',
  failed: '전사 실패',
};

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mode, setMode] = useState(() =>
    location.hash.startsWith('#/admin') ? 'admin' : 'view',
  );

  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [sel, setSel] = useState<string>('all');
  const [selTag, setSelTag] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const [toastMsg, setToastMsg] = useState('');
  const toastT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(''), 2400);
  }, []);
  useEffect(() => () => clearTimeout(toastT.current), []);

  useEffect(() => {
    const onHash = () => setMode(location.hash.startsWith('#/admin') ? 'admin' : 'view');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(
    () =>
      onAuthChange((u) => {
        setUser(u);
        setAuthReady(true);
      }),
    [],
  );

  // 콘텐츠는 RLS 로 강사 본인 것만 내려온다. 로그인 전에는 부르지 않는다.
  useEffect(() => {
    if (!user) {
      setFolders([]);
      setItems([]);
      setLoaded(true);
      return;
    }
    let alive = true;
    setLoaded(false);
    void (async () => {
      try {
        // 강사 프로필을 먼저 만든다. teachers 행이 없으면 owner_id 는 채워져도
        // 승인 여부(teachers.approved)를 볼 데가 없어서 업로드가 막힌다.
        // upsert 라 두 번째 로그인부터는 아무 일도 하지 않는다.
        await ensureTeacher(user.email?.split('@')[0] ?? '강사');

        const [f, i] = await Promise.all([listFolders(), listItems()]);
        if (!alive) return;
        setFolders(f);
        setItems(i);
        setLoadError('');
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : '자료를 불러오지 못했어요');
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  if (!authReady || !loaded) {
    return (
      <div className="lock">
        <div style={{ color: 'var(--ink-3)' }}>불러오는 중…</div>
      </div>
    );
  }

  if (mode === 'admin' && !user) {
    return <Login onView={() => { location.hash = '#/view'; }} toast={toast} />;
  }

  const isAdmin = mode === 'admin' && !!user;
  const folderOf = (id: string | null) => folders.find((f) => f.id === id);
  const allTags = [...new Set(items.flatMap((i) => i.tags))].sort();

  let visible = items;
  if (sel !== 'all') visible = visible.filter((i) => i.folderId === sel);
  if (selTag) visible = visible.filter((i) => i.tags.includes(selTag));

  const curFolder = sel === 'all' ? null : folderOf(sel);
  const heading = sel === 'all' ? '전체 음성' : (curFolder?.name ?? '');

  const copyShare = () => {
    const url = location.origin + location.pathname + '#/view';
    navigator.clipboard
      .writeText(url)
      .then(() => toast('학생용 보기 링크를 복사했어요'))
      .catch(() => toast(url));
  };

  return (
    <div className="app">
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <aside className={'sidebar' + (navOpen ? ' open' : '')}>
        <div className="brand">
          <div className="mark"><Ic.wave s={18} /></div>
          <div>
            <div className="name">듣기 연습실</div>
            <div className="sub">Listening Lab</div>
          </div>
          <button className="drawer-close icon-btn" onClick={() => setNavOpen(false)} aria-label="닫기">
            <Ic.x />
          </button>
        </div>

        <button
          className={'nav-item' + (sel === 'all' && !selTag ? ' active' : '')}
          onClick={() => { setSel('all'); setSelTag(null); setNavOpen(false); }}
        >
          <Ic.layers /> 전체 음성 <span className="count">{items.length}</span>
        </button>

        <div className="side-section">폴더</div>
        {folders.map((f) => (
          <button
            key={f.id}
            className={'nav-item' + (sel === f.id ? ' active' : '')}
            onClick={() => { setSel(f.id); setSelTag(null); setNavOpen(false); }}
          >
            <span className="dot" style={{ background: f.color }} />
            {f.name}
            <span className="count">{items.filter((i) => i.folderId === f.id).length}</span>
          </button>
        ))}

        {allTags.length > 0 && (
          <>
            <div className="side-section">태그</div>
            <div className="tagrow">
              {allTags.map((t) => (
                <button
                  key={t}
                  className={'tag-chip' + (selTag === t ? ' active' : '')}
                  onClick={() => { setSelTag(selTag === t ? null : t); setNavOpen(false); }}
                >
                  #{t}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="sidebar-foot">
          {isAdmin ? (
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', padding: '4px 8px', lineHeight: 1.5 }}>
              <span className="mode-pill admin"><Ic.lock s={13} /> 관리자</span>
              <div style={{ marginTop: 8, wordBreak: 'break-all' }}>{user?.email}</div>
              <button
                className="btn ghost sm"
                style={{ marginTop: 8, paddingLeft: 8 }}
                onClick={() => void signOut()}
              >
                로그아웃
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', padding: '4px 8px', lineHeight: 1.5 }}>
              <span className="mode-pill view"><Ic.eye s={13} /> 보기 전용</span>
              <div style={{ marginTop: 8 }}>학생용 화면입니다</div>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <button className="menu-btn icon-btn" onClick={() => setNavOpen(true)} aria-label="메뉴">
            <Ic.menu />
          </button>
          <h1>{heading}</h1>
          {selTag && <span className="crumb">#{selTag}</span>}
          <div className="spacer" />
          {isAdmin ? (
            <>
              <button className="btn ghost sm" onClick={() => { location.hash = '#/view'; }}>
                <Ic.eye /> <span className="lbl">학생 보기</span>
              </button>
              <button className="btn sm" onClick={copyShare}>
                <Ic.link /> <span className="lbl">공유 링크</span>
              </button>
            </>
          ) : (
            <>
              <span className="mode-pill view"><Ic.eye s={13} /> 보기 전용</span>
              <button className="btn ghost sm" onClick={() => { location.hash = '#/admin'; }}>
                <Ic.lock s={15} /> <span className="lbl">관리자</span>
              </button>
            </>
          )}
        </div>

        <div className="content">
          {loadError && (
            <div style={{ color: '#c8392b', fontSize: 13, marginBottom: 14 }}>{loadError}</div>
          )}
          {visible.length === 0 ? (
            <div className="empty">
              <div className="big"><Ic.wave s={26} /></div>
              <h3>{items.length === 0 ? '아직 음성이 없어요' : '여기에는 음성이 없어요'}</h3>
              <p>
                {isAdmin
                  ? '영상이나 음성을 올려 첫 듣기 자료를 만들어 보세요.'
                  : '곧 자료가 추가될 예정이에요.'}
              </p>
            </div>
          ) : (
            <div>
              <div className="list-head">
                <span className="h">{heading}</span>
                <span className="c">{visible.length}개</span>
              </div>
              {visible.map((it) => {
                const folder = folderOf(it.folderId);
                const status = STATUS_LABEL[it.status];
                return (
                  <div className="card" key={it.id}>
                    <div className="card-head">
                      <button className="play-btn" aria-label="재생"><Ic.play s={22} /></button>
                      <div className="card-meta">
                        <div className="card-title">{it.title}</div>
                        <div className="card-sub">
                          {folder && (
                            <span className="pill" style={{ color: folder.color }}>{folder.name}</span>
                          )}
                          <span>{fmt(it.durationSec ?? 0)}</span>
                          {status && <span className="pill">{status}</span>}
                          {it.tags.slice(0, 3).map((t) => (
                            <span key={t} className="tg">#{t}</span>
                          ))}
                        </div>
                      </div>
                      <button
                        className="icon-btn"
                        style={{ border: 'none', boxShadow: 'none', background: 'transparent' }}
                        aria-label="펼치기"
                      >
                        <span className="chev"><Ic.chev /></span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
