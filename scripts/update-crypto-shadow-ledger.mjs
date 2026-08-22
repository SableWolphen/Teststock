import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir=path.resolve('docs/data');
const ledgerFile=path.join(dataDir,'crypto-shadow-trades.json');
const planFile=path.join(dataDir,'crypto-plan-100.json');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=6)=>Number(Number(n||0).toFixed(d));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const day=x=>String(x||'').slice(0,10);
function headers(){const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;if(!key||!secret)throw new Error('Missing Alpaca credentials');return {'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};}
async function bars(symbol,start){const q=new URLSearchParams({symbols:symbol,timeframe:'1Day',start,limit:'1000',sort:'asc'});const r=await fetch(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${q}`,{headers:headers()});if(!r.ok)throw new Error(`Alpaca ${r.status}`);const raw=await r.json();return raw.bars?.[symbol]||[];}
function resolveTrade(t,xs){if(t.status!=='OPEN')return t;const entry=Number(t.entry),stop=Number(t.stop),target=Number(t.target2||t.target1),risk=Math.max(1e-8,entry-stop);if(!(entry>stop&&target>entry))return {...t,status:'UNKNOWN',notes:'Invalid shadow geometry'};let entered=false,count=0;for(const b of xs){if(day(b.t)<=t.createdDate)continue;if(count>=20)break;count++;if(!entered){if(!(b.l<=entry&&b.h>=entry))continue;entered=true;t.entryTouchedAt=day(b.t);}const stopHit=b.l<=stop,targetHit=b.h>=target;if(stopHit&&targetHit)return {...t,status:'AMBIGUOUS',resolvedAt:day(b.t),realizedR:null};if(stopHit)return {...t,status:'RESOLVED',outcome:'LOSS',resolvedAt:day(b.t),realizedR:-1};if(targetHit)return {...t,status:'RESOLVED',outcome:'WIN',resolvedAt:day(b.t),realizedR:round((target-entry)/risk,4)};}if(entered&&count>=20){const last=xs.filter(b=>day(b.t)>t.createdDate).slice(0,20).at(-1);if(last){const r=clamp((Number(last.c)-entry)/risk,-1,(target-entry)/risk);return {...t,status:'RESOLVED',outcome:r>0?'WIN':r<0?'LOSS':'FLAT',resolvedAt:day(last.t),realizedR:round(r,4)};}}return t;}
function summary(rows){const done=rows.filter(x=>x.status==='RESOLVED'&&Number.isFinite(Number(x.realizedR))),stats={};for(const decision of ['ACCEPTED','REJECTED']){const xs=done.filter(x=>x.decision===decision),wins=xs.filter(x=>Number(x.realizedR)>0).length;stats[decision]={resolved:xs.length,winRatePct:xs.length?round(wins/xs.length*100,1):null,averageR:xs.length?round(xs.reduce((s,x)=>s+Number(x.realizedR),0)/xs.length,2):null};}const a=stats.ACCEPTED.averageR,r=stats.REJECTED.averageR;return {...stats,opportunityCostSignal:a!=null&&r!=null?(r>a?'REJECTED_OUTPERFORMED_ACCEPTED':'ACCEPTED_OUTPERFORMED_REJECTED'):'NOT_ENOUGH_DATA',note:'Diagnostic only. Shadow outcomes may support profitability admission but must never loosen a hard live-money gate.'};}

const plan=await read(planFile,{});
let ledger=await read(ledgerFile,{schemaVersion:1,generatedAt:null,trades:[],summary:{}});
ledger.trades=Array.isArray(ledger.trades)?ledger.trades:[];

const openSymbols=[...new Set(ledger.trades.filter(x=>x.status==='OPEN').map(x=>x.symbol))];
for(const symbol of openSymbols){
  try{
    const openStarts=ledger.trades.filter(x=>x.symbol===symbol&&x.status==='OPEN').map(x=>x.createdDate).sort();
    const xs=await bars(symbol,openStarts[0]);
    ledger.trades=ledger.trades.map(t=>t.symbol===symbol?resolveTrade({...t},xs):t);
  }catch(error){console.warn(`Crypto shadow update ${symbol}: ${error.message}`);}
}

const today=new Date().toISOString().slice(0,10);
const acceptedSymbols=new Set((plan.allocations||[]).map(x=>x.symbol));
const candidates=(plan.ranked||[]).slice(0,10);
for(const r of candidates){
  if(!(Number(r.entry)>0&&Number(r.stop)>0&&Number(r.target1)>0))continue;
  const decision=acceptedSymbols.has(r.symbol)?'ACCEPTED':'REJECTED';
  const id=`${today}-${r.symbol}-${decision}-${round(r.entry,6)}-${round(r.stop,6)}`;
  if(ledger.trades.some(x=>x.id===id))continue;
  ledger.trades.push({
    id,
    createdDate:today,
    createdAt:new Date().toISOString(),
    decision,
    symbol:r.symbol,
    setupGrade:r.setupGrade,
    btcTrendSupport:r.btcTrendSupport===true,
    entry:round(r.entry,6),
    stop:round(r.stop,6),
    target1:round(r.target1,6),
    target2:round(r.target2,6),
    growthQuality:r.growthQuality,
    rewardRisk1:r.rewardRisk1,
    rewardRisk2:r.rewardRisk2,
    status:'OPEN',
    outcome:null,
    realizedR:null,
    modelOnly:true,
  });
}

ledger.trades=ledger.trades.slice(-2000);
ledger.generatedAt=new Date().toISOString();
ledger.summary=summary(ledger.trades);
ledger.rules=[
  'Tracks accepted (would-have-bought) and rejected crypto model candidates for opportunity-cost diagnostics and shadow-first profitability admission.',
  'Uses future Alpaca crypto daily bars only after the decision date; never uses future data to create the decision.',
  'Shadow evidence may unlock reduced-size live probation via scripts/apply-crypto-profitability-admission.mjs; it may never automatically increase maximum live risk or loosen a hard gate.',
  'Robinhood Crypto API-confirmed real-fill history (crypto-real-trade-journal.json) remains authoritative for actual-money performance and full admission.',
];
await fs.writeFile(ledgerFile,JSON.stringify(ledger,null,2)+'\n');
console.log(`Crypto shadow ledger: ${ledger.trades.length} records; ${JSON.stringify(ledger.summary)}`);
