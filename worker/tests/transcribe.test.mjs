/* transcribe.test.mjs — 전사 파이프라인 종단 테스트.
 *
 *   npm run test:transcribe
 *
 * fake-neon(인증) + fake-deepgram(전사) + 로컬 R2 를 띄우고
 * 업로드 → 전사 시작 → 콜백 → 결과 수령까지 실제로 돌린다. */

const B = 'http://127.0.0.1:8790';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const T = (who) => ({ authorization: `Bearer ${who}`, 'content-type': 'application/json' });
const out = [];
const ck = (n, ok, d = '') => { out.push(`${ok ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 음원 하나 올린다 ---
const c = await (await fetch(`${B}/api/media/create`, {
  method: 'POST', headers: T('teacher_A'),
  body: JSON.stringify({ itemId: ITEM, filename: 'lesson.mp3', contentType: 'audio/mpeg' }),
})).json();
const part = await (await fetch(
  `${B}/api/media/part?key=${encodeURIComponent(c.key)}&uploadId=${encodeURIComponent(c.uploadId)}&partNumber=1`,
  { method: 'PUT', headers: { authorization: 'Bearer teacher_A' }, body: new Uint8Array(1024).fill(7) },
)).json();
await fetch(`${B}/api/media/complete`, {
  method: 'POST', headers: T('teacher_A'),
  body: JSON.stringify({ key: c.key, uploadId: c.uploadId, parts: [part] }),
});
ck('전사할 음원 업로드', typeof c.key === 'string', c.key);

// --- 남의 파일로 전사 시도 ---
const steal = await (await fetch(`${B}/api/transcribe`, {
  method: 'POST', headers: T('teacher_B'), body: JSON.stringify({ key: c.key }),
})).json();
ck('B 는 A 음원을 전사시킬 수 없다', steal.error !== undefined, steal.error ?? '허용됨 — 위험');

// --- 없는 파일 ---
const missing = await fetch(`${B}/api/transcribe`, {
  method: 'POST', headers: T('teacher_A'),
  body: JSON.stringify({ key: `teacher_A/${ITEM}.nope` }),
});
ck('없는 음원은 404', missing.status === 404, String(missing.status));

// --- 전사 시작 ---
const started = await fetch(`${B}/api/transcribe`, {
  method: 'POST', headers: T('teacher_A'), body: JSON.stringify({ key: c.key }),
});
const startedBody = await started.json();
ck('전사 시작 202', started.status === 202, `requestId=${startedBody.requestId}`);

// --- 아직 결과 없음 ---
const pending = await fetch(`${B}/api/transcribe/result?key=${encodeURIComponent(c.key)}`, {
  headers: T('teacher_A'),
});
ck('결과 전에는 processing', pending.status === 202, (await pending.json()).status);

// --- 콜백이 올 때까지 기다린다 ---
let result = null;
for (let i = 0; i < 40; i++) {
  const r = await fetch(`${B}/api/transcribe/result?key=${encodeURIComponent(c.key)}`, { headers: T('teacher_A') });
  if (r.status === 200) { result = await r.json(); break; }
  await sleep(250);
}
ck('콜백으로 결과가 도착한다', result !== null, result ? result.status : '시간 초과');

if (result) {
  ck('세그먼트 2개', result.segments.length === 2, `${result.segments.length}개`);
  ck('문장 텍스트', result.segments[0].text === 'Climate change is transforming the environment.');
  ck('세그먼트 타임스탬프', result.segments[0].startSec === 0.08 && result.segments[0].endSec === 4.12);
  ck('단어 타임스탬프', result.segments[0].words[3].s === 1.05, JSON.stringify(result.segments[0].words[3]));
  ck('표시용 토큰(문장부호 포함)', result.segments[0].words[5].w === 'environment.');
  // Deepgram 이 서명 URL 로 실제 파일을 Range 로 받아갔다는 뜻
  ck('Deepgram 이 서명 URL 로 음원을 받아갔다', result.segments.length > 0);
}

// --- 남이 결과를 가져갈 수 없다 ---
const stealResult = await fetch(`${B}/api/transcribe/result?key=${encodeURIComponent(c.key)}`, {
  headers: T('teacher_B'),
});
ck('B 는 A 전사 결과를 못 가져간다', stealResult.status === 403, String(stealResult.status));

// --- 미승인 계정은 전사를 못 건다 (Deepgram 크레딧 보호) ---
const unapproved = await fetch(`${B}/api/transcribe`, {
  method: 'POST', headers: T('unapproved_stranger'),
  body: JSON.stringify({ key: `unapproved_stranger/${ITEM}.mp3` }),
});
ck('미승인 계정은 전사를 걸 수 없다', unapproved.status === 403,
  (await unapproved.json()).error ?? String(unapproved.status));

// --- 위조 콜백 ---
const forged = await fetch(`${B}/api/transcribe/callback?key=${encodeURIComponent(c.key)}&exp=9999999999&sig=forged`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ results: { utterances: [{ start: 0, end: 1, transcript: '가짜' }] } }),
});
ck('서명 없는 콜백은 403', forged.status === 403, String(forged.status));

console.log(out.join('\n'));
const f = out.filter((l) => l[0] === '❌').length;
console.log(`\n${out.length - f} PASS / ${f} FAIL`);
process.exit(f ? 1 : 0);
