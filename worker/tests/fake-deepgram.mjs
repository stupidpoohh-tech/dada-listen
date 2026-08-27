/* fake-deepgram.mjs — 테스트용 Deepgram 스텁.
 *
 * 실제 Deepgram 처럼 동작한다: 요청을 받으면 202 로 request_id 를 주고,
 * 잠시 뒤 callback URL 로 전사 결과를 POST 한다.
 * 넘겨받은 미디어 URL 을 실제로 GET 해보므로, 서명 URL 이 유효한지도 함께 확인된다. */
import { createServer } from 'node:http';

const SAMPLE = {
  results: {
    utterances: [
      { start: 0.08, end: 4.12, transcript: 'Climate change is transforming the environment.',
        words: [
          { word: 'climate', punctuated_word: 'Climate', start: 0.08, end: 0.5 },
          { word: 'change', punctuated_word: 'change', start: 0.5, end: 0.9 },
          { word: 'is', punctuated_word: 'is', start: 0.9, end: 1.05 },
          { word: 'transforming', punctuated_word: 'transforming', start: 1.05, end: 1.9 },
          { word: 'the', punctuated_word: 'the', start: 1.9, end: 2.0 },
          { word: 'environment', punctuated_word: 'environment.', start: 2.0, end: 4.12 },
        ] },
      { start: 4.5, end: 7.0, transcript: 'Rising temperatures affect agriculture.',
        words: [
          { word: 'rising', punctuated_word: 'Rising', start: 4.5, end: 4.9 },
          { word: 'temperatures', punctuated_word: 'temperatures', start: 4.9, end: 5.8 },
          { word: 'affect', punctuated_word: 'affect', start: 5.8, end: 6.2 },
          { word: 'agriculture', punctuated_word: 'agriculture.', start: 6.2, end: 7.0 },
        ] },
    ],
  },
};

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const url = new URL(req.url, 'http://x');
    const callback = url.searchParams.get('callback');
    const auth = req.headers.authorization || '';

    if (!auth.startsWith('Token ')) { res.writeHead(401).end('{}'); return; }
    if (!callback) { res.writeHead(400).end('{"err":"no callback"}'); return; }

    let mediaUrl = '';
    try { mediaUrl = JSON.parse(body).url; } catch {}

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ request_id: 'fake-req-1' }));

    // 서명 URL 이 실제로 열리는지 확인한 뒤 콜백을 보낸다.
    setTimeout(async () => {
      let ok = false;
      try { ok = (await fetch(mediaUrl, { headers: { range: 'bytes=0-9' } })).status === 206; } catch {}
      await fetch(callback, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ok ? SAMPLE : { results: {} }),
      }).catch(() => {});
    }, 250);
  });
}).listen(8998, '127.0.0.1', () => console.log('fake deepgram on 8998'));
