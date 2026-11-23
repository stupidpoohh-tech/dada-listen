import { describe, expect, it } from 'vitest';
import { detectLongSilences, passagesFromSilence, parseClipCsv } from './audioSilence';
describe('실제 음원 기반 구간 보정', () => {
  const gaps = [
    [54.9,64.3],[120.4,129.8],[207.7,217.1],[290.4,299.8],
    [379.5,389.0],[474.4,483.9],[547.6,557.1],[636.1,645.6],
    [729.2,738.7],[826.4,835.9],[862.9,872.4],[906,915.5],
    [984.3,993.8],[1075.6,1085.1],[1151.4,1160.8],[1324.2,1333.6],
    [1342.6,1351.9],
  ].map(([startSec,endSec])=>({startSec:startSec!,endSec:endSec!}));
  it('11·12번의 실제 시작 시각을 복원한다', () => {
    const result=passagesFromSilence(gaps,1428.468);
    expect(result).toHaveLength(17);
    expect(result[10]!.startSec).toBeCloseTo(835.7,1);
    expect(result[10]!.endSec).toBeCloseTo(863.55,1);
    expect(result[11]!.startSec).toBeCloseTo(872.2,1);
    expect(result[11]!.endSec).toBeCloseTo(906.65,1);
  });
  it('공동 지문은 22:04 이후 끝내고 안내 방송은 제외한다',()=>{
    const result=passagesFromSilence(gaps,1428.468);
    expect(result[15]!.endSec).toBeGreaterThan(1324.5);
    expect(result[15]!.endSec).toBeLessThan(1333);
    expect(result[16]!.startSec).toBe(result[15]!.startSec);
    expect(result[16]!.endSec).toBe(result[15]!.endSec);
  });
  it('무음이 부족하면 잘못 추정하지 않는다',()=>{
    expect(()=>passagesFromSilence(gaps.slice(0,10),1428)).toThrow('무음');
  });
  it('마지막의 75초 공백은 무시한다',()=>{
    expect(passagesFromSilence([...gaps,{startSec:1353,endSec:1428}],1428.4)).toHaveLength(17);
  });
  it('발화 중 2초 휴지는 분리하지 않는다',()=>{
    const peaks=Array.from({length:80},(_,i)=>i>=10&&i<33?0:.2);
    expect(detectLongSilences(peaks,.1)).toHaveLength(0);
    for(let i=10;i<53;i++)peaks[i]=0;
    const found=detectLongSilences(peaks,.1);
    expect(found).toHaveLength(1);
    expect(found[0]!.startSec).toBeCloseTo(1,4);
    expect(found[0]!.endSec).toBeCloseTo(5.3,4);
  });
  it('구간표의 중복과 누락을 거부한다',()=>{
    const csv=['번호,시작,끝',...Array.from({length:17},(_,i)=>(i+1)+','+(i*80)+','+(i*80+60))].join('\n');
    expect(parseClipCsv(csv)).toHaveLength(17);
    expect(()=>parseClipCsv(csv+'\n17,100,200')).toThrow('중복');
    expect(()=>parseClipCsv('1,0,55\n2,60,100')).toThrow('모두');
  });
});
