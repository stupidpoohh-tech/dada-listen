/* Login.tsx — 강사 로그인. 원본 app.jsx 의 Login 을 그대로 옮겼다.
 * 문구·레이아웃·에러 메시지 모두 원본과 같다. 학생은 이 화면을 보지 않는다 (D-005). */

import { useState } from 'react';
import { Ic } from './icons';
import { resetPassword, signIn, signUpTeacher } from '../lib/store';

/**
 * 인증 오류에서 사람이 읽을 만한 문자열을 최대한 끌어낸다.
 *
 * 제공자마다 모양이 다르다 — Error 일 수도, {message}, {error}, {code} 를 가진
 * 평범한 객체일 수도 있다. 모르는 모양이면 JSON 으로라도 남긴다.
 * 원인을 감추는 것보다 낫다.
 */
function rawDetail(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.error, o.error_description, o.code, o.status]
      .filter((v) => typeof v === 'string' || typeof v === 'number')
      .map(String);
    if (parts.length > 0) return [...new Set(parts)].join(' · ');
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/** 인증 제공자의 영어 에러 메시지를 원본 앱의 한국어 문구로 옮긴다. */
function authMessage(e: unknown, mode: 'signin' | 'signup'): string {
  const raw = rawDetail(e);
  const m = raw.toLowerCase();

  if (m.includes('invalid login credentials') || m.includes('invalid email or password'))
    return '이메일 또는 비밀번호가 올바르지 않아요';
  if (m.includes('already') || m.includes('exists') || m.includes('duplicate') || m.includes('taken'))
    return '이미 등록된 이메일이에요. 아래 "로그인으로 돌아가기" 로 로그인해 보세요';
  if (m.includes('password') && (m.includes('short') || m.includes('least') || m.includes('length')))
    return '비밀번호가 너무 짧아요. 더 길게 정해주세요';
  if (m.includes('email not confirmed') || m.includes('not verified') || m.includes('verify'))
    return '이메일 인증이 필요해요. 받은 메일함을 확인해 주세요';
  if (m.includes('invalid email')) return '이메일 형식이 올바르지 않아요';
  if (m.includes('missing') && m.includes('password')) return '비밀번호를 입력하세요';
  if (m.includes('rate limit') || m.includes('too many'))
    return '시도가 너무 많아요. 잠시 후 다시 시도하세요';
  if (m.includes('network') || m.includes('failed to fetch'))
    return '네트워크 오류예요. 연결을 확인하세요';
  if (m.includes('disabled') || m.includes('not enabled'))
    return '이 기능이 꺼져 있어요. Neon 콘솔의 Auth 설정을 확인해 주세요';

  // 모르는 오류. 원문을 함께 보여준다 — 감추면 아무도 못 고친다.
  const head = mode === 'signup' ? '계정을 만들지 못했어요' : '로그인에 실패했어요';
  return raw ? `${head} — ${raw.slice(0, 200)}` : head;
}

type Props = {
  onView: () => void;
  toast: (message: string) => void;
};

export default function Login({ onView, toast }: Props) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  // 첫 설정에서만 쓰는 모드. 콘솔에서 만든 계정에는 비밀번호가 없어서
  // 이 경로로 한 번 만들어야 로그인할 수 있다.
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!email || !pw) {
      setErr('이메일과 비밀번호를 입력하세요');
      return;
    }
    if (creating && pw.length < 8) {
      setErr('비밀번호는 8자 이상으로 정해주세요');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      if (creating) {
        const created = await signUpTeacher(
          email.trim(),
          pw,
          name.trim() || email.split('@')[0] || '강사',
        );
        // 이메일 확인이 켜져 있으면 가입은 되지만 세션이 없다. 그대로 두면
        // 아무 일도 일어나지 않은 것처럼 보이므로, 바로 로그인을 시도해 본다.
        if (!created.signedIn) {
          try {
            await signIn(email.trim(), pw);
          } catch {
            setErr('계정은 만들어졌어요. 받은 메일함에서 인증을 마친 뒤 로그인해 주세요');
            return;
          }
        }
        toast('계정을 만들었어요');
      } else {
        await signIn(email.trim(), pw);
      }
    } catch (e) {
      console.error('[auth]', e); // 원본 오류는 콘솔에도 남긴다
      setErr(authMessage(e, creating ? 'signup' : 'signin'));
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
      console.error('[auth]', e);
      setErr(authMessage(e, 'signin'));
    }
  };

  return (
    <div className="lock">
      <div className="box">
        <div className="mark"><Ic.lock /></div>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>
          {creating ? '관리자 계정 만들기' : '관리자 로그인'}
        </h2>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 18px' }}>
          {creating
            ? '처음 한 번만 하면 됩니다. 이 계정으로 듣기 자료를 관리합니다.'
            : '듣기 자료를 관리하려면 로그인하세요.'}
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
          placeholder={creating ? '비밀번호 (8자 이상)' : '비밀번호'}
          value={pw}
          autoComplete={creating ? 'new-password' : 'current-password'}
          onChange={(e) => { setPw(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
        />
        {creating && (
          <input
            className="input"
            type="text"
            placeholder="이름 (선택)"
            value={name}
            autoComplete="name"
            style={{ marginTop: 10 }}
            onChange={(e) => { setName(e.target.value); setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          />
        )}
        {err && (
          <div
            style={{
              color: '#c8392b',
              fontSize: 12.5,
              marginTop: 8,
              textAlign: 'left',
              lineHeight: 1.55,
              wordBreak: 'break-word',
            }}
          >
            {err}
          </div>
        )}
        <button
          className="btn primary"
          style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? '확인 중…' : creating ? '계정 만들고 시작하기' : '로그인'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <button className="btn ghost sm" style={{ paddingLeft: 6 }} onClick={onView}>
            <Ic.eye /> 학생 보기
          </button>
          {!creating && (
            <button
              className="btn ghost sm"
              style={{ color: 'var(--ink-3)', paddingRight: 6 }}
              onClick={() => void reset()}
            >
              비밀번호 재설정
            </button>
          )}
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
          <button
            className="btn ghost sm"
            style={{ color: 'var(--ink-3)', fontSize: 12 }}
            onClick={() => { setCreating((c) => !c); setErr(''); }}
          >
            {creating ? '← 로그인으로 돌아가기' : '처음이신가요? 관리자 계정 만들기'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 10, lineHeight: 1.5 }}>
          로그인 상태는 이 브라우저에 자동으로 유지됩니다.
        </div>
      </div>
    </div>
  );
}
