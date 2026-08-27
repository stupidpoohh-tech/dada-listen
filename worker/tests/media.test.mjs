/* media.test.mjs — 미디어 엔드포인트 종단 테스트.
 *
 *   npm run test:media
 *
 * fake-neon 스텁 + wrangler dev(로컬 R2)를 띄우고 업로드·Range 스트리밍·
 * 서명 검증·테넌트 격리를 실제로 확인한다. 전부 PASS 여야 한다. */
const B = 'http://127.0.0.1:8790';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const T = (who) => ({ authorization: `Bearer ${who}`, 'content-type': 'application/json' });
const out = [];
const check = (name, ok, detail='') => { out.push(`${ok?'✅':'❌'} ${name}${detail?' — '+detail:''}`); return ok; };

// 12MB 파일: 20MB 파트 하나 → 단일 파트 경로
// 45MB 파일: 파트 3개 → 멀티파트 경로
async function upload(who, sizeBytes, filename) {
  const c = await (await fetch(`${B}/api/media/create`, {
    method:'POST', headers:T(who),
    body: JSON.stringify({ itemId: ITEM, filename, contentType:'audio/mpeg' })
  })).json();
  if (c.error) throw new Error(c.error);

  const PART = 20*1024*1024;
  const total = Math.ceil(sizeBytes/PART);
  const parts = [];
  for (let i=0;i<total;i++){
    const len = Math.min(PART, sizeBytes - i*PART);
    // 파트마다 다른 바이트 패턴을 넣어 나중에 Range 로 확인한다
    const buf = new Uint8Array(len).fill((i+1) & 0xff);
    const r = await fetch(`${B}/api/media/part?key=${encodeURIComponent(c.key)}&uploadId=${encodeURIComponent(c.uploadId)}&partNumber=${i+1}`, {
      method:'PUT', headers:{authorization:`Bearer ${who}`}, body: buf
    });
    const p = await r.json();
    if (p.error) throw new Error('part: '+p.error);
    parts.push(p);
  }
  const done = await (await fetch(`${B}/api/media/complete`, {
    method:'POST', headers:T(who), body: JSON.stringify({ key:c.key, uploadId:c.uploadId, parts })
  })).json();
  return { key:c.key, done };
}

// --- 단일 파트 ---
const small = await upload('teacher_A', 3*1024*1024, 'unit01.mp3');
check('작은 파일 업로드', small.done.size === 3*1024*1024, `size=${small.done.size}`);
check('키를 서버가 정한다 ({owner}/{item}.ext)', small.key === `teacher_A/${ITEM}.mp3`, small.key);

// --- 멀티파트 (45MB → 3파트) ---
const big = await upload('teacher_A', 45*1024*1024, 'unit02.mp4');
check('45MB 멀티파트 업로드 (3파트)', big.done.size === 45*1024*1024, `size=${big.done.size}`);

// --- 재생 URL ---
const play = await (await fetch(`${B}/api/media/play-url`, {
  method:'POST', headers:T('teacher_A'), body: JSON.stringify({ key: big.key })
})).json();
check('재생 URL 발급', typeof play.url === 'string' && play.url.includes('sig='), play.expiresIn+'초');

// --- 전체 GET ---
const full = await fetch(play.url);
check('전체 재생 200 + accept-ranges', full.status===200 && full.headers.get('accept-ranges')==='bytes',
  `len=${full.headers.get('content-length')}`);

// --- Range 요청 (핵심) ---
const r1 = await fetch(play.url, { headers: { range: 'bytes=0-99' } });
const b1 = new Uint8Array(await r1.arrayBuffer());
check('Range 206 Partial Content', r1.status===206, `content-range=${r1.headers.get('content-range')}`);
check('Range 로 요청한 만큼만 받는다', b1.length===100, `${b1.length} bytes`);
check('1번 파트 바이트 패턴 확인', b1[0]===1 && b1[99]===1, `first=${b1[0]}`);

// 2번 파트 구간(20MB 지점)을 찍어본다 → 전체를 안 받고 중간부터 스트리밍되는지
const off = 20*1024*1024;
const r2 = await fetch(play.url, { headers: { range: `bytes=${off}-${off+9}` } });
const b2 = new Uint8Array(await r2.arrayBuffer());
check('중간 구간(20MB 지점) Range', r2.status===206 && b2.length===10, `content-range=${r2.headers.get('content-range')}`);
check('2번 파트 바이트 패턴 확인', b2[0]===2, `value=${b2[0]}`);

// --- 서명 검증 ---
const tampered = play.url.replace(/sig=[^&]+/, 'sig=forged');
check('서명 위조는 403', (await fetch(tampered)).status===403);
const otherKey = play.url.replace(encodeURIComponent(big.key), encodeURIComponent('teacher_B/x.mp3'));
check('다른 키로 바꿔치기는 403', (await fetch(otherKey)).status===403);
const expired = play.url.replace(/exp=\d+/, 'exp=1000000000');
check('만료된 링크는 403', (await fetch(expired)).status===403);

// --- 테넌트 격리 ---
const steal = await (await fetch(`${B}/api/media/play-url`, {
  method:'POST', headers:T('teacher_B'), body: JSON.stringify({ key: big.key })
})).json();
check('B 는 A 파일의 재생 URL 을 못 받는다', steal.error !== undefined, steal.error ?? '받아짐 — 위험');

const stealPart = await (await fetch(`${B}/api/media/part?key=${encodeURIComponent(big.key)}&uploadId=zz&partNumber=1`, {
  method:'PUT', headers:{authorization:'Bearer teacher_B'}, body:new Uint8Array(10)
})).json();
check('B 는 A 경로에 파트를 못 올린다', stealPart.error !== undefined, stealPart.error ?? '올려짐 — 위험');

const stealDel = await (await fetch(`${B}/api/media/delete`, {
  method:'POST', headers:T('teacher_B'), body: JSON.stringify({ key: big.key })
})).json();
check('B 는 A 파일을 못 지운다', stealDel.error !== undefined, stealDel.error ?? '지워짐 — 위험');

// --- 미승인 계정은 돈 나가는 작업을 못 한다 (공개 가입 대비) ---
const unapprovedCreate = await (await fetch(`${B}/api/media/create`, {
  method:'POST', headers:T('unapproved_stranger'),
  body: JSON.stringify({ itemId: ITEM, filename:'x.mp3', contentType:'audio/mpeg' })
})).json();
check('미승인 계정은 업로드를 시작할 수 없다', unapprovedCreate.error !== undefined,
  unapprovedCreate.error ?? '허용됨 — 크레딧 위험');

// --- 실패는 사실대로 말해야 한다 ---
//
// 예전에는 Data API 가 뭐라고 답하든 전부 "로그인이 만료되었습니다" 였다.
// 그래서 whoami() 가 없어 나는 404 도 만료로 보였고, 사용자는 로그인만
// 반복하며 두 번을 헤맸다. 원인이 화면에 드러나는지 여기서 지킨다.
const noFunc = await (await fetch(`${B}/api/media/create`, {
  method:'POST', headers:T('nofunc'),
  body: JSON.stringify({ itemId: ITEM, filename:'x.mp3', contentType:'audio/mpeg' })
})).json();
check('whoami() 404 를 만료로 속이지 않는다',
  typeof noFunc.error === 'string'
  && !noFunc.error.includes('만료')
  && noFunc.error.includes('404'),
  noFunc.error);
check('404 응답에 Data API 가 말한 이유가 실린다',
  typeof noFunc.error === 'string' && noFunc.error.includes('schema cache'),
  noFunc.error);

const oldShape = await (await fetch(`${B}/api/media/create`, {
  method:'POST', headers:T('oldshape'),
  body: JSON.stringify({ itemId: ITEM, filename:'x.mp3', contentType:'audio/mpeg' })
})).json();
check('whoami() 가 옛 모양이면 그렇게 말한다',
  typeof oldShape.error === 'string'
  && !oldShape.error.includes('만료')
  && oldShape.error.includes('0003'),
  oldShape.error);

const noSchema = await (await fetch(`${B}/api/media/create`, {
  method:'POST', headers:T('noschema'),
  body: JSON.stringify({ itemId: ITEM, filename:'x.mp3', contentType:'audio/mpeg' })
})).json();
check('42501(permission denied for schema auth)을 만료로 속이지 않는다',
  typeof noSchema.error === 'string'
  && !noSchema.error.includes('만료')
  && noSchema.error.includes('42501'),
  noSchema.error);

const noSub = await (await fetch(`${B}/api/media/create`, {
  method:'POST', headers:T('nosub'),
  body: JSON.stringify({ itemId: ITEM, filename:'x.mp3', contentType:'audio/mpeg' })
})).json();
check('id 가 빈 응답은 인증 문제로 안내한다 (마이그레이션 탓으로 돌리지 않는다)',
  typeof noSub.error === 'string'
  && noSub.error.includes('로그인')
  && !noSub.error.includes('0003'),
  noSub.error);

const badToken = await (await fetch(`${B}/api/media/create`, {
  method:'POST', headers:T('bad'),
  body: JSON.stringify({ itemId: ITEM, filename:'x.mp3', contentType:'audio/mpeg' })
})).json();
check('진짜 401 만 만료로 안내한다',
  typeof badToken.error === 'string' && badToken.error.includes('만료'),
  badToken.error);

// --- 삭제 ---
const del = await (await fetch(`${B}/api/media/delete`, {
  method:'POST', headers:T('teacher_A'), body: JSON.stringify({ key: small.key })
})).json();
check('본인 파일 삭제', del.ok === true);

console.log(out.join('\n'));
const fails = out.filter(l=>l.startsWith('❌')).length;
console.log(`\n${out.length-fails} PASS / ${fails} FAIL`);
process.exit(fails ? 1 : 0);
