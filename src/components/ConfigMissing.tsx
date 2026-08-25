/* ConfigMissing.tsx — 환경변수가 없을 때. 흰 화면 대신 무엇을 해야 하는지 보여준다. */

import { Ic } from './icons';

export default function ConfigMissing() {
  return (
    <div className="lock">
      <div className="box" style={{ width: 420 }}>
        <div className="mark"><Ic.lock /></div>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>설정이 필요해요</h2>
        <p style={{ color: 'var(--ink-3)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.6 }}>
          Neon 접속 정보가 없습니다.
          <br />
          <code style={{ fontSize: 12 }}>.env.example</code> 을 복사해{' '}
          <code style={{ fontSize: 12 }}>.env.local</code> 을 만들고 아래 두 값을 채우세요.
        </p>
        <div
          style={{
            background: 'var(--bg-soft)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r)',
            padding: '12px 14px',
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'var(--ink-2)',
            textAlign: 'left',
            lineHeight: 1.9,
          }}
        >
          VITE_NEON_AUTH_URL
          <br />
          VITE_NEON_DATA_API_URL
        </div>
        <p style={{ color: 'var(--ink-4)', fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
          배포 환경에서는 호스팅 대시보드의 환경변수에 같은 값을 등록하세요.
        </p>
      </div>
    </div>
  );
}
