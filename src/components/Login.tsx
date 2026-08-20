/* Login.tsx — 강사 로그인. 원본 app.jsx 의 Login 을 그대로 옮겼다.
 * 문구·레이아웃·에러 메시지 모두 원본과 같다. 학생은 이 화면을 보지 않는다 (D-005). */

import { useState } from 'react';
import { Ic } from './icons';
import { resetPassword, signIn } from '../lib/store';

/** Supabase 의 에러 메시지를 원본 앱의 한국어 문구로 옮긴다. */
function authMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.toLowerCase();
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 올바르지 않아요';
  if (m.includes('email not confirmed')) return '이메일 인증이 완료되지 않았어요';
  if (m.includes('invalid email')) return '이메일 형식이 올바르지 않아요';
  if (m.includes('missing') && m.includes('password')) return '비밀번호를 입력하세요';
  if (m.includes('rate limit') || m.includes('too many')) return '시도가 너무 많아요. 잠시 후 다시 시도하세요';
  if (m.includes('network') || m.includes('fetch')) return '네트워크 오류예요. 연결을 확인하세요';
  return '로그인에 실패했어요';
}

type Props = {
  onView: () => void;
  toast: (message: string) => void;
};

export default function Login({ onView, toast }: Props) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!email || !pw) {
      setErr('이메일과 비밀번호를 입력하세요');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await signIn(email.trim(), pw);
    } catch (e) {
      setErr(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email) {
      setErr('재설정 메일을 받을 이메일을 먼저 입력하세요');
      return;
    }
    try {
      await resetPassword(email.trim());
      toast('비밀번호 재설정 메일을 보냈어요');
    } catch (e) {
      setErr(authMessage(e));
    }
  };

  return (
    <div className="lock">
      <div className="box">
        <div className="mark"><Ic.lock /></div>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>관리자 로그인</h2>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 18px' }}>
          듣기 자료를 관리하려면 로그인하세요.
        </p>
        <input
          className="input"
          type="email"
          placeholder="이메일"
          value={email}
          autoFocus
          autoComplete="username"
          style={{ marginBottom: 10 }}
          onChange={(e) => { setEmail(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        <input
          className="input"
          type="password"
          placeholder="비밀번호"
          value={pw}
          autoComplete="current-password"
          onChange={(e) => { setPw(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        {err && (
          <div style={{ color: '#c8392b', fontSize: 12.5, marginTop: 8, textAlign: 'left' }}>{err}</div>
        )}
        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? '확인 중…' : '로그인'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <button className="btn ghost sm" style={{ paddingLeft: 6 }} onClick={onView}>
            <Ic.eye /> 학생 보기
          </button>
          <button
            className="btn ghost sm"
            style={{ color: 'var(--ink-3)', paddingRight: 6 }}
            onClick={() => void reset()}
          >
            비밀번호 재설정
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 14, lineHeight: 1.5 }}>
          로그인 상태는 이 브라우저에 자동으로 유지됩니다.
        </div>
      </div>
    </div>
  );
}
