import {measuredNumber} from './performance-evidence.mjs';
const positive=x=>measuredNumber(x)&&Number(x)>0;
const rounded=x=>Number.isFinite(x)?Number(x.toFixed(4)):null;

export async function loadReplayBars(get, url, symbol, maxPages=100) {
  const query=new URL(url),seen=new Set(),bars=[];
  for(let page=0;page<maxPages;page++) {
    const raw=await get(query.href);
    const rows=Array.isArray(raw?.bars)?raw.bars:raw?.bars?.[symbol];
    if(!Array.isArray(rows)) throw new Error('REPLAY_BARS_UNAVAILABLE');
    bars.push(...rows);
    const token=raw.next_page_token;
    if(!token) return bars;
    if(typeof token!=='string'||seen.has(token)) throw new Error('REPLAY_PAGINATION_INVALID');
    seen.add(token);query.searchParams.set('page_token',token);
  }
  throw new Error('REPLAY_HISTORY_INCOMPLETE');
}

// One-minute bar timestamps denote the START of each interval. Exclude the
// entry interval (which contains pre-fill prices) and any interval after exit.
export function calculateTradeReplay(trade, bars) {
  const entry=Number(trade.actualAverageEntry),stop=Number(trade.plannedStop);
  const start=Date.parse(trade.entryFilledAt),end=Date.parse(trade.finalExitAt);
  if(!positive(trade.actualAverageEntry)||!positive(trade.plannedStop)||stop>=entry||!Number.isFinite(start)||!Number.isFinite(end)||end<=start) return null;
  const risk=entry-stop;
  const observed=new Map();
  for(const b of bars||[]) {
    const at=Date.parse(b.t);
    if(!Number.isFinite(at)||at<start||at+60000>end||![b.h,b.l,b.c].every(positive)||Number(b.h)<Number(b.l)||Number(b.c)>Number(b.h)||Number(b.c)<Number(b.l)) continue;
    // Duplicate provider timestamps do not add observations.
    if(!observed.has(at)) observed.set(at,{at,h:Number(b.h),l:Number(b.l),c:Number(b.c)});
  }
  const rows=[...observed.values()].sort((a,b)=>a.at-b.at);
  if(!rows.length) return null;
  const high=rows.reduce((a,b)=>b.h>a.h?b:a),low=Math.min(...rows.map(b=>b.l));
  const exitAt=minutes=>{
    const target=start+minutes*60000;
    const b=rows.find(b=>b.at+60000>=target&&b.at+60000<target+60000);
    return b?rounded((b.c-entry)/risk):null;
  };
  let edgeDecayMinutes=null;
  for(let i=5;i<rows.length;i++) {
    const window=rows.slice(i-5,i+1);
    if(window.every((b,j)=>j===0||b.at-window[j-1].at===60000)&&window.at(-1).c<entry&&window.filter(b=>b.c<entry).length>=4) {
      edgeDecayMinutes=(rows[i].at+60000-start)/60000;break;
    }
  }
  return {maximumFavorableExcursionR:rounded((high.h-entry)/risk),maximumAdverseExcursionR:rounded((low-entry)/risk),
    minutesToMFE:(high.at+60000-start)/60000,edgeDecayMinutes,
    alternativeExits:{exit15mR:exitAt(15),exit30mR:exitAt(30),exit60mR:exitAt(60),
      actualExitR:measuredNumber(trade.realizedR)?Number(trade.realizedR):positive(trade.actualAverageExit)?rounded((Number(trade.actualAverageExit)-entry)/risk):null},
    barCount:rows.length};
}
