/* fake-neon.mjs — 테스트용 Neon Data API 스텁.
 *
 * Worker 는 /rpc/whoami 로 토큰의 주인을 확인한다 (worker/auth.ts).
 * 테스트에서는 실제 Neon 대신 이걸 띄우고, 토큰 문자열을 그대로 사용자 id 로 쓴다.
 * 실제 배포에는 쓰이지 않는다. */
import { createServer } from 'node:http';
createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc/whoami') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token || token === 'bad') { res.writeHead(401).end('{}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    // whoami() 는 {id, approved} 를 돌려준다.
    // 토큰이 'unapproved' 로 시작하면 미승인 계정을 흉내낸다.
    res.end(JSON.stringify({ id: token, approved: !token.startsWith('unapproved') }));
    return;
  }
  res.writeHead(404).end('{}');
}).listen(8999, '127.0.0.1', () => console.log('fake neon on 8999'));
