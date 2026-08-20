import fs from 'node:fs/promises';

const OUT='docs/data/exit-policy-validation.json';
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const round=(n,d=3)=>Number(Number(n||0).toFixed(d));
const sma=(xs,n)=>avg(xs.slice(-n));
function atr(b,n=14){const xs=[];for(let i=Math.max(1,b.length-n);i<b.length;i++){const x=b[i],p=b[i-1];xs.push(Math.max(x.h-x.l,Math.abs(x.h-p.c),Math.abs(x.l-p.c)));}return avg(xs);}

const broad=await read('docs/data/broad-stock-universe.json',{}),latest=await read('docs/data/latest-500.json',{});
const symbols=[...new Set([...(broad.topCandidates||[]).map(x=>x.symbol),...(latest.recommendations||[]).map(x=>x.symbol),...(broad.top2000Preview||[]).slice(0,30).map(x=>x.symbol)])].filter(Boolean).slice(0,60);
if(symbols.length<10)throw new Error(`Exit-policy validation needs >=10 symbols; found ${symbols.length}`);
const start='2019-01-01',by={};
for(const batch of chunks(symbols,40)){
  let token='';
  for(let page=0;page<8;page++){
    const q=new URLSearchParams({symbols:batch.join(','),timeframe:'1Day',start,limit:'10000',adjustment:'all',feed:'iex'});if(token)q.set('page_token',token);
    const raw=await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for(const [s,bars] of Object.entries(raw.bars||{}))by[s]=[...(by[s]||[]),...bars];
    token=raw.next_page_token||'';if(!token)break;
  }
}

const policies={
  ALL_T2:{label:'100% at target2',t1Pct:0,t2Pct:100,runnerPct:0,trailR:null},
  T1_25_T2_75:{label:'25% at target1, 75% at target2',t1Pct:25,t2Pct:75,runnerPct:0,trailR:null},
  T1_25_T2_60_RUN15:{label:'25% at target1, 60% at target2, 15% runner',t1Pct:25,t2Pct:60,runnerPct:15,trailR:1.0},
  T1_25_T2_50_RUN25:{label:'25% at target1, 50% at target2, 25% runner',t1Pct:25,t2Pct:50,runnerPct:25,trailR:1.0}
};
function simulate(bars,i,p){
  const hist=bars.slice(0,i+1),closes=hist.map(x=>x.c),entry=closes.at(-1),ma20=sma(closes,20),ma50=sma(closes,50),a=atr(hist),risk=entry-Math.min(ma20,entry-a*1.35);
  if(!(entry>0&&ma20>ma50&&entry>ma20&&risk>0))return null;
  const t1=entry+1.5*risk,t2=entry+2.6*risk,stop=entry-risk;
  let remaining=1,realizedR=0,t1Done=false,t2Done=false,trail=null,maxClose=entry;
  const future=bars.slice(i+1,i+31);if(future.length<10)return null;
  for(const b of future){
    if(b.o<=stop)return realizedR+remaining*((b.o-entry)/risk);
    if(b.l<=stop)return realizedR+remaining*(-1);
    maxClose=Math.max(maxClose,b.c);
    if(!t1Done&&p.t1Pct>0&&b.h>=t1){const q=Math.min(remaining,p.t1Pct/100);realizedR+=q*1.5;remaining-=q;t1Done=true;}
    if(!t2Done&&b.h>=t2){const q=Math.min(remaining,p.t2Pct/100);realizedR+=q*2.6;remaining-=q;t2Done=true;if(p.runnerPct>0)trail=Math.max(entry,t2-p.trailR*risk);else if(remaining>0){realizedR+=remaining*2.6;remaining=0;}if(remaining<=0)return realizedR;}
    if(t2Done&&remaining>0&&p.runnerPct>0){trail=Math.max(trail??entry,maxClose-p.trailR*risk);if(b.l<=trail)return realizedR+remaining*((trail-entry)/risk);}
  }
  const last=future.at(-1).c;return realizedR+remaining*((last-entry)/risk);
}
const rows=[];
for(const s of symbols){const bars=by[s]||[];for(let i=220;i<bars.length-31;i+=10){const date=String(bars[i].t||'').slice(0,10);for(const [id,p] of Object.entries(policies)){const r=simulate(bars,i,p);if(r!=null&&Number.isFinite(r))rows.push({symbol:s,date,policy:id,r});}}}
function period(date){if(date<'2024-01-01')return'DEVELOPMENT';if(date<'2026-01-01')return'HOLDOUT_2024_2025';return'CONFIRMATION_2026_PLUS';}
function stats(xs){const rs=xs.map(x=>x.r),wins=rs.filter(r=>r>0).length;let eq=0,peak=0,maxDd=0;for(const r of rs){eq+=r;peak=Math.max(peak,eq);maxDd=Math.max(maxDd,peak-eq);}return{samples:rs.length,winRatePct:rs.length?round(wins/rs.length*100,1):null,avgR:rs.length?round(avg(rs),3):null,medianR:rs.length?round([...rs].sort((a,b)=>a-b)[Math.floor(rs.length/2)],3):null,maxDrawdownR:round(maxDd,2)};}
const summary={};for(const id of Object.keys(policies)){summary[id]={};for(const p of ['DEVELOPMENT','HOLDOUT_2024_2025','CONFIRMATION_2026_PLUS'])summary[id][p]=stats(rows.filter(x=>x.policy===id&&period(x.date)===p));}
const baseline='T1_25_T2_75';
const developmentRank=Object.keys(policies).map(id=>({id,dev:summary[id].DEVELOPMENT})).filter(x=>x.dev.samples>=40).sort((a,b)=>(b.dev.avgR??-99)-(a.dev.avgR??-99));
const devWinner=developmentRank[0]?.id||baseline;
let recommended=baseline,reason=`Development winner ${devWinner} did not clear untouched confirmation requirements; baseline retained.`;
if(devWinner===baseline){recommended=baseline;reason='The no-runner baseline was the strongest policy in development, so no runner policy is promoted.';}
else{
  const cH=summary[devWinner].HOLDOUT_2024_2025,bH=summary[baseline].HOLDOUT_2024_2025,cC=summary[devWinner].CONFIRMATION_2026_PLUS,bC=summary[baseline].CONFIRMATION_2026_PLUS;
  const holdOk=cH.samples>=20&&(cH.avgR??-99)>=(bH.avgR??-99)&&cH.maxDrawdownR<=Math.max(1,bH.maxDrawdownR*1.15);
  const confirmSparse=cC.samples<12;
  const confirmOk=confirmSparse||((cC.avgR??-99)>=(bC.avgR??-99)&&cC.maxDrawdownR<=Math.max(1,bC.maxDrawdownR*1.2));
  if(holdOk&&confirmOk){recommended=devWinner;reason=`${devWinner} was selected using development only, then improved or matched the untouched 2024-2025 holdout without materially worsening drawdown${confirmSparse?'; 2026+ confirmation remains sparse, so this cannot increase entry risk':''}.`;}
}
const out={schemaVersion:2,generatedAt:new Date().toISOString(),symbolsTested:symbols.length,method:'Walk-forward daily-bar exit-policy tournament. One policy is selected using pre-2024 development only; that single frozen policy is then checked on untouched 2024-2025 holdout and 2026+ confirmation. Results are research estimates, not guaranteed live fills.',developmentWinner:devWinner,baselinePolicy:baseline,recommendedPolicy:recommended,recommendationReason:reason,automaticRiskIncreaseAllowed:false,policies,summary,instructions:'Use this report only to choose among exit shapes. Never increase entry size or loosen stops because an exit policy backtested well. Missing/stale evidence falls back to the no-runner baseline.'};
await fs.writeFile(OUT,JSON.stringify(out,null,2));console.log(`Exit policy validation: ${rows.length} policy observations; development winner ${devWinner}; authorized ${recommended}.`);
