/* ClipRepairModal — 이미 등록된 듣기 문항의 오디오 구간을 재업로드 없이 보정한다.
 * 같은 원본 mediaKey를 공유하는 17개 문항을 1개 묶음으로 다룬다.
 * 오디오의 긴 무음이 불명확하면 저장하지 않고 CSV를 받는다.
 */
import { useMemo, useState } from 'react';
import { Ic, fmt } from './icons';
import { analyzeRemoteAudio, parseClipCsv } from '../lib/audioSilence';
import type { ClipRange } from '../lib/audioSilence';
import { getMediaUrl, updateItemClip } from '../lib/store';
import type { Item } from '../lib/types';

type Group = { key: string; title: string; items: Item[] };
type Props = { items: Item[]; onClose: () => void; onChanged: () => void; toast: (message:string) => void };
const questionNo = (item: Item): number => {
  const no = item.questionNo || item.title.match(/(?:^|\s)(\d{1,2})번$/)?.[1] || '';
  const num = Number(no);
  return Number.isInteger(num) && num >= 1 && num <= 17 ? num : 0;
};
export default function ClipRepairModal({ items, onClose, onChanged, toast }: Props) {
  const groups = useMemo(() => {
    const grouped = new Map<string,Item[]>();
    for (const item of items) {
      if (!item.mediaKey || !questionNo(item)) continue;
      const list = grouped.get(item.mediaKey) || [];
      list.push(item);
      grouped.set(item.mediaKey,list);
    }
    return [...grouped].map(([key, list]):Group => ({
      key,
      title: list[0]!.title.replace(/\s+\d{1,2}번$/, ''),
      items:list.sort((a,b)=>questionNo(a)-questionNo(b)),
    })).filter(g => g.items.length === 17 &&
      Array.from({length:17},(_,i)=>i+1).every(n => g.items.some(it=>questionNo(it)===n)));
  }, [items]);

  const [chosen, setChosen] = useState<string>('');
  const group = groups.find(g=>g.key===chosen) || groups[0];
  const [ranges, setRanges] = useState<ClipRange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');

  const analyze = async () => {
    if (!group || busy || saving) return;
    setBusy(true);
    setError('');
    setRanges(null);
    try {
      const url = await getMediaUrl(group.key);
      if (!url) throw new Error('원본 음원 링크를 가져오지 못했습니다');
      const detected = await analyzeRemoteAudio(url);
      setRanges(detected);
      setSource('원본 음원의 무음 분석');
    } catch (e) {
      setError(e instanceof Error ? e.message : '음원 분석에 실패했습니다');
    } finally { setBusy(false); }
  };

  const csv = async (file?: File) => {
    if (!file || saving) return;
    setError('');
    try {
      const text = await file.text();
      const parsed = parseClipCsv(text);
      setRanges(parsed);
      setSource('CSV 구간표');
    } catch (e) {
      setRanges(null);
      setError(e instanceof Error ? e.message : '구간표를 읽지 못했습니다');
    }
  };

  const apply = async () => {
    if (!group || !ranges || saving || busy) return;
    if (ranges.length !== 17 || ranges.some(r=>r.endSec<=r.startSec) ||
        ranges.some(r=>!Number.isFinite(r.startSec)||!Number.isFinite(r.endSec))) {
      setError('시작·종료 시간을 확인해 주세요');
      return;
    }
    if (!window.confirm(
      group.title + '의 17개 문항을 원본 음원 기준으로 보정할까요?\n' +
      '재생 구간만 변경하며 원본 MP3와 전사 스크립트는 삭제하지 않습니다.',
    )) return;
    setSaving(true);
    setProcessed(0);
    setError('');
    const updated: Item[] = [];
    try {
      for (const it of group.items) {
        const target = ranges.find(r=>r.no===questionNo(it));
        if (!target) throw new Error(questionNo(it) + '번 구간이 없습니다');
        await updateItemClip(it.id,target.startSec,target.endSec);
        updated.push(it);
        setProcessed(updated.length);
      }
      await Promise.resolve(onChanged());
      toast('17개 문항의 재생 구간을 보정했습니다');
      onClose();
    } catch (e) {
      const rollback=await Promise.allSettled(updated.map(it=>
        updateItemClip(it.id,it.clipStartSec,it.clipEndSec,it.durationSec)
      ));
      const undone=rollback.filter(r=>r.status==='rejected').length;
      setError(
        (e instanceof Error?e.message:'구간 저장에 실패했습니다') +
        (undone ? ' · 일부 문항 되돌리기 실패: '+undone+'개' : ' · 변경된 문항은 원래 구간으로 복원했습니다'),
      );
      await Promise.resolve(onChanged());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay" role="presentation" onMouseDown={(e)=>{
      if ((e.target as HTMLElement).classList.contains('overlay') && !busy && !saving) onClose();
    }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="문항 재생 구간 보정">
        <div className="modal-head">
          <h2>문항 재생 구간 보정</h2>
          <div style={{flex:1}}/>
          <button className="icon-btn" disabled={busy || saving} onClick={onClose} aria-label="닫기"><Ic.x /></button>
        </div>
        <div className="modal-body">
          <p style={{fontSize:13,lineHeight:1.65,color:'var(--ink-2)',marginBottom:16}}>
            전사 스크립트의 첫·마지막 단어로 자르면 앞뒤 음성이 누락될 수 있습니다.
            원본 MP3의 긴 무음을 분석해 17개 문항을 한꺼번에 보정합니다. 재업로드는 필요 없습니다.
          </p>
          {groups.length===0 ? (
            <div style={{padding:16,border:'1px solid var(--line)',borderRadius:10,color:'var(--ink-3)',fontSize:13,lineHeight:1.65}}>
              하나의 원본 음원을 공유하는 17개 문항을 찾지 못했습니다.
              문항을 17개로 나눠 등록한 음원만 일괄 보정할 수 있습니다.
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="clip-repair-source">보정할 회차</label>
                <select id="clip-repair-source" className="input" style={{width:'100%'}}
                  disabled={busy||saving}
                  value={group?.key??''}
                  onChange={e=>{setChosen(e.target.value);setRanges(null);setError('');}}>
                  {groups.map((g,i)=><option key={g.key} value={g.key}>{g.title} · 17문항 (묶음 {i+1})</option>)}
                </select>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginTop:12,marginBottom:16}}>
                <button className="btn primary" disabled={busy||saving}
                  onClick={()=>void analyze()}>
                  {busy?'음원 분석 중…':'원본 음원으로 자동 보정'}
                </button>
                <label className="btn ghost sm" style={{cursor:saving?'not-allowed':'pointer'}}>
                  CSV 구간표 선택
                  <input type="file" accept=".csv,text/csv,text/plain" style={{display:'none'}}
                    disabled={saving} onChange={e=>{void csv(e.target.files?.[0]);e.target.value='';}} />
                </label>
              </div>
              {ranges && (
                <>
                  <div style={{fontSize:12.5,color:'var(--ink-2)',marginBottom:9}}>
                    {source} · 16·17번은 같은 구간을 사용합니다. 시각을 수정할 수도 있습니다.
                  </div>
                  <div style={{maxHeight:310,overflowY:'auto',border:'1px solid var(--line)',borderRadius:10}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12.5}}>
                      <thead><tr><th style={{padding:8,textAlign:'left'}}>문항</th>
                        <th style={{padding:8,textAlign:'left'}}>기존</th>
                        <th style={{padding:8,textAlign:'left'}}>새 시작(초)</th>
                        <th style={{padding:8,textAlign:'left'}}>새 종료(초)</th></tr></thead>
                      <tbody>{ranges.map(r=>{
                        const item=group?.items.find(it=>questionNo(it)===r.no);
                        return <tr key={r.no} style={{borderTop:'1px solid var(--line-2)'}}>
                          <td style={{padding:6}}>{r.no}번</td>
                          <td style={{padding:6,color:'var(--ink-3)',whiteSpace:'nowrap'}}>
                            {fmt(item?.clipStartSec??0)}–{fmt(item?.clipEndSec??0)}
                          </td>
                          {(['startSec','endSec'] as const).map(k=><td key={k} style={{padding:4}}>
                            <input className="input" type="number" min="0" step=".1"
                              style={{maxWidth:96,width:'100%',padding:'6px 4px',fontSize:12}}
                              disabled={saving} aria-label={r.no+'번 '+(k==='startSec'?'시작':'끝')+' 초'}
                              value={r[k]} onChange={e=>{
                                const next=Number(e.target.value);
                                setRanges(old=>old?.map(x=>x.no===r.no?{...x,[k]:next}:x)??null);
                              }}/>
                          </td>)}
                        </tr>;
                      })}</tbody>
                    </table>
                  </div>
                  <p style={{fontSize:12,color:'var(--ink-3)',marginTop:10,lineHeight:1.6}}>
                    보정 전·후 시간을 확인하세요. 음원 재생 범위만 바뀌며,
                    AI가 전사하지 못한 스크립트 문장은 자동 복구되지 않습니다.
                  </p>
                </>
              )}
            </>
          )}
          {saving && <div role="status" style={{fontSize:13,marginTop:12}}>저장 중… {processed}/17개</div>}
          {error && <div role="alert" style={{fontSize:13,marginTop:12,color:'#c8392b',lineHeight:1.65}}>{error}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} disabled={busy||saving}>닫기</button>
          {ranges && <button className="btn primary" disabled={busy||saving}
            onClick={()=>void apply()}>
            <Ic.check/> {saving?'보정 중…':'17개 문항에 적용'}
          </button>}
        </div>
      </div>
    </div>
  );
}
