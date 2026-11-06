/* sourceText.ts — 교사용 대본(PDF/TXT)에서 선택 가능한 영어 텍스트 추출.
 * PDF는 외부 서버로 보내지 않고 브라우저의 PDF.js로만 읽는다.
 * 여러 단으로 조판된 모의고사 해설 PDF는 단(column)별로 읽어야
 * 1번·4번·7번 대본이 한 줄에 섞이지 않는다.
 */
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export const SCRIPT_ACCEPT = '.pdf,.txt,.md,text/plain,application/pdf';
type Piece = { x: number; y: number; value: string };

function orderPage(items: Piece[], width: number): string {
  const populated = (n: number) => Array.from({ length: n }, (_, col) =>
    items.filter(x => x.x >= col * width / n && x.x < (col + 1) * width / n).length
  );
  const thirds = populated(3);
  const halves = populated(2);
  const cols = thirds.every(n => n >= 12) ? 3 :
    halves.every(n => n >= 15) ? 2 : 1;
  const ordered: string[] = [];

  for (let col = 0; col < cols; col++) {
    const slice = items.filter(x => {
      const index = Math.min(cols - 1, Math.floor(x.x / (width / cols)));
      return index === col;
    }).sort((a, b) => b.y - a.y || a.x - b.x);
    let line: Piece[] = [];
    let prevY = Infinity;
    const flush = () => {
      const text = line.sort((a, b) => a.x - b.x)
        .map(p => p.value).join(' ').replace(/\s+/g, ' ').trim();
      if (text) ordered.push(text);
      line = [];
    };
    for (const piece of slice) {
      if (line.length && Math.abs(piece.y - prevY) > 3) flush();
      line.push(piece);
      prevY = piece.y;
    }
    flush();
  }
  return ordered.join('\n');
}

export async function readTranscriptFile(file: File): Promise<string> {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('대본 파일은 25MB 이하로 올려 주세요.');
  }
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 30) throw new Error('PDF는 30페이지 이하만 지원합니다.');
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pieces: Piece[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim() || !('transform' in item)) continue;
          pieces.push({ x: item.transform[4], y: item.transform[5], value: item.str });
        }
        const width = page.view[2] - page.view[0];
        pages.push(orderPage(pieces, width));
        page.cleanup();
      }
      const text = pages.join('\n');
      if (text.trim().length < 80) {
        throw new Error('PDF에서 글자를 읽지 못했습니다. 스캔본이라면 대본을 직접 붙여넣어 주세요.');
      }
      return text;
    } catch (err) {
      if (err instanceof Error && /PDF는|읽지 못했습니다/.test(err.message)) throw err;
      throw new Error('PDF를 읽지 못했습니다. 텍스트가 선택되는 PDF인지 확인해 주세요.');
    } finally {
      await task.destroy();
    }
  }
  if (!/\.(txt|md)$/i.test(file.name) && !file.type.startsWith('text/')) {
    throw new Error('대본은 PDF 또는 TXT 파일만 지원합니다.');
  }
  const text = await file.text();
  if (!text.trim()) throw new Error('대본 파일에 텍스트가 없습니다.');
  return text.replace(/^\uFEFF/, '');
}
