import fs from 'node:fs/promises';

const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [stockJ,cryptoJ]=await Promise.all([
  read('docs/data/real-trade-journal.json',{}),
  read('docs/data/crypto-real-trade-journal.json',{})
]);
const now=new Date().toISOString();
const finite=x=>Number.isFinite(Number(x));
const avg=a=>{const x=a.filter(finite).map(Number);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;};
const median=a=>{const x=a.filter(finite).map(Number).sort((a,b)=>a-b);return x.length?x[Math.floor(x.length/2)]:null;};
const trades=[...(stockJ.trades||[]),...(cryptoJ.trades||[])].filter(t=>t?.reconciledFromRobinhood===true&&['WIN','LOSS','FLAT'].includes(t.outcome)&&finite(t.realizedR));

function session(t){
  if(t.entrySessionBucket&&t.entrySessionBucket!=='UNKNOWN') return String(t.entrySessionBucket);
  const d=new Date(t.entryFilledAt||0); if(!Number.isFinite(d.getTime())) return 'UNKNOWN';
  const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  if(p>='09:30'&&p<'10:30')return 'OPEN_0930_1030_ET';
  if(p>='10:30'&&p<'15:00')return 'MIDDAY_1030_1500_ET';
  if(p>='15:00'&&p<='16:00')return 'POWER_HOUR_1500_1600_ET';
  return t.assetClass==='CRYPTO'?'CRYPTO_OFF_HOURS':'EXTENDED_OR_UNKNOWN';
}
function key(v){return String(v??'UNKNOWN').trim().toUpperCase()||'UNKNOWN';}
function group(rows,fn){const m=new Map();for(const r of rows){const k=fn(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return [...m.entries()].map(([k,rs])=>({key:k,rows:rs}));}
function stats(rows){
  const rs=rows.map(x=>Number(x.realizedR));
  const n=rs.length,wins=rs.filter(x=>x>0).length;
  const entrySlip=avg(rows.map(x=>x.adverseEntrySlippagePct));
  const exitSlip=avg(rows.map(x=>x.adverseExitSlippagePct));
  const expectancy=avg(rs);
  // Conservative shrinkage toward zero prevents tiny samples from dominating ranking.
  const shrunk=expectancy==null?null:Number((expectancy*(n/(n+12))).toFixed(4));
  let state='COLLECT_MORE';
  if(n>=20&&shrunk!=null&&shrunk<=-0.10) state='BLOCK_OR_SHADOW';
  else if(n>=12&&shrunk!=null&&shrunk<0) state='REDUCE';
  else if(n>=20&&shrunk!=null&&shrunk>=0.15) state='FAVOR';
  else if(n>=8&&shrunk!=null&&shrunk>0) state='POSITIVE_EARLY';
  return {sampleSize:n,winRatePct:n?Number((wins/n*100).toFixed(1)):null,averageR:expectancy,medianR:median(rs),shrunkExpectancyR:shrunk,averageEntrySlippagePct:entrySlip,averageExitSlippagePct:exitSlip,state};
}
const dimensions={
  setup:t=>key(t.setupType),
  session:t=>session(t),
  regime:t=>key(t.marketRegime||t.regime),
  sector:t=>key(t.sector),
  catalyst:t=>key(t.catalystType||t.catalystCategory),
  assetClass:t=>key(t.assetClass)
};
const scorecards={};
for(const [name,fn] of Object.entries(dimensions)) scorecards[name]=group(trades,fn).map(g=>({[name]:g.key,...stats(g.rows)})).sort((a,b)=>(b.sampleSize||0)-(a.sampleSize||0));

const combos=group(trades,t=>`${key(t.setupType)}|${session(t)}|${key(t.marketRegime||t.regime)}`).map(g=>{
  const [setup,sessionBucket,regime]=g.key.split('|'); return {setup,session:sessionBucket,regime,...stats(g.rows)};
}).filter(x=>x.sampleSize>=5).sort((a,b)=>(b.shrunkExpectancyR??-999)-(a.shrunkExpectancyR??-999));

const out={
  schemaVersion:1,generatedAt:now,source:'ROBINHOOD_RECONCILED_REAL_FILLS_ONLY',resolvedTrades:trades.length,
  minimumEvidence:{positiveEarly:8,reduce:12,favorOrBlock:20,shrinkagePriorTrades:12},
  scorecards,setupSessionRegime:combos,
  livePolicy:{
    authority:'RISK_REDUCING_AND_RANKING_ONLY',
    favor:'May rank an already-qualified candidate ahead of another or retain normal encoded size; never increase the hard risk ceiling.',
    positiveEarly:'May break ties among already-qualified candidates; no size increase.',
    reduce:'Reduce size/selectivity or skip when alternatives with stronger real-fill evidence exist.',
    blockOrShadow:'Block new live entries for that evidence bucket until fresh forward/out-of-sample evidence supports reconsideration.',
    insufficient:'COLLECT_MORE is neutral. Missing fields or small samples never count as negative evidence.',
    immutableRules:['Never create eligibility','Never increase hard risk ceilings','Never override stale-data, broker, spread, protection, daily-loss, account, or duplicate-order gates','Never treat hypothetical/shadow/backtest results as real fills']
  }
};
await write('docs/data/real-fill-scorecard.json',out);
console.log(`Real-fill scorecard: ${trades.length} reconciled resolved trades; ${combos.length} setup/session/regime buckets with >=5 samples.`);
